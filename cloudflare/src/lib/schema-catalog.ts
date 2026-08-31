import { HttpError } from "./http";
import type { EffectiveScope } from "./scope";

interface DataTable {
  name: string;
  sql: string | null;
}

interface ParsedColumn { name: string; type: string; notNull: number; primaryKey: number; defaultValue: string | null; references?: { table: string; column: string } }
interface ParsedForeignKey { column: string; referencedTable: string; referencedColumn: string }

export interface AuthorizedCatalogColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  /** A catalog-maintained label, never a policy value or business row. */
  label: string;
}

export interface AuthorizedCatalogForeignKey {
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface AuthorizedCatalogTable {
  name: string;
  label: string;
  columns: AuthorizedCatalogColumn[];
}

/**
 * The metadata projection used by design-time features after EffectiveScope
 * has been resolved. It intentionally excludes CREATE TABLE SQL, row-policy
 * predicates, scope keys, credentials, and every business-data value.
 */
export interface AuthorizedSchemaCatalog {
  schemaSnapshotId: string;
  tables: AuthorizedCatalogTable[];
  foreignKeys: AuthorizedCatalogForeignKey[];
}

const MAX_BIND_PARAMETERS = 96;
const MAX_SCHEMA_CONTEXT_CHARACTERS = 32_000;

/**
 * Stable identity for the physical D1 catalog snapshot. The identity is
 * derived only from the filtered table names and CREATE TABLE SQL, so the
 * same physical catalog always produces the same value while any DDL change
 * produces a different value. This is provenance metadata, not schema
 * history, and it must never be used as an authorization decision.
 */
export async function schemaSnapshotId(tables: readonly DataTable[]): Promise<string> {
  const canonical = tables
    .filter((table) => Boolean(table.sql))
    .map((table) => `${table.name}\u0000${table.sql ?? ""}`)
    .sort()
    .join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function splitDefinitions(sql: string): string[] {
  const body = sql.slice(sql.indexOf("(" ) + 1, sql.lastIndexOf(")"));
  const definitions: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of body) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) { definitions.push(current.trim()); current = ""; } else current += character;
  }
  if (current.trim()) definitions.push(current.trim());
  return definitions;
}

function parseColumns(sql: string): ParsedColumn[] {
  return splitDefinitions(sql).flatMap((definition) => {
    if (/^(?:constraint|primary|foreign|unique|check)\b/i.test(definition)) return [];
    const match = definition.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?\s+([A-Za-z]+(?:\s*\([^)]*\))?)/u);
    if (!match) return [];
    const reference = definition.match(/references\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\)/iu);
    const defaultMatch = definition.match(/\bdefault\s+([^\s,]+)/iu);
    return [{ name: match[1], type: match[2].toUpperCase(), notNull: /\bnot\s+null\b/iu.test(definition) ? 1 : 0, primaryKey: /\bprimary\s+key\b/iu.test(definition) ? 1 : 0, defaultValue: defaultMatch?.[1] ?? null, references: reference ? { table: reference[1], column: reference[2] } : undefined }];
  });
}

function parseTableForeignKeys(sql: string): ParsedForeignKey[] {
  return splitDefinitions(sql).flatMap((definition) => {
    const match = definition.match(/^(?:constraint\s+"?[A-Za-z_][A-Za-z0-9_]*"?\s+)?foreign\s+key\s*\(\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\)\s+references\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\)/iu);
    return match ? [{ column: match[1], referencedTable: match[2], referencedColumn: match[3] }] : [];
  });
}

function insertRows(database: D1Database, prefix: string, rows: unknown[][]): D1PreparedStatement[] {
  if (rows.length === 0) return [];
  const valuesPerRow = rows[0].length;
  const chunkSize = Math.max(1, Math.floor(MAX_BIND_PARAMETERS / valuesPerRow));
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => `(${Array.from({ length: valuesPerRow }, () => "?").join(", ")})`).join(", ");
    statements.push(database.prepare(`${prefix} VALUES ${placeholders}`).bind(...chunk.flat()));
  }
  return statements;
}

export async function refreshSchemaCatalog(env: Env): Promise<{ tableCount: number; refreshedAt: string }> {
  // `_cf_METADATA` is maintained by the D1 platform; it is not business
  // schema and must never be exposed to the agent or the product catalog.
  const tables = (await env.QUERYMIND_DATA.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<DataTable>()).results ?? [];
  const now = new Date().toISOString();
  const snapshotId = await schemaSnapshotId(tables);
  const statements: D1PreparedStatement[] = [
    env.QUERYMIND_APP.prepare("DELETE FROM schema_catalog_foreign_keys"),
    env.QUERYMIND_APP.prepare("DELETE FROM schema_catalog_columns"),
    env.QUERYMIND_APP.prepare("DELETE FROM schema_catalog_tables"),
  ];
  const tableRows: unknown[][] = [];
  const columnRows: unknown[][] = [];
  const foreignKeyRows: unknown[][] = [];
  for (const table of tables) {
    if (!table.sql) continue;
    const columns = parseColumns(table.sql);
    tableRows.push([table.name, table.sql, null, "", now]);
    for (const [ordinal, column] of columns.entries()) {
      columnRows.push([table.name, column.name, ordinal, column.type || "TEXT", column.notNull, column.primaryKey, column.defaultValue, ""]);
      if (column.references) foreignKeyRows.push([table.name, column.name, column.references.table, column.references.column]);
    }
    for (const foreignKey of parseTableForeignKeys(table.sql)) foreignKeyRows.push([table.name, foreignKey.column, foreignKey.referencedTable, foreignKey.referencedColumn]);
  }
  statements.push(...insertRows(env.QUERYMIND_APP, "INSERT INTO schema_catalog_tables (table_name, create_sql, row_count, description, refreshed_at)", tableRows));
  statements.push(...insertRows(env.QUERYMIND_APP, "INSERT INTO schema_catalog_columns (table_name, column_name, ordinal_position, data_type, is_not_null, is_primary_key, default_value, description)", columnRows));
  const uniqueForeignKeys = [...new Map(foreignKeyRows.map((row) => [row.join("\u0000"), row])).values()];
  statements.push(...insertRows(env.QUERYMIND_APP, "INSERT INTO schema_catalog_foreign_keys (table_name, column_name, referenced_table, referenced_column)", uniqueForeignKeys));
  statements.push(env.QUERYMIND_APP.prepare("INSERT INTO schema_catalog_state (id, source_schema_version, schema_snapshot_id, refreshed_at, table_count) VALUES (1, 'd1', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_schema_version = excluded.source_schema_version, schema_snapshot_id = excluded.schema_snapshot_id, refreshed_at = excluded.refreshed_at, table_count = excluded.table_count").bind(snapshotId, now, tables.filter((table) => Boolean(table.sql)).length));
  if (statements.length > 50) throw new HttpError(413, "SCHEMA_TOO_LARGE", "Schema catalog exceeds the Free-plan refresh budget.");
  await env.QUERYMIND_APP.batch(statements);
  return { tableCount: tables.length, refreshedAt: now };
}

function allowedColumn(scope: EffectiveScope, tableName: string, columnName: string): boolean {
  const policy = scope.datasource.tables[tableName.toLowerCase()];
  return Boolean(policy && (policy.columns === "*" || policy.columns.includes(columnName.toLowerCase())));
}

/**
 * Read the authoritative app-D1 catalog only after the caller has obtained an
 * EffectiveScope. This is deliberately structured rather than reusing the
 * chat string context so future callers cannot accidentally pass row-policy
 * details or raw DDL to a model.
 */
export async function authorizedSchemaCatalog(env: Env, scope: EffectiveScope): Promise<AuthorizedSchemaCatalog> {
  const [state, tableResult, columnResult, foreignKeyResult] = await Promise.all([
    env.QUERYMIND_APP.prepare("SELECT schema_snapshot_id FROM schema_catalog_state WHERE id = 1").first<{ schema_snapshot_id: string | null }>(),
    env.QUERYMIND_APP.prepare("SELECT table_name, description FROM schema_catalog_tables ORDER BY table_name").all<{ table_name: string; description: string }>(),
    env.QUERYMIND_APP.prepare("SELECT table_name, column_name, data_type, is_not_null, is_primary_key, description FROM schema_catalog_columns ORDER BY table_name, ordinal_position").all<{ table_name: string; column_name: string; data_type: string; is_not_null: number; is_primary_key: number; description: string }>(),
    env.QUERYMIND_APP.prepare("SELECT table_name, column_name, referenced_table, referenced_column FROM schema_catalog_foreign_keys ORDER BY table_name, column_name, referenced_table, referenced_column").all<{ table_name: string; column_name: string; referenced_table: string; referenced_column: string }>(),
  ]);
  const schemaSnapshotId = state?.schema_snapshot_id?.trim() ?? "";
  if (!schemaSnapshotId || schemaSnapshotId === "uninitialized") {
    throw new HttpError(409, "SCHEMA_CATALOG_EMPTY", "Schema catalog is empty. Refresh it before using schema intelligence.");
  }
  const allowedTables = new Set(Object.keys(scope.datasource.tables));
  const columns = columnResult.results ?? [];
  const groupedColumns = new Map<string, AuthorizedCatalogColumn[]>();
  for (const column of columns) {
    if (!allowedTables.has(column.table_name.toLowerCase()) || !allowedColumn(scope, column.table_name, column.column_name)) continue;
    const key = column.table_name.toLowerCase();
    groupedColumns.set(key, [...(groupedColumns.get(key) ?? []), {
      name: column.column_name,
      dataType: column.data_type,
      nullable: column.is_not_null !== 1,
      primaryKey: column.is_primary_key === 1,
      label: column.description ?? "",
    }]);
  }
  const tables = (tableResult.results ?? []).flatMap((table) => {
    const key = table.table_name.toLowerCase();
    if (!allowedTables.has(key)) return [];
    return [{ name: table.table_name, label: table.description ?? "", columns: groupedColumns.get(key) ?? [] }];
  });
  if (tables.length === 0) throw new HttpError(409, "SCHEMA_CATALOG_EMPTY", "No authorized schema catalog is available.");
  const foreignKeys = (foreignKeyResult.results ?? []).flatMap((foreignKey) => {
    if (
      !allowedTables.has(foreignKey.table_name.toLowerCase())
      || !allowedTables.has(foreignKey.referenced_table.toLowerCase())
      || !allowedColumn(scope, foreignKey.table_name, foreignKey.column_name)
      || !allowedColumn(scope, foreignKey.referenced_table, foreignKey.referenced_column)
    ) return [];
    return [{ table: foreignKey.table_name, column: foreignKey.column_name, referencedTable: foreignKey.referenced_table, referencedColumn: foreignKey.referenced_column }];
  });
  return { schemaSnapshotId, tables, foreignKeys };
}

/**
 * Serializes the already scope-filtered catalog for the existing P1 model
 * prompt. Keeping this projection separate from the catalog reader prevents
 * a caller from accidentally rebuilding an unscoped schema string after it
 * has obtained an authorized catalog.
 */
export function authorizedCatalogContext(catalog: AuthorizedSchemaCatalog): string {
  const lines = catalog.tables.map((table) => {
    const columns = table.columns.map((column) => `${column.name}${column.primaryKey ? " PK" : ""} ${column.dataType}`).join(", ");
    const relationships = catalog.foreignKeys
      .filter((foreignKey) => foreignKey.table === table.name)
      .map((foreignKey) => `${foreignKey.column} -> ${foreignKey.referencedTable}.${foreignKey.referencedColumn}`)
      .join(", ");
    return `${table.name}(${columns})${relationships ? ` FK[${relationships}]` : ""}`;
  });
  const context: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > MAX_SCHEMA_CONTEXT_CHARACTERS) {
      context.push("[Schema catalog truncated at safe context limit]");
      break;
    }
    context.push(line);
    length += line.length + 1;
  }
  return context.join("\n");
}

export async function schemaContext(env: Env, scope?: EffectiveScope): Promise<string> {
  const tables = (await env.QUERYMIND_APP.prepare("SELECT table_name, description FROM schema_catalog_tables ORDER BY table_name").all<{ table_name: string; description: string }>()).results ?? [];
  if (tables.length === 0) throw new HttpError(409, "SCHEMA_CATALOG_EMPTY", "Schema catalog is empty. Refresh it before using the AI agent.");
  const columns = (await env.QUERYMIND_APP.prepare("SELECT table_name, column_name, data_type, is_primary_key FROM schema_catalog_columns ORDER BY table_name, ordinal_position").all<{ table_name: string; column_name: string; data_type: string; is_primary_key: number }>()).results ?? [];
  const foreignKeys = (await env.QUERYMIND_APP.prepare("SELECT table_name, column_name, referenced_table, referenced_column FROM schema_catalog_foreign_keys ORDER BY table_name, column_name").all<{ table_name: string; column_name: string; referenced_table: string; referenced_column: string }>()).results ?? [];
  const grouped = new Map<string, string[]>();
  const relationships = new Map<string, string[]>();
  for (const column of columns) {
    const policy = scope?.datasource.tables[column.table_name.toLowerCase()];
    if (scope && (!policy || (policy.columns !== "*" && !policy.columns.includes(column.column_name.toLowerCase())))) continue;
    const item = `${column.column_name}${column.is_primary_key ? ' PK' : ''} ${column.data_type}`;
    grouped.set(column.table_name, [...(grouped.get(column.table_name) ?? []), item]);
  }
  for (const foreignKey of foreignKeys) {
    if (scope && (!scope.datasource.tables[foreignKey.table_name.toLowerCase()] || !scope.datasource.tables[foreignKey.referenced_table.toLowerCase()])) continue;
    if (scope) {
      const sourcePolicy = scope.datasource.tables[foreignKey.table_name.toLowerCase()];
      const targetPolicy = scope.datasource.tables[foreignKey.referenced_table.toLowerCase()];
      if ((sourcePolicy?.columns !== "*" && !sourcePolicy?.columns.includes(foreignKey.column_name.toLowerCase())) || (targetPolicy?.columns !== "*" && !targetPolicy?.columns.includes(foreignKey.referenced_column.toLowerCase()))) continue;
    }
    const item = `${foreignKey.column_name} -> ${foreignKey.referenced_table}.${foreignKey.referenced_column}`;
    relationships.set(foreignKey.table_name, [...(relationships.get(foreignKey.table_name) ?? []), item]);
  }
  const lines = tables.filter((table) => !scope || Boolean(scope.datasource.tables[table.table_name.toLowerCase()])).map((table) => {
    const relationText = relationships.get(table.table_name)?.join(", ");
    return `${table.table_name}(${(grouped.get(table.table_name) ?? []).join(', ')})${relationText ? ` FK[${relationText}]` : ""}`;
  });
  const context: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > MAX_SCHEMA_CONTEXT_CHARACTERS) {
      context.push("[Schema catalog truncated at safe context limit]");
      break;
    }
    context.push(line);
    length += line.length + 1;
  }
  return context.join("\n");
}
