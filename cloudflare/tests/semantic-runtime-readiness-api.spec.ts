import { expect, test } from "playwright/test";
import { absoluteUrl, loginApi } from "./helpers";

test.describe("P2-H Semantic Runtime Readiness API", () => {
  test("is authenticated, capability-gated, read-only, and reports the empty-registry baseline", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    expect((await anonymous.get(absoluteUrl("/api/v1/admin/semantic-runtime/readiness"))).status()).toBe(401);
    await anonymous.dispose();

    const owner = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    await loginApi(owner);
    const response = await owner.get(absoluteUrl("/api/v1/admin/semantic-runtime/readiness"));
    expect(response.status(), await response.text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runtimeCapability: "AVAILABLE",
      activationCurrentState: "DISABLED",
      status: "NOT_READY",
      checks: { registry: { status: "NOT_READY", code: "NO_APPROVED_SEMANTIC", approvedEligibleAssets: 0 }, policyEngine: { status: "PASS" }, evidenceHook: { status: "PASS" } },
      blockers: ["NO_APPROVED_SEMANTIC"],
    });
    await owner.dispose();
  });
});
