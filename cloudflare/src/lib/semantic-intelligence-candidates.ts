import type { AuthorizedCatalogForeignKey, AuthorizedSchemaCatalog } from "./schema-catalog";
import type { SemanticAssetType } from "./semantic-types";

export const SEMANTIC_INTELLIGENCE_LIMITS = {
  selectedTables: 8,
  columns: 120,
  requestedSuggestions: 12,
  hardSuggestions: 20,
  candidatesPerType: 24,
} as const;

export interface SemanticCandidate {
  id: string;
  semanticType: SemanticAssetType;
  tables: string[];
  columns: string[];
  foreignKeys: AuthorizedCatalogForeignKey[];
  rationale: string;
}

export interface SelectedSuggestionCatalog extends AuthorizedSchemaCatalog {
  selectedTableNames: string[];
}

const NUMERIC = /(?:INT|REAL|NUMERIC|DECIMAL|DOUBLE|FLOAT)/iu;
const DIMENSION_NAME = /(?:name|status|type|category|region|country|product|customer|date|time|month|year)/iu;
const METRIC_NAME = /(?:amount|total|subtotal|price|quantity|cost|revenue|count|duration)/iu;
const SECRET_NAME = /(?:secret|token|password|credential|api[_-]?key|hash|binary|blob)/iu;

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

function canonical(value: string): string {
  const normalized = value.replace(/([a-z])([A-Z])/gu, "$1_$2").replace(/[^A-Za-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").toLowerCase();
  return normalized.slice(0, 120) || "semantic_item";
}

export function selectedCatalog(catalog: AuthorizedSchemaCatalog, requestedTableNames: string[]): SelectedSuggestionCatalog {
  const requested = unique(requestedTableNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (requested.length === 0 || requested.length > SEMANTIC_INTELLIGENCE_LIMITS.selectedTables) {
    throw new Error("INVALID_TABLE_SELECTION");
  }
  const byName = new Map(catalog.tables.map((table) => [table.name.toLowerCase(), table]));
  const tables = requested.map((name) => byName.get(name)).filter((table): table is NonNullable<typeof table> => Boolean(table));
  if (tables.length !== requested.length) throw new Error("UNAUTHORIZED_TABLE_SELECTION");
  const columnCount = tables.reduce((count, table) => count + table.columns.length, 0);
  if (columnCount > SEMANTIC_INTELLIGENCE_LIMITS.columns) throw new Error("SUGGESTION_CATALOG_TOO_LARGE");
  const allowed = new Set(tables.map((table) => table.name.toLowerCase()));
  const foreignKeys = catalog.foreignKeys.filter((foreignKey) => allowed.has(foreignKey.table.toLowerCase()) && allowed.has(foreignKey.referencedTable.toLowerCase()));
  return { ...catalog, tables, foreignKeys, selectedTableNames: tables.map((table) => table.name) };
}

function candidate(id: string, semanticType: SemanticAssetType, tables: string[], columns: string[], foreignKeys: AuthorizedCatalogForeignKey[], rationale: string): SemanticCandidate {
  return { id, semanticType, tables: unique(tables), columns: unique(columns), foreignKeys, rationale };
}

/** Pure, bounded heuristics. Candidate extraction only ranks structural facts; it never creates truth. */
export function extractSemanticCandidates(catalog: SelectedSuggestionCatalog, requestedTypes: SemanticAssetType[]): SemanticCandidate[] {
  const requested = new Set(requestedTypes);
  const result: SemanticCandidate[] = [];
  if (requested.has("TERM")) {
    for (const table of catalog.tables.slice(0, SEMANTIC_INTELLIGENCE_LIMITS.candidatesPerType)) {
      result.push(candidate(`term:${table.name}`, "TERM", [table.name], [], [], "A selected authorized table may name a business entity."));
    }
  }
  if (requested.has("DIMENSION")) {
    for (const table of catalog.tables) {
      for (const column of table.columns) {
        if (SECRET_NAME.test(column.name) || (!DIMENSION_NAME.test(column.name) && !/TEXT|CHAR|DATE|TIME/iu.test(column.dataType))) continue;
        result.push(candidate(`dimension:${table.name}.${column.name}`, "DIMENSION", [table.name], [`${table.name}.${column.name}`], [], "The authorized column has categorical, text, or time-like structural metadata."));
        if (result.filter((item) => item.semanticType === "DIMENSION").length >= SEMANTIC_INTELLIGENCE_LIMITS.candidatesPerType) break;
      }
      if (result.filter((item) => item.semanticType === "DIMENSION").length >= SEMANTIC_INTELLIGENCE_LIMITS.candidatesPerType) break;
    }
  }
  if (requested.has("METRIC")) {
    for (const table of catalog.tables) {
      for (const column of table.columns) {
        if (column.primaryKey || SECRET_NAME.test(column.name) || !NUMERIC.test(column.dataType) || !METRIC_NAME.test(column.name)) continue;
        const grain = table.columns.find((item) => item.primaryKey);
        if (!grain) continue;
        result.push(candidate(`metric:${table.name}.${column.name}`, "METRIC", [table.name], [`${table.name}.${column.name}`, `${table.name}.${grain.name}`], [], "The authorized field is a non-identifier numeric column with a metric-like name."));
        if (result.filter((item) => item.semanticType === "METRIC").length >= SEMANTIC_INTELLIGENCE_LIMITS.candidatesPerType) break;
      }
      if (result.filter((item) => item.semanticType === "METRIC").length >= SEMANTIC_INTELLIGENCE_LIMITS.candidatesPerType) break;
    }
  }
  if (requested.has("RELATIONSHIP")) {
    for (const foreignKey of catalog.foreignKeys.slice(0, SEMANTIC_INTELLIGENCE_LIMITS.candidatesPerType)) {
      result.push(candidate(`relationship:${foreignKey.table}.${foreignKey.column}->${foreignKey.referencedTable}.${foreignKey.referencedColumn}`, "RELATIONSHIP", [foreignKey.table, foreignKey.referencedTable], [`${foreignKey.table}.${foreignKey.column}`, `${foreignKey.referencedTable}.${foreignKey.referencedColumn}`], [foreignKey], "An explicit authorized foreign key is present in the schema catalog."));
    }
  }
  return result;
}

export function canonicalCandidateName(table: string, column?: string): string {
  return canonical(column ? `${table}_${column}` : table);
}
