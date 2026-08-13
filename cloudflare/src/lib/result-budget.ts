import { HttpError } from "./http";

const encoder = new TextEncoder();

export const MAX_API_RESULT_BYTES = 2_000_000;
export const MAX_STORED_PREVIEW_BYTES = 32_000;
export const MAX_STORED_PREVIEW_ROWS = 25;

export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

export function assertApiResultBudget(value: unknown): void {
  if (jsonBytes(value) > MAX_API_RESULT_BYTES) {
    throw new HttpError(413, "RESULT_TOO_LARGE", "Query result exceeds the safe response size. Add filters or select fewer columns.");
  }
}

/** Build a bounded, already-masked preview for D1 history and model context. */
export function boundedResultPreview(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const preview: Record<string, unknown>[] = [];
  for (const row of rows.slice(0, MAX_STORED_PREVIEW_ROWS)) {
    const candidate = [...preview, row];
    if (jsonBytes(candidate) > MAX_STORED_PREVIEW_BYTES) break;
    preview.push(row);
  }
  return preview;
}
