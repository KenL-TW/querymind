import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReleaseManifest } from "./release-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(path.join(root, "production-runtime-contract.json"), "utf8"));
const configPath = path.join(root, "wrangler.production.jsonc");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const requiredMigrations = Array.from({ length: 10 }, (_, index) => String(index + 1).padStart(4, "0"));

function assert(condition, message) { if (!condition) throw new Error(`Production preflight failed: ${message}`); }
function git(...args) { return execFileSync("git", args, { cwd: path.join(root, ".."), encoding: "utf8" }).trim(); }

assert(config.name === contract.workerName, "Worker name does not match the production contract");
assert(config.keep_vars === true, "production config must preserve existing remote vars");
assert(!Object.hasOwn(config, "vars"), "production config must not upload preview/mock vars");
assert(config.main === "src/index.ts", "Worker entrypoint must be src/index.ts");
assert(Array.isArray(config.compatibility_flags) && config.compatibility_flags.includes("nodejs_compat"), "nodejs_compat must remain enabled");
assert(config.observability?.enabled === true && config.observability?.logs?.enabled === true && config.observability?.traces?.enabled === true, "production observability must remain enabled");
const bindings = new Set((config.d1_databases ?? []).map((item) => item.binding));
for (const binding of contract.requiredD1Bindings) assert(bindings.has(binding), `required D1 binding missing: ${binding}`);
assert(contract.environment === "production" && contract.authRequired === true && contract.aiMockMode === false, "production auth/mock contract is invalid");
assert(contract.gatewayHost === "gateway.ai.cloudflare.com" && contract.gatewayName === "querymind-prod" && contract.gatewayPathSuffix === "/querymind-prod/openai/chat/completions", "AI Gateway contract is invalid");
assert(contract.byokAlias === "production", "BYOK alias must be production");
assert(JSON.stringify(contract.allowedOpenAiModels) === JSON.stringify(["gpt-4o", "gpt-4o-mini"]), "model allowlist must be exactly gpt-4o,gpt-4o-mini");
const appMigrationFiles = readdirSync(path.join(root, "migrations", "app"));
for (const migration of requiredMigrations) assert(appMigrationFiles.some((name) => name.startsWith(`${migration}_`) && name.endsWith(".sql")), `application migration ${migration} is missing`);
assert(existsSync(path.join(root, "migrations", "data", "0001_initial_business_schema.sql")), "data migration 0001 is missing");
loadReleaseManifest();
assert(git("status", "--porcelain") === "", "working tree is not clean; commit or explicitly reconcile all changes before release");
assert(git("branch", "--show-current") === "main", "release must run from main");
console.log(`Production preflight passed for ${contract.workerName}.`);
console.log("Target: existing production Worker variables are preserved; no D1 migration or secret read will occur.");
