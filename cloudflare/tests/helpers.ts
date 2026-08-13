import { expect, type APIRequestContext, type Page } from "playwright/test";

export const baseUrl = process.env.QUERYMIND_TEST_URL || "http://127.0.0.1:8787";
export const ownerCredentials = {
  email: process.env.QUERYMIND_TEST_EMAIL || "owner@example.com",
  password: process.env.QUERYMIND_TEST_PASSWORD || "correct-horse-battery-staple",
};

/**
 * Stateful product tests are safe by default: localhost may mutate its test D1,
 * while a remote deployment requires an explicit opt-in.
 */
export const allowMutatingE2E =
  process.env.QUERYMIND_ALLOW_MUTATING_E2E === "true"
  || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/u.test(baseUrl);

export function absoluteUrl(pathname: string): string {
  return new URL(pathname, baseUrl).href;
}

export async function expectOk(response: { ok(): boolean; status(): number; text(): Promise<string> }, label: string): Promise<void> {
  if (!response.ok()) {
    const body = await response.text();
    expect(response.ok(), `${label} failed (${response.status()}): ${body}`).toBeTruthy();
  }
}

export async function loginApi(api: APIRequestContext, credentials = ownerCredentials): Promise<{ id: string; email: string; roleName: string }> {
  const response = await api.post(absoluteUrl("/api/v1/auth/login"), { data: credentials });
  await expectOk(response, `login for ${credentials.email}`);
  const payload = await response.json() as { user: { id: string; email: string; roleName: string } };
  return payload.user;
}

export async function loginUi(page: Page, credentials = ownerCredentials): Promise<void> {
  // The semantic dashboard assertion below is the readiness signal. Waiting
  // for global network-idle makes this helper vulnerable to streams, browser
  // extensions and unrelated background requests.
  await page.goto(absoluteUrl("/"), { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("QueryMind");
  await expect(page.getByRole("heading", { name: "登入 QueryMind" })).toBeVisible();
  await page.getByLabel("電子郵件", { exact: true }).fill(credentials.email);
  await page.getByLabel("密碼", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登入工作區" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("工作總覽");
}

export async function provisionViewer(api: APIRequestContext): Promise<{ id: string; email: string; password: string }> {
  await loginApi(api);
  const email = `viewer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = "viewer-test-password";
  const invitationResponse = await api.post(absoluteUrl("/api/v1/admin/invitations"), {
    data: { email, roleName: "viewer", expiresHours: 1 },
  });
  await expectOk(invitationResponse, "create viewer invitation");
  const invitation = await invitationResponse.json() as { inviteToken: string };
  const acceptResponse = await api.post(absoluteUrl("/api/v1/auth/accept-invitation"), {
    data: { token: invitation.inviteToken, email, displayName: "E2E Viewer", password },
  });
  expect(acceptResponse.status(), await acceptResponse.text()).toBe(201);
  const user = await loginApi(api, { email, password });
  expect(user.roleName).toBe("viewer");
  return { id: user.id, email, password };
}

export function collectConsoleIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") issues.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.message}`));
  return issues;
}

export async function basicAccessibilityIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = [];
    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const accessibleName = (element: Element): string => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent || "").join(" ")
        : "";
      const id = element.getAttribute("id");
      const explicitLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || "" : "";
      const implicitLabel = element.closest("label")?.textContent || "";
      return [element.getAttribute("aria-label"), labelledText, explicitLabel, implicitLabel, element.getAttribute("title"), element.textContent]
        .filter(Boolean).join(" ").trim();
    };

    const mains = [...document.querySelectorAll("main")];
    if (mains.length !== 1) issues.push(`expected one main landmark, found ${mains.length}`);
    if (document.querySelector("main main")) issues.push("main landmark must not be nested");
    if (document.querySelectorAll("h1").length !== 1) issues.push(`expected one h1, found ${document.querySelectorAll("h1").length}`);
    if (!document.documentElement.lang) issues.push("document language is missing");

    const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    if (duplicateIds.length) issues.push(`duplicate ids: ${duplicateIds.join(", ")}`);

    for (const control of document.querySelectorAll("button, input, select, textarea")) {
      if (visible(control) && !accessibleName(control)) issues.push(`${control.tagName.toLowerCase()} has no accessible name`);
    }
    for (const image of document.querySelectorAll("img")) {
      if (visible(image) && !image.hasAttribute("alt")) issues.push("visible image is missing alt text");
    }
    return issues;
  });
}
