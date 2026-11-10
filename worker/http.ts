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

/** Reads a JSON body with a hard size limit, enforced while streaming (a chunked body has no Content-Length). */
export async function readJson(request: Request, maxBytes = 8_192): Promise<unknown> {
  const tooLarge = () => new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw tooLarge();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  const reader = request.body?.getReader();
  for (let part = await reader?.read(); part && !part.done; part = await reader!.read()) {
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader!.cancel().catch(() => undefined);
      throw tooLarge();
    }
    text += decoder.decode(part.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be JSON.");
  }
}

/** Rejects anything but a JSON body, so a cross-site form or text/plain POST cannot skip the CORS preflight. */
export function requireJson(request: Request) {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request as application/json.");
}

export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

/** IPv4 as is; IPv6 by its /64, the block one subscriber usually controls, so rotating within it shares a limit. */
export function network(ip: string) {
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((group) => (parseInt(group, 16) || 0).toString(16)).join(":")}::/64`;
}

export async function requester(request: Request) {
  const session = request.headers.get("x-kitab-session") ?? "";
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return {
    ip: await sha256(`ip:${ip}`),
    network: await sha256(`net:${network(ip)}`),
    // Client-chosen id: useful for per-session fairness, never trusted alone (IP limit also applies).
    session: await sha256(`session:${/^[a-f0-9-]{16,64}$/.test(session) ? session : "none"}`),
  };
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
