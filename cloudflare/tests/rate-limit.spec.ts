import { expect, test } from "playwright/test";
import { consumeRateLimit } from "../src/lib/rate-limit";

class MemoryRateLimitDatabase {
  readonly counters = new Map<string, { request_count: number; expires_at: number }>();

  prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...bound: unknown[]) => { values = bound; return statement; },
      first: async <T>() => {
        if (!sql.includes("INSERT INTO rate_limit_counters")) throw new Error("Unexpected rate-limit test query.");
        const [subjectKey, windowStart, expiresAt, limit] = values as [string, number, number, number];
        const key = `${subjectKey}:${windowStart}`;
        const current = this.counters.get(key);
        if (current && current.request_count >= limit) return null;
        const row = { request_count: (current?.request_count ?? 0) + 1, expires_at: expiresAt };
        this.counters.set(key, row);
        return row as T;
      },
      run: async () => {
        if (!sql.includes("DELETE FROM rate_limit_counters")) throw new Error("Unexpected rate-limit test query.");
        const [now] = values as [number];
        for (const [key, row] of this.counters) if (row.expires_at < now) this.counters.delete(key);
        return { success: true };
      },
    };
    return statement;
  }
}

function asD1(database: MemoryRateLimitDatabase): D1Database {
  return database as unknown as D1Database;
}

function withNow<T>(milliseconds: number, action: () => Promise<T>): Promise<T> {
  const previous = Date.now;
  Date.now = () => milliseconds;
  return action().finally(() => { Date.now = previous; });
}

test.describe("persisted rate-limit contract", () => {
  test("enforces the configured threshold and denies the next request", async () => {
    const database = new MemoryRateLimitDatabase();
    await withNow(1_000_000, async () => {
      await expect(consumeRateLimit(asD1(database), "account-hash", 900, 2)).resolves.toMatchObject({ remaining: 1 });
      await expect(consumeRateLimit(asD1(database), "account-hash", 900, 2)).resolves.toMatchObject({ remaining: 0 });
      await expect(consumeRateLimit(asD1(database), "account-hash", 900, 2)).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
      expect(database.counters.get("account-hash:900")?.request_count).toBe(2);
    });
  });

  test("starts an independent counter in the next fixed window", async () => {
    const database = new MemoryRateLimitDatabase();
    await withNow(1_000_000, async () => {
      await consumeRateLimit(asD1(database), "account-hash", 900, 1);
      await expect(consumeRateLimit(asD1(database), "account-hash", 900, 1)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    });
    await withNow(1_800_000, async () => {
      await expect(consumeRateLimit(asD1(database), "account-hash", 900, 1)).resolves.toMatchObject({ remaining: 0, resetAt: 2_700 });
      expect(database.counters.get("account-hash:1800")?.request_count).toBe(1);
    });
  });

  test("expires rows using the existing opportunistic cleanup rule", async () => {
    const database = new MemoryRateLimitDatabase();
    database.counters.set("expired-subject:0", { request_count: 1, expires_at: 899 });
    await withNow(900_000, async () => {
      await consumeRateLimit(asD1(database), "01-subject", 900, 3);
      expect(database.counters.has("expired-subject:0")).toBe(false);
      expect(database.counters.get("01-subject:900")?.request_count).toBe(1);
    });
  });
});
