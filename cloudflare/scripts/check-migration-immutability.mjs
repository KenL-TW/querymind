import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expected = {
  "0006_governed_query_safety.sql": "3d4aceb4fa688b831b8edc359b7e23dfe15e317921b90aff593fafe6f8a91411",
  "0007_explainable_query_experience.sql": "b0919b42c6742a7755bbfa923b0cda87f114cd696b17003dbe140422ecd14341",
  "0008_governed_semantic_foundation.sql": "7d17c89872d0df209735358eaad4bca2a2ae008149454b155d388a43ec9be179",
  "0009_semantic_governance_capabilities.sql": "6a2374347ca5107cc1df319655d69ae1b0ff3f0e279027bc8ce15091ef3960ff",
  "0010_semantic_schema_intelligence_suggestions.sql": "b8eb98fc7358d6b9f9f36294bb0b753a862e2422d4f6df3b41aa16f04c02ee37",
  "0011_feedback_trust_experience.sql": "b8276e61498ffd95691ec93982fee39d9ab400ad239cb3444666367b5875960a",
  "0012_semantic_approval_publication.sql": "3a3732bbcee0705f33fc03c8e7650437a2eeb7bc6d1fd5d8472b7998900cc12b"
};

for (const [name, hash] of Object.entries(expected)) {
  // Git may materialize text files with CRLF on Windows. Hash the canonical LF
  // representation so the released migration contract is checkout-independent.
  const canonicalSql = readFileSync(path.join(root, "migrations", "app", name), "utf8")
    .replace(/\r\n?/g, "\n");
  const actual = createHash("sha256").update(canonicalSql, "utf8").digest("hex");
  if (actual !== hash) throw new Error(`Released migration changed: ${name}`);
}
console.log("Protected migrations 0006-0012 are immutable.");
