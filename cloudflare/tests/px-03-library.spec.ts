import { expect, test } from "playwright/test";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  absoluteUrl,
  allowMutatingE2E,
  basicAccessibilityIssues,
  expectOk,
  loginApi,
  loginUi,
  navigateToPage,
  ownerCredentials,
  provisionViewer,
} from "./helpers";

const evidenceDir = process.env.QUERYMIND_E2E_OUTPUT || path.join(os.tmpdir(), "querymind-e2e");

test.describe("PX-03 contextual Save to Library", () => {
  test.beforeAll(async ({ request }) => {
    await mkdir(evidenceDir, { recursive: true });
    if (!allowMutatingE2E) return;
    const login = await request.post(absoluteUrl("/api/v1/auth/login"), { data: ownerCredentials });
    await expectOk(login, "login before PX-03 schema-dependent tests");
    await expectOk(await request.post(absoluteUrl("/api/v1/schema/refresh")), "refresh schema catalog before PX-03 tests");
  });

  test("contextual save uses owned successful intent, stores no SQL, and is idempotent", async ({ playwright }) => {
    test.skip(!allowMutatingE2E, "PX-03 persistence test requires disposable local D1.");
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const otherApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    let insightId = "";
    try {
      await loginApi(ownerApi, ownerCredentials);
      const prompt = "PX-03 contextual intent " + Date.now();
      const query = await ownerApi.post("/api/v1/query", { data: { sql: "SELECT COUNT(*) AS product_count FROM products", prompt } });
      await expectOk(query, "create successful governed query run");
      const queryRunId = (await query.json() as { queryRunId: string }).queryRunId;

      const first = await ownerApi.post("/api/v1/insights", {
        data: { queryRunId, title: "PX-03 saved product count", description: "Local demo note", prompt: "untrusted client prompt" },
      });
      expect(first.status(), await first.text()).toBe(201);
      const firstBody = await first.json() as { insight: { id: string; prompt: string; description: string }; alreadySaved: boolean };
      insightId = firstBody.insight.id;
      expect(firstBody.alreadySaved).toBe(false);
      expect(firstBody.insight.prompt).toBe(prompt);
      expect(firstBody.insight.description).toBe("Local demo note");
      expect(firstBody.insight.id).toBe(queryRunId);
      expect(firstBody.insight).not.toHaveProperty("sql");
      expect(firstBody.insight).not.toHaveProperty("rows");
      expect(firstBody.insight).not.toHaveProperty("result");

      const duplicate = await ownerApi.post("/api/v1/insights", { data: { queryRunId, title: "Ignored duplicate title" } });
      expect(duplicate.status(), await duplicate.text()).toBe(200);
      await expect(duplicate.json()).resolves.toMatchObject({ insight: { id: insightId, title: "PX-03 saved product count" }, alreadySaved: true });

      const listed = await ownerApi.get("/api/v1/insights");
      await expectOk(listed, "read own saved analyses");
      const items = (await listed.json() as { insights: Array<{ id: string; sql?: string | null }> }).insights;
      expect(items.filter((item) => item.id === insightId)).toHaveLength(1);
      expect(items.find((item) => item.id === insightId)?.sql).toBeNull();

      const audit = await ownerApi.get("/api/v1/admin/audit?limit=200");
      await expectOk(audit, "read bounded insight audit evidence");
      const auditRows = (await audit.json() as { events: Array<{ eventType: string; resourceId: string }> }).events;
      expect(auditRows.filter((event) => event.eventType === "insight.created" && event.resourceId === insightId)).toHaveLength(1);

      const beforeFailureAudit = await ownerApi.get("/api/v1/admin/audit?limit=200");
      const beforeFailureEvents = (await beforeFailureAudit.json() as { events: Array<{ eventType: string; resourceId: string }> }).events;
      const priorQueryRuns = new Set(beforeFailureEvents.filter((event) => event.eventType === "query.executed").map((event) => event.resourceId));
      const failedQuery = await ownerApi.post("/api/v1/query", {
        data: { sql: "SELECT ABS(-9223372036854775808) AS value FROM products LIMIT 1", prompt: "PX-03 deterministic execution failure" },
      });
      expect(failedQuery.ok()).toBe(false);
      expect(await failedQuery.json()).not.toHaveProperty("queryRunId");
      const afterFailureAudit = await ownerApi.get("/api/v1/admin/audit?limit=200");
      const afterFailureEvents = (await afterFailureAudit.json() as { events: Array<{ eventType: string; resourceId: string; metadata: string }> }).events;
      const failedRunEvent = afterFailureEvents.find((event) => {
        if (event.eventType !== "query.executed" || priorQueryRuns.has(event.resourceId)) return false;
        try { return (JSON.parse(event.metadata) as { outcome?: string }).outcome === "error"; } catch { return false; }
      });
      expect(failedRunEvent).toBeTruthy();
      const failedRunSave = await ownerApi.post("/api/v1/insights", { data: { queryRunId: failedRunEvent!.resourceId, title: "failed run must not save" } });
      expect(failedRunSave.status()).toBe(404);
      await expect(failedRunSave.json()).resolves.toMatchObject({ error: "QUERY_RUN_NOT_FOUND" });

      const viewer = await provisionViewer(ownerApi);
      await loginApi(otherApi, viewer);
      const crossOwner = await otherApi.post("/api/v1/insights", { data: { queryRunId, title: "must not save another user's run" } });
      expect(crossOwner.status()).toBe(404);
      await expect(crossOwner.json()).resolves.toMatchObject({ error: "QUERY_RUN_NOT_FOUND" });

      const missing = await ownerApi.post("/api/v1/insights", {
        data: { queryRunId: "00000000-0000-4000-8000-000000000000", title: "not a successful run" },
      });
      expect(missing.status()).toBe(404);
      await expect(missing.json()).resolves.toMatchObject({ error: "QUERY_RUN_NOT_FOUND" });

      const sqlAttempt = await ownerApi.post("/api/v1/insights", {
        data: { queryRunId, title: "no SQL snapshot", sql: "SELECT COUNT(*) AS product_count FROM products" },
      });
      expect(sqlAttempt.status()).toBe(400);
      await expect(sqlAttempt.json()).resolves.toMatchObject({ error: "INVALID_REQUEST" });
    } finally {
      if (insightId) {
        await loginApi(ownerApi, ownerCredentials);
        await ownerApi.delete("/api/v1/insights/" + insightId);
      }
      await Promise.all([ownerApi.dispose(), otherApi.dispose()]);
    }
  });

  test("successful answer offers contextual Save, lightweight dialog, and a coherent Library", async ({ page, request }) => {
    test.skip(!allowMutatingE2E, "PX-03 product-flow test requires disposable local D1.");
    const stamp = Date.now();
    const insightTitle = "PX-03 demo product analysis " + stamp;
    const prompt = "請顯示 Demo 商品數量";
    await loginApi(request, ownerCredentials);
    let sourceInsightId = "";
    let savedInsightId = "";
    const sessionIds: string[] = [];
    try {
      await loginUi(page);
      await navigateToPage(page, "library");
      await expect(page.getByRole("heading", { name: "已儲存的分析" })).toBeVisible();
      await expect(page.locator(".library-empty")).toContainText("還沒有已儲存的分析");
      await expect(page.getByRole("main").getByRole("button", { name: "Ask QueryMind" })).toBeVisible();
      const created = await request.post(absoluteUrl("/api/v1/insights"), {
        data: { title: "PX-03 source fixture " + stamp, description: "disposable local demo", prompt, sql: "SELECT COUNT(*) AS product_count FROM products", chartType: "table" },
      });
      await expectOk(created, "create disposable legacy insight for governed rerun");
      sourceInsightId = (await created.json() as { insight: { id: string } }).insight.id;
      // The preceding empty Library render cached the insights response in the SPA.
      // Reload after the API fixture is created so the legacy Insights route sees it.
      await page.reload();
      await navigateToPage(page, "insights");
      const sessionCreated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/sessions" && response.request().method() === "POST");
      const governedRerun = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/query" && response.request().method() === "POST");
      await page.locator('[data-run-insight="' + sourceInsightId + '"]').click();
      const sessionResponse = await sessionCreated;
      await expectOk(sessionResponse, "create session for successful governed result");
      sessionIds.push((await sessionResponse.json() as { session: { id: string } }).session.id);
      const queryResponse = await governedRerun;
      await expectOk(queryResponse, "execute saved SQL through current governed query route");
      await expectOk(await request.delete(absoluteUrl("/api/v1/insights/" + sourceInsightId)), "remove disposable source Insight before Library evidence");
      sourceInsightId = "";

      const saveButton = page.getByRole("button", { name: "儲存至 Library" });
      await expect(saveButton).toBeVisible();
      await page.screenshot({ path: path.join(evidenceDir, "px-03-save-action.png"), fullPage: false });
      await saveButton.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "儲存這次分析" })).toBeVisible();
      await expect(dialog.getByLabel("標題")).toHaveValue(prompt);
      await expect(dialog.getByLabel("標題")).toBeFocused();
      await page.screenshot({ path: path.join(evidenceDir, "px-03-save-dialog.png"), fullPage: false });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(saveButton).toBeFocused();
      await saveButton.click();
      const reopenedDialog = page.getByRole("dialog");
      await expect(reopenedDialog.getByRole("heading", { name: "儲存這次分析" })).toBeVisible();
      await reopenedDialog.getByLabel("標題").fill(insightTitle);
      await reopenedDialog.getByLabel("備註（選填）").fill("Demo data only; rerun checks current authorization.");
      let failSaveOnce = true;
      await page.route("**/api/v1/insights", async (route) => {
        if (route.request().method() === "POST" && failSaveOnce) {
          failSaveOnce = false;
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "TEMP_UNAVAILABLE", message: "Internal database diagnostics must not reach the UI." }) });
          return;
        }
        await route.continue();
      });
      await reopenedDialog.getByRole("button", { name: "儲存至 Library" }).click();
      await expect(reopenedDialog.getByRole("alert")).toContainText("儲存失敗，請稍後重試");
      await expect(reopenedDialog.getByRole("alert")).not.toContainText("Internal database diagnostics");
      await expect(page.locator(".saved-analysis-status")).toHaveCount(0);
      await reopenedDialog.getByRole("button", { name: "重試儲存" }).click();
      await expect(page.locator(".saved-analysis-status")).toContainText("已儲存");
      await expect(page.locator(".toast")).toHaveCount(0, { timeout: 6000 });
      const savedLink = page.getByRole("link", { name: "查看 Library" });
      await expect(savedLink).toBeVisible();
      await page.screenshot({ path: path.join(evidenceDir, "px-03-saved-state.png"), fullPage: false });
      await savedLink.click();

      await expect(page.locator(".topbar h1")).toHaveText("Library");
      const savedCard = page.locator(".saved-analysis-card").filter({ hasText: insightTitle });
      await expect(savedCard).toContainText(prompt);
      await expect(savedCard).toContainText("儲存於");
      await expect(savedCard).not.toContainText("SELECT COUNT(*)");
      await expect(page.getByRole("heading", { name: "查詢範本" })).toBeVisible();
      await expect(page.getByText("與個人已儲存的分析分開管理")).toBeVisible();
      await expect(page.locator(".library-legacy")).toBeVisible();
      const listed = await request.get(absoluteUrl("/api/v1/insights"));
      await expectOk(listed, "read saved demo analysis for cleanup");
      savedInsightId = ((await listed.json()) as { insights: Array<{ id: string; title: string }> }).insights.find((item) => item.title === insightTitle)?.id || "";
      await page.screenshot({ path: path.join(evidenceDir, "px-03-library.png"), fullPage: true });

      await savedCard.getByRole("button", { name: "重新命名" }).click();
      const renameDialog = page.getByRole("dialog");
      await expect(renameDialog.getByRole("heading", { name: "重新命名分析" })).toBeVisible();
      const renamedTitle = insightTitle + " renamed";
      await renameDialog.getByLabel("標題").fill(renamedTitle);
      await renameDialog.getByRole("button", { name: "儲存名稱" }).click();
      await expect(page.locator(".saved-analysis-card").filter({ hasText: renamedTitle })).toBeVisible();
      await expect(page.locator(".toast")).toHaveCount(0, { timeout: 6000 });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => {
        const sidebar = document.querySelector(".sidebar");
        return sidebar instanceof HTMLElement && sidebar.getBoundingClientRect().right <= 0;
      });
      await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: "instant" }));
      await page.screenshot({ path: path.join(evidenceDir, "px-03-library-mobile.png"), fullPage: true });
      const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      expect(await basicAccessibilityIssues(page)).toEqual([]);
      await page.setViewportSize({ width: 1280, height: 800 });

      const savedRunId = savedInsightId;
      const intentSessionCreated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/sessions" && response.request().method() === "POST");
      const intentRerun = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/chat" && response.request().method() === "POST");
      await page.locator('[data-run-insight="' + savedInsightId + '"]').click();
      const intentSessionResponse = await intentSessionCreated;
      await expectOk(intentSessionResponse, "create fresh session for saved intent rerun");
      const intentSessionId = (await intentSessionResponse.json() as { session: { id: string } }).session.id;
      const intentResponse = await intentRerun;
      await expectOk(intentResponse, "rerun saved intent through existing governed Chat route");
      sessionIds.push(intentSessionId);
      const messages = await request.get(absoluteUrl("/api/v1/sessions/" + intentSessionId + "/messages"));
      await expectOk(messages, "read new execution evidence from rerun session");
      const messagePayload = await messages.json() as { messages: Array<{ metadata_json: string }> };
      const runIds = messagePayload.messages.flatMap((message) => {
        try {
          const metadata = JSON.parse(message.metadata_json) as { queryRunId?: string };
          return metadata.queryRunId ? [metadata.queryRunId] : [];
        } catch { return []; }
      });
      expect(runIds.length).toBeGreaterThan(0);
      expect(runIds).not.toContain(savedRunId);
      await expect(page.locator("[data-query-result]")).toBeVisible();
      await navigateToPage(page, "library");
      const savedCardAfterRerun = page.locator('[data-insight-item="' + savedInsightId + '"]');
      await expect(savedCardAfterRerun).toBeVisible();
      page.once("dialog", (dialog) => void dialog.accept());
      const deleted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/insights/" + savedInsightId && response.request().method() === "DELETE");
      await savedCardAfterRerun.getByRole("button", { name: "刪除" }).click();
      await expectOk(await deleted, "delete saved analysis from Library");
      savedInsightId = "";
      await expect(savedCardAfterRerun).toHaveCount(0);
      await expect(page.locator(".library-empty")).toContainText("還沒有已儲存的分析");
    } finally {
      if (!savedInsightId) {
        const listed = await request.get(absoluteUrl("/api/v1/insights"));
        if (listed.ok()) {
          const items = (await listed.json() as { insights: Array<{ id: string; title: string }> }).insights;
          savedInsightId = items.find((item) => item.title === insightTitle)?.id || "";
        }
      }
      if (savedInsightId) await request.delete(absoluteUrl("/api/v1/insights/" + savedInsightId));
      if (sourceInsightId) await request.delete(absoluteUrl("/api/v1/insights/" + sourceInsightId));
      for (const sessionId of sessionIds) await request.delete(absoluteUrl("/api/v1/sessions/" + sessionId));
    }
  });

  test("a successful result without manage_own_insights has no Save control and API rejects mutation", async ({ playwright, page }) => {
    test.skip(!allowMutatingE2E, "PX-03 RBAC test requires disposable local D1.");
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const viewerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    let viewerSessionId = "";
    let originalCapabilities: string[] = [];
    try {
      await loginApi(ownerApi, ownerCredentials);
      const roles = await ownerApi.get("/api/v1/admin/roles");
      await expectOk(roles, "read role capabilities");
      const rolePayload = await roles.json() as { roles: Array<{ roleName: string; capabilities: string[] }> };
      originalCapabilities = rolePayload.roles.find((role) => role.roleName === "viewer")?.capabilities || [];
      expect(originalCapabilities).toContain("manage_own_insights");
      await expectOk(await ownerApi.patch("/api/v1/admin/roles/viewer", { data: { capabilities: originalCapabilities.filter((item) => item !== "manage_own_insights") } }), "remove capability from disposable Viewer fixture");

      const viewer = await provisionViewer(ownerApi);
      await loginApi(viewerApi, viewer);
      const session = await viewerApi.post("/api/v1/sessions", { data: { title: "PX-03 no-save capability fixture" } });
      await expectOk(session, "create Viewer session");
      viewerSessionId = (await session.json() as { session: { id: string } }).session.id;
      const query = await viewerApi.post("/api/v1/query", { data: { sessionId: viewerSessionId, prompt: "PX-03 Viewer successful result", sql: "SELECT COUNT(*) AS product_count FROM products" } });
      await expectOk(query, "run successful Viewer query");
      const queryRunId = (await query.json() as { queryRunId: string }).queryRunId;
      const mutation = await viewerApi.post("/api/v1/insights", { data: { queryRunId, title: "must be denied" } });
      expect(mutation.status()).toBe(403);
      await expect(mutation.json()).resolves.toMatchObject({ error: "RBAC_FORBIDDEN" });

      await loginUi(page, viewer);
      await navigateToPage(page, "history");
      await page.locator('[data-session="' + viewerSessionId + '"]').click();
      await expect(page.locator("[data-query-result]")).toBeVisible();
      await expect(page.locator("[data-save-query-run]")).toHaveCount(0);
      await navigateToPage(page, "library");
      await expect(page.getByRole("heading", { name: "已儲存的分析" })).toHaveCount(0);
    } finally {
      if (viewerSessionId) await viewerApi.delete("/api/v1/sessions/" + viewerSessionId);
      if (originalCapabilities.length) {
        await loginApi(ownerApi, ownerCredentials);
        await expectOk(await ownerApi.patch("/api/v1/admin/roles/viewer", { data: { capabilities: originalCapabilities } }), "restore Viewer role capabilities");
      }
      await Promise.all([ownerApi.dispose(), viewerApi.dispose()]);
    }
  });

  test("rerunning a stored SQL analysis after a scope change uses a new governed execution", async ({ playwright, page }) => {
    test.skip(!allowMutatingE2E, "PX-03 scope-change test requires disposable local D1.");
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const viewerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    let contextualInsightId = "";
    let sqlInsightId = "";
    let viewer: { id: string; email: string; password: string } | undefined;
    let sessionId = "";
    try {
      await loginApi(ownerApi, ownerCredentials);
      viewer = await provisionViewer(ownerApi);
      await loginApi(ownerApi, ownerCredentials);
      await expectOk(await ownerApi.patch("/api/v1/admin/users/" + viewer.id, { data: { dataScopeKey: "scope:tw" } }), "assign initial deterministic Taipei scope");
      await loginApi(viewerApi, viewer);

      const sql = "SELECT orders.shipping_city, COUNT(*) AS order_count FROM orders GROUP BY orders.shipping_city";
      const prompt = "依配送城市彙總訂單";
      const initial = await viewerApi.post("/api/v1/query", { data: { sql, prompt } });
      await expectOk(initial, "execute under initial scope");
      const initialResult = await initial.json() as { queryRunId: string; rows: Array<{ shipping_city: string }> };
      expect(initialResult.rows.every((row) => row.shipping_city === "Taipei")).toBe(true);

      const contextual = await viewerApi.post("/api/v1/insights", { data: { queryRunId: initialResult.queryRunId, title: "PX-03 saved intent under Taipei scope" } });
      expect(contextual.status(), await contextual.text()).toBe(201);
      contextualInsightId = (await contextual.json() as { insight: { id: string } }).insight.id;
      const sqlInsight = await viewerApi.post("/api/v1/insights", { data: { title: "PX-03 legacy saved SQL under Taipei scope", prompt, sql } });
      expect(sqlInsight.status(), await sqlInsight.text()).toBe(201);
      sqlInsightId = (await sqlInsight.json() as { insight: { id: string } }).insight.id;

      await loginApi(ownerApi, ownerCredentials);
      await expectOk(await ownerApi.patch("/api/v1/admin/users/" + viewer.id, { data: { dataScopeKey: "scope:jp" } }), "change user to deterministic Tokyo scope");
      await loginUi(page, viewer);
      await navigateToPage(page, "library");
      const sessionCreated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/sessions" && response.request().method() === "POST");
      const newRunResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/query" && response.request().method() === "POST");
      await page.locator('[data-run-insight="' + sqlInsightId + '"]').click();
      const sessionResponse = await sessionCreated;
      await expectOk(sessionResponse, "create a fresh session for current-scope rerun");
      sessionId = (await sessionResponse.json() as { session: { id: string } }).session.id;
      const rerun = await newRunResponse;
      await expectOk(rerun, "rerun saved SQL under current scope");
      const rerunPayload = await rerun.json() as { queryRunId: string; rows: Array<{ shipping_city: string }>; rowCount: number };
      expect(rerunPayload.queryRunId).not.toBe(initialResult.queryRunId);
      expect(rerunPayload.rowCount).toBe(0);
      expect(rerunPayload.rows).toEqual([]);
      await expect(page.locator("[data-query-result]")).toContainText("查詢成功，沒有符合條件的資料");
      await expect(page.locator("[data-query-result]")).not.toContainText("Taipei");
    } finally {
      if (contextualInsightId) await viewerApi.delete("/api/v1/insights/" + contextualInsightId);
      if (sqlInsightId) await viewerApi.delete("/api/v1/insights/" + sqlInsightId);
      if (sessionId) await viewerApi.delete("/api/v1/sessions/" + sessionId);
      if (viewer) {
        await loginApi(ownerApi, ownerCredentials);
        await ownerApi.patch("/api/v1/admin/users/" + viewer.id, { data: { dataScopeKey: "" } });
      }
      await Promise.all([ownerApi.dispose(), viewerApi.dispose()]);
    }
  });

  test("Library is owner-scoped, safely renders legacy content, hides SQL, and supports deletion", async ({ playwright, page }) => {
    test.skip(!allowMutatingE2E, "PX-03 ownership and content-safety test requires disposable local D1.");
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const viewerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    let insightId = "";
    try {
      await loginApi(ownerApi, ownerCredentials);
      const stamp = Date.now();
      const unsafeTitle = `<img src=x onerror=alert(1)> PX-03 ${stamp}`;
      const storedSql = "SELECT COUNT(*) AS product_count FROM products";
      const created = await ownerApi.post("/api/v1/insights", { data: { title: unsafeTitle, description: "<script>alert(1)</script>", prompt: "PX-03 safely escaped content", sql: storedSql } });
      await expectOk(created, "create legacy SQL fixture for UI disclosure check");
      insightId = (await created.json() as { insight: { id: string } }).insight.id;

      const viewer = await provisionViewer(ownerApi);
      await loginApi(viewerApi, viewer);
      const viewerList = await viewerApi.get("/api/v1/insights");
      await expectOk(viewerList, "read Viewer-owned saved analyses");
      expect((await viewerList.json() as { insights: Array<{ id: string }> }).insights.some((item) => item.id === insightId)).toBe(false);

      await loginUi(page, ownerCredentials);
      await navigateToPage(page, "library");
      const card = page.locator('[data-insight-item="' + insightId + '"]');
      await expect(card.locator("h3")).toContainText(unsafeTitle);
      await expect(card).not.toContainText(storedSql);
      await expect(card.locator("img, script, [onerror], [onload]")).toHaveCount(0);
      await expect(card).toContainText("<script>alert(1)</script>");

      page.once("dialog", (dialog) => void dialog.accept());
      const deleted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/insights/" + insightId && response.request().method() === "DELETE");
      await card.getByRole("button", { name: "刪除" }).click();
      await expectOk(await deleted, "delete owner-owned analysis");
      insightId = "";
      await expect(card).toHaveCount(0);
      await expect(page.locator(".library-empty")).toBeVisible();
    } finally {
      if (insightId) await ownerApi.delete("/api/v1/insights/" + insightId);
      await Promise.all([ownerApi.dispose(), viewerApi.dispose()]);
    }
  });
});
