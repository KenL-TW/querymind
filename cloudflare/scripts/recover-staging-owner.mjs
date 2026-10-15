import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const cloudflareDirectory = path.resolve(scriptDirectory, "..");
const configPath = path.join(cloudflareDirectory, "wrangler.staging.jsonc");
const wranglerPath = path.join(cloudflareDirectory, "node_modules", "wrangler", "bin", "wrangler.js");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

// Use the repository's TypeScript auth implementation without adding a second
// password-hashing implementation or a runtime dependency for this CLI.
require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8");
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(compiled, filename);
};

const {
  STAGING_OWNER_RECOVERY_TARGET,
  StagingOwnerRecoveryError,
  assertStagingRecoveryTarget,
  buildStagingRecoverySql,
  parseRecoveryArgs,
  recoveryWriteCountsFromWranglerImport,
  recoverExistingStagingOwner,
  safeRecoveryMessage,
} = require("../src/lib/staging-owner-recovery.ts");
const { validateEmail } = require("../src/lib/auth.ts");

function findJsonPayload(output) {
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== "[" && output[index] !== "{") continue;
    try {
      return JSON.parse(output.slice(index));
    } catch {
      // Wrangler may prefix --json output with progress text; try the next opener.
    }
  }
  throw new Error("D1_RESPONSE_INVALID");
}

function queryResults(output) {
  const parsed = findJsonPayload(output);
  const value = parsed?.result ?? parsed;
  const entries = Array.isArray(value) ? value : Array.isArray(value?.results) ? [value] : [];
  if (entries.length === 0 || entries.some((entry) => entry?.success === false)) throw new Error("D1_RESPONSE_INVALID");
  return entries;
}

function assertStagingConfig() {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (config.name !== "querymind-staging"
    || config.vars?.ENVIRONMENT !== "staging"
    || config.vars?.AUTH_REQUIRED !== "true"
    || config.vars?.AI_PROVIDER !== "workers_ai"
    || config.vars?.SEMANTIC_RUNTIME_CONTEXT_ENABLED !== "false") {
    throw new StagingOwnerRecoveryError("STAGING_CONFIG_MISMATCH");
  }
  const appBindings = (config.d1_databases ?? []).filter((database) => database.binding === "QUERYMIND_APP");
  if (appBindings.length !== 1) throw new StagingOwnerRecoveryError("STAGING_APP_BINDING_AMBIGUOUS");
  const app = appBindings[0];
  assertStagingRecoveryTarget(config.vars.ENVIRONMENT, app.database_id, app.database_name);
  if ((config.d1_databases ?? []).some((database) => database.database_id === "31aa9906-6ced-4a9c-9b46-1af029e3271f" || database.database_name === "querymind-app")) {
    throw new StagingOwnerRecoveryError("PRODUCTION_BINDING_FORBIDDEN");
  }
  return app;
}

function writeTemporarySql(sql) {
  const filePath = path.join(tmpdir(), `querymind-staging-recovery-${randomUUID()}.sql`);
  writeFileSync(filePath, sql, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return filePath;
}

function executeSql(sql) {
  const sqlPath = writeTemporarySql(sql);
  try {
    const result = spawnSync(process.execPath, [
      wranglerPath,
      "d1", "execute", STAGING_OWNER_RECOVERY_TARGET.databaseName,
      "--remote", "--json", "--config", configPath, "--file", sqlPath,
    ], {
      cwd: cloudflareDirectory,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
      env: process.env,
    });
    if (result.error || result.status !== 0) throw new Error("D1_EXECUTION_FAILED");
    return queryResults(result.stdout ?? "");
  } catch {
    // Never forward Wrangler output: errors can contain SQL or credential hashes.
    throw new Error("STAGING_D1_OPERATION_FAILED");
  } finally {
    try { unlinkSync(sqlPath); } catch { /* Best effort cleanup of the one-use SQL file. */ }
  }
}

function createDatabaseAdapter() {
  return {
    async findUsersByEmail(email) {
      const escapedEmail = email.replaceAll("'", "''");
      const sql = `SELECT id, email, role_name, is_active, password_updated_at FROM users WHERE email = '${escapedEmail}' COLLATE NOCASE;`;
      const entries = executeSql(sql);
      return entries.flatMap((entry) => Array.isArray(entry.results) ? entry.results : []).map((user) => ({
        ...user,
        is_active: Number(user.is_active),
        password_updated_at: user.password_updated_at ?? null,
      }));
    },
    async applyRecovery(write) {
      const entries = executeSql(buildStagingRecoverySql(write));
      return recoveryWriteCountsFromWranglerImport(entries);
    },
  };
}

function readHiddenLine(label) {
  const input = process.stdin;
  const output = process.stderr;
  if (!input.isTTY || typeof input.setRawMode !== "function") throw new Error("PASSWORD_INPUT_REQUIRED_VIA_SECURE_TTY_OR_ENV");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      input.off("data", onData);
      input.setRawMode(false);
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") return finish(new Error("PASSWORD_INPUT_CANCELLED"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };
    output.write(label);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function readRecoveryPassword(fromEnvironment) {
  if (fromEnvironment !== undefined) return fromEnvironment;
  const password = await readHiddenLine("New Staging Owner password (hidden): ");
  const confirmation = await readHiddenLine("Confirm password (hidden): ");
  if (password !== confirmation) throw new Error("PASSWORD_CONFIRMATION_MISMATCH");
  return password;
}

async function verifyOwnerLogin(email, password) {
  let cookie = "";
  try {
    const response = await fetch("https://querymind-staging.digitalaaronl.workers.dev/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new Error("STAGING_LOGIN_FAILED");
    const setCookie = response.headers.get("set-cookie") ?? "";
    cookie = setCookie.split(";")[0] ?? "";
    if (!cookie.startsWith("qm_session=")) throw new Error("STAGING_SESSION_NOT_ISSUED");
    const body = await response.json();
    if (body?.user?.email !== email || body?.user?.roleName !== "owner") throw new Error("STAGING_OWNER_LOGIN_MISMATCH");
    const adminResponse = await fetch("https://querymind-staging.digitalaaronl.workers.dev/api/v1/admin/overview", {
      headers: { cookie },
    });
    if (!adminResponse.ok) throw new Error("STAGING_OWNER_READ_CHECK_FAILED");
    return { email: body.user.email, roleName: body.user.roleName, adminRead: true };
  } catch {
    throw new Error("OWNER_RECOVERY_APPLIED_LOGIN_VERIFICATION_FAILED");
  } finally {
    cookie = "";
  }
}

async function main() {
  let recoveryApplied = false;
  let password = "";
  let environmentPassword = process.env.QUERYMIND_RECOVERY_PASSWORD;
  delete process.env.QUERYMIND_RECOVERY_PASSWORD;
  try {
    const args = parseRecoveryArgs(process.argv.slice(2));
    if (!args.confirmed) throw new StagingOwnerRecoveryError("EXPLICIT_CONFIRMATION_REQUIRED");
    const app = assertStagingConfig();
    assertStagingRecoveryTarget(args.environment, args.databaseId, app.database_name);
    if (!existsSync(wranglerPath)) throw new StagingOwnerRecoveryError("WRANGLER_NOT_FOUND");

    const email = validateEmail(args.email);
    const database = createDatabaseAdapter();
    const preflightUsers = await database.findUsersByEmail(email);
    if (preflightUsers.length === 0) throw new StagingOwnerRecoveryError("STAGING_OWNER_NOT_FOUND");
    if (preflightUsers.length !== 1) throw new StagingOwnerRecoveryError("STAGING_OWNER_AMBIGUOUS");
    if (preflightUsers[0].role_name !== "owner") throw new StagingOwnerRecoveryError("TARGET_USER_NOT_OWNER");
    if (Number(preflightUsers[0].is_active) !== 1) throw new StagingOwnerRecoveryError("TARGET_OWNER_INACTIVE");

    password = await readRecoveryPassword(environmentPassword);
    environmentPassword = "";
    const result = await recoverExistingStagingOwner({
      environment: args.environment,
      databaseId: args.databaseId,
      databaseName: app.database_name,
      email,
      password,
      confirmed: args.confirmed,
    }, {
      findUsersByEmail: async () => preflightUsers,
      applyRecovery: database.applyRecovery,
    });
    recoveryApplied = true;
    await verifyOwnerLogin(email, password);
    process.stdout.write(`${safeRecoveryMessage(result)}\n`);
  } catch (error) {
    const code = error instanceof StagingOwnerRecoveryError ? error.code : "STAGING_OWNER_RECOVERY_FAILED";
    process.stderr.write(`${recoveryApplied ? "OWNER_RECOVERY_APPLIED_LOGIN_VERIFICATION_FAILED" : code}\n`);
    process.exitCode = 1;
  } finally {
    password = "";
    environmentPassword = "";
    delete process.env.QUERYMIND_RECOVERY_PASSWORD;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
