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
  ["querymind-app", "migrations/app/0008_governed_semantic_foundation.sql"],
  ["querymind-app", "migrations/app/0009_semantic_governance_capabilities.sql"],
  ["querymind-app", "migrations/app/0010_semantic_schema_intelligence_suggestions.sql"],
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

const expectedTables = [
  "semantic_registry_state",
  "semantic_assets",
  "semantic_revisions",
  "semantic_sources",
  "semantic_aliases",
  "semantic_relationship_keys",
  "semantic_reviews",
  "semantic_suggestion_runs",
  "semantic_suggestions",
];
const expectedIndexes = [
  "idx_semantic_assets_status_type",
  "idx_semantic_assets_owner_status",
  "idx_semantic_revisions_asset_status",
  "idx_semantic_revisions_status",
  "idx_semantic_sources_revision",
  "idx_semantic_sources_physical",
  "idx_semantic_aliases_normalized",
  "idx_semantic_relationship_keys_endpoint",
  "idx_semantic_reviews_revision_created",
  "idx_semantic_reviews_reviewer_created",
  "idx_semantic_suggestion_runs_owner_created",
  "idx_semantic_suggestions_run_status",
  "idx_semantic_suggestions_status_type",
];
const verificationSql = "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (" + expectedTables.map((name) => `'${name}'`).join(",") + ") ORDER BY name; SELECT name FROM sqlite_schema WHERE type = 'index' AND name IN (" + expectedIndexes.map((name) => `'${name}'`).join(",") + ") ORDER BY name; SELECT registry_version FROM semantic_registry_state WHERE state_key = 'global'; PRAGMA table_info(schema_catalog_state); PRAGMA foreign_key_list(semantic_sources); PRAGMA foreign_key_list(semantic_suggestions); SELECT sql FROM sqlite_schema WHERE type IN ('table','trigger') AND name IN ('semantic_assets','semantic_revisions','semantic_sources','semantic_aliases','semantic_reviews','semantic_suggestion_runs','semantic_suggestions','semantic_suggestions_generated_content_immutable');";
const verification = spawnSync(process.execPath, [wrangler, "d1", "execute", "querymind-app", "--local", `--persist-to=${persistPath}`, "--command", verificationSql, "--json"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, XDG_CONFIG_HOME: path.join(persistPath, ".config") },
});
if (verification.status !== 0) {
  process.stderr.write(verification.stderr ?? "");
  process.exit(verification.status ?? 1);
}
for (const table of expectedTables) {
  if (!(verification.stdout ?? "").includes(table)) throw new Error(`P2-A migration verification failed: missing ${table}`);
}
for (const index of expectedIndexes) {
  if (!(verification.stdout ?? "").includes(index)) throw new Error(`P2-A migration verification failed: missing ${index}`);
}
if (!(verification.stdout ?? "").includes("registry_version") || !(verification.stdout ?? "").includes('"registry_version": 0') || !(verification.stdout ?? "").includes('"name": "schema_snapshot_id"')) throw new Error("P2-A migration verification failed: registry seed or schema snapshot column is missing");
if (!(verification.stdout ?? "").includes("semantic_revisions") || !(verification.stdout ?? "").includes("CHECK") || !(verification.stdout ?? "").includes("UNIQUE") || !(verification.stdout ?? "").includes('"from": "referenced_asset_id"')) throw new Error("P2-A migration verification failed: semantic FK/CHECK/UNIQUE constraints are missing");
if (!(verification.stdout ?? "").includes("semantic_suggestions_generated_content_immutable") || !(verification.stdout ?? "").includes('"from": "accepted_asset_id"')) throw new Error("P2-D migration verification failed: immutable suggestion content or acceptance FK is missing");

console.log(`Disposable local D1 initialized at ${persistPath}`);
console.log("Applied app migrations 0001-0010, including DLP, governed query safety, explainability feedback, semantic persistence, semantic governance, and P2-D schema intelligence suggestions.");
