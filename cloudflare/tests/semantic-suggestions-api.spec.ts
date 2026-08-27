import { expect, test } from "playwright/test";
import { allowMutatingE2E, absoluteUrl, expectOk, loginApi, provisionViewer } from "./helpers";

test.describe("P2-D governed semantic suggestion APIs", () => {
  test.skip(!allowMutatingE2E, "Suggestion lifecycle tests require disposable local D1 or explicit mutation opt-in.");

  test("generates local mock suggestions, accepts only a human-reviewed Draft, and supports dismiss", async ({ playwright }) => {
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    await loginApi(ownerApi);
    await expectOk(await ownerApi.post(absoluteUrl("/api/v1/schema/refresh")), "refresh schema catalog before P2-D suggestion generation");
    const picker = await ownerApi.get(absoluteUrl("/api/v1/semantics/suggestions/catalog"));
    expect(picker.status()).toBe(200);
    expect(JSON.stringify(await picker.json())).toContain("products");

    const anonymous = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    expect((await anonymous.post(absoluteUrl("/api/v1/semantics/suggestions/generate"), { data: {} })).status()).toBe(401);
    await anonymous.dispose();

    const generated = await ownerApi.post(absoluteUrl("/api/v1/semantics/suggestions/generate"), { data: { tableNames: ["products", "order_items", "orders"], suggestionTypes: ["DIMENSION", "METRIC", "RELATIONSHIP"], maxSuggestions: 8 } });
    expect(generated.status(), await generated.text()).toBe(200);
    const generation = await generated.json() as { runId: string; status: string; items: Array<{ suggestionId: string; status: string; suggestionType: string; suggestion: { contract: Record<string, unknown>; canonicalName: string; displayName: string; definition: string; aliases: unknown[]; assumptions: string[]; openQuestions: string[] } }> };
    expect(generation.status).toBe("SUCCEEDED");
    expect(generation.items.length).toBeGreaterThan(0);
    const metric = generation.items.find((item) => item.suggestionType === "METRIC");
    expect(metric).toBeTruthy();
    expect(metric!.suggestion.assumptions.length).toBeGreaterThan(0);
    expect(metric!.suggestion.openQuestions.length).toBeGreaterThan(0);
    expect((metric!.suggestion.contract.defaultFilters as unknown[])).toEqual([]);

    const reviewedDefinition = `${metric!.suggestion.definition} Reviewed by the semantic owner.`;
    const reviewedContract = { ...metric!.suggestion.contract, definition: reviewedDefinition };
    const accepted = await ownerApi.post(absoluteUrl(`/api/v1/semantics/suggestions/${metric!.suggestionId}/accept-as-draft`), { data: { canonicalName: metric!.suggestion.canonicalName, displayName: metric!.suggestion.displayName, domain: reviewedContract.domain, description: "Created from an AI suggestion after human review.", contract: reviewedContract, aliases: metric!.suggestion.aliases, changeReason: "Reviewed P2-D suggestion." } });
    expect(accepted.status(), await accepted.text()).toBe(201);
    const acceptedBody = await accepted.json() as { status: string; assetId: string; revisionId: string; draftStatus: string };
    expect(acceptedBody).toMatchObject({ status: "ACCEPTED", draftStatus: "DRAFT" });

    const asset = await ownerApi.get(absoluteUrl(`/api/v1/semantics/${acceptedBody.assetId}`));
    expect(asset.status()).toBe(200);
    await expect(asset.json()).resolves.toMatchObject({ latestRevision: { revisionId: acceptedBody.revisionId, status: "DRAFT", contract: { definition: reviewedDefinition } } });
    const acceptedSuggestion = await ownerApi.get(absoluteUrl(`/api/v1/semantics/suggestions/${metric!.suggestionId}`));
    await expect(acceptedSuggestion.json()).resolves.toMatchObject({ status: "ACCEPTED", acceptedAssetId: acceptedBody.assetId, acceptedRevisionId: acceptedBody.revisionId });

    const open = generation.items.find((item) => item.suggestionType !== "METRIC");
    expect(open).toBeTruthy();
    const dismissed = await ownerApi.post(absoluteUrl(`/api/v1/semantics/suggestions/${open!.suggestionId}/dismiss`), { data: { dismissalReason: "Not needed for this workspace." } });
    expect(dismissed.status()).toBe(200);
    expect((await dismissed.json()).status).toBe("DISMISSED");
    expect((await ownerApi.post(absoluteUrl(`/api/v1/semantics/suggestions/${open!.suggestionId}/accept-as-draft`), { data: { canonicalName: "cannot_accept", displayName: "Cannot accept", contract: { canonicalName: "cannot_accept", displayName: "Cannot accept", definition: "No.", domain: "", semanticDependencies: [] }, aliases: [] } })).status()).toBe(409);

    const audit = await ownerApi.get(absoluteUrl("/api/v1/admin/audit?limit=100"));
    expect(audit.status()).toBe(200);
    const events = (await audit.json() as { events: Array<{ eventType: string; metadata: string }> }).events.filter((event) => event.eventType.startsWith("semantic.suggestion."));
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["semantic.suggestion.generated", "semantic.suggestion.accepted_as_draft", "semantic.suggestion.dismissed"]));
    expect(JSON.stringify(events)).not.toContain("Reviewed by the semantic owner.");
    expect(JSON.stringify(events)).not.toContain("payload_json");

    const viewer = await provisionViewer(ownerApi);
    const viewerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    await loginApi(viewerApi, { email: viewer.email, password: viewer.password });
    expect((await viewerApi.get(absoluteUrl("/api/v1/semantics/suggestions/catalog"))).status()).toBe(403);
    expect((await viewerApi.get(absoluteUrl("/api/v1/semantics/suggestions"))).status()).toBe(403);
    expect((await viewerApi.post(absoluteUrl("/api/v1/semantics/suggestions/generate"), { data: { tableNames: ["orders"], suggestionTypes: ["TERM"], maxSuggestions: 1 } })).status()).toBe(403);
    expect((await viewerApi.post(absoluteUrl(`/api/v1/semantics/suggestions/${metric!.suggestionId}/accept-as-draft`), { data: {} })).status()).toBe(403);
    await viewerApi.dispose();
    await ownerApi.dispose();
  });
});
