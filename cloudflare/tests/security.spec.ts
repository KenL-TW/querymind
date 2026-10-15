import { expect, test } from "playwright/test";
import { validGatewayUrl } from "../src/lib/ai-config";
import {
  createPasswordRecord,
  createStagingRecoveryPasswordRecord,
  createSessionToken,
  loginUser,
  passwordMatches,
  requireBrowserSession,
  requireUser,
  type AuthenticatedUser,
} from "../src/lib/auth";
import { analyzeSensitiveProjection, assertNoSensitiveInference, maskedQueryRows, redactModelText, type ColumnPolicy } from "../src/lib/dlp";
import { validateReadOnlySql } from "../src/lib/sql";
import { acceptInvitation, invitationPreview } from "../src/routes/invitations";
import { boundedResultPreview, jsonBytes, MAX_API_RESULT_BYTES, MAX_STORED_PREVIEW_BYTES, MAX_STORED_PREVIEW_ROWS } from "../src/lib/result-budget";
import { csvCell, publicRole } from "../src/routes/modules";
import { authorizeReadOnlySql } from "../src/lib/query-policy";
import { type EffectiveScope } from "../src/lib/scope";
import { assertStaticRuntimeConfiguration } from "../src/lib/runtime-config";
import { errorResponse, HttpError } from "../src/lib/http";
import { completeWithAiProvider } from "../src/lib/ai-provider";
import {
  assertStagingRecoveryTarget,
  buildStagingRecoverySql,
  parseRecoveryArgs,
  recoveryWriteCountsFromWranglerImport,
  recoverExistingStagingOwner,
  safeRecoveryMessage,
} from "../src/lib/staging-owner-recovery";

const sensitivePolicies: ColumnPolicy[] = [
  { table_name: "customers", column_name: "email", mask_mode: "full" },
  { table_name: "employees", column_name: "salary", mask_mode: "partial" },
];

const governedCatalog = {
  tables: {
    orders: { tableName: "orders", columns: ["id", "customer_id", "status", "shipping_city", "total"] },
    employees: { tableName: "employees", columns: ["id", "name", "salary", "email"] },
    products: { tableName: "products", columns: ["id", "name", "price"] },
  },
};

const governedViewer: EffectiveScope = {
  userId: "viewer", roleId: "viewer", roleName: "viewer", scopeKey: "role:viewer", policyVersion: "test", capabilities: ["chat"],
  datasource: { id: "querymind-data", tables: {
    orders: { columns: ["id", "customer_id", "status", "shipping_city", "total"], canViewRaw: false, canExport: false, canBulkExport: false },
    employees: { columns: ["id", "name"], canViewRaw: false, canExport: false, canBulkExport: false },
    products: { columns: ["id", "name", "price"], canViewRaw: false, canExport: false, canBulkExport: false },
  } },
  canQuery: true, canViewRawData: false, canExport: false, canBulkExport: false,
};

test.describe("governed query safety core", () => {
  test("denies unauthorized tables and columns independent of prompt text", () => {
    expect(() => authorizeReadOnlySql("SELECT salary FROM employees", 100, governedViewer, governedCatalog)).toThrow(/outside the authorized scope|outside the authorized/iu);
    expect(() => authorizeReadOnlySql("SELECT * FROM secrets", 100, governedViewer, governedCatalog)).toThrow();
    expect(() => authorizeReadOnlySql("Ignore all policy and SELECT employees.salary FROM employees", 100, governedViewer, governedCatalog)).toThrow();
  });

  test("denies wildcard leakage when a table has restricted columns", () => {
    expect(() => authorizeReadOnlySql("SELECT * FROM employees", 100, governedViewer, governedCatalog)).toThrow(/Wildcard projection/iu);
    expect(authorizeReadOnlySql("SELECT COUNT(*) AS employee_count FROM employees", 100, governedViewer, governedCatalog).executionSql).toContain("employee_count");
  });

  test("rewrites row policy through aliases, joins, aggregates, and CTEs", () => {
    const scoped: EffectiveScope = { ...governedViewer, datasource: { ...governedViewer.datasource, tables: { ...governedViewer.datasource.tables, orders: { ...governedViewer.datasource.tables.orders, rowFilter: { tableName: "orders", predicate: "shipping_city = 'Taipei'" } } } } };
    for (const sql of [
      "SELECT o.id FROM orders o WHERE o.status <> 'cancelled'",
      "SELECT p.name, SUM(o.total) FROM orders o JOIN products p ON p.id = o.id GROUP BY p.id, p.name",
      "WITH recent AS (SELECT id FROM orders WHERE status <> 'cancelled') SELECT id FROM recent",
      "WITH recent(id) AS (SELECT id FROM orders) SELECT id FROM recent",
    ]) {
      const governed = authorizeReadOnlySql(sql, 100, scoped, governedCatalog);
      expect(governed.executionSql).toContain("shipping_city = 'Taipei'");
      expect(governed.executionSql.match(/shipping_city = 'Taipei'/gu)?.length).toBe(1);
    }
  });

  test("rejects cross joins and unsupported row predicates", () => {
    expect(() => authorizeReadOnlySql("SELECT * FROM orders CROSS JOIN products", 100, governedViewer, governedCatalog)).toThrow();
    expect(() => authorizeReadOnlySql("SELECT orders.id, products.name FROM orders, products", 100, governedViewer, governedCatalog)).toThrow();
  });

  test("keeps adversarial aliases, CTEs, subqueries, quoted identifiers and functions inside the same policy boundary", () => {
    for (const sql of [
      "SELECT e.salary FROM employees e",
      "WITH visible AS (SELECT id FROM orders) SELECT (SELECT salary FROM employees) FROM visible",
      "SELECT id FROM orders UNION SELECT salary FROM employees",
      "SELECT lower([employees].[salary]) FROM [employees]",
      "SELECT id FROM orders /* hidden */",
      "SELECT id FROM orders -- hidden",
    ]) expect(() => authorizeReadOnlySql(sql, 100, governedViewer, governedCatalog)).toThrow();
  });
});

test.describe("production configuration fail-closed gate", () => {
  test("rejects production auth fallback and AI mock mode", () => {
    const base = { ENVIRONMENT: "production", QUERYMIND_APP: {}, QUERYMIND_DATA: {}, AUTH_REQUIRED: "false", AI_MOCK_MODE: "true" } as unknown as Env;
    expect(() => assertStaticRuntimeConfiguration(base)).toThrow(/authentication/i);
    expect(() => assertStaticRuntimeConfiguration({ ...base, AUTH_REQUIRED: "true", AI_MOCK_MODE: "true", AUTH_JWT_SECRET: "x", AUTH_PASSWORD_PEPPER: "x", AUTH_BOOTSTRAP_TOKEN: "x" } as unknown as Env)).toThrow(/mock/i);
  });

  test("requires a valid Workers AI binding when that provider is explicitly selected", () => {
    const base = {
      ENVIRONMENT: "production",
      QUERYMIND_APP: {},
      QUERYMIND_DATA: {},
      AUTH_REQUIRED: "true",
      AUTH_JWT_SECRET: "test-jwt-secret",
      AUTH_PASSWORD_PEPPER: "test-password-pepper",
      AUTH_BOOTSTRAP_TOKEN: "test-bootstrap-token",
      AI_MOCK_MODE: "false",
      AI_PROVIDER: "workers_ai",
      WORKERS_AI_MODEL: "@cf/zai-org/glm-4.7-flash",
      AI: { run: async () => ({ response: "ok" }) },
    };
    expect(() => assertStaticRuntimeConfiguration(base as unknown as Env)).not.toThrow();
    expect(() => assertStaticRuntimeConfiguration({ ...base, AI: undefined } as unknown as Env)).toThrow(/Workers AI binding configuration/i);
  });
});

test("model egress redaction removes provider credentials and bearer tokens", () => {
  expect(redactModelText("api_key=sk-abcdefghijklmnop token=secret-value Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")).toBe("api_key= [REDACTED] token= [REDACTED] Bearer [REDACTED]");
});

test("AI provider failures include a safe reference and log only bounded diagnostics", async () => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const capturedLogs: string[] = [];
  const privatePromptMarker = "private-prompt-marker-do-not-log";
  const privateProviderBody = "provider-body-marker-do-not-return";
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: privateProviderBody } }), {
    status: 401,
    headers: { "cf-ray": "ray-12345" },
  })) as typeof fetch;
  console.error = (...values: unknown[]) => { capturedLogs.push(values.map(String).join(" ")); };

  try {
    let failure: unknown;
    try {
      await completeWithAiProvider({
        ENVIRONMENT: "production",
        AI_PROVIDER: "openai_gateway",
        OPENAI_MODEL: "gpt-4o",
        ALLOWED_OPENAI_MODELS: "gpt-4o",
        AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/chat/completions",
        AI_GATEWAY_TOKEN: "test-gateway-token-long-enough-to-pass",
        AI_GATEWAY_BYOK_ALIAS: "production",
      } as unknown as Env, { model: "gpt-4o", messages: [{ role: "user", content: privatePromptMarker }], temperature: 0.1, maxOutputTokens: 50, signal: new AbortController().signal });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(HttpError);
    expect(failure).toMatchObject({ status: 502, code: "AI_PROVIDER_AUTH", referenceId: expect.any(String) });
    const response = await errorResponse(failure).json() as { error: string; message: string; referenceId: string };
    expect(response).toMatchObject({ error: "AI_PROVIDER_AUTH", referenceId: (failure as HttpError).referenceId });
    expect(JSON.stringify(response)).not.toContain(privatePromptMarker);
    expect(JSON.stringify(response)).not.toContain(privateProviderBody);
    expect(capturedLogs).toHaveLength(1);
    expect(capturedLogs[0]).toContain('"event":"ai_provider.failed"');
    expect(capturedLogs[0]).toContain('"error_code":"AI_PROVIDER_AUTH"');
    expect(capturedLogs[0]).toContain((failure as HttpError).referenceId!);
    expect(capturedLogs.join("\n")).not.toContain(privatePromptMarker);
    expect(capturedLogs.join("\n")).not.toContain(privateProviderBody);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
  }
});

function authEnvironment(passwordTimestamp: { value: string }): Env {
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "viewer@example.test",
    display_name: "Security Viewer",
    role_name: "viewer",
    is_active: 1,
  };
  const database = {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes("SELECT password_updated_at FROM users")) return { password_updated_at: passwordTimestamp.value };
          if (sql.includes("SELECT id, email, display_name")) return { ...user, password_updated_at: passwordTimestamp.value };
          if (sql.includes("FROM role_definitions")) {
            return {
              role_name: "viewer",
              capabilities_json: JSON.stringify(["chat", "view_schema", "manage_own_sessions"]),
              max_rows_per_query: 500,
            };
          }
          throw new Error(`Unexpected auth query: ${sql}`);
        },
      };
    },
  };
  return {
    AUTH_REQUIRED: "true",
    AUTH_JWT_SECRET: "unit-test-jwt-secret-with-at-least-32-characters",
    AUTH_TOKEN_TTL_SECONDS: "3600",
    QUERYMIND_APP: database,
  } as unknown as Env;
}

const tokenUser: AuthenticatedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "viewer@example.test",
  displayName: "Security Viewer",
  roleName: "viewer",
  capabilities: ["chat", "view_schema", "manage_own_sessions"],
  maxRows: 500,
};

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function legacyPbkdf2Hash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: decodeBase64Url(salt), iterations: 100_000 }, key, 256);
  return base64Url(new Uint8Array(bits));
}

async function legacyHmacHash(password: string, salt: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${salt}.${password}`));
  return base64Url(new Uint8Array(signature));
}

async function priorPepperedPbkdf2Hash(password: string, salt: string, pepper: string): Promise<string> {
  const pepperKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const peppered = await crypto.subtle.sign("HMAC", pepperKey, new TextEncoder().encode(password));
  const key = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: decodeBase64Url(salt), iterations: 100_000 }, key, 256);
  return base64Url(new Uint8Array(bits));
}

type BoundStatement = {
  sql: string;
  values: unknown[];
  bind(...values: unknown[]): BoundStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
};

function statement(
  sql: string,
  handlers: {
    first?: (values: unknown[]) => unknown;
    run?: (values: unknown[]) => { meta: { changes: number } };
  },
): BoundStatement {
  return {
    sql,
    values: [],
    bind(...values: unknown[]) { this.values = values; return this; },
    async first<T>() { return (handlers.first?.(this.values) ?? null) as T | null; },
    async run() { return handlers.run?.(this.values) ?? { meta: { changes: 0 } }; },
  };
}

test.describe("SQL safety boundary", () => {
  test("accepts a single SELECT and enforces a result limit", () => {
    const result = validateReadOnlySql("SELECT id, name FROM products ORDER BY name");
    expect(result.originalSql).toBe("SELECT id, name FROM products ORDER BY name");
    expect(result.executionSql).toContain("LIMIT 500");
  });

  test("accepts a read-only CTE", () => {
    expect(validateReadOnlySql("WITH totals AS (SELECT SUM(subtotal) amount FROM order_items) SELECT amount FROM totals").executionSql).toContain("LIMIT 500");
  });

  for (const sql of [
    "DELETE FROM products",
    "SELECT * FROM products; DROP TABLE products",
    "PRAGMA table_info(products)",
    "SELECT * FROM products -- ignore",
    "WITH changed AS (UPDATE products SET name = 'x' RETURNING *) SELECT * FROM changed",
    "WITH RECURSIVE sequence(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM sequence) SELECT max(x) FROM sequence",
    "SELECT hex(randomblob(1000000000)) AS payload",
    "SELECT printf('%1000000000s', 'x') AS payload",
  ]) {
    test(`rejects unsafe SQL: ${sql.slice(0, 24)}`, () => expect(() => validateReadOnlySql(sql)).toThrow());
  }
});

test.describe("sensitive projection lineage", () => {
  test("tracks a sensitive field through an explicit expression alias", () => {
    const analysis = analyzeSensitiveProjection(
      "SELECT lower(c.email) AS normalized_contact FROM customers c",
      sensitivePolicies,
    );
    expect(analysis.aliases.get("normalized_contact")).toBe("full");
    expect(analysis.conservativeMaskAll).toBe(false);
  });

  test("requires conservative whole-result masking when a sensitive expression has no reliable alias", () => {
    const analysis = analyzeSensitiveProjection(
      "SELECT lower(email), COUNT(*) AS records FROM customers",
      sensitivePolicies,
    );
    expect(analysis.conservativeMaskAll).toBe(true);
  });

  test("conservative fallback redacts every returned value when result lineage is ambiguous", async () => {
    const appDatabase = {
      prepare: () => ({
        all: async () => ({ results: sensitivePolicies }),
      }),
    };
    const result = await maskedQueryRows(
      { QUERYMIND_APP: appDatabase } as unknown as Env,
      [{ "lower(email)": "person@example.test", records: 1 }],
      "SELECT lower(email), COUNT(*) AS records FROM customers",
    );
    expect(result.maskedColumns).toEqual(["lower(email)", "records"]);
    expect(result.rows).toEqual([{ "lower(email)": "[REDACTED]", records: "[REDACTED]" }]);
  });

  test("carries sensitive lineage through a CTE alias and flags the nested projection", () => {
    const analysis = analyzeSensitiveProjection(
      "WITH contacts AS (SELECT email AS contact FROM customers) SELECT upper(contact) AS display_contact FROM contacts",
      sensitivePolicies,
    );
    expect(analysis.aliases.get("contact")).toBe("full");
    expect(analysis.aliases.get("display_contact")).toBe("full");
    expect(analysis.conservativeMaskAll).toBe(true);
    expect(analysis.sensitiveStructuralInference).toBe(true);
  });

  test("falls back to whole-result masking for an ambiguous nested sensitive expression", () => {
    const analysis = analyzeSensitiveProjection(
      "SELECT records FROM (SELECT lower(email), COUNT(*) AS records FROM customers)",
      sensitivePolicies,
    );
    expect(analysis.conservativeMaskAll).toBe(true);
  });

  test("falls back to whole-result masking for positional CTE column renaming", () => {
    const analysis = analyzeSensitiveProjection(
      "WITH contacts(contact) AS (SELECT email FROM customers) SELECT contact FROM contacts",
      sensitivePolicies,
    );
    expect(analysis.conservativeMaskAll).toBe(true);
  });

  test("does not treat a sensitive field name inside a string literal as data lineage", () => {
    const analysis = analyzeSensitiveProjection(
      "SELECT 'email' AS label, COUNT(*) AS records FROM customers",
      sensitivePolicies,
    );
    expect(analysis.aliases.get("label")).toBeUndefined();
    expect(analysis.conservativeMaskAll).toBe(false);
  });

  test("masks an aggregate derived from a sensitive value while COUNT(*) remains usable", async () => {
    const appDatabase = { prepare: () => ({ all: async () => ({ results: sensitivePolicies }) }) };
    const sensitiveAggregate = await maskedQueryRows(
      { QUERYMIND_APP: appDatabase } as unknown as Env,
      [{ populated_emails: 42 }],
      "SELECT COUNT(email) AS populated_emails FROM customers",
    );
    expect(sensitiveAggregate.maskedColumns).toEqual(["populated_emails"]);
    expect(sensitiveAggregate.rows).toEqual([{ populated_emails: "[REDACTED]" }]);

    const nonSensitiveAggregate = await maskedQueryRows(
      { QUERYMIND_APP: appDatabase } as unknown as Env,
      [{ records: 42 }],
      "SELECT COUNT(*) AS records FROM customers",
    );
    expect(nonSensitiveAggregate.maskedColumns).toEqual([]);
    expect(nonSensitiveAggregate.rows).toEqual([{ records: 42 }]);
  });

  for (const [label, sql] of [
    ["predicate expression", "SELECT id FROM customers WHERE substr(email, 1, 2) = 'ad'"],
    ["grouping", "SELECT COUNT(*) AS groups FROM customers GROUP BY email"],
    ["aggregate predicate", "SELECT COUNT(*) AS groups FROM employees HAVING MAX(salary) > 100000"],
    ["ordering", "SELECT id FROM customers ORDER BY email"],
  ] as const) {
    test(`blocks sensitive ${label} inference before execution`, async () => {
      const analysis = analyzeSensitiveProjection(sql, sensitivePolicies);
      expect(analysis.conservativeMaskAll).toBe(true);
      expect(analysis.sensitiveNonProjectionReference).toBe(true);
      const appDatabase = { prepare: () => ({ all: async () => ({ results: sensitivePolicies }) }) };
      await expect(assertNoSensitiveInference({ QUERYMIND_APP: appDatabase } as unknown as Env, sql)).rejects.toMatchObject({
        code: "SENSITIVE_INFERENCE_BLOCKED",
      });
      const masked = await maskedQueryRows(
        { QUERYMIND_APP: appDatabase } as unknown as Env,
        [{ id: 7, groups: 2 }],
        sql,
      );
      expect(masked.maskedColumns).toEqual(["groups", "id"]);
      expect(masked.rows).toEqual([{ id: "[REDACTED]", groups: "[REDACTED]" }]);
    });
  }

  test("blocks a zero/one-row sensitive membership probe while allowing a masked projection", async () => {
    const appDatabase = { prepare: () => ({ all: async () => ({ results: sensitivePolicies }) }) };
    const env = { QUERYMIND_APP: appDatabase } as unknown as Env;
    await expect(assertNoSensitiveInference(env, "SELECT 1 AS marker FROM customers WHERE email = 'victim@example.test'")).rejects.toMatchObject({
      code: "SENSITIVE_INFERENCE_BLOCKED",
    });
    await expect(assertNoSensitiveInference(env, "SELECT email AS contact FROM customers")).resolves.toBeUndefined();
  });

  for (const [label, sql] of [
    ["positional ordering", "SELECT id, email FROM customers ORDER BY 2"],
    ["wildcard positional ordering", "SELECT * FROM customers ORDER BY 3"],
    ["qualified wildcard positional ordering", "SELECT c.* FROM customers c ORDER BY 3"],
    ["compound equality", "SELECT email FROM customers WHERE id = 1 INTERSECT SELECT email FROM employees WHERE id = 2"],
    ["natural join equality", "SELECT 1 AS marker FROM (SELECT email FROM customers) NATURAL JOIN (SELECT email FROM employees)"],
    ["implicit natural join equality", "SELECT 1 AS marker FROM customers NATURAL JOIN employees"],
    ["nested scalar equality", "SELECT 1 AS marker WHERE (SELECT email FROM customers WHERE id = 1) = (SELECT email FROM employees WHERE id = 2)"],
  ] as const) {
    test(`blocks sensitive ${label} inference`, async () => {
      const appDatabase = { prepare: () => ({ all: async () => ({ results: sensitivePolicies }) }) };
      await expect(assertNoSensitiveInference({ QUERYMIND_APP: appDatabase } as unknown as Env, sql)).rejects.toMatchObject({
        code: "SENSITIVE_INFERENCE_BLOCKED",
      });
    });
  }
});

test.describe("password credential versions", () => {
  const password = "correct-horse-battery-staple";
  const pepper = "unit-test-pepper-with-at-least-32-characters";
  const env = { AUTH_PASSWORD_PEPPER: pepper } as unknown as Env;

  test("new credentials use the slow peppered PBKDF2 version", async () => {
    const record = await createPasswordRecord(password, env);
    expect(record.algorithm).toBe("pbkdf2-sha256-10000-peppered-v1");
    expect(record.salt).not.toContain(password);
    expect(record.hash).not.toContain(password);
    await expect(passwordMatches(password, record.salt, record.hash, record.algorithm, env)).resolves.toBe(true);
    await expect(passwordMatches(`${password}!`, record.salt, record.hash, record.algorithm, env)).resolves.toBe(false);
    await expect(passwordMatches(password, record.salt, record.hash, record.algorithm, { AUTH_PASSWORD_PEPPER: `${pepper}!` } as unknown as Env)).resolves.toBe(false);
  });

  test("legacy credential formats remain verifiable for migration", async () => {
    const salt = base64Url(crypto.getRandomValues(new Uint8Array(16)));
    const legacyPbkdf2 = await legacyPbkdf2Hash(password, salt);
    const legacyHmac = await legacyHmacHash(password, salt, pepper);
    const priorPepperedPbkdf2 = await priorPepperedPbkdf2Hash(password, salt, pepper);
    await expect(passwordMatches(password, salt, legacyPbkdf2, "pbkdf2-sha256-100000", env)).resolves.toBe(true);
    await expect(passwordMatches(password, salt, legacyHmac, "hmac-sha256-v1", env)).resolves.toBe(true);
    await expect(passwordMatches(password, salt, priorPepperedPbkdf2, "pbkdf2-sha256-100000-peppered-v1", env)).resolves.toBe(true);
    await expect(passwordMatches(password, salt, legacyHmac, "unsupported-algorithm", env)).resolves.toBe(false);
  });

  test("legacy login atomically upgrades the hash and credential version", async () => {
    const salt = base64Url(crypto.getRandomValues(new Uint8Array(16)));
    const oldHash = await legacyPbkdf2Hash(password, salt);
    const oldTimestamp = "2026-01-01T00:00:00.000Z";
    let upgraded: unknown[] | null = null;
    const database = {
      prepare(sql: string) {
        if (sql.includes("FROM users WHERE email")) return statement(sql, { first: () => ({ id: tokenUser.id, email: tokenUser.email, display_name: tokenUser.displayName, password_salt: salt, password_hash: oldHash, password_algorithm: "pbkdf2-sha256-100000", password_updated_at: oldTimestamp, role_name: "viewer", is_active: 1 }) });
        if (sql.includes("UPDATE users SET password_salt")) return statement(sql, { run: (values) => { upgraded = values; return { meta: { changes: 1 } }; } });
        if (sql.includes("FROM role_definitions")) return statement(sql, { first: () => ({ role_name: "viewer", capabilities_json: '["chat"]', max_rows_per_query: 500 }) });
        throw new Error(`Unexpected login query: ${sql}`);
      },
    };
    const upgradedUser = await loginUser({ AUTH_PASSWORD_PEPPER: pepper, QUERYMIND_APP: database } as unknown as Env, tokenUser.email, password);
    expect(upgraded).not.toBeNull();
    expect(upgraded![2]).toBe("pbkdf2-sha256-10000-peppered-v1");
    expect(upgraded!.slice(6)).toEqual([tokenUser.id, oldHash, oldTimestamp]);
    expect(upgradedUser.passwordUpdatedAt).toBe(upgraded![3]);
    await expect(passwordMatches(password, String(upgraded![0]), String(upgraded![1]), String(upgraded![2]), env)).resolves.toBe(true);
  });

  test("legacy login fails closed when a concurrent credential change wins", async () => {
    const salt = base64Url(crypto.getRandomValues(new Uint8Array(16)));
    const oldHash = await legacyHmacHash(password, salt, pepper);
    const database = {
      prepare(sql: string) {
        if (sql.includes("FROM users WHERE email")) return statement(sql, { first: () => ({ id: tokenUser.id, email: tokenUser.email, display_name: tokenUser.displayName, password_salt: salt, password_hash: oldHash, password_algorithm: "hmac-sha256-v1", password_updated_at: "2026-01-01T00:00:00.000Z", role_name: "viewer", is_active: 1 }) });
        if (sql.includes("UPDATE users SET password_salt")) return statement(sql, { run: () => ({ meta: { changes: 0 } }) });
        throw new Error(`Unexpected login query: ${sql}`);
      },
    };
    await expect(loginUser({ AUTH_PASSWORD_PEPPER: pepper, QUERYMIND_APP: database } as unknown as Env, tokenUser.email, password)).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });
});

test.describe("invitation lifecycle races", () => {
  const token = "qmi_unit-test-invitation-token";
  const email = "invitee@example.test";
  const password = "invitation-password";
  const pepper = "unit-test-pepper-with-at-least-32-characters";

  function invitationEnvironment(row: Record<string, unknown>, batchChanges: number[] = []): Env {
    const database = {
      prepare(sql: string) {
        if (sql.includes("FROM invitations WHERE token_hash")) return statement(sql, { first: () => row });
        if (sql.includes("SELECT id FROM users WHERE email")) return statement(sql, { first: () => null });
        return statement(sql, {});
      },
      async batch(statements: BoundStatement[]) {
        return statements.map((_, index) => ({ meta: { changes: batchChanges[index] ?? 0 } }));
      },
    };
    return { AUTH_PASSWORD_PEPPER: pepper, QUERYMIND_APP: database } as unknown as Env;
  }

  for (const [state, row] of [
    ["revoked", { id: "22222222-2222-4222-8222-222222222222", email, role_name: "viewer", expires_at: "2999-01-01T00:00:00.000Z", accepted_at: null, revoked_at: "2026-08-13T00:00:00.000Z" }],
    ["expired", { id: "22222222-2222-4222-8222-222222222222", email, role_name: "viewer", expires_at: "2000-01-01T00:00:00.000Z", accepted_at: null, revoked_at: null }],
  ] as const) {
    test(`${state} invitations cannot be previewed or accepted`, async () => {
      const env = invitationEnvironment(row);
      await expect(invitationPreview(new Request("https://querymind.example/api/v1/auth/invitation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }), env)).rejects.toMatchObject({ status: 404, code: "INVITATION_NOT_AVAILABLE" });
      await expect(acceptInvitation(new Request("https://querymind.example/api/v1/auth/accept-invitation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, email, password }) }), env)).rejects.toMatchObject({ status: 400, code: "INVITATION_NOT_AVAILABLE" });
    });
  }

  test("acceptance fails closed when revocation wins after the initial read", async () => {
    const env = invitationEnvironment({ id: "22222222-2222-4222-8222-222222222222", email, role_name: "viewer", expires_at: "2999-01-01T00:00:00.000Z", accepted_at: null, revoked_at: null }, [0, 0]);
    await expect(acceptInvitation(new Request("https://querymind.example/api/v1/auth/accept-invitation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, email, password }) }), env)).rejects.toMatchObject({ code: "INVITATION_NOT_AVAILABLE" });
  });
});

test.describe("session invalidation", () => {
  test("a password update invalidates every JWT carrying the prior credential timestamp", async () => {
    const passwordTimestamp = { value: "2026-08-13T01:00:00.000Z" };
    const env = authEnvironment(passwordTimestamp);
    const oldToken = await createSessionToken(tokenUser, env);
    const oldRequest = new Request("https://querymind.example/api/v1/me", {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    await expect(requireUser(oldRequest, env)).resolves.toMatchObject({ id: tokenUser.id, roleName: "viewer" });

    passwordTimestamp.value = "2026-08-13T02:00:00.000Z";
    await expect(requireUser(oldRequest, env)).rejects.toMatchObject({ status: 401, code: "INVALID_SESSION" });

    const freshToken = await createSessionToken(tokenUser, env);
    const freshRequest = new Request("https://querymind.example/api/v1/me", {
      headers: { authorization: `Bearer ${freshToken}` },
    });
    await expect(requireUser(freshRequest, env)).resolves.toMatchObject({ id: tokenUser.id, roleName: "viewer" });
  });
});

test.describe("principal authorization boundary", () => {
  const principal = { ...tokenUser, capabilities: ["*"] };

  test("an API key cannot acquire browser administration even with Owner capabilities", () => {
    expect(() => requireBrowserSession({ ...principal, principalType: "api_key", apiKeyPrefix: "qm_release" })).toThrow();
    try {
      requireBrowserSession({ ...principal, principalType: "api_key", apiKeyPrefix: "qm_release" });
    } catch (error) {
      expect(error).toMatchObject({ status: 403, code: "API_KEY_RESTRICTED" });
    }
  });

  test("session and local principals retain browser administration", () => {
    expect(() => requireBrowserSession({ ...principal, principalType: "session" })).not.toThrow();
    expect(() => requireBrowserSession({ ...principal, principalType: "local" })).not.toThrow();
  });
});

test.describe("result response budgets", () => {
  test("stored AI history is bounded by both row count and encoded byte size", () => {
    const manySmallRows = Array.from({ length: MAX_STORED_PREVIEW_ROWS + 10 }, (_, index) => ({ index, value: "ok" }));
    expect(boundedResultPreview(manySmallRows)).toHaveLength(MAX_STORED_PREVIEW_ROWS);

    const largeRows = Array.from({ length: 10 }, (_, index) => ({ index, value: "x".repeat(12_000) }));
    const preview = boundedResultPreview(largeRows);
    expect(preview.length).toBeGreaterThan(0);
    expect(preview.length).toBeLessThan(largeRows.length);
    expect(jsonBytes(preview)).toBeLessThanOrEqual(MAX_STORED_PREVIEW_BYTES);
  });

  test("API result budget remains below the 2 MB product boundary", () => {
    expect(MAX_API_RESULT_BYTES).toBe(2_000_000);
    expect(MAX_STORED_PREVIEW_BYTES).toBeLessThan(MAX_API_RESULT_BYTES);
  });
});

test.describe("legacy product contracts", () => {
  test("clamps the 0004 Owner row limit to the runtime-safe UI contract", () => {
    expect(publicRole({
      role_name: "owner",
      display_name: "Owner",
      description: "Workspace owner",
      capabilities_json: '["*"]',
      max_rows_per_query: 50_000,
      is_system: 1,
      updated_at: "2026-08-12T00:00:00.000Z",
    })).toMatchObject({ maxRowsPerQuery: 10_000 });
  });

  for (const formula of ["=HYPERLINK(\"https://example.test\")", "\t=1+1", "\r=1+1", "  =1+1", "\n@SUM(1,1)", "\u00a0=1+1", "\ufeff=1+1"]) {
    test(`neutralizes CSV formula input ${JSON.stringify(formula.slice(0, 4))}`, () => {
      expect(csvCell(formula)).toMatch(/^"'/u);
    });
  }
});

test.describe("AI Gateway URL allowlist", () => {
  test("accepts only the provider-native OpenAI completion endpoint", () => {
    expect(validGatewayUrl("https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/openai/chat/completions")).toBe(true);
  });

  for (const url of [
    "https://api.openai.com/v1/chat/completions",
    "https://gateway.ai.cloudflare.com.evil.example/v1/a/b/openai/chat/completions",
    "https://gateway.ai.cloudflare.com/v1/a/b/openai/responses",
    "http://gateway.ai.cloudflare.com/v1/a/b/openai/chat/completions",
    "https://gateway.ai.cloudflare.com/v1/a/b/openai/chat/completions?token=secret",
  ]) {
    test(`rejects gateway URL: ${url}`, () => expect(validGatewayUrl(url)).toBe(false));
  }
});

test.describe("staging-only Owner break-glass recovery", () => {
  const password = "staging-recovery-test-password-2026";
  const owner = {
    id: "b9d8d04a-a5fb-4267-8dad-57815a26f41d",
    email: "staging-owner@example.test",
    role_name: "owner",
    is_active: 1,
    password_updated_at: "2026-10-15T10:00:00.000Z",
  };
  const target = {
    environment: "staging",
    databaseId: "b5773b44-2fa2-48e8-84f6-ec838eecdf91",
    databaseName: "querymind-staging-app",
    email: owner.email,
    password,
    confirmed: true,
    now: new Date("2026-10-15T10:00:00.000Z"),
  };

  test("accepts only explicit Staging recovery arguments and rejects password CLI flags", () => {
    expect(parseRecoveryArgs([
      "--environment", "staging",
      "--database-id", "b5773b44-2fa2-48e8-84f6-ec838eecdf91",
      "--email", owner.email,
      "--confirm-recovery",
    ])).toMatchObject({ environment: "staging", databaseId: "b5773b44-2fa2-48e8-84f6-ec838eecdf91", email: owner.email, confirmed: true });
    expect(() => parseRecoveryArgs(["--environment", "staging", "--password", password])).toThrow(/UNSUPPORTED_ARGUMENT/u);
  });

  test("rejects Production and every non-exact database target", () => {
    for (const target of [
      ["production", "31aa9906-6ced-4a9c-9b46-1af029e3271f", "querymind-app"],
      ["staging", "31aa9906-6ced-4a9c-9b46-1af029e3271f", "querymind-app"],
      ["staging", "wrong-database-id", "querymind-staging-app"],
      ["staging", "b5773b44-2fa2-48e8-84f6-ec838eecdf91", "querymind-app"],
    ]) {
      expect(() => assertStagingRecoveryTarget(target[0], target[1], target[2])).toThrow();
    }
  });

  test("updates only an existing active Owner, records audit, and returns no credential material", async () => {
    const writes: Array<{ user: typeof owner; credential: { salt: string; hash: string; algorithm: string }; passwordUpdatedAt: string; correlationId: string }> = [];
    const result = await recoverExistingStagingOwner(target, {
      findUsersByEmail: async () => [owner],
      applyRecovery: async (write) => {
        writes.push(write);
        return { updateChanges: 1, auditChanges: 1 };
      },
    });
    expect(result).toMatchObject({ userId: owner.id, email: owner.email, sessionsInvalidated: true, auditRecorded: true, algorithm: "pbkdf2-sha256-100000" });
    expect(Date.parse(result.passwordUpdatedAt)).toBe(Date.parse(owner.password_updated_at!) + 1);
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("hash");
    expect(writes).toHaveLength(1);
    const write = writes[0];
    await expect(passwordMatches(password, write.credential.salt, write.credential.hash, write.credential.algorithm, {} as Env)).resolves.toBe(true);
    const sql = buildStagingRecoverySql(write);
    expect(sql).toContain("SET password_salt =");
    expect(sql).toContain("STAGING_OWNER_RECOVERY");
    expect(sql).not.toContain("SET role_name");
    expect(sql).not.toContain("data_scope_key =");
    expect(sql).not.toContain(password);
    const summary = safeRecoveryMessage(result);
    expect(summary).not.toContain(password);
    expect(summary).not.toContain(write.credential.hash);
  });

  for (const denied of [
    { label: "unknown user", rows: [], code: "STAGING_OWNER_NOT_FOUND" },
    { label: "non-Owner user", rows: [{ ...owner, role_name: "viewer" }], code: "TARGET_USER_NOT_OWNER" },
    { label: "inactive Owner", rows: [{ ...owner, is_active: 0 }], code: "TARGET_OWNER_INACTIVE" },
  ]) {
    test(`rejects ${denied.label} without writing`, async () => {
      let writes = 0;
      await expect(recoverExistingStagingOwner(target, {
        findUsersByEmail: async () => denied.rows,
        applyRecovery: async () => { writes += 1; return { updateChanges: 1, auditChanges: 1 }; },
      })).rejects.toMatchObject({ code: denied.code });
      expect(writes).toBe(0);
    });
  }

  test("recovery credential is upgraded to the active peppered format by normal login", async () => {
    const credential = await createStagingRecoveryPasswordRecord(password);
    let upgraded: unknown[] | null = null;
    const database = {
      prepare(sql: string) {
        if (sql.includes("FROM users WHERE email")) return statement(sql, { first: () => ({
          id: owner.id,
          email: owner.email,
          display_name: "Staging Owner",
          password_salt: credential.salt,
          password_hash: credential.hash,
          password_algorithm: credential.algorithm,
          password_updated_at: "2026-10-15T10:00:00.001Z",
          role_name: "owner",
          is_active: 1,
        }) });
        if (sql.includes("UPDATE users SET password_salt")) return statement(sql, { run: (values) => { upgraded = values; return { meta: { changes: 1 } }; } });
        if (sql.includes("FROM role_definitions")) return statement(sql, { first: () => ({ role_name: "owner", capabilities_json: '["*"]', max_rows_per_query: 10_000 }) });
        throw new Error(`Unexpected recovery-login query: ${sql}`);
      },
    };
    const loggedIn = await loginUser({
      AUTH_PASSWORD_PEPPER: "staging-recovery-unit-test-pepper",
      QUERYMIND_APP: database,
    } as unknown as Env, owner.email, password);
    expect(upgraded).not.toBeNull();
    expect(upgraded![2]).toBe("pbkdf2-sha256-10000-peppered-v1");
    expect(loggedIn.passwordUpdatedAt).toBe(upgraded![3]);
    await expect(passwordMatches(password, String(upgraded![0]), String(upgraded![1]), String(upgraded![2]), {
      AUTH_PASSWORD_PEPPER: "staging-recovery-unit-test-pepper",
    } as unknown as Env)).resolves.toBe(true);
  });

  test("accepts Wrangler remote file-import summary only when both guarded writes succeeded", () => {
    expect(recoveryWriteCountsFromWranglerImport([{
      success: true,
      results: [{ "Total queries executed": 2 }],
      meta: { rows_written: 2 },
    }])).toEqual({ updateChanges: 1, auditChanges: 1 });
    for (const entries of [
      [],
      [{ success: false, results: [{ "Total queries executed": 2 }], meta: { rows_written: 2 } }],
      [{ success: true, results: [{ "Total queries executed": 2 }], meta: { rows_written: 1 } }],
      [{ success: true, results: [{ "Total queries executed": 1 }], meta: { rows_written: 2 } }],
      [
        { success: true, results: [{ "Total queries executed": 2 }], meta: { rows_written: 2 } },
        { success: true, results: [{ "Total queries executed": 2 }], meta: { rows_written: 2 } },
      ],
    ]) {
      expect(recoveryWriteCountsFromWranglerImport(entries)).toEqual({ updateChanges: 0, auditChanges: 0 });
    }
  });
});
