import { expect, test } from "playwright/test";
import { allowMutatingE2E, absoluteUrl, expectOk, loginApi, loginUi } from "./helpers";

test.describe("P2-D Semantic Registry suggestion workspace", () => {
  test.skip(!allowMutatingE2E, "Suggestion UI test requires disposable local D1 or explicit mutation opt-in.");

  test("renders controlled AI suggestions, preserves navigation state, and opens the existing editable Draft composer", async ({ page, request }) => {
    await loginApi(request);
    await expectOk(await request.post(absoluteUrl("/api/v1/schema/refresh")), "refresh schema for suggestion UI");
    const generated = await request.post(absoluteUrl("/api/v1/semantics/suggestions/generate"), { data: { tableNames: ["orders"], suggestionTypes: ["TERM"], maxSuggestions: 1 } });
    expect(generated.status(), await generated.text()).toBe(200);

    await loginUi(page);
    await page.locator('[data-page="semantics"]').first().click();
    await expect(page.locator(".topbar h1")).toHaveText("Semantic Registry");
    await page.getByRole("button", { name: "AI Suggestions" }).click();
    await expect(page.getByRole("heading", { name: "AI Schema Suggestions" })).toBeVisible();
    await expect(page.getByText("AI 建議僅依目前可授權存取的 Schema Metadata 產生", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "使用此建議建立草稿" }).first()).toBeVisible();
    await expect(page.getByText(/Publish|Execute/, { exact: false })).toHaveCount(0);

    // Regression: P2-C/P2-D workspace state must not collide with P1 chat state.
    await page.locator('[data-page="chat"]').first().click();
    await expect(page.locator(".topbar h1")).toHaveText("AI 對話");
    await page.locator('[data-page="semantics"]').first().click();
    await expect(page.locator(".topbar h1")).toHaveText("Semantic Registry");
    await page.getByRole("button", { name: "AI Suggestions" }).click();
    await expect(page.getByRole("heading", { name: "AI Schema Suggestions" })).toBeVisible();

    await page.getByRole("button", { name: "使用此建議建立草稿" }).first().click();
    await expect(page.getByRole("heading", { name: "Review AI suggestion as Draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Draft" })).toBeVisible();
    await expect(page.locator('textarea[name="semantic-definition"]')).toHaveValue(/AI suggested/);
  });
});
