import { expect, test } from "playwright/test";
import { validGatewayUrl } from "../src/lib/ai-config";
import {
  createPasswordRecord,
  createSessionToken,
  loginUser,
  passwordMatches,
  requireBrowserSession,
  requireUser,
  type AuthenticatedUser,
} from "../src/lib/auth";
import { analyzeSensitiveProjection, assertNoSensitiveInference, maskedQueryRows, type ColumnPolicy } from "../src/lib/dlp";
import { validateReadOnlySql } from "../src/lib/sql";
import { acceptInvitation, invitationPreview } from "../src/routes/invitations";
import { boundedResultPreview, jsonBytes, MAX_API_RESULT_BYTES, MAX_STORED_PREVIEW_BYTES, MAX_STORED_PREVIEW_ROWS } from "../src/lib/result-budget";
import { csvCell, publicRole } from "../src/routes/modules";

const sensitivePolicies: ColumnPolicy[] = [
  { table_name: "customers", column_name: "email", mask_mode: "full" },
  { table_name: "employees", column_name: "salary", mask_mode: "partial" },
];

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
