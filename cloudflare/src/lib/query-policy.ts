import { HttpError } from "./http";
import { validateReadOnlySql, type ValidatedQuery } from "./sql";
import type { EffectiveScope } from "./scope";

export interface CatalogTable { tableName: string; columns: string[]; }
export interface QueryCatalog { tables: Record<string, CatalogTable>; }

type TokenKind = "word" | "quoted" | "string" | "number" | "symbol";
interface Token { value: string; lower: string; start: number; end: number; kind: TokenKind; depth: number; }

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const KEYWORDS = new Set(["select", "from", "join", "left", "right", "full", "inner", "outer", "cross", "natural", "on", "where", "group", "by", "order", "having", "limit", "offset", "union", "intersect", "except", "as", "with", "recursive", "and", "or", "not", "is", "null", "case", "when", "then", "else", "end", "distinct", "all", "asc", "desc", "filter", "over", "partition", "collate", "like", "between", "in", "exists"]);

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("`") && value.endsWith("`"))) return value.slice(1, -1).replaceAll(value[0], value[0]);
  if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1);
  return value;
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0; let depth = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/u.test(c)) { i += 1; continue; }
    const start = i;
    if (c === "'") { i += 1; while (i < sql.length) { if (sql[i] === "'" && sql[i + 1] === "'") i += 2; else if (sql[i] === "'") { i += 1; break; } else i += 1; } tokens.push({ value: sql.slice(start, i), lower: "", start, end: i, kind: "string", depth }); continue; }
    if (c === '"' || c === "`" || c === "[") { const close = c === "[" ? "]" : c; i += 1; while (i < sql.length) { if (sql[i] === close && sql[i + 1] === close && c !== "[") i += 2; else if (sql[i] === close) { i += 1; break; } else i += 1; } const value = unquote(sql.slice(start, i)); tokens.push({ value, lower: value.toLowerCase(), start, end: i, kind: "quoted", depth }); continue; }
    if (/[A-Za-z_]/u.test(c)) { i += 1; while (i < sql.length && /[A-Za-z0-9_$]/u.test(sql[i])) i += 1; const value = sql.slice(start, i); tokens.push({ value, lower: value.toLowerCase(), start, end: i, kind: "word", depth }); continue; }
    if (/[0-9]/u.test(c)) { i += 1; while (i < sql.length && /[0-9.eE+-]/u.test(sql[i])) i += 1; tokens.push({ value: sql.slice(start, i), lower: "", start, end: i, kind: "number", depth }); continue; }
    i += 1; tokens.push({ value: c, lower: c, start, end: i, kind: "symbol", depth });
    if (c === "(") depth += 1; else if (c === ")") depth = Math.max(0, depth - 1);
  }
  if (tokens.length > 320) throw new HttpError(400, "QUERY_TOO_COMPLEX", "The query exceeds the governed query complexity limit.");
  return tokens;
}

function cteNames(tokens: Token[]): Set<string> {
  const names = new Set<string>();
  for (let i = 1; i + 2 < tokens.length; i += 1) {
    if (tokens[i].lower !== "as" || tokens[i + 1].value !== "(") continue;
    let nameIndex = i - 1;
    if (tokens[nameIndex]?.value === ")") {
      let closeDepth = 0;
      while (nameIndex >= 0) {
        if (tokens[nameIndex].value === ")") closeDepth += 1;
        if (tokens[nameIndex].value === "(") { closeDepth -= 1; if (closeDepth === 0) break; }
        nameIndex -= 1;
      }
      nameIndex -= 1;
    }
    const before = tokens[nameIndex];
    const beforeName = tokens[nameIndex - 1];
    if (before?.kind === "word" || before?.kind === "quoted") {
      if (!beforeName || beforeName.value === "," || beforeName.lower === "with") names.add(before.lower);
    }
  }
  return names;
}

function quoteIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }

interface Source { table: string; alias: string; token: Token; end: number; }

function sourcesAndReferences(tokens: Token[], catalog: QueryCatalog): { sources: Source[]; physical: Set<string>; aliases: Map<string, string>; ctes: Set<string> } {
  const ctes = cteNames(tokens); const sources: Source[] = []; const physical = new Set<string>(); const aliases = new Map<string, string>();
  for (let i = 0; i < tokens.length; i += 1) {
    const keyword = tokens[i].lower;
    if (keyword !== "from" && keyword !== "join") continue;
    if (keyword === "from") {
      for (let scan = i + 1; scan < tokens.length; scan += 1) {
        if (tokens[scan].depth < tokens[i].depth) break;
        if (tokens[scan].depth === tokens[i].depth && tokens[scan].value === ",") throw new HttpError(400, "QUERY_TOO_COMPLEX", "Comma-separated source lists are not permitted; use explicit JOIN.");
        if (tokens[scan].depth === tokens[i].depth && ["where", "group", "order", "having", "limit", "offset", "union", "intersect", "except"].includes(tokens[scan].lower)) break;
      }
    }
    let j = i + 1;
    if (tokens[j]?.value === "(") continue; // derived table: its inner FROM/JOIN is still scanned
    const tableToken = tokens[j];
    if (!tableToken || !["word", "quoted"].includes(tableToken.kind)) throw new HttpError(400, "TABLE_NOT_ALLOWED", "Every query source must be an authorized table.");
    const table = tableToken.lower;
    if (ctes.has(table)) continue;
    if (!catalog.tables[table]) throw new HttpError(403, "TABLE_NOT_ALLOWED", `Table ${table} is outside the authorized catalog.`);
    physical.add(table);
    let alias = table; let end = tableToken.end;
    const next = tokens[j + 1];
    if (next?.lower === "as" && tokens[j + 2] && ["word", "quoted"].includes(tokens[j + 2].kind)) { alias = tokens[j + 2].lower; end = tokens[j + 2].end; }
    else if (next && ["word", "quoted"].includes(next.kind) && !KEYWORDS.has(next.lower)) { alias = next.lower; end = next.end; }
    aliases.set(alias, table); aliases.set(table, table);
    sources.push({ table, alias, token: tableToken, end });
  }
  if (!sources.length) throw new HttpError(400, "TABLE_NOT_ALLOWED", "The query must reference an authorized business table.");
  return { sources, physical, aliases, ctes };
}

function enforceColumns(tokens: Token[], scope: EffectiveScope, refs: ReturnType<typeof sourcesAndReferences>, catalog: QueryCatalog): void {
  const selectAliases = new Set(tokens.flatMap((token, index) => token.kind !== "word" && token.kind !== "quoted" ? [] : tokens[index - 1]?.lower === "as" ? [token.lower] : []));
  const projectionWildcard = tokens.some((token, index) => {
    if (token.value !== "*") return false;
    const previous = tokens[index - 1]?.value;
    const previousLower = tokens[index - 1]?.lower;
    if (previous === "(") return false; // COUNT(*)/aggregate argument, not a projected column set
    return previous === "." || previousLower === "select" || previous === "," || previous === undefined;
  });
  for (const table of refs.physical) {
    const policy = scope.datasource.tables[table];
    if (!policy) throw new HttpError(403, "TABLE_NOT_ALLOWED", `Table ${table} is outside the authorized scope.`);
    const allowed = policy.columns === "*" ? new Set(catalog.tables[table]?.columns ?? []) : new Set(policy.columns);
    const actual = catalog.tables[table]?.columns ?? [];
    if (actual.length === 0) throw new HttpError(503, "SCHEMA_CATALOG_EMPTY", "Authorized schema metadata is unavailable.");
    for (const column of actual) if (!allowed.has(column)) {
      // Wildcards are only safe when every physical column is authorized.
      if (projectionWildcard) throw new HttpError(403, "COLUMN_NOT_ALLOWED", `Wildcard projection would expose ${table}.${column}.`);
    }
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== "word" && token.kind !== "quoted") continue;
    const next = tokens[i + 1];
    if (next?.value === "." && tokens[i + 2] && (tokens[i + 2].kind === "word" || tokens[i + 2].kind === "quoted")) {
      const table = refs.aliases.get(token.lower); const column = tokens[i + 2].lower;
      if (table && catalog.tables[table]?.columns.includes(column)) {
        const policy = scope.datasource.tables[table];
        if (!policy || (policy.columns !== "*" && !policy.columns.includes(column))) throw new HttpError(403, "COLUMN_NOT_ALLOWED", `Column ${table}.${column} is outside the authorized scope.`);
      }
      i += 2; continue;
    }
    if (KEYWORDS.has(token.lower) || tokens[i - 1]?.value === "." || tokens[i + 1]?.value === "(" || token.lower === "true" || token.lower === "false") continue;
    const matched = [...refs.physical].filter((table) => catalog.tables[table]?.columns.includes(token.lower));
    if (matched.length && matched.some((table) => {
      const policy = scope.datasource.tables[table]; return !policy || (policy.columns !== "*" && !policy.columns.includes(token.lower));
    })) throw new HttpError(403, "COLUMN_NOT_ALLOWED", `Column ${token.lower} is outside the authorized scope.`);
    if (!matched.length && !refs.aliases.has(token.lower) && !refs.ctes.has(token.lower) && !refs.physical.has(token.lower) && !selectAliases.has(token.lower) && tokens[i - 1]?.lower !== "as" && tokens[i - 1]?.value !== ")") {
      throw new HttpError(403, "COLUMN_NOT_ALLOWED", `Column ${token.lower} is not present in the authorized catalog.`);
    }
  }
}

function rewriteRows(sql: string, sources: Source[], scope: EffectiveScope): string {
  const replacements = sources.flatMap((source) => {
    const filter = scope.datasource.tables[source.table]?.rowFilter?.predicate;
    if (!filter) return [];
    return [{ start: source.token.start, end: source.end, value: `(SELECT * FROM ${quoteIdentifier(source.table)} WHERE ${filter}) AS ${quoteIdentifier(source.alias)}` }];
  }).sort((a, b) => b.start - a.start);
  let output = sql;
  for (const replacement of replacements) output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  return output;
}

export interface GovernedQuery extends ValidatedQuery { referencedTables: string[]; }

export function authorizeReadOnlySql(sql: unknown, maxRows: number, scope: EffectiveScope, catalog: QueryCatalog): GovernedQuery {
  const initial = validateReadOnlySql(sql, maxRows);
  if (!scope.canQuery) throw new HttpError(403, "RBAC_FORBIDDEN", "Your data scope is not allowed to query.");
  const tokens = tokenize(initial.originalSql);
  const refs = sourcesAndReferences(tokens, catalog);
  if (refs.sources.length > 8) throw new HttpError(400, "QUERY_TOO_COMPLEX", "The query references too many tables.");
  if (tokens.some((token, index) => (token.lower === "cross" || token.lower === "natural") && tokens[index + 1]?.lower === "join")) throw new HttpError(400, "QUERY_TOO_COMPLEX", "CROSS/NATURAL JOIN is not permitted.");
  enforceColumns(tokens, scope, refs, catalog);
  const rewritten = rewriteRows(initial.originalSql, refs.sources, scope);
  const bounded = validateReadOnlySql(rewritten, maxRows);
  return { ...bounded, originalSql: initial.originalSql, referencedTables: [...refs.physical] };
}

export async function queryCatalog(env: Env): Promise<QueryCatalog> {
  const rows = (await env.QUERYMIND_APP.prepare("SELECT table_name, column_name FROM schema_catalog_columns ORDER BY table_name, ordinal_position").all<{ table_name: string; column_name: string }>()).results ?? [];
  const tables: Record<string, CatalogTable> = {};
  for (const row of rows) { const table = row.table_name.toLowerCase(); (tables[table] ??= { tableName: table, columns: [] }).columns.push(row.column_name.toLowerCase()); }
  if (!Object.keys(tables).length) throw new HttpError(409, "SCHEMA_CATALOG_EMPTY", "Schema catalog is empty. Refresh it before querying.");
  return { tables };
}

export async function authorizeQuery(env: Env, scope: EffectiveScope, sql: unknown, maxRows: number): Promise<GovernedQuery> {
  return authorizeReadOnlySql(sql, maxRows, scope, await queryCatalog(env));
}
