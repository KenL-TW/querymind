import { HttpError } from "./http";
import { MAX_SAFE_RESULT_ROWS } from "./product";

export const MAX_SQL_LENGTH = 10_000;
export const MAX_RESULT_ROWS = 500;

const FORBIDDEN_TOKEN = /\b(?:alter|analyze|attach|begin|commit|create|delete|detach|drop|end|insert|load_extension|pragma|reindex|release|replace|rollback|savepoint|update|vacuum)\b/i;
const COMMENT_TOKEN = /(?:--|\/\*)/;
const RESOURCE_AMPLIFICATION_FUNCTION = /\b(?:format|group_concat|json_group_array|json_group_object|printf|randomblob|zeroblob)\s*\(/i;

export interface ValidatedQuery {
  originalSql: string;
  executionSql: string;
  rowCap: number;
}

function withoutTrailingWhitespace(sql: string): string {
  return sql.trim();
}

/**
 * Defensive allow-list for the only SQL that QueryMind may execute against D1.
 * This intentionally rejects comments and semicolons, which removes common
 * multi-statement/obfuscation paths without attempting to be a SQL parser.
 */
export function validateReadOnlySql(input: unknown, requestedRowCap = MAX_RESULT_ROWS): ValidatedQuery {
  if (typeof input !== "string") {
    throw new HttpError(400, "INVALID_SQL", "The sql field must be a string.");
  }
  const sql = withoutTrailingWhitespace(input);
  if (!sql) throw new HttpError(400, "INVALID_SQL", "SQL cannot be empty.");
  if (sql.length > MAX_SQL_LENGTH) {
    throw new HttpError(400, "SQL_TOO_LONG", `SQL cannot exceed ${MAX_SQL_LENGTH} characters.`);
  }
  if (sql.includes(";")) {
    throw new HttpError(400, "MULTI_STATEMENT_SQL", "Semicolons are not allowed in read-only SQL.");
  }
  if (COMMENT_TOKEN.test(sql)) {
    throw new HttpError(400, "COMMENTED_SQL", "SQL comments are not allowed.");
  }
  if (!/^(?:select|with)\b/i.test(sql)) {
    throw new HttpError(400, "READ_ONLY_SQL_REQUIRED", "Only SELECT or WITH queries are allowed.");
  }
  if (FORBIDDEN_TOKEN.test(sql)) {
    throw new HttpError(400, "FORBIDDEN_SQL", "The SQL contains a forbidden operation.");
  }
  if (/\bwith\s+recursive\b/i.test(sql)) {
    throw new HttpError(400, "RECURSIVE_SQL_FORBIDDEN", "Recursive CTEs are not allowed within the Free-plan query budget.");
  }
  if (RESOURCE_AMPLIFICATION_FUNCTION.test(sql)) {
    throw new HttpError(400, "RESOURCE_AMPLIFICATION_FORBIDDEN", "This SQL function can generate an unbounded result and is not allowed.");
  }

  // The outer query is always capped, including when the generated SQL omits LIMIT.
  // D1 serializes query results inside the Worker.  A bounded cap keeps a
  // single prompt from exhausting Free-plan Worker memory or response budget.
  const rowCap = Math.min(Math.max(Math.floor(requestedRowCap), 1), MAX_SAFE_RESULT_ROWS);
  return {
    originalSql: sql,
    executionSql: `SELECT * FROM (${sql}) AS querymind_result LIMIT ${rowCap}`,
    rowCap,
  };
}
