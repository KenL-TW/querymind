import { HttpError } from "./http";
import { hasCapability, type AuthenticatedUser } from "./auth";

export interface RowPolicy {
  tableName: string;
  predicate: string;
}

export interface ScopeTable {
  columns: string[] | "*";
  rowFilter?: RowPolicy;
  canViewRaw: boolean;
  canExport: boolean;
  canBulkExport: boolean;
}

export interface EffectiveScope {
  userId: string;
  roleId: string;
  roleName: string;
  scopeKey: string;
  policyVersion: string;
  capabilities: string[];
  datasource: {
    id: "querymind-data";
    tables: Record<string, ScopeTable>;
  };
  canQuery: boolean;
  canViewRawData: boolean;
  canExport: boolean;
  canBulkExport: boolean;
}

interface PolicyRow {
  scope_key: string;
  table_name: string;
  allowed_columns_json: string;
  row_filter_sql: string;
  can_view_raw: number;
  can_export: number;
  can_bulk_export: number;
}

interface PolicyStateRow {
  policy_version: string;
  expected_migration: string;
}

const SAFE_ROW_FILTER = /^[A-Za-z_][A-Za-z0-9_]*\s*(?:=|<>|!=)\s*(?:'(?:''|[^'])*'|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)$/u;

export function validateRowFilter(value: string): string {
  const predicate = value.trim();
  if (!predicate) return "";
  if (!SAFE_ROW_FILTER.test(predicate)) {
    throw new HttpError(503, "POLICY_INVALID", "A configured row policy is not a supported deterministic predicate.");
  }
  return predicate;
}

function parseColumns(value: string): string[] | "*" {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === "*") return "*";
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((column) => typeof column === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(column))) {
      throw new Error("invalid columns");
    }
    return [...new Set(parsed.map((column) => column.toLowerCase()))];
  } catch {
    throw new HttpError(503, "POLICY_INVALID", "A configured data policy has invalid columns.");
  }
}

export async function resolveEffectiveScope(env: Env, user: AuthenticatedUser): Promise<EffectiveScope> {
  const state = await env.QUERYMIND_APP.prepare(
    "SELECT policy_version, expected_migration FROM policy_state WHERE id = 1",
  ).first<PolicyStateRow>();
  if (!state || state.expected_migration !== "0006" || !state.policy_version.trim()) {
    throw new HttpError(503, "POLICY_STATE_UNAVAILABLE", "The governed query policy is not ready.");
  }

  const scopeKey = user.scopeKey?.trim() || `role:${user.roleName}`;
  const policies = (await env.QUERYMIND_APP.prepare(
    "SELECT scope_key, table_name, allowed_columns_json, row_filter_sql, can_view_raw, can_export, can_bulk_export FROM data_scope_policies WHERE scope_key = ? AND is_active = 1 ORDER BY table_name",
  ).bind(scopeKey).all<PolicyRow>()).results ?? [];
  if (policies.length === 0) throw new HttpError(503, "POLICY_SCOPE_UNAVAILABLE", "No authorized data scope is configured for this user.");

  const tables: Record<string, ScopeTable> = {};
  for (const policy of policies) {
    const tableName = policy.table_name.trim().toLowerCase();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tableName) || tables[tableName]) {
      throw new HttpError(503, "POLICY_INVALID", "A configured data policy has an invalid or duplicate table.");
    }
    const rowFilter = validateRowFilter(policy.row_filter_sql ?? "");
    tables[tableName] = {
      columns: parseColumns(policy.allowed_columns_json),
      ...(rowFilter ? { rowFilter: { tableName, predicate: rowFilter } } : {}),
      canViewRaw: policy.can_view_raw === 1,
      canExport: policy.can_export === 1,
      canBulkExport: policy.can_bulk_export === 1,
    };
  }

  const canExport = hasCapability(user, "export") && Object.values(tables).some((table) => table.canExport);
  const canBulkExport = canExport && Object.values(tables).some((table) => table.canBulkExport);
  return {
    userId: user.id,
    roleId: user.roleName,
    roleName: user.roleName,
    scopeKey,
    policyVersion: state.policy_version,
    capabilities: user.capabilities,
    datasource: { id: "querymind-data", tables },
    canQuery: hasCapability(user, "chat"),
    canViewRawData: Object.values(tables).some((table) => table.canViewRaw),
    canExport,
    canBulkExport,
  };
}

export async function policyState(env: Env): Promise<{ ok: boolean; policyVersion: string | null; expectedMigration: string | null; policyCount: number }> {
  try {
    const [state, count] = await Promise.all([
      env.QUERYMIND_APP.prepare("SELECT policy_version, expected_migration FROM policy_state WHERE id = 1").first<PolicyStateRow>(),
      env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM data_scope_policies WHERE is_active = 1").first<{ total: number }>(),
    ]);
    const policyCount = count?.total ?? 0;
    return { ok: Boolean(state && state.expected_migration === "0006" && state.policy_version && policyCount > 0), policyVersion: state?.policy_version ?? null, expectedMigration: state?.expected_migration ?? null, policyCount };
  } catch {
    return { ok: false, policyVersion: null, expectedMigration: null, policyCount: 0 };
  }
}
