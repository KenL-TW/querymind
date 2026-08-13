import { HttpError } from "./http";

export async function hashSubject(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function consumeRateLimit(
  database: D1Database,
  subjectKey: string,
  windowSeconds: number,
  limit: number,
): Promise<{ remaining: number; resetAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const resetAt = windowStart + windowSeconds;
  const row = await database.prepare(
    `INSERT INTO rate_limit_counters (subject_key, window_start, request_count, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(subject_key, window_start)
     DO UPDATE SET request_count = request_count + 1
     WHERE request_count < ?
     RETURNING request_count`,
  ).bind(subjectKey, windowStart, resetAt + windowSeconds, limit).first<{ request_count: number }>();
  const count = row?.request_count ?? limit + 1;
  // Keep the counter table bounded without adding a full-table DELETE to each
  // request. Only the first request in roughly one of every 256 subject windows
  // performs opportunistic expiry cleanup.
  const cleanupSelector = Number.parseInt(subjectKey.slice(0, 2), 16);
  const windowNumber = Math.floor(windowStart / windowSeconds);
  if (count === 1 && Number.isFinite(cleanupSelector) && ((cleanupSelector ^ windowNumber) & 0xff) === 0) {
    await database.prepare("DELETE FROM rate_limit_counters WHERE expires_at < ?").bind(now).run();
  }
  if (count > limit) {
    throw new HttpError(429, "RATE_LIMITED", `Too many requests. Try again after ${new Date(resetAt * 1000).toISOString()}.`);
  }
  return { remaining: Math.max(0, limit - count), resetAt };
}
