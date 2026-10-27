export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function failure(status: number, code: string, error: string, extra: Record<string, unknown> = {}) {
  return json({ error, code, ...extra }, status);
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Reads a JSON body with a hard size limit. */
export async function readJson(request: Request, maxBytes = 8_192): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be JSON.");
  }
}

export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export async function requester(request: Request) {
  const session = request.headers.get("x-kitab-session") ?? "";
  return {
    ip: await sha256(`ip:${request.headers.get("CF-Connecting-IP") || "unknown"}`),
    // Client-chosen id: useful for per-session fairness, never trusted alone (IP limit also applies).
    session: await sha256(`session:${/^[a-f0-9-]{16,64}$/.test(session) ? session : "none"}`),
  };
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
