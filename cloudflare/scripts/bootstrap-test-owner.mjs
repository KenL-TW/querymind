/**
 * Creates the disposable local test Owner and refreshes its catalog. It is
 * deliberately localhost-only and requires an explicitly supplied bootstrap
 * token, so it cannot target production or manufacture production state.
 */
const baseUrl = process.env.QUERYMIND_TEST_URL ?? "http://127.0.0.1:8787";
if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/u.test(baseUrl)) throw new Error("Test bootstrap is restricted to localhost.");
const bootstrapToken = process.env.QUERYMIND_TEST_BOOTSTRAP_TOKEN;
if (!bootstrapToken) throw new Error("QUERYMIND_TEST_BOOTSTRAP_TOKEN is required.");
const email = process.env.QUERYMIND_TEST_EMAIL ?? "owner@example.com";
const password = process.env.QUERYMIND_TEST_PASSWORD ?? "correct-horse-battery-staple";

async function post(path, body, headers = {}) {
  const response = await fetch(new URL(path, baseUrl), { method: "POST", headers: { "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Local test bootstrap ${path} failed with ${response.status}.`);
  return response;
}

const bootstrap = await fetch(new URL("/api/v1/auth/bootstrap", baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, bootstrapToken }) });
if (!bootstrap.ok && bootstrap.status !== 409) throw new Error(`Local test bootstrap /api/v1/auth/bootstrap failed with ${bootstrap.status}.`);
const login = await post("/api/v1/auth/login", { email, password });
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) throw new Error("Local test bootstrap did not receive a session cookie.");
await post("/api/v1/schema/refresh", undefined, { cookie });
console.log("Disposable local test Owner and schema catalog are ready.");
