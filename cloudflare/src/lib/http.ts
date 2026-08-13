const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.code, message: error.message }, error.status);
  }
  return json({ error: "INTERNAL_ERROR", message: "An unexpected server error occurred." }, 500);
}

/** Read a small JSON API body without buffering an unbounded request. */
export async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  return readJsonStream(request.body, request.headers.get("content-length"), maxBytes);
}

export async function readResponseJson(response: Response, maxBytes = 65_536): Promise<unknown> {
  return readJsonStream(response.body, response.headers.get("content-length"), maxBytes);
}

async function readJsonStream(bodyStream: ReadableStream<Uint8Array> | null, contentLength: string | null, maxBytes: number): Promise<unknown> {
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new HttpError(413, "REQUEST_TOO_LARGE", "Request body exceeds the allowed size.");
  }
  if (!bodyStream) {
    throw new HttpError(400, "INVALID_JSON", "A JSON request body is required.");
  }

  const reader = bodyStream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "REQUEST_TOO_LARGE", "Request body exceeds the allowed size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must contain valid JSON.");
  }
}
