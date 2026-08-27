import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const run = (script) => execFileSync(process.execPath, [path.join(root, "scripts", script)], { cwd: root, stdio: "inherit" });

run("release-preflight.mjs");
console.log("Planned target: Worker querymind (production variables preserved with keep_vars). No D1 migration will be applied.");
execFileSync(process.execPath, [wrangler, "deploy", "--config", "wrangler.production.jsonc", "--dry-run"], { cwd: root, stdio: "inherit" });
console.log("Dry-run passed. Execute this command only after the operator has reviewed the planned target.");
execFileSync(process.execPath, [wrangler, "deploy", "--config", "wrangler.production.jsonc", "--keep-vars"], { cwd: root, stdio: "inherit" });
