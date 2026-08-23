import { rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const persistPath = path.join(root, ".wrangler-test");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

// This directory is disposable by definition and never shares state with the
// normal local runtime or a remote D1 database.
rmSync(persistPath, { recursive: true, force: true });

const inputs = [
  ["querymind-data", "migrations/data/0001_initial_business_schema.sql"],
  ["querymind-data", "seeds/demo.sql"],
  ["querymind-app", "migrations/app/0001_initial_application_schema.sql"],
  ["querymind-app", "migrations/app/0002_add_local_auth.sql"],
  ["querymind-app", "migrations/app/0003_usage_and_security.sql"],
  ["querymind-app", "migrations/app/0004_restore_product_modules.sql"],
  ["querymind-app", "migrations/app/0005_product_hardening.sql"],
  ["querymind-app", "migrations/app/0006_governed_query_safety.sql"],
  ["querymind-app", "migrations/app/0007_explainable_query_experience.sql"],
];

for (const [database, file] of inputs) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", database, "--local", `--persist-to=${persistPath}`, `--file=${path.join(root, file)}`], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, XDG_CONFIG_HOME: path.join(persistPath, ".config") },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Disposable local D1 initialized at ${persistPath}`);
console.log("Applied app migrations 0001-0007, including DLP, governed query safety, and explainability feedback.");
