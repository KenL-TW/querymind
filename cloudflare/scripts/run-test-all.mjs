import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const playwright = path.join(root, "node_modules", "playwright", "cli.js");

function runNode(script, env) {
  execFileSync(process.execPath, [script], { cwd: root, env, stdio: "inherit" });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not reserve a local test port."));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
}

async function waitForHealth(child, url, logs) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local test Worker exited before becoming healthy.\n${logs()}`);
    try {
      const response = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* Worker startup is still in progress. */ }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Local test Worker did not become healthy.\n${logs()}`);
}

async function stopWorker(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else if (child.pid) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    if (!(await waitForExit(child, 5_000))) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  }
  await waitForExit(child, 5_000);
}

// CI supplies QUERYMIND_TEST_URL after setting up its own fresh D1 and Worker.
// Local runs get a unique disposable D1, so previous auth throttles cannot leak
// into a later full regression run.
if (process.env.QUERYMIND_TEST_URL) {
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/u.test(process.env.QUERYMIND_TEST_URL)) {
    throw new Error("The regression runner refuses non-local QUERYMIND_TEST_URL targets.");
  }
  const result = spawnSync(process.execPath, [playwright, "test"], { cwd: root, env: process.env, stdio: "inherit" });
  process.exit(result.status ?? 1);
}

const persistRoot = path.resolve(root, ".wrangler");
const persistPath = path.join(persistRoot, `pxai-a2-${randomUUID()}`);
if (!persistPath.startsWith(`${persistRoot}${path.sep}`)) throw new Error("Refusing to initialize a test database outside the Wrangler test state directory.");
mkdirSync(persistRoot, { recursive: true });
const persistArg = path.relative(root, persistPath);
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const testEnv = {
  ...process.env,
  XDG_CONFIG_HOME: path.join(persistPath, ".config"),
  QUERYMIND_TEST_PERSIST: persistArg,
  QUERYMIND_TEST_URL: baseUrl,
  QUERYMIND_TEST_BOOTSTRAP_TOKEN: "local-only-querymind-bootstrap-token-2026",
  QUERYMIND_TEST_SEMANTIC_ENABLED: "true",
};

let worker;
let workerLogs = "";
try {
  runNode(path.join(root, "scripts", "init-local-test.mjs"), testEnv);
  worker = spawn(process.execPath, [
    wrangler, "dev", "--local", "--port", String(port), "--persist-to", persistArg,
    "--var=ENVIRONMENT:local",
    "--var=AI_MOCK_MODE:true",
    "--var=SEMANTIC_RUNTIME_CONTEXT_ENABLED:true",
    "--var=AUTH_REQUIRED:true",
    "--var=AUTH_LOGIN_ATTEMPTS_PER_15_MINUTES:100",
    "--var=AUTH_JWT_SECRET:local-only-querymind-jwt-secret-2026",
    "--var=AUTH_BOOTSTRAP_TOKEN:local-only-querymind-bootstrap-token-2026",
    "--var=AUTH_PASSWORD_PEPPER:local-only-querymind-password-pepper-2026",
  ], { cwd: root, env: testEnv, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  const appendLogs = (chunk) => { workerLogs = `${workerLogs}${chunk}`.slice(-20_000); };
  worker.stdout.on("data", appendLogs);
  worker.stderr.on("data", appendLogs);
  await waitForHealth(worker, baseUrl, () => workerLogs);
  console.log(`Running complete Playwright regression against isolated local D1 on port ${port}.`);
  runNode(path.join(root, "scripts", "bootstrap-test-owner.mjs"), testEnv);
  const result = spawnSync(process.execPath, [playwright, "test"], { cwd: root, env: testEnv, stdio: "inherit" });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await stopWorker(worker);
  rmSync(persistPath, { recursive: true, force: true });
}
