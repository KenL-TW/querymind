import { expect, test } from "playwright/test";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  absoluteUrl,
  allowMutatingE2E,
  basicAccessibilityIssues,
  collectConsoleIssues,
  expectOk,
  loginApi,
  loginUi,
  ownerCredentials,
  provisionViewer,
} from "./helpers";

const evidenceDir = process.env.QUERYMIND_E2E_OUTPUT || path.join(os.tmpdir(), "querymind-e2e");

test.describe("QueryMind product workspace", () => {
  test.beforeAll(async ({ request }) => {
    await mkdir(evidenceDir, { recursive: true });
    if (!allowMutatingE2E) return;
    const login = await request.post(absoluteUrl("/api/v1/auth/login"), { data: ownerCredentials });
    await expectOk(login, "login before schema-dependent product navigation");
    const refresh = await request.post(absoluteUrl("/api/v1/schema/refresh"));
    await expectOk(refresh, "refresh schema catalog before product navigation");
  });

  test("health and document responses expose production security boundaries", async ({ request }) => {
    const health = await request.get(absoluteUrl("/health"));
    await expectOk(health, "health check");
    await expect(health.json()).resolves.toMatchObject({
      service: "querymind",
      status: "ok",
      databases: { data: "ok", app: "ok" },
    });

    const document = await request.get(absoluteUrl("/"));
    await expectOk(document, "application document");
    expect(document.headers()["content-type"]).toContain("text/html");
    expect(document.headers()["x-content-type-options"]).toBe("nosniff");
    expect(document.headers()["x-frame-options"]).toBe("DENY");
    expect(document.headers()["permissions-policy"]).toContain("camera=()");
    expect(document.headers()["content-security-policy"]).toContain("default-src 'self'");
    expect(document.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  test("Owner can log in and navigate every product module", async ({ page }) => {
    const consoleIssues = collectConsoleIssues(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await loginUi(page);

    const modules: Array<[string, string]> = [
      ["dashboard", "工作總覽"], ["chat", "AI 對話"], ["schema", "資料綱要"],
      ["dictionary", "資料字典"], ["templates", "查詢範本"], ["insights", "我的洞察"],
      ["usage", "我的用量"], ["source", "資料來源"], ["semantics", "Semantic Registry"], ["admin-overview", "管理總覽"],
      ["admin-users", "使用者"], ["admin-roles", "角色與權限"], ["admin-invitations", "邀請"],
      ["admin-audit", "稽核紀錄"], ["admin-system", "系統設定"], ["profile", "個人設定"],
    ];

    const navigation = page.getByRole("navigation", { name: "主要選單" });
    for (const [pageName, title] of modules) {
      const control = page.locator(`[data-page="${pageName}"]`).first();
      await expect(control, `${title} should be available to Owner`).toBeVisible();
      await control.click();
      await expect(page.locator(".topbar h1")).toHaveText(title);
    }
    await expect(navigation).toBeVisible();
    await expect(page.getByText(ownerCredentials.email, { exact: true })).toBeVisible();
    expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
  });

  test("Semantic Registry escapes metadata and drops undeclared sensitive fields", async ({ page }) => {
    const consoleIssues = collectConsoleIssues(page);
    const maliciousName = '<img src=x onerror="alert(1)">';
    await loginUi(page);
    await page.route("**/api/v1/semantics**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ assetId: "asset-safe-1", assetType: "TERM", canonicalName: "safe_term", displayName: maliciousName, domain: "sales", ownerUserId: "owner-safe-1", assetStatus: "ACTIVE", latestRevision: { revisionId: "revision-safe-1", revisionNumber: 1, status: "DRAFT" }, data_scope_key: "scope-secret", rawRowPredicate: "tenant_id = secret", credential: "not-for-ui" }],
          page: { page: 1, limit: 25, total: 1, hasNext: false },
        }),
      });
    });
    try {
      await page.locator('[data-page="semantics"]').first().click();
      const registry = page.locator(".semantic-registry");
      await expect(registry).toContainText(maliciousName);
      await expect(registry.locator('img[src="x"]')).toHaveCount(0);
      await expect(registry).not.toContainText("scope-secret");
      await expect(registry).not.toContainText("tenant_id = secret");
      await expect(registry).not.toContainText("not-for-ui");
    } finally {
      await page.unroute("**/api/v1/semantics**");
    }
    expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
  });

  test("Semantic Registry governs a draft lifecycle without invoking runtime query paths", async ({ page }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const consoleIssues = collectConsoleIssues(page);
    const unexpectedRuntimeRequests: string[] = [];
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (["/api/v1/chat", "/api/v1/query", "/api/v1/export"].includes(pathname)) unexpectedRuntimeRequests.push(`${request.method()} ${pathname}`);
    });

    await loginUi(page);
    const refresh = await page.context().request.post(absoluteUrl("/api/v1/schema/refresh"));
    await expectOk(refresh, "refresh schema catalog for Semantic Registry UI");
    await page.locator('[data-page="semantics"]').first().click();
    await expect(page.locator(".semantic-registry")).toBeVisible();
    await page.getByRole("button", { name: "Create Semantic Asset" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Create Semantic Asset" })).toBeVisible();
    await dialog.locator('[name="semantic-asset-type"]').selectOption("METRIC");
    await expect(dialog.getByText("僅能建立受限結構式 AST；不支援 SQL 表達式。", { exact: true })).toBeVisible();
    await expect(dialog.locator("[data-semantic-expression-root] [data-expression-kind]").first()).toBeVisible();
    await expect(dialog.locator('textarea[name*="sql" i], input[name*="sql" i]')).toHaveCount(0);
    await dialog.locator('[name="semantic-asset-type"]').selectOption("TERM");
    await dialog.locator('[name="semantic-canonical-name"]').fill(`support_case_${stamp.replace(/[^a-z0-9]/giu, "").toLowerCase()}`);
    await dialog.locator('[name="semantic-display-name"]').fill(`Support case ${stamp}`);
    await dialog.locator('[name="semantic-domain"]').fill("support");
    await dialog.locator('[name="semantic-asset-description"]').fill("A deterministic P2-C design-time UI fixture.");
    await dialog.locator('[name="semantic-definition"]').fill("A case recorded by the support team.");
    await dialog.getByRole("button", { name: "Create Draft" }).click();

    await expect(page.locator(".semantic-detail h2")).toHaveText(`Support case ${stamp}`);
    await expect(page.locator(".semantic-detail")).toContainText("DRAFT");
    await page.getByRole("button", { name: "Revision History" }).click();
    await expect(page.getByRole("heading", { name: "Revision history" })).toBeVisible();
    await expect(page.locator(".semantic-table")).toContainText("v1");
    await page.getByRole("button", { name: "Overview" }).click();
    page.once("dialog", (nativeDialog) => nativeDialog.accept());
    await page.getByRole("button", { name: "Submit for Review" }).click();
    await expect(page.locator(".semantic-detail")).toContainText("IN_REVIEW");

    await page.getByRole("button", { name: "Request Changes" }).click();
    const requestChanges = page.getByRole("dialog");
    await requestChanges.getByLabel("Review comment").fill("Please clarify the business definition.");
    await requestChanges.getByRole("button", { name: "Request Changes" }).click();
    await expect(page.locator(".semantic-detail")).toContainText("DRAFT");

    page.once("dialog", (nativeDialog) => nativeDialog.accept());
    await page.getByRole("button", { name: "Submit for Review" }).click();
    await expect(page.locator(".semantic-detail")).toContainText("IN_REVIEW");
    await page.getByRole("button", { name: "Reject" }).click();
    const reject = page.getByRole("dialog");
    await reject.getByLabel("Review comment").fill("Rejected only as a deterministic P2-C UI fixture.");
    await reject.getByRole("button", { name: "Reject Revision" }).click();
    await expect(page.locator(".semantic-detail")).toContainText("REJECTED");
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByText(/registry version/iu)).toHaveCount(0);
    await page.screenshot({ path: path.join(evidenceDir, "querymind-semantic-registry-desktop.png"), fullPage: false });
    expect(unexpectedRuntimeRequests).toEqual([]);
    expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
  });

  test("mock AI conversation renders a governed result and archive filtering is exact", async ({ page }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const consoleIssues = collectConsoleIssues(page);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const prompt = `目前有多少筆未取消訂單？ E2E ${stamp}`;
    const activeSentinel = `Active E2E ${stamp}`;
    const createdSessionIds: string[] = [];

    await loginUi(page);
    const api = page.context().request;
    const configuration = await api.get(absoluteUrl("/api/v1/config"), { timeout: 5_000 });
    await expectOk(configuration, "load runtime configuration");
    const runtime = await configuration.json() as { ai: { availability: string } };
    test.skip(runtime.ai.availability !== "mock", "This deterministic conversation test requires AI mock mode.");
    await page.locator('[data-page="chat"]').first().click();
    await page.getByLabel("輸入資料問題").fill(prompt);
    const chatResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/chat" && response.request().method() === "POST",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: "送出" }).click();
    const chatResponse = await chatResponsePromise;
    expect(chatResponse.ok(), `mock chat failed (${chatResponse.status()}): ${await chatResponse.text()}`).toBeTruthy();

    const result = page.locator(".message.assistant .query-result").last();
    await expect(result.getByText("查詢結果", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(result.locator(".query-table tbody tr")).toHaveCount(1);
    await expect(result.locator(".query-table thead th")).toHaveText(["訂單數量"]);
    const explanation = page.locator(".message.assistant .query-explainability").last();
    await expect(explanation.getByText("查詢說明", { exact: true })).toBeVisible();
    await expect(explanation).not.toContainText("可解釋查詢查詢完成");
    await expect(explanation.locator(".sql-disclosure")).toHaveCount(1);
    await expect(explanation.locator(".sql-disclosure")).toHaveAttribute("open", "");
    await expect(explanation.locator(".sql-disclosure pre")).toBeVisible();
    await expect(explanation.locator(".sql-disclosure pre")).toContainText("SELECT COUNT(*) AS order_count");
    await result.getByRole("button", { name: "SQL", exact: true }).click();
    await expect(result.locator(".sql-panel pre")).toContainText("SELECT COUNT(*) AS order_count");

    const archivedItem = page.locator(".session-item").filter({ hasText: prompt });
    await expect(archivedItem).toHaveCount(1);
    const archivedSessionId = await archivedItem.locator("[data-session]").getAttribute("data-session");
    expect(archivedSessionId).toBeTruthy();
    createdSessionIds.push(archivedSessionId!);

    const createActive = await api.post(absoluteUrl("/api/v1/sessions"), { data: { title: activeSentinel }, timeout: 5_000 });
    await expectOk(createActive, "create active session sentinel");
    const activePayload = await createActive.json() as { session: { id: string } };
    createdSessionIds.push(activePayload.session.id);

    try {
      const archiveResponsePromise = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/v1/sessions/${archivedSessionId}` && response.request().method() === "PATCH",
        { timeout: 7_000 },
      );
      await archivedItem.getByRole("button", { name: "封存對話" }).click();
      const archiveResponse = await archiveResponsePromise;
      expect(archiveResponse.ok(), `archive failed (${archiveResponse.status()}): ${await archiveResponse.text()}`).toBeTruthy();
      await expect(archivedItem).toHaveCount(0);

      const archiveListPromise = page.waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return url.pathname === "/api/v1/sessions" && url.searchParams.get("archived") === "true" && response.request().method() === "GET";
        },
        { timeout: 7_000 },
      );
      await page.getByRole("button", { name: "查看封存對話" }).click();
      const archiveList = await archiveListPromise;
      expect(archiveList.ok(), `archive list failed (${archiveList.status()}): ${await archiveList.text()}`).toBeTruthy();
      await expect(page.locator(".session-item").filter({ hasText: prompt })).toHaveCount(1);
      await expect(page.locator(".session-item").filter({ hasText: activeSentinel })).toHaveCount(0);
      await expect(page.getByLabel("輸入資料問題")).toBeDisabled();
      await page.screenshot({ path: path.join(evidenceDir, "querymind-chat-archive-desktop.png"), fullPage: false });
    } finally {
      const cleanup = await Promise.all(createdSessionIds.map((id) => api.delete(absoluteUrl(`/api/v1/sessions/${id}`), { timeout: 5_000 })));
      for (const response of cleanup) await expectOk(response, "remove E2E session");
    }
    expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
  });

  test("empty verified SQL stays hidden and result headers remain separate table cells", async ({ page }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const consoleIssues = collectConsoleIssues(page);
    const api = page.context().request;
    const insightId = "p11-empty-sql-regression";
    const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let sessionId = "";

    await loginUi(page);
    await page.route("**/api/v1/insights", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          insights: [{
            id: insightId,
            title: "P1.1 empty SQL regression",
            description: "Frontend defensive rendering fixture",
            prompt: "請列出銷售額最高的商品",
            sql: "SELECT products.name AS product_name, SUM(order_items.subtotal) AS sales_amount FROM products JOIN order_items ON order_items.product_id = products.id GROUP BY products.name",
            chartType: "table",
            isFavorite: false,
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
          }],
        }),
      });
    });
    await page.route("**/api/v1/query", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          rows: [{ product_name: "QueryBook Air", sales_amount: 29990 }],
          rowCount: 1,
          rowCap: 100,
          maskedColumns: [],
          durationMs: 1,
          queryRunId: runId,
          sql: "",
          explainability: {
            version: "p1",
            queryRunId: runId,
            understanding: { intent: "比較與彙總資料", metrics: ["sales amount"], dimensions: ["product"], filters: [], timeRange: null, ranking: "ordered or ranked results", assumptions: [], confidence: "high" },
            sources: { tables: [{ name: "products", label: "Products" }, { name: "order_items", label: "Order Items" }], governance: { scopeApplied: true, rowPolicyApplied: false, columnPolicyApplied: true, dlpApplied: true }, result: { rowCount: 1, truncated: false } },
            explanation: { business: "來源：Products、Order Items；指標：sales amount；分組：product；共產生 1 筆結果。", rawSqlAvailable: true, sql: "   " },
            summary: { headline: "查詢完成，共 1 筆結果", highlights: [], caveats: [] },
            feedback: { supported: true, queryRunId: runId },
          },
        }),
      });
    });

    try {
      await page.locator('[data-page="insights"]').first().click();
      const sessionCreated = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/v1/sessions" && response.request().method() === "POST",
        { timeout: 7_000 },
      );
      await page.locator(`[data-run-insight="${insightId}"]`).click();
      const sessionResponse = await sessionCreated;
      expect(sessionResponse.ok(), `create P1.1 regression session failed (${sessionResponse.status()}): ${await sessionResponse.text()}`).toBeTruthy();
      sessionId = ((await sessionResponse.json()) as { session: { id: string } }).session.id;

      const result = page.locator(".message.assistant .query-result").last();
      await expect(result).toBeVisible();
      await expect(result.locator(".query-table thead th")).toHaveText(["商品名稱", "銷售額"]);
      await expect(result.getByRole("button", { name: "SQL", exact: true })).toHaveCount(0);
      await expect(page.locator(".query-explainability .sql-disclosure")).toHaveCount(0);
      await expect(result.locator(".query-table thead th").evaluateAll((headers) => headers.map((header) => ({ display: getComputedStyle(header).display, borderLeftWidth: getComputedStyle(header).borderLeftWidth })))).resolves.toEqual([
        { display: "table-cell", borderLeftWidth: "0px" },
        { display: "table-cell", borderLeftWidth: "1px" },
      ]);
    } finally {
      await page.unroute("**/api/v1/insights");
      await page.unroute("**/api/v1/query");
      if (sessionId) {
        const remove = await api.delete(absoluteUrl(`/api/v1/sessions/${sessionId}`), { timeout: 5_000 });
        await expectOk(remove, "remove P1.1 regression session");
      }
    }
    expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
  });

  test("Owner can create and revoke an invitation and one-time API key", async ({ page }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inviteEmail = `invite-${stamp}@example.test`;
    const keyLabel = `E2E automation ${stamp}`;
    await loginUi(page);

    await page.locator('[data-page="admin-invitations"]').first().click();
    await page.getByRole("button", { name: "建立邀請" }).click();
    const inviteDialog = page.getByRole("dialog");
    await inviteDialog.getByLabel("電子郵件").fill(inviteEmail);
    await inviteDialog.getByLabel("角色").selectOption("viewer");
    await inviteDialog.getByRole("button", { name: "建立一次性邀請" }).click();
    await expect(inviteDialog.getByRole("heading", { name: "請安全傳送此連結" })).toBeVisible();
    const invitationLink = await inviteDialog.locator(".secret-value").textContent();
    expect(invitationLink).toBeTruthy();
    const invitationUrl = new URL(invitationLink!);
    expect(invitationUrl.pathname).toBe("/accept-invite");
    expect(invitationUrl.search).toBe("");
    expect(invitationUrl.hash).toMatch(/^#token=qmi_/u);
    expect(invitationLink).not.toContain("?token=");
    await inviteDialog.getByRole("button", { name: "關閉" }).click();
    await expect(page.locator("tbody tr").filter({ hasText: inviteEmail })).toContainText("待接受");

    const invitee = await page.context().browser()!.newPage();
    try {
      const token = new URLSearchParams(invitationUrl.hash.slice(1)).get("token");
      expect(token).toMatch(/^qmi_/u);
      const previewRequestPromise = invitee.waitForRequest(
        (request) => new URL(request.url()).pathname === "/api/v1/auth/invitation" && request.method() === "POST",
        { timeout: 7_000 },
      );
      await invitee.goto(invitationLink!, { waitUntil: "domcontentloaded" });
      const previewRequest = await previewRequestPromise;
      expect(new URL(previewRequest.url()).search).toBe("");
      expect(previewRequest.url()).not.toContain(token!);
      expect(previewRequest.postDataJSON()).toEqual({ token });
      await expect(invitee.getByRole("heading", { name: "加入 QueryMind" })).toBeVisible();
      await expect(invitee.locator(".invite-summary")).toContainText(inviteEmail);
      await expect(invitee.getByLabel("設定密碼")).toBeVisible();
    } finally {
      await invitee.close();
    }

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("tbody tr").filter({ hasText: inviteEmail }).getByRole("button", { name: "撤銷" }).click();
    await expect(page.locator("tbody tr").filter({ hasText: inviteEmail })).toContainText("已撤銷");

    await page.locator('[data-page="admin-users"]').first().click();
    const ownerRow = page.locator("tbody tr").filter({ hasText: ownerCredentials.email });
    await ownerRow.getByRole("button", { name: "API Keys" }).click();
    let keyDialog = page.getByRole("dialog");
    await keyDialog.getByLabel("Key 名稱").fill(keyLabel);
    await keyDialog.getByRole("button", { name: "建立新 Key" }).click();
    await expect(keyDialog.getByRole("heading", { name: "新的 API Key" })).toBeVisible();
    await expect(keyDialog.locator(".secret-value")).toHaveText(/^qm_/u);
    await keyDialog.getByRole("button", { name: "關閉" }).click();

    await ownerRow.getByRole("button", { name: "API Keys" }).click();
    keyDialog = page.getByRole("dialog");
    const keyItem = keyDialog.locator(".key-list li").filter({ hasText: keyLabel });
    await expect(keyItem).toHaveCount(1);
    await keyItem.getByRole("button", { name: "撤銷 API Key" }).click();
    keyDialog = page.getByRole("dialog");
    await expect(keyDialog.locator(".key-list li").filter({ hasText: keyLabel })).toContainText("已撤銷");
  });

  test("viewer sees only role-appropriate menus", async ({ page, request }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const viewer = await provisionViewer(request);
    await loginUi(page, viewer);

    for (const pageName of ["dashboard", "chat", "schema", "dictionary", "templates", "insights", "usage", "profile"]) {
      await expect(page.locator(`[data-page="${pageName}"]`).first()).toBeVisible();
    }
    await expect(page.locator('[data-page="source"]')).toHaveCount(0);
    await expect(page.locator('[data-page="semantics"]')).toHaveCount(0);
    await expect(page.locator('[data-page^="admin-"]')).toHaveCount(0);

    await page.goto(absoluteUrl("/#/admin-users"), { waitUntil: "domcontentloaded" });
    await expect(page.locator(".topbar h1")).toHaveText("工作總覽");
    await expect(page.getByText("viewer", { exact: true }).first()).toBeVisible();
  });

  test("view_semantics alone permits read-only registry access", async ({ page, request }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const viewer = await provisionViewer(request);
    await loginApi(request);
    const rolesResponse = await request.get(absoluteUrl("/api/v1/admin/roles"));
    await expectOk(rolesResponse, "read viewer role before semantic view-only test");
    const roles = await rolesResponse.json() as { roles: Array<{ roleName: string; capabilities: string[] }> };
    const viewerRole = roles.roles.find((role) => role.roleName === "viewer");
    expect(viewerRole).toBeTruthy();
    const originalCapabilities = viewerRole!.capabilities;
    const semanticViewOnlyCapabilities = [...new Set([...originalCapabilities, "view_semantics"])]
      .filter((capability) => capability !== "manage_semantic_drafts" && capability !== "review_semantics");

    await expectOk(await request.patch(absoluteUrl("/api/v1/admin/roles/viewer"), { data: { capabilities: semanticViewOnlyCapabilities } }), "grant local view_semantics fixture");
    try {
      await loginUi(page, viewer);
      await expect(page.locator('[data-page="semantics"]').first()).toBeVisible();
      await page.locator('[data-page="semantics"]').first().click();
      await expect(page.locator(".topbar h1")).toHaveText("Semantic Registry");
      await expect(page.getByRole("button", { name: "Create Semantic Asset" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Submit for Review|Request Changes|Reject/ })).toHaveCount(0);
      const forcedMutationStatus = await page.evaluate(async () => {
        const response = await fetch("/api/v1/semantics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        return response.status;
      });
      expect(forcedMutationStatus).toBe(403);
    } finally {
      await loginApi(request);
      await expectOk(await request.patch(absoluteUrl("/api/v1/admin/roles/viewer"), { data: { capabilities: originalCapabilities } }), "restore viewer role after semantic view-only test");
    }
  });

  test("mobile shell has no document overflow and passes basic accessibility checks", async ({ page }) => {
    const consoleIssues = collectConsoleIssues(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginUi(page);
    await expect(page.getByRole("button", { name: "開啟選單" })).toBeVisible();
    await page.getByRole("button", { name: "開啟選單" }).click();
    await expect(page.getByRole("navigation", { name: "主要選單" })).toBeVisible();
    await expect(page.locator('[data-page="chat"]').first()).toBeVisible();
    await expect(page.locator('[data-page="semantics"]').first()).toBeVisible();
    await page.locator('[data-page="semantics"]').first().click();
    await expect(page.locator(".topbar h1")).toHaveText("Semantic Registry");
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    expect(await basicAccessibilityIssues(page)).toEqual([]);
    await page.screenshot({ path: path.join(evidenceDir, "querymind-mobile.png"), fullPage: false });
    await page.screenshot({ path: path.join(evidenceDir, "querymind-semantic-registry-mobile.png"), fullPage: false });
    expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
  });

  test("P1.2 feedback uses progressive evidence targets and preserves correction on retry", async ({ page }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const insightId = "p12-feedback-fixture";
    const createdSessionIds: string[] = [];
    let feedbackCalls = 0;
    await loginUi(page);
    await page.route("**/api/v1/insights**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ insights: [{ id: insightId, title: "P1.2 feedback fixture", description: "deterministic evidence feedback", prompt: "請依商品列出銷售額", sql: "SELECT products.name, SUM(order_items.subtotal) AS sales_revenue FROM products JOIN order_items ON order_items.product_id = products.id GROUP BY products.name", chartType: "table", isFavorite: false, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" }] }) });
    });
    await page.route("**/api/v1/query", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [{ product_name: "QueryBook Air", sales_revenue: 29990 }], rowCount: 1, rowCap: 100, maskedColumns: [], durationMs: 1, queryRunId: runId, sql: "SELECT products.name, SUM(order_items.subtotal) AS sales_revenue FROM products JOIN order_items ON order_items.product_id = products.id GROUP BY products.name", explainability: { version: "p1", queryRunId: runId, understanding: { intent: "比較與彙總資料", metrics: ["sales amount"], dimensions: ["product"], filters: [], timeRange: null, ranking: null, assumptions: [], confidence: "high" }, sources: { tables: [{ name: "products", label: "Products" }, { name: "order_items", label: "Order Items" }], governance: { scopeApplied: true, rowPolicyApplied: false, columnPolicyApplied: true, dlpApplied: true }, result: { rowCount: 1, truncated: false } }, explanation: { business: "指標：sales amount；依商品分組", rawSqlAvailable: true, sql: "SELECT products.name, SUM(order_items.subtotal) AS sales_revenue FROM products JOIN order_items ON order_items.product_id = products.id GROUP BY products.name" }, summary: { headline: "查詢完成，共 1 筆結果", highlights: [], caveats: [] }, feedback: { supported: true, queryRunId: runId } } }) });
    });
    await page.route("**/api/v1/query-runs/*/feedback", async (route) => {
      feedbackCalls += 1;
      if (feedbackCalls === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "TEMPORARY", message: "暫時無法記錄，請重試。" }) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, feedback: { id: "feedback-fixture", version: "p1.2", rating: "NEEDS_ADJUSTMENT", target: { type: "METRIC", ref: "sales amount" }, category: "metric", submittedAt: "2026-08-28T00:00:00.000Z" } }) });
    });
    try {
      await page.locator('[data-page="insights"]').first().click();
      const sessionCreated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/sessions" && response.request().method() === "POST", { timeout: 7_000 });
      await page.locator(`[data-run-insight="${insightId}"]`).click();
      const sessionResponse = await sessionCreated;
      await expectOk(sessionResponse, "create P1.2 fixture session");
      createdSessionIds.push(((await sessionResponse.json()) as { session: { id: string } }).session.id);
      const explanation = page.locator(".query-explainability").last();
      await expect(explanation.getByText("這份結果符合你的需求嗎？", { exact: true })).toBeVisible();
      await expect(explanation.getByRole("button", { name: "符合需求" })).toBeVisible();
      await expect(explanation.getByRole("button", { name: "調整這份結果" })).toBeVisible();
      await explanation.getByRole("button", { name: /針對sales amount提出調整/ }).click();
      const feedback = explanation.locator("[data-feedback-box]");
      await expect(feedback.locator(".feedback-negative")).toBeVisible();
      await expect(feedback.locator("[data-feedback-target]")).toHaveValue(/METRIC::/u);
      await feedback.locator("[data-feedback-correction]").fill("這是 <script>alert(1)</script> 的修正");
      await feedback.getByRole("button", { name: "送出回饋" }).click();
      await expect(feedback).toContainText("暫時無法記錄");
      await expect(feedback.locator("[data-feedback-correction]")).toHaveValue("這是 <script>alert(1)</script> 的修正");
      await feedback.getByRole("button", { name: "重試" }).click();
      await expect(feedback.locator(".feedback-complete")).toContainText("已記錄這次調整建議");
      expect(feedbackCalls).toBe(2);
    } finally {
      await page.unroute("**/api/v1/insights**");
      await page.unroute("**/api/v1/query");
      await page.unroute("**/api/v1/query-runs/*/feedback");
      const api = page.context().request;
      for (const id of createdSessionIds) await expectOk(await api.delete(absoluteUrl(`/api/v1/sessions/${id}`), { timeout: 5_000 }), "remove P1.2 fixture session");
    }
  });
});
