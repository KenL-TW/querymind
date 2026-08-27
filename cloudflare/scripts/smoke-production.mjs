const baseUrl = (process.env.QUERYMIND_PRODUCTION_URL ?? "https://querymind.digitalaaronl.workers.dev").replace(/\/$/u, "");
const authorization = process.env.QUERYMIND_SMOKE_AUTHORIZATION;

function assert(condition, message) { if (!condition) throw new Error(`Production smoke failed: ${message}`); }
async function request(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (authorization) headers.set("authorization", authorization);
  return fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "error" });
}
async function json(response, label) {
  const body = await response.json().catch(() => null);
  assert(body !== null, `${label} did not return JSON`);
  return body;
}

const home = await request("/");
assert(home.status === 200, `GET / expected 200, received ${home.status}`);
const healthResponse = await request("/health");
assert(healthResponse.status === 200, `GET /health expected 200, received ${healthResponse.status}`);
const health = await json(healthResponse, "health");
assert(health.status === "ok" && health.environment === "production" && health.ai === "ready", "health must report production AI ready");
assert(health.databases?.app === "ok" && health.databases?.data === "ok", "health must report both D1 databases ready");
assert(health.policy?.ok === true && health.policy?.policyCount === 72, "health must report the P0 policy baseline");
const anonymous = await fetch(`${baseUrl}/api/v1/semantics`, { redirect: "error" });
assert(anonymous.status === 401, `anonymous semantics expected 401, received ${anonymous.status}`);
console.log("Public smoke passed: /, /health, anonymous protected endpoint.");

if (!authorization) {
  console.log("Authenticated smoke skipped: set QUERYMIND_SMOKE_AUTHORIZATION to an existing authorized session/token; no credential is stored by this script.");
  process.exit(0);
}

const me = await request("/api/v1/me");
assert(me.status === 200, `GET /api/v1/me expected 200, received ${me.status}`);
const semantics = await request("/api/v1/semantics");
assert(semantics.status === 200, `GET /api/v1/semantics expected 200, received ${semantics.status}`);
const semanticPayload = await json(semantics, "semantics");
assert(Array.isArray(semanticPayload.items) && semanticPayload.items.length === 0, "semantic baseline must remain empty");
const chat = await request("/api/v1/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sessionId: crypto.randomUUID(), prompt: "請依商品列出銷售額" }),
});
assert(chat.status === 200, `golden chat expected 200, received ${chat.status}`);
const payload = await json(chat, "golden chat");
const explanation = payload.explainability ?? payload.message?.explainability;
const result = payload.result ?? payload.message?.result ?? payload;
assert((explanation?.understanding?.metrics ?? []).includes("sales amount"), "golden chat metric must include sales amount");
assert((explanation?.understanding?.dimensions ?? []).includes("product"), "golden chat dimension must include product");
assert(result.rowCount === 3 || result.rows?.length === 3, "golden chat must return three rows");
assert(typeof explanation?.explanation?.sql === "string" && explanation.explanation.sql.trim(), "golden chat must provide authorized verified SQL");
console.log("Authenticated smoke passed: current user, empty semantic registry, and golden governed chat.");
