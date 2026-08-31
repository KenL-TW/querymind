import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = path.join(root, "..", "docs", "releases", "manifests", "p2-d-production.json");
const workerId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const sha = /^[0-9a-f]{40}$/iu;
const snapshot = /^[0-9a-f]{64}$/iu;
const migration = /^\d{4}$/u;

function fail(message) { throw new Error(`Release manifest invalid: ${message}`); }

export function validateReleaseManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("must be an object");
  if (value.phase === "P1.2") return validateP12ReleaseManifest(value);
  const requiredStrings = ["releaseId", "phase", "gitSha", "workerVersionId", "previousWorkerVersionId", "appMigration", "dataMigration", "schemaSnapshotId", "policyVersion", "modelProvider", "gateway", "byokAlias", "releasedAt", "rollbackWorker", "environment"];
  for (const key of requiredStrings) if (typeof value[key] !== "string" || !value[key].trim()) fail(`${key} is required`);
  if (!["P2-D", "P2-F", "P2-G"].includes(value.phase)) fail("phase must be P2-D, P2-F, or P2-G");
  if (!sha.test(value.gitSha)) fail("gitSha must be a 40-character SHA");
  for (const key of ["workerVersionId", "previousWorkerVersionId", "rollbackWorker"]) if (!workerId.test(value[key])) fail(`${key} must be a Worker version ID`);
  for (const key of ["appMigration", "dataMigration"]) if (!migration.test(value[key])) fail(`${key} must be a four-digit migration`);
  if (!snapshot.test(value.schemaSnapshotId)) fail("schemaSnapshotId must be a SHA-256 digest");
  if (value.environment !== "production" || value.aiMockMode !== false) fail("must describe production with AI mock mode disabled");
  if (value.rollbackWorker !== value.previousWorkerVersionId) fail("rollbackWorker must equal previousWorkerVersionId");
  if (!Number.isInteger(value.policyCount) || value.policyCount < 1) fail("policyCount must be a positive integer");
  for (const key of ["semanticRegistryVersion", "semanticAssets", "semanticRevisions", "semanticReviews"]) if (!Number.isInteger(value[key]) || value[key] < 0) fail(`${key} must be a non-negative integer`);
  if (!Array.isArray(value.promptVersions) || value.promptVersions.length === 0 || !value.promptVersions.every((entry) => typeof entry === "string" && entry.length <= 80)) fail("promptVersions must be a non-empty bounded string array");
  if (!value.tests || typeof value.tests !== "object") fail("tests is required");
  for (const name of ["unit", "e2e", "full"]) {
    const result = value.tests[name];
    if (!result || !Number.isInteger(result.passed) || !Number.isInteger(result.total) || result.passed < 0 || result.total < result.passed || result.total === 0) fail(`tests.${name} must contain valid counts`);
  }
  if (!["PENDING", "PASS"].includes(value.productionManualGate)) fail("productionManualGate must be PENDING or PASS");
  const forbiddenKey = /(secret|token|password|credential|api_?key)/iu;
  const visit = (entry, key = "") => {
    if (forbiddenKey.test(key)) fail(`forbidden secret-like field: ${key}`);
    if (typeof entry === "string" && /(?:sk-[a-z0-9_-]{16,}|bearer\s+\S{16,})/iu.test(entry)) fail("contains a credential-like value");
    if (entry && typeof entry === "object") for (const [nestedKey, nestedValue] of Object.entries(entry)) visit(nestedValue, nestedKey);
  };
  visit(value);
  return value;
}

function validateP12ReleaseManifest(value) {
  const requiredStrings = ["releaseId", "phase", "gitSha", "workerVersionId", "previousWorkerVersionId", "appMigration", "dataMigration", "schemaSnapshotId", "policyVersion", "releasedAt", "rollbackWorker", "environment", "manualAuthenticatedUxSmoke"];
  for (const key of requiredStrings) if (typeof value[key] !== "string" || !value[key].trim()) fail(`${key} is required`);
  if (value.phase !== "P1.2") fail("phase must be P1.2");
  if (!sha.test(value.gitSha)) fail("gitSha must be a 40-character SHA");
  for (const key of ["workerVersionId", "previousWorkerVersionId", "rollbackWorker"]) if (!workerId.test(value[key])) fail(`${key} must be a Worker version ID`);
  for (const key of ["appMigration", "dataMigration"]) if (!migration.test(value[key])) fail(`${key} must be a four-digit migration`);
  if (!snapshot.test(value.schemaSnapshotId)) fail("schemaSnapshotId must be a SHA-256 digest");
  if (value.environment !== "production") fail("environment must be production");
  if (value.rollbackWorker !== value.previousWorkerVersionId) fail("rollbackWorker must equal previousWorkerVersionId");
  if (!Number.isInteger(value.policyCount) || value.policyCount < 1) fail("policyCount must be a positive integer");
  for (const key of ["semanticRegistryVersion", "semanticAssets", "semanticRevisions", "semanticReviews"]) if (!Number.isInteger(value[key]) || value[key] < 0) fail(`${key} must be a non-negative integer`);
  if (!value.tests || typeof value.tests !== "object") fail("tests is required");
  for (const name of ["unit", "e2e", "full"]) {
    const result = value.tests[name];
    if (!result || !Number.isInteger(result.passed) || !Number.isInteger(result.total) || result.passed < 0 || result.total < result.passed || result.total === 0) fail(`tests.${name} must contain valid counts`);
  }
  if (!["PENDING", "PASS", "NOT_EXECUTED_BY_DESIGN"].includes(value.manualAuthenticatedUxSmoke)) fail("manualAuthenticatedUxSmoke must be PENDING, PASS, or NOT_EXECUTED_BY_DESIGN");
  const forbiddenKey = /(secret|token|password|credential|api_?key)/iu;
  const visit = (entry, key = "") => {
    if (forbiddenKey.test(key)) fail(`forbidden secret-like field: ${key}`);
    if (typeof entry === "string" && /(?:sk-[a-z0-9_-]{16,}|bearer\s+\S{16,})/iu.test(entry)) fail("contains a credential-like value");
    if (entry && typeof entry === "object") for (const [nestedKey, nestedValue] of Object.entries(entry)) visit(nestedValue, nestedKey);
  };
  visit(value);
  return value;
}

export function loadReleaseManifest(file = process.argv[2] ? path.resolve(process.argv[2]) : defaultManifestPath) {
  return validateReleaseManifest(JSON.parse(readFileSync(file, "utf8")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const value = loadReleaseManifest();
  console.log(`Release manifest valid: ${value.releaseId}`);
}
