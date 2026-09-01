import { expect, test } from "playwright/test";
import { absoluteUrl, expectOk, loginApi, ownerCredentials } from "./helpers";

type UserFixture = { id: string; email: string; password: string };

async function provisionEditor(playwright: import("playwright/test").Playwright, ownerApi: import("playwright/test").APIRequestContext, suffix: string, roleName = "editor"): Promise<UserFixture> {
  const email = `semantic-approver-${suffix}-${Date.now()}@example.test`;
  const password = "semantic-approval-password";
  const invitation = await ownerApi.post(absoluteUrl("/api/v1/admin/invitations"), { data: { email, roleName, expiresHours: 1 } });
  await expectOk(invitation, "create semantic approver invitation");
  const token = (await invitation.json() as { inviteToken: string }).inviteToken;
  const userApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
  const accepted = await userApi.post(absoluteUrl("/api/v1/auth/accept-invitation"), { data: { token, email, displayName: `Approver ${suffix}`, password } });
  expect(accepted.status(), await accepted.text()).toBe(201);
  const user = await loginApi(userApi, { email, password });
  await userApi.dispose();
  return { id: user.id, email, password };
}

function termContract(canonicalName: string, domain: string) {
  return { canonicalName, displayName: "Governed service term", definition: "A deliberately bounded term for human semantic approval testing.", domain, semanticDependencies: [] };
}

test.describe("P2-E human semantic approval and publication governance", () => {
  test("fails closed until RACI exists, enforces quorum, atomically publishes, and governs runtime eligibility", async ({ playwright }) => {
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    await loginApi(ownerApi, ownerCredentials);
    await expectOk(await ownerApi.post(absoluteUrl("/api/v1/schema/refresh")), "refresh schema before P2-E approval");

    const capabilities = ["chat", "view_schema", "view_dictionary", "view_templates", "manage_own_sessions", "manage_own_insights", "view_own_usage", "view_semantics", "manage_semantic_drafts", "review_semantics", "approve_semantics", "emergency_publish_semantics", "suspend_semantics_runtime", "resume_semantics_runtime"];
    await expectOk(await ownerApi.patch(absoluteUrl("/api/v1/admin/roles/editor"), { data: { capabilities } }), "configure disposable editor governance capability fixture");

    const first = await provisionEditor(playwright, ownerApi, "one");
    const second = await provisionEditor(playwright, ownerApi, "two");
    const third = await provisionEditor(playwright, ownerApi, "three");
    const domain = `p2e_${Date.now().toString(36)}`;

    // A submitted revision is unusable until an explicit human policy and RACI
    // authority are configured. Owner's product wildcard is deliberately not
    // an approval authority.
    const unconfiguredName = `unconfigured_service_${Date.now().toString(36)}`;
    const unconfigured = await ownerApi.post(absoluteUrl("/api/v1/semantics"), { data: { assetType: "TERM", canonicalName: unconfiguredName, displayName: "Governed service term", domain, contract: termContract(unconfiguredName, domain), aliases: [] } });
    expect(unconfigured.status(), await unconfigured.text()).toBe(201);
    const unconfiguredAsset = await unconfigured.json() as { assetId: string; revisionId: string };
    await expectOk(await ownerApi.post(absoluteUrl(`/api/v1/semantics/${unconfiguredAsset.assetId}/revisions/${unconfiguredAsset.revisionId}/submit-review`)), "submit unconfigured semantic review");
    const blocked = await ownerApi.get(absoluteUrl(`/api/v1/semantics/${unconfiguredAsset.assetId}/revisions/${unconfiguredAsset.revisionId}/approval`));
    expect(blocked.status(), await blocked.text()).toBe(200);
    await expect(blocked.json()).resolves.toMatchObject({ status: "BLOCKED", code: "SEMANTIC_APPROVAL_AUTHORITY_NOT_CONFIGURED" });

    const policy = await ownerApi.post(absoluteUrl("/api/v1/semantics/governance/policies"), {
      data: { scopeKind: "DOMAIN", domain, riskClass: "HIGH", requiredApprovals: 2, allowProposerSelfApproval: false, allowEmergencyPublication: true, postReviewDueHours: 48 },
    });
    expect(policy.status(), await policy.text()).toBe(201);
    for (const user of [first, second, third]) {
      const authority = await ownerApi.post(absoluteUrl("/api/v1/semantics/governance/authorities"), {
        data: { scopeKind: "DOMAIN", domain, userId: user.id, raciRole: "SEMANTIC_APPROVER", canApprove: true, canGovernRuntime: true },
      });
      expect(authority.status(), await authority.text()).toBe(201);
    }

    const canonicalName = `governed_service_${Date.now().toString(36)}`;
    const created = await ownerApi.post(absoluteUrl("/api/v1/semantics"), { data: { assetType: "TERM", canonicalName, displayName: "Governed service term", domain, contract: termContract(canonicalName, domain), aliases: [] } });
    expect(created.status(), await created.text()).toBe(201);
    const asset = await created.json() as { assetId: string; revisionId: string };
    await expectOk(await ownerApi.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/submit-review`)), "submit semantic review");

    const noAuthority = await ownerApi.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/approve`), { data: { idempotencyKey: "owner-no-authority-0001" } });
    expect(noAuthority.status()).toBe(403);
    await expect(noAuthority.json()).resolves.toMatchObject({ error: "SEMANTIC_AUTHORITY_FORBIDDEN" });

    const approverOne = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const approverTwo = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const approverThree = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    await loginApi(approverOne, { email: first.email, password: first.password });
    await loginApi(approverTwo, { email: second.email, password: second.password });
    await loginApi(approverThree, { email: third.email, password: third.password });
    const firstApproval = await approverOne.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/approve`), { data: { idempotencyKey: "first-human-approval-0001", comment: "First bounded human approval." } });
    expect(firstApproval.status(), await firstApproval.text()).toBe(200);
    const firstApprovalBody = await firstApproval.json() as { status: string; published: boolean; registryVersion: number };
    expect(firstApprovalBody).toMatchObject({ status: "IN_REVIEW", published: false });
    const replay = await approverOne.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/approve`), { data: { idempotencyKey: "first-human-approval-0001" } });
    expect(replay.status(), await replay.text()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ published: false, registryVersion: firstApprovalBody.registryVersion, replayed: true });

    // Two independent valid approvers race for the final quorum. Exactly one
    // command may publish and increment the registry; the other must be
    // rejected atomically rather than creating a lost or duplicate approval.
    const [secondAttempt, thirdAttempt] = await Promise.all([
      approverTwo.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/approve`), { data: { idempotencyKey: "second-human-approval-001" } }),
      approverThree.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/approve`), { data: { idempotencyKey: "third-human-approval-0001" } }),
    ]);
    const attempts = [secondAttempt, thirdAttempt];
    expect(attempts.filter((attempt) => attempt.status() === 200)).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status() !== 200).map((attempt) => attempt.status())).toEqual([409]);
    const finalApproval = attempts.find((attempt) => attempt.status() === 200)!;
    await expect(finalApproval.json()).resolves.toMatchObject({ status: "APPROVED", published: true, registryVersion: firstApprovalBody.registryVersion + 1 });
    const history = await approverOne.get(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/approval-history`));
    expect(history.status(), await history.text()).toBe(200);
    await expect(history.json()).resolves.toMatchObject({ decisions: [expect.objectContaining({ decision: "APPROVE", approval_slot: 1 }), expect.objectContaining({ decision: "APPROVE", approval_slot: 2 })], publication: expect.objectContaining({ publication_mode: "NORMAL", registry_version_before: firstApprovalBody.registryVersion, registry_version_after: firstApprovalBody.registryVersion + 1, runtime_eligibility: "ELIGIBLE" }) });

    // P2-H: disposable-D1-only activation rehearsal. CI enables the capability
    // flag for this Worker, but approval still follows the ordinary human route.
    // Chat must keep SQL behind P0 and store P2-G's exact selected revision.
    const sessionCreated = await ownerApi.post(absoluteUrl("/api/v1/sessions"), { data: { title: "P2-H semantic runtime rehearsal" } });
    expect(sessionCreated.status(), await sessionCreated.text()).toBe(201);
    const sessionId = (await sessionCreated.json() as { session: { id: string } }).session.id;
    const semanticChat = await ownerApi.post(absoluteUrl("/api/v1/chat"), { data: { sessionId, prompt: `請查詢 ${canonicalName} 的相關訂單數量` } });
    expect(semanticChat.status(), await semanticChat.text()).toBe(200);
    await expect(semanticChat.json()).resolves.toMatchObject({
      rowCount: expect.any(Number),
      explainability: { semanticEvidence: { mode: "USED", registryVersion: firstApprovalBody.registryVersion + 1, selections: [expect.objectContaining({ assetId: asset.assetId, revisionId: asset.revisionId })] } },
    });

    const immutable = await ownerApi.patch(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}`), { data: { contract: termContract(canonicalName, domain), aliases: [] } });
    expect(immutable.status()).toBe(409);
    const suspended = await approverOne.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/suspend-runtime`), { data: { idempotencyKey: "suspend-human-approval-01", reason: "Known-bad definition investigation." } });
    expect(suspended.status(), await suspended.text()).toBe(200);
    await expect(suspended.json()).resolves.toMatchObject({ runtimeEligibility: "SUSPENDED", registryVersion: firstApprovalBody.registryVersion + 2 });
    const resumed = await approverTwo.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/resume-runtime`), { data: { idempotencyKey: "resume-human-approval-001", reason: "Deterministic revalidation passed." } });
    expect(resumed.status(), await resumed.text()).toBe(200);
    await expect(resumed.json()).resolves.toMatchObject({ runtimeEligibility: "ELIGIBLE", registryVersion: firstApprovalBody.registryVersion + 3 });

    await approverOne.dispose();
    await approverTwo.dispose();
    await approverThree.dispose();
    await ownerApi.dispose();
  });

  test("keeps break-glass separate, validates the emergency contract, and creates a mandatory post-review", async ({ playwright }) => {
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    await loginApi(ownerApi, ownerCredentials);
    await expectOk(await ownerApi.post(absoluteUrl("/api/v1/schema/refresh")), "refresh schema before emergency publication");
    await expectOk(await ownerApi.patch(absoluteUrl("/api/v1/admin/roles/analyst"), { data: { capabilities: ["chat", "view_schema", "view_semantics", "approve_semantics"] } }), "configure non-emergency semantic approver fixture");
    await expectOk(await ownerApi.patch(absoluteUrl("/api/v1/admin/roles/editor"), { data: { capabilities: ["chat", "view_schema", "view_semantics", "manage_semantic_drafts", "review_semantics", "approve_semantics", "emergency_publish_semantics", "suspend_semantics_runtime", "resume_semantics_runtime"] } }), "configure emergency semantic approver fixture");
    const normal = await provisionEditor(playwright, ownerApi, "normal", "analyst");
    const emergency = await provisionEditor(playwright, ownerApi, "emergency");
    const domain = `p2e_breakglass_${Date.now().toString(36)}`;
    const policy = await ownerApi.post(absoluteUrl("/api/v1/semantics/governance/policies"), { data: { scopeKind: "DOMAIN", domain, riskClass: "STANDARD", requiredApprovals: 1, allowProposerSelfApproval: false, allowEmergencyPublication: true, postReviewDueHours: 24 } });
    expect(policy.status(), await policy.text()).toBe(201);
    for (const user of [normal, emergency]) {
      const created = await ownerApi.post(absoluteUrl("/api/v1/semantics/governance/authorities"), { data: { scopeKind: "DOMAIN", domain, userId: user.id, raciRole: "SEMANTIC_APPROVER", canApprove: true, canGovernRuntime: true } });
      expect(created.status(), await created.text()).toBe(201);
    }
    const canonicalName = `breakglass_term_${Date.now().toString(36)}`;
    const created = await ownerApi.post(absoluteUrl("/api/v1/semantics"), { data: { assetType: "TERM", canonicalName, displayName: "Governed service term", domain, contract: termContract(canonicalName, domain), aliases: [] } });
    expect(created.status(), await created.text()).toBe(201);
    const asset = await created.json() as { assetId: string; revisionId: string };
    await expectOk(await ownerApi.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/submit-review`)), "submit emergency revision review");
    const normalApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const emergencyApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    await loginApi(normalApi, { email: normal.email, password: normal.password });
    await loginApi(emergencyApi, { email: emergency.email, password: emergency.password });
    expect((await normalApi.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/emergency-publish`), { data: { idempotencyKey: "normal-no-breakglass-1", reason: "No authority", changeReference: "INC-0", reviewDueAt: new Date(Date.now() + 86_400_000).toISOString() } })).status()).toBe(403);
    expect((await emergencyApi.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/emergency-publish`), { data: { idempotencyKey: "emergency-invalid-0001" } })).status()).toBe(400);
    const published = await emergencyApi.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/emergency-publish`), { data: { idempotencyKey: "emergency-valid-0000001", reason: "Correct critical production semantic immediately.", changeReference: "INC-2048", reviewDueAt: new Date(Date.now() + 86_400_000).toISOString() } });
    expect(published.status(), await published.text()).toBe(200);
    await expect(published.json()).resolves.toMatchObject({ publicationMode: "EMERGENCY", status: "APPROVED" });
    const history = await emergencyApi.get(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/approval-history`));
    await expect(history.json()).resolves.toMatchObject({ publication: expect.objectContaining({ publication_mode: "EMERGENCY", post_review_status: "PENDING" }) });
    const resolution = await emergencyApi.post(absoluteUrl(`/api/v1/semantics/${asset.assetId}/revisions/${asset.revisionId}/post-review`), { data: { idempotencyKey: "post-review-confirmed-001", resolution: "CONFIRMED", reason: "Human post-review confirmed the emergency definition." } });
    expect(resolution.status(), await resolution.text()).toBe(200);
    await expect(resolution.json()).resolves.toMatchObject({ postReviewStatus: "CONFIRMED" });
    await normalApi.dispose();
    await emergencyApi.dispose();
    await ownerApi.dispose();
  });
});
