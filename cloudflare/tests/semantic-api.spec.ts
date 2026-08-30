import { expect, test } from "playwright/test";
import { allowMutatingE2E, absoluteUrl, expectOk, loginApi, provisionViewer } from "./helpers";

test.describe("P2-B governed semantic design-time API", () => {
  test.skip(!allowMutatingE2E, "Semantic API tests are enabled only for disposable local D1 or explicit mutation opt-in.");

  test("enforces capability, browser-session mutation, bounded lifecycle and audit redaction", async ({ playwright }) => {
    const ownerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    const owner = await loginApi(ownerApi);
    const refresh = await ownerApi.post(absoluteUrl("/api/v1/schema/refresh"));
    await expectOk(refresh, "refresh schema catalog for semantic API");
    const testCanonicalName = `customer_segment_${Date.now().toString(36)}`;

    const anonymous = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    expect((await anonymous.get(absoluteUrl("/api/v1/semantics"))).status()).toBe(401);
    await anonymous.dispose();

    const termContract = {
      canonicalName: testCanonicalName,
      displayName: "Customer segment",
      definition: "A bounded business vocabulary term.",
      domain: "sales",
      semanticDependencies: [],
    };
    const created = await ownerApi.post(absoluteUrl("/api/v1/semantics"), {
      data: { assetType: "TERM", canonicalName: testCanonicalName, displayName: "Customer segment", domain: "sales", contract: termContract, aliases: [{ alias: "Segment", locale: "en" }], changeReason: "initial draft" },
    });
    expect(created.status(), await created.text()).toBe(201);
    const createdBody = await created.json() as { assetId: string; revisionId: string; revisionNumber: number };
    expect(createdBody.revisionNumber).toBe(1);

    const listed = await ownerApi.get(absoluteUrl("/api/v1/semantics?type=TERM&domain=sales&limit=10"));
    expect(listed.status()).toBe(200);
    const listedBody = await listed.json() as { items: Array<Record<string, unknown>> };
    expect(listedBody.items.some((item) => item.assetId === createdBody.assetId)).toBe(true);
    expect(JSON.stringify(listedBody)).not.toContain("payload_json");

    const detail = await ownerApi.get(absoluteUrl(`/api/v1/semantics/${createdBody.assetId}`));
    expect(detail.status()).toBe(200);
    const detailBody = await detail.json() as { latestRevision: { contract: { canonicalName: string } }; aliases: unknown[] };
    expect(detailBody.latestRevision.contract.canonicalName).toBe(testCanonicalName);
    expect(detailBody.aliases).toHaveLength(1);

    const revisions = await ownerApi.get(absoluteUrl(`/api/v1/semantics/${createdBody.assetId}/revisions`));
    expect(revisions.status(), await revisions.text()).toBe(200);
    await expect(revisions.json()).resolves.toMatchObject({
      assetId: createdBody.assetId,
      items: [expect.objectContaining({ revisionId: createdBody.revisionId, revisionNumber: 1, status: "DRAFT" })],
    });

    const fixtureSuffix = Date.now().toString(36);
    const additionalFixtures: Array<{ assetType: "DIMENSION" | "METRIC" | "RELATIONSHIP"; canonicalName: string; displayName: string; contract: Record<string, unknown> }> = [
      {
        assetType: "DIMENSION",
        canonicalName: `product_name_${fixtureSuffix}`,
        displayName: "Product name",
        contract: { canonicalName: `product_name_${fixtureSuffix}`, displayName: "Product name", definition: "The product name used for grouping.", domain: "sales", source: { table: "products", column: "name" }, dataType: "TEXT", allowedOperations: ["GROUP", "FILTER", "ORDER"], semanticDependencies: [] },
      },
      {
        assetType: "METRIC",
        canonicalName: `sales_revenue_${fixtureSuffix}`,
        displayName: "Sales revenue",
        contract: { canonicalName: `sales_revenue_${fixtureSuffix}`, displayName: "Sales revenue", definition: "The sum of line-item subtotals.", domain: "sales", sources: [{ ref: { table: "order_items", column: "subtotal" }, role: "value" }], expression: { kind: "SUM", argument: { kind: "COLUMN", source: { table: "order_items", column: "subtotal" } } }, defaultFilters: [], nativeGrain: { kind: "ENTITY", key: "order_item", source: { table: "order_items", keyColumns: ["id"] } }, unit: "CURRENCY", currency: "TWD", semanticDependencies: [] },
      },
      {
        assetType: "RELATIONSHIP",
        canonicalName: `product_order_items_${fixtureSuffix}`,
        displayName: "Product order items",
        contract: { canonicalName: `product_order_items_${fixtureSuffix}`, displayName: "Product order items", definition: "Products relate to their order items.", domain: "sales", leftTable: "products", rightTable: "order_items", cardinality: "ONE_TO_MANY", joinKeys: [{ leftTable: "products", leftColumn: "id", rightTable: "order_items", rightColumn: "product_id" }], semanticDependencies: [] },
      },
    ];
    for (const fixture of additionalFixtures) {
      const response = await ownerApi.post(absoluteUrl("/api/v1/semantics"), { data: { assetType: fixture.assetType, canonicalName: fixture.canonicalName, displayName: fixture.displayName, domain: "sales", contract: fixture.contract, aliases: [] } });
      expect(response.status(), `${fixture.assetType} fixture: ${await response.text()}`).toBe(201);
    }
    const filteredMetric = await ownerApi.get(absoluteUrl(`/api/v1/semantics?type=METRIC&search=${encodeURIComponent(`sales_revenue_${fixtureSuffix}`)}&domain=sales&limit=1`));
    expect(filteredMetric.status(), await filteredMetric.text()).toBe(200);
    await expect(filteredMetric.json()).resolves.toMatchObject({
      page: expect.objectContaining({ limit: 1, total: 1, hasNext: false }),
      items: [expect.objectContaining({ assetType: "METRIC", canonicalName: `sales_revenue_${fixtureSuffix}`, latestRevision: expect.objectContaining({ status: "DRAFT" }) })],
    });

    const editedContract = { ...termContract, definition: "An edited bounded business vocabulary term." };
    const edited = await ownerApi.patch(absoluteUrl(`/api/v1/semantics/${createdBody.assetId}/revisions/${createdBody.revisionId}`), { data: { contract: editedContract, aliases: [{ alias: "Segment", locale: "en" }, { alias: "客群", locale: "zh-TW" }] } });
    expect(edited.status(), await edited.text()).toBe(200);

    const second = await ownerApi.post(absoluteUrl(`/api/v1/semantics/${createdBody.assetId}/revisions`), { data: { contract: termContract, aliases: [] } });
    expect(second.status(), await second.text()).toBe(201);
    const secondBody = await second.json() as { revisionId: string; revisionNumber: number };
    expect(secondBody.revisionNumber).toBe(2);

    const submitted = await ownerApi.post(absoluteUrl(`/api/v1/semantics/${createdBody.assetId}/revisions/${secondBody.revisionId}/submit-review`));
    expect(submitted.status(), await submitted.text()).toBe(200);
    expect((await submitted.json()).status).toBe("IN_REVIEW");
    const requested = await ownerApi.post(absoluteUrl(`/api/v1/semantics/${createdBody.assetId}/revisions/${secondBody.revisionId}/request-changes`), { data: { comment: "Please clarify the term." } });
    expect(requested.status(), await requested.text()).toBe(200);
    expect((await requested.json()).status).toBe("DRAFT");
    const rejectedWithoutReview = await ownerApi.post(absoluteUrl(`/api/v1/semantics/${createdBody.assetId}/revisions/${secondBody.revisionId}/reject`), { data: { comment: "must conflict" } });
    expect(rejectedWithoutReview.status()).toBe(409);

    const submittedAgain = await ownerApi.post(absoluteUrl(`/api/v1/semantics/${createdBody.assetId}/revisions/${secondBody.revisionId}/submit-review`));
    expect(submittedAgain.status()).toBe(200);
    const rejected = await ownerApi.post(absoluteUrl(`/api/v1/semantics/${createdBody.assetId}/revisions/${secondBody.revisionId}/reject`), { data: { comment: "Rejected for a deterministic test." } });
    expect(rejected.status(), await rejected.text()).toBe(200);
    expect((await rejected.json()).status).toBe("REJECTED");

    const approve = await ownerApi.post(absoluteUrl(`/api/v1/semantics/${createdBody.assetId}/revisions/${secondBody.revisionId}/approve`));
    // P2-E now owns this route. A call without its required JSON body is
    // rejected before any governance mutation rather than falling through.
    expect(approve.status()).toBe(415);

    const viewer = await provisionViewer(ownerApi);
    const viewerApi = await playwright.request.newContext({ baseURL: absoluteUrl("/") });
    await loginApi(viewerApi, { email: viewer.email, password: viewer.password });
    expect((await viewerApi.get(absoluteUrl("/api/v1/semantics"))).status()).toBe(403);
    expect((await viewerApi.post(absoluteUrl("/api/v1/semantics"), { data: { assetType: "TERM", canonicalName: "viewer_forbidden", displayName: "Forbidden", contract: termContract } })).status()).toBe(403);

    // provisionViewer logs the shared context in as the new viewer; restore
    // the owner browser session before testing API-key creation.
    await loginApi(ownerApi);
    const keyResponse = await ownerApi.post(absoluteUrl(`/api/v1/admin/users/${owner.id}/keys`), { data: { label: `semantic-api-${Date.now()}` } });
    expect(keyResponse.status(), await keyResponse.text()).toBe(201);
    const apiKey = (await keyResponse.json() as { apiKey: string }).apiKey;
    const keyApi = await playwright.request.newContext({ baseURL: absoluteUrl("/"), extraHTTPHeaders: { authorization: `Bearer ${apiKey}` } });
    expect((await keyApi.post(absoluteUrl("/api/v1/semantics"), { data: { assetType: "TERM", canonicalName: "key_forbidden", displayName: "Forbidden", contract: termContract } })).status()).toBe(403);

    const audit = await ownerApi.get(absoluteUrl("/api/v1/admin/audit?limit=100"));
    expect(audit.status()).toBe(200);
    const auditBody = await audit.json() as { events: Array<{ eventType: string; metadata: string }> };
    const semanticEvents = auditBody.events.filter((event) => event.eventType.startsWith("semantic."));
    expect(semanticEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining(["semantic.asset.created", "semantic.revision.updated", "semantic.review.submitted", "semantic.review.request_changes", "semantic.review.rejected"]));
    expect(JSON.stringify(semanticEvents)).not.toContain("Please clarify the term.");
    expect(JSON.stringify(semanticEvents)).not.toContain("payload_json");

    await keyApi.dispose();
    await viewerApi.dispose();
    await ownerApi.dispose();
  });
});
