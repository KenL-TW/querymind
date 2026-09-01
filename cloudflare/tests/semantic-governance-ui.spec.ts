import { expect, test } from "playwright/test";
import { absoluteUrl, allowMutatingE2E, baseUrl, expectOk, loginApi, loginUi, ownerCredentials, provisionViewer } from "./helpers";

test.describe("P2-Ia Semantic Governance bootstrap UI", () => {
  test("Owner with governance capability can load both admin surfaces without creating registry content", async ({ page, request }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    await loginApi(request);
    await loginUi(page);
    const readinessBefore = await request.get(absoluteUrl("/api/v1/admin/semantic-runtime/readiness"));
    await expectOk(readinessBefore, "readiness before governance UI smoke");
    const before = await readinessBefore.json() as { registryVersion?: number };

    await page.goto(absoluteUrl("/#/admin-semantic-authorities"), { waitUntil: "domcontentloaded" });
    await expect(page.locator(".topbar h1")).toHaveText("Semantic Authorities");
    await expect(page.getByRole("button", { name: "新增 Authority" })).toBeVisible();
    await expect(page.getByText("Role != Semantic Authority。", { exact: false })).toBeVisible();
    await page.goto(absoluteUrl("/#/admin-semantic-policies"), { waitUntil: "domcontentloaded" });
    await expect(page.locator(".topbar h1")).toHaveText("Approval Policies");
    await expect(page.getByRole("button", { name: "新增 Approval Policy" })).toBeVisible();

    const readinessAfter = await request.get(absoluteUrl("/api/v1/admin/semantic-runtime/readiness"));
    await expectOk(readinessAfter, "readiness after governance UI smoke");
    await expect(readinessAfter.json()).resolves.toMatchObject({ registryVersion: before.registryVersion });
  });

  test("unauthorized user cannot see or mutate governance settings", async ({ page, request }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const viewer = await provisionViewer(request);
    await loginUi(page, viewer);
    await expect(page.locator('[data-page="admin-semantic-authorities"]')).toHaveCount(0);
    await expect(page.locator('[data-page="admin-semantic-policies"]')).toHaveCount(0);
    await page.goto(absoluteUrl("/#/admin-semantic-authorities"), { waitUntil: "domcontentloaded" });
    await expect(page.locator(".topbar h1")).toHaveText("工作總覽");
    const mutation = await request.post(absoluteUrl("/api/v1/semantics/governance/policies"), { data: { scopeKind: "DOMAIN", domain: "p2ia_unauthorized", riskClass: "STANDARD", requiredApprovals: 1, allowProposerSelfApproval: false, allowEmergencyPublication: false, postReviewDueHours: 72 } });
    expect(mutation.status()).toBe(403);
    await expect(mutation.json()).resolves.toMatchObject({ error: "RBAC_FORBIDDEN" });
  });

  test("explicit authority and policy lifecycle is audited while platform roles remain unchanged", async ({ playwright }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    try {
      await loginApi(ownerApi, ownerCredentials);
      const usersResponse = await ownerApi.get(absoluteUrl("/api/v1/admin/users"));
      await expectOk(usersResponse, "list users for governance bootstrap fixture");
      const users = (await usersResponse.json() as { users: Array<{ id: string; roleName: string; isActive: boolean }> }).users;
      let dba = users.find((user) => user.roleName === "dba" && user.isActive);
      // Disposable local D1 starts with only the bootstrapped Owner. Create a
      // real DBA-role user through the existing invitation flow for this
      // fixture; never manufacture a user against a remote deployment.
      if (!dba && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/u.test(baseUrl)) {
        const email = `dba-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
        const password = "dba-test-password";
        const invitation = await ownerApi.post(absoluteUrl("/api/v1/admin/invitations"), { data: { email, roleName: "dba", expiresHours: 1 } });
        expect(invitation.status(), await invitation.text()).toBe(201);
        const invite = await invitation.json() as { inviteToken: string };
        const accepted = await ownerApi.post(absoluteUrl("/api/v1/auth/accept-invitation"), { data: { token: invite.inviteToken, email, displayName: "E2E DBA", password } });
        expect(accepted.status(), await accepted.text()).toBe(201);
        const refreshed = await ownerApi.get(absoluteUrl("/api/v1/admin/users"));
        await expectOk(refreshed, "refresh users after local DBA fixture");
        const refreshedUsers = (await refreshed.json() as { users: Array<{ id: string; roleName: string; isActive: boolean }> }).users;
        dba = refreshedUsers.find((user) => user.roleName === "dba" && user.isActive);
      }
      expect(dba, "an active seeded DBA is required").toBeTruthy();
      const rolesResponse = await ownerApi.get(absoluteUrl("/api/v1/admin/roles"));
      await expectOk(rolesResponse, "list roles for governance bootstrap fixture");
      const dbaRole = (await rolesResponse.json() as { roles: Array<{ roleName: string; capabilities: string[] }> }).roles.find((role) => role.roleName === "dba");
      expect(dbaRole?.capabilities || []).not.toContain("approve_semantics");

      const domain = `p2ia_${Date.now().toString(36)}`;
      const policy = await ownerApi.post(absoluteUrl("/api/v1/semantics/governance/policies"), { data: { scopeKind: "DOMAIN", domain, riskClass: "STANDARD", requiredApprovals: 1, allowProposerSelfApproval: false, allowEmergencyPublication: false, postReviewDueHours: 72 } });
      expect(policy.status(), await policy.text()).toBe(201);
      const policyId = (await policy.json() as { policyId: string }).policyId;
      const authority = await ownerApi.post(absoluteUrl("/api/v1/semantics/governance/authorities"), { data: { scopeKind: "DOMAIN", domain, userId: dba!.id, raciRole: "SEMANTIC_APPROVER", canApprove: true, canGovernRuntime: false } });
      expect(authority.status(), await authority.text()).toBe(201);
      const authorityId = (await authority.json() as { authorityId: string }).authorityId;

      const config = await ownerApi.get(absoluteUrl("/api/v1/semantics/governance/policies"));
      await expectOk(config, "list governance bootstrap records");
      const configBody = await config.json() as { policies: Array<Record<string, unknown>>; authorities: Array<Record<string, unknown>> };
      expect(configBody.policies.some((item) => item.policy_id === policyId && item.domain === domain && item.is_active === 1)).toBeTruthy();
      expect(configBody.authorities.some((item) => item.authority_id === authorityId && item.user_id === dba!.id && item.can_approve === 1 && item.is_active === 1)).toBeTruthy();

      const deactivateAuthority = await ownerApi.patch(absoluteUrl(`/api/v1/semantics/governance/authorities/${authorityId}`), { data: { isActive: false } });
      await expectOk(deactivateAuthority, "deactivate explicit authority");
      const deactivatePolicy = await ownerApi.patch(absoluteUrl(`/api/v1/semantics/governance/policies/${policyId}`), { data: { isActive: false } });
      await expectOk(deactivatePolicy, "deactivate governance policy");

      const audit = await ownerApi.get(absoluteUrl("/api/v1/admin/audit?limit=200"));
      await expectOk(audit, "read governance audit evidence");
      const events = (await audit.json() as { events: Array<{ eventType: string; resourceId: string }> }).events;
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ eventType: "semantic.governance.policy.created", resourceId: policyId }),
        expect.objectContaining({ eventType: "semantic.governance.authority.created", resourceId: authorityId }),
        expect.objectContaining({ eventType: "semantic.governance.policy.deactivated", resourceId: policyId }),
        expect.objectContaining({ eventType: "semantic.governance.authority.deactivated", resourceId: authorityId }),
      ]));
    } finally {
      await ownerApi.dispose();
    }
  });
});
