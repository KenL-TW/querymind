import { createStagingRecoveryPasswordRecord, validateEmail, validatePassword } from "./auth";

export const STAGING_OWNER_RECOVERY_TARGET = Object.freeze({
  environment: "staging",
  databaseName: "querymind-staging-app",
  databaseId: "b5773b44-2fa2-48e8-84f6-ec838eecdf91",
});

const PRODUCTION_DATABASE_NAME = "querymind-app";
const PRODUCTION_DATABASE_ID = "31aa9906-6ced-4a9c-9b46-1af029e3271f";

export class StagingOwnerRecoveryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StagingOwnerRecoveryError";
  }
}

export interface StagingOwnerRecord {
  id: string;
  email: string;
  role_name: string;
  is_active: number;
  password_updated_at: string | null;
}

export interface RecoveryCredential {
  salt: string;
  hash: string;
  algorithm: string;
}

export interface RecoveryWrite {
  user: StagingOwnerRecord;
  credential: RecoveryCredential;
  passwordUpdatedAt: string;
  correlationId: string;
}

export interface StagingRecoveryDatabase {
  findUsersByEmail(email: string): Promise<readonly StagingOwnerRecord[]>;
  applyRecovery(write: RecoveryWrite): Promise<{ updateChanges: number; auditChanges: number }>;
}

export interface WranglerD1ImportResult {
  success?: boolean;
  meta?: { rows_written?: number };
  results?: Array<Record<string, unknown>>;
}

export interface StagingRecoveryInput {
  environment: string;
  databaseId: string;
  databaseName: string;
  email: string;
  password: string;
  confirmed: boolean;
  now?: Date;
}

export interface StagingRecoveryResult {
  userId: string;
  email: string;
  passwordUpdatedAt: string;
  algorithm: string;
  sessionsInvalidated: true;
  auditRecorded: true;
  correlationId: string;
}

export function parseRecoveryArgs(argv: readonly string[]): {
  environment: string;
  databaseId: string;
  email: string;
  confirmed: boolean;
} {
  const values = new Map<string, string | true>();
  const valueFlags = new Set(["--environment", "--database-id", "--email"]);
  const booleanFlags = new Set(["--confirm-recovery"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (values.has(flag)) throw new StagingOwnerRecoveryError("DUPLICATE_ARGUMENT");
    if (booleanFlags.has(flag)) {
      values.set(flag, true);
      continue;
    }
    if (!valueFlags.has(flag)) throw new StagingOwnerRecoveryError("UNSUPPORTED_ARGUMENT");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new StagingOwnerRecoveryError("MISSING_ARGUMENT_VALUE");
    values.set(flag, value);
    index += 1;
  }

  const environment = values.get("--environment");
  const databaseId = values.get("--database-id");
  const email = values.get("--email");
  if (typeof environment !== "string" || typeof databaseId !== "string" || typeof email !== "string") {
    throw new StagingOwnerRecoveryError("REQUIRED_ARGUMENT_MISSING");
  }
  return { environment, databaseId, email, confirmed: values.get("--confirm-recovery") === true };
}

export function assertStagingRecoveryTarget(environment: string, databaseId: string, databaseName: string): void {
  if (environment === "production" || databaseName === PRODUCTION_DATABASE_NAME || databaseId === PRODUCTION_DATABASE_ID) {
    throw new StagingOwnerRecoveryError("PRODUCTION_TARGET_FORBIDDEN");
  }
  if (environment !== STAGING_OWNER_RECOVERY_TARGET.environment
    || databaseName !== STAGING_OWNER_RECOVERY_TARGET.databaseName
    || databaseId !== STAGING_OWNER_RECOVERY_TARGET.databaseId) {
    throw new StagingOwnerRecoveryError("STAGING_TARGET_MISMATCH");
  }
}

export async function recoverExistingStagingOwner(
  input: StagingRecoveryInput,
  database: StagingRecoveryDatabase,
): Promise<StagingRecoveryResult> {
  assertStagingRecoveryTarget(input.environment, input.databaseId, input.databaseName);
  if (!input.confirmed) throw new StagingOwnerRecoveryError("EXPLICIT_CONFIRMATION_REQUIRED");
  const email = validateEmail(input.email);
  const password = validatePassword(input.password);
  const matches = await database.findUsersByEmail(email);
  if (matches.length === 0) throw new StagingOwnerRecoveryError("STAGING_OWNER_NOT_FOUND");
  if (matches.length !== 1) throw new StagingOwnerRecoveryError("STAGING_OWNER_AMBIGUOUS");
  const user = matches[0];
  if (user.role_name !== "owner") throw new StagingOwnerRecoveryError("TARGET_USER_NOT_OWNER");
  if (user.is_active !== 1) throw new StagingOwnerRecoveryError("TARGET_OWNER_INACTIVE");

  const previousUpdatedAt = user.password_updated_at === null ? 0 : Date.parse(user.password_updated_at);
  if (!Number.isFinite(previousUpdatedAt)) throw new StagingOwnerRecoveryError("INVALID_CREDENTIAL_VERSION");
  const requestedAt = input.now?.getTime() ?? Date.now();
  const passwordUpdatedAt = new Date(Math.max(requestedAt, previousUpdatedAt + 1)).toISOString();
  const credential = await createStagingRecoveryPasswordRecord(password);
  const correlationId = crypto.randomUUID();
  const write = { user, credential, passwordUpdatedAt, correlationId };
  const result = await database.applyRecovery(write);
  if (result.updateChanges !== 1) throw new StagingOwnerRecoveryError("OWNER_CREDENTIAL_UPDATE_FAILED");
  if (result.auditChanges !== 1) throw new StagingOwnerRecoveryError("RECOVERY_AUDIT_FAILED");

  return {
    userId: user.id,
    email,
    passwordUpdatedAt,
    algorithm: credential.algorithm,
    sessionsInvalidated: true,
    auditRecorded: true,
    correlationId,
  };
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildStagingRecoverySql(write: RecoveryWrite): string {
  const { user, credential, passwordUpdatedAt, correlationId } = write;
  const oldVersion = user.password_updated_at === null ? "password_updated_at IS NULL" : `password_updated_at = ${sqlText(user.password_updated_at)}`;
  const metadata = JSON.stringify({
    method: "staging-break-glass-cli",
    passwordAlgorithm: credential.algorithm,
    sessionsInvalidated: true,
    correlationId,
  });
  return [
    `UPDATE users SET password_salt = ${sqlText(credential.salt)}, password_hash = ${sqlText(credential.hash)}, password_algorithm = ${sqlText(credential.algorithm)}, password_updated_at = ${sqlText(passwordUpdatedAt)}, updated_at = ${sqlText(passwordUpdatedAt)} WHERE id = ${sqlText(user.id)} AND email = ${sqlText(user.email)} AND role_name = 'owner' AND is_active = 1 AND ${oldVersion};`,
    `INSERT INTO audit_events (id, actor_id, event_type, resource_type, resource_id, metadata_json, created_at) SELECT ${sqlText(crypto.randomUUID())}, NULL, 'STAGING_OWNER_RECOVERY', 'user', ${sqlText(user.id)}, ${sqlText(metadata)}, ${sqlText(passwordUpdatedAt)} WHERE changes() = 1 AND EXISTS (SELECT 1 FROM users WHERE id = ${sqlText(user.id)} AND email = ${sqlText(user.email)} AND role_name = 'owner' AND is_active = 1 AND password_updated_at = ${sqlText(passwordUpdatedAt)} AND password_salt = ${sqlText(credential.salt)} AND password_hash = ${sqlText(credential.hash)});`,
  ].join("\n");
}

/**
 * Wrangler's remote `d1 execute --file` reports one import summary instead of
 * per-statement D1Result objects. The recovery SQL is deliberately exactly two
 * statements (guarded Owner update + conditional audit insert), so only a
 * successful two-query import with two total writes proves both operations.
 */
export function recoveryWriteCountsFromWranglerImport(entries: readonly WranglerD1ImportResult[]): { updateChanges: number; auditChanges: number } {
  if (entries.length !== 1) return { updateChanges: 0, auditChanges: 0 };
  const [entry] = entries;
  const queryCount = Number(entry.results?.[0]?.["Total queries executed"]);
  const rowsWritten = Number(entry.meta?.rows_written);
  if (entry.success !== true || queryCount !== 2 || rowsWritten !== 2) {
    return { updateChanges: 0, auditChanges: 0 };
  }
  return { updateChanges: 1, auditChanges: 1 };
}

export function safeRecoveryMessage(result: StagingRecoveryResult): string {
  return `OWNER_RECOVERY_PASS user=${result.userId} email=${result.email} sessions_invalidated=true audit=recorded algorithm=${result.algorithm} correlation=${result.correlationId}`;
}
