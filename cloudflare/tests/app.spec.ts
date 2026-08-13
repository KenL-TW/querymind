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
  loginUi,
  ownerCredentials,
  provisionViewer,
} from "./helpers";

const evidenceDir = process.env.QUERYMIND_E2E_OUTPUT || path.join(os.tmpdir(), "querymind-e2e");

test.describe("QueryMind product workspace", () => {
  test.beforeAll(async () => { await mkdir(evidenceDir, { recursive: true }); });

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
      ["usage", "我的用量"], ["source", "資料來源"], ["admin-overview", "管理總覽"],
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
    await expect(page.locator('[data-page^="admin-"]')).toHaveCount(0);

    await page.goto(absoluteUrl("/#/admin-users"), { waitUntil: "domcontentloaded" });
    await expect(page.locator(".topbar h1")).toHaveText("工作總覽");
    await expect(page.getByText("viewer", { exact: true }).first()).toBeVisible();
  });

  test("mobile shell has no document overflow and passes basic accessibility checks", async ({ page }) => {
    const consoleIssues = collectConsoleIssues(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginUi(page);
    await expect(page.getByRole("button", { name: "開啟選單" })).toBeVisible();
    await page.getByRole("button", { name: "開啟選單" }).click();
    await expect(page.getByRole("navigation", { name: "主要選單" })).toBeVisible();
    await expect(page.locator('[data-page="chat"]').first()).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    expect(await basicAccessibilityIssues(page)).toEqual([]);
    await page.screenshot({ path: path.join(evidenceDir, "querymind-mobile.png"), fullPage: false });
    expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
  });
});
