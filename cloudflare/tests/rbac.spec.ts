import { expect, test } from "playwright/test";
import { absoluteUrl, allowMutatingE2E, expectOk, loginApi, ownerCredentials, provisionViewer } from "./helpers";

test.describe("API authorization boundary", () => {
  test("anonymous requests cannot access workspace data", async ({ request }) => {
    const response = await request.get(absoluteUrl("/api/v1/schema"));
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "AUTH_REQUIRED" });
  });

  test("invitation tokens are not accepted in URL query strings", async ({ request }) => {
    const response = await request.get(absoluteUrl("/api/v1/auth/invitation?token=qmi_must-not-enter-logs"));
    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "API_NOT_IMPLEMENTED" });
  });

  test("invitation preview accepts POST JSON without putting the token in the request URL", async ({ request }) => {
    const token = "qmi_nonexistent-fragment-token";
    const response = await request.post(absoluteUrl("/api/v1/auth/invitation"), { data: { token } });
    expect(new URL(response.url()).search).toBe("");
    expect(response.url()).not.toContain(token);
    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "INVITATION_NOT_AVAILABLE" });
  });

  test("viewer can analyze but cannot use Owner, DBA, export, or forged-agent APIs", async ({ playwright }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const viewerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    let ownerSessionId = "";
    let viewerSessionId = "";
    try {
      await loginApi(ownerApi, ownerCredentials);
      const ownerSession = await ownerApi.post("/api/v1/sessions", { data: { title: `Owner private ${Date.now()}` } });
      await expectOk(ownerSession, "create owner session");
      ownerSessionId = ((await ownerSession.json()) as { session: { id: string } }).session.id;

      const viewer = await provisionViewer(viewerApi);
      const blocked: Array<["get" | "post", string, Record<string, unknown>?]> = [
        ["get", "/api/v1/admin/users"],
        ["get", "/api/v1/admin/roles"],
        ["get", "/api/v1/admin/connection"],
        ["post", "/api/v1/admin/invitations", { email: `blocked-${Date.now()}@example.test`, roleName: "owner" }],
        ["post", `/api/v1/admin/users/${viewer.id}/reset-password`, {}],
        ["post", "/api/v1/export/csv", { sql: "SELECT 1 AS value" }],
      ];
      for (const [method, pathname, data] of blocked) {
        const response = method === "get"
          ? await viewerApi.get(pathname)
          : await viewerApi.post(pathname, { data });
        expect(response.status(), `${method.toUpperCase()} ${pathname}`).toBe(403);
        await expect(response.json()).resolves.toMatchObject({ error: "RBAC_FORBIDDEN" });
      }

      const schema = await viewerApi.get("/api/v1/schema");
      await expectOk(schema, "viewer schema access");
      const createViewerSession = await viewerApi.post("/api/v1/sessions", { data: { title: `Viewer ${Date.now()}` } });
      await expectOk(createViewerSession, "viewer session creation");
      viewerSessionId = ((await createViewerSession.json()) as { session: { id: string } }).session.id;

      const forgedAssistant = await viewerApi.post(`/api/v1/sessions/${viewerSessionId}/messages`, {
        data: { role: "assistant", content: "forged trusted result" },
      });
      expect(forgedAssistant.status()).toBe(400);
      await expect(forgedAssistant.json()).resolves.toMatchObject({ error: "INVALID_REQUEST" });

      const crossTenantSession = await viewerApi.get(`/api/v1/sessions/${ownerSessionId}/messages`);
      expect(crossTenantSession.status()).toBe(404);
      await expect(crossTenantSession.json()).resolves.toMatchObject({ error: "SESSION_NOT_FOUND" });

      const removeViewerSession = await viewerApi.delete(`/api/v1/sessions/${viewerSessionId}`);
      await expectOk(removeViewerSession, "remove viewer session before account recovery");
      viewerSessionId = "";

      const resetPassword = await ownerApi.post(`/api/v1/admin/users/${viewer.id}/reset-password`, { data: {} });
      await expectOk(resetPassword, "Owner account recovery");
      const recovery = await resetPassword.json() as { temporaryPassword: string; userId: string; passwordUpdatedAt: string };
      expect(recovery).toMatchObject({ userId: viewer.id });
      expect(recovery.temporaryPassword.length).toBeGreaterThanOrEqual(12);
      expect(Number.isNaN(Date.parse(recovery.passwordUpdatedAt))).toBe(false);

      const invalidatedSession = await viewerApi.get("/api/v1/me");
      expect(invalidatedSession.status()).toBe(401);
      await expect(invalidatedSession.json()).resolves.toMatchObject({ error: "INVALID_SESSION" });
      const oldPasswordLogin = await viewerApi.post("/api/v1/auth/login", { data: { email: viewer.email, password: viewer.password } });
      expect(oldPasswordLogin.status()).toBe(401);
      await expect(oldPasswordLogin.json()).resolves.toMatchObject({ error: "INVALID_CREDENTIALS" });
      const recoveredLogin = await viewerApi.post("/api/v1/auth/login", { data: { email: viewer.email, password: recovery.temporaryPassword } });
      await expectOk(recoveredLogin, "login with one-time recovery password");
    } finally {
      if (viewerSessionId) await viewerApi.delete(`/api/v1/sessions/${viewerSessionId}`);
      if (ownerSessionId) await ownerApi.delete(`/api/v1/sessions/${ownerSessionId}`);
      await Promise.all([ownerApi.dispose(), viewerApi.dispose()]);
    }
  });

  test("even an Owner API key cannot enter browser-only administration or account recovery", async ({ playwright }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    let keyId = "";
    let keyApi: Awaited<ReturnType<typeof playwright.request.newContext>> | null = null;
    try {
      const owner = await loginApi(ownerApi, ownerCredentials);
      const create = await ownerApi.post(`/api/v1/admin/users/${owner.id}/keys`, { data: { label: `Release boundary ${Date.now()}` } });
      await expectOk(create, "create restricted Owner API key");
      const payload = await create.json() as { key: { id: string }; apiKey: string };
      keyId = payload.key.id;
      keyApi = await playwright.request.newContext({
        baseURL: absoluteUrl("/"),
        extraHTTPHeaders: { authorization: `Bearer ${payload.apiKey}` },
      });

      const nonexistentUser = "00000000-0000-4000-8000-000000000000";
      const safeBlockedCalls: Array<[string, () => Promise<import("playwright/test").APIResponse>]> = [
        ["list users", () => keyApi!.get("/api/v1/admin/users")],
        ["list roles", () => keyApi!.get("/api/v1/admin/roles")],
        ["list invitations", () => keyApi!.get("/api/v1/admin/invitations")],
        ["view source settings", () => keyApi!.get("/api/v1/admin/connection")],
        ["reset password", () => keyApi!.post(`/api/v1/admin/users/${nonexistentUser}/reset-password`, { data: {} })],
        ["create invitation", () => keyApi!.post("/api/v1/admin/invitations", { data: { email: "invalid", roleName: "owner" } })],
        ["change role", () => keyApi!.patch("/api/v1/admin/roles/viewer", { data: { capabilities: ["*"] } })],
        ["list keys", () => keyApi!.get(`/api/v1/admin/users/${owner.id}/keys`)],
        ["create key", () => keyApi!.post(`/api/v1/admin/users/${owner.id}/keys`, { data: { label: "" } })],
        ["change password", () => keyApi!.post("/api/v1/auth/change-password", { data: { currentPassword: "not-the-owner-password", newPassword: "another-valid-password" } })],
      ];
      for (const [label, call] of safeBlockedCalls) {
        const response = await call();
        expect(response.status(), label).toBe(403);
        await expect(response.json(), label).resolves.toMatchObject({ error: "API_KEY_RESTRICTED" });
      }
    } finally {
      if (keyApi) await keyApi.dispose();
      if (keyId) {
        const revoke = await ownerApi.delete(`/api/v1/admin/keys/${keyId}`);
        await expectOk(revoke, "revoke restricted Owner API key");
      }
      await ownerApi.dispose();
    }
  });

  test("concurrent Owner demotions preserve at least one active Owner", async ({ playwright }) => {
    test.skip(!allowMutatingE2E, "Set QUERYMIND_ALLOW_MUTATING_E2E=true before mutating a remote deployment.");
    const firstApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const secondApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const secondCredentials = { email: `owner-race-${stamp}@example.test`, password: "owner-race-test-password" };
    try {
      const firstOwner = await loginApi(firstApi, ownerCredentials);
      const invitationResponse = await firstApi.post("/api/v1/admin/invitations", {
        data: { email: secondCredentials.email, roleName: "owner", expiresHours: 1 },
      });
      await expectOk(invitationResponse, "create second Owner invitation");
      const invitation = await invitationResponse.json() as { inviteToken: string };
      const accept = await secondApi.post("/api/v1/auth/accept-invitation", {
        data: { token: invitation.inviteToken, email: secondCredentials.email, displayName: "Race Owner", password: secondCredentials.password },
      });
      expect(accept.status(), await accept.text()).toBe(201);
      const secondOwner = await loginApi(secondApi, secondCredentials);

      const [demoteSecond, demoteFirst] = await Promise.all([
        firstApi.patch(`/api/v1/admin/users/${secondOwner.id}`, { data: { roleName: "viewer", isActive: true } }),
        secondApi.patch(`/api/v1/admin/users/${firstOwner.id}`, { data: { roleName: "viewer", isActive: true } }),
      ]);
      expect([demoteSecond.status(), demoteFirst.status()].sort()).toEqual([200, 400]);

      const survivorApi = demoteSecond.ok() ? firstApi : secondApi;
      const usersResponse = await survivorApi.get("/api/v1/admin/users");
      await expectOk(usersResponse, "list users after Owner race");
      const users = (await usersResponse.json() as { users: Array<{ id: string; roleName: string; isActive: boolean }> }).users;
      expect(users.filter((user) => user.roleName === "owner" && user.isActive).length).toBeGreaterThanOrEqual(1);

      const firstAfter = users.find((user) => user.id === firstOwner.id)!;
      if (firstAfter.roleName !== "owner" || !firstAfter.isActive) {
        const restoreFirst = await survivorApi.patch(`/api/v1/admin/users/${firstOwner.id}`, { data: { roleName: "owner", isActive: true } });
        await expectOk(restoreFirst, "restore original Owner");
      }
      const secondAfter = users.find((user) => user.id === secondOwner.id)!;
      if (secondAfter.roleName === "owner" && secondAfter.isActive) {
        const demoteTestOwner = await firstApi.patch(`/api/v1/admin/users/${secondOwner.id}`, { data: { roleName: "viewer", isActive: true } });
        await expectOk(demoteTestOwner, "demote temporary race Owner");
      }
    } finally {
      await Promise.all([firstApi.dispose(), secondApi.dispose()]);
    }
  });
});
