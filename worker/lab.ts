// The Real Engineering Lab's HTTP endpoints (/api/lab/*). Every response is computed from the request and fixed
// data: no outbound request is ever made (not a proxy), nothing touches D1 or Workers AI, and nothing is stored.
// Bodies are JSON or text/plain with nosniff, so a reflected value can never become a page.

export const LAB_PREFIX = "/api/lab/";
const MAX_BODY = 8_192;
const MAX_WAIT_MS = 5_000;

/** Request headers never echoed back: credentials and what Cloudflare or a proxy adds about the client. */
const hidden = /^(cookie|cf-.*|x-forwarded-.*|x-real-ip|true-client-ip|cdn-loop|forwarded|x-amzn-.*)$/i;

type Answer = { status: number; body?: unknown; text?: string; headers?: Record<string, string> };

const reasons: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 406: "Not Acceptable",
  409: "Conflict", 410: "Gone", 413: "Content Too Large", 415: "Unsupported Media Type", 422: "Unprocessable Content",
  429: "Too Many Requests", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
};

/** Codes /api/lab/status/:code will return, with what each one means for the client. */
export const statusMeanings: Record<number, string> = {
  200: "The request worked and the body is the result.",
  201: "Something was created; Location says where.",
  202: "Accepted for later processing; not done yet.",
  204: "It worked and there is deliberately no body.",
  301: "The resource moved for good. fetch follows the Location header by itself.",
  302: "The resource is temporarily elsewhere. fetch follows the Location header by itself.",
  400: "The server could not understand the request as sent.",
  401: "Credentials are missing or wrong. WWW-Authenticate says how to authenticate.",
  403: "The server knows who you are and refuses anyway.",
  404: "Nothing exists at this path.",
  405: "The path exists, but not for this method. Allow lists the methods it accepts.",
  409: "The request conflicts with the resource's current state.",
  410: "It existed once and was removed on purpose.",
  418: "An April Fools' joke from RFC 2324, kept by many servers.",
  422: "The body was well-formed but its values were invalid.",
  429: "Too many requests. Retry-After says when to try again.",
  500: "The server failed while handling a valid request. Not the client's fault.",
  502: "A gateway got a bad answer from the server behind it.",
  503: "The server is temporarily unable to serve. Retry-After may say when.",
  504: "A gateway gave up waiting for the server behind it.",
};

const books = [
  { id: 1, title: "The Art of Computer Programming", author: "Donald Knuth", year: 1968 },
  { id: 2, title: "Structure and Interpretation of Computer Programs", author: "Abelson and Sussman", year: 1985 },
  { id: 3, title: "TCP/IP Illustrated, Volume 1", author: "W. Richard Stevens", year: 1994 },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mediaType = (request: Request) => request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";

async function readText(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(part.value, { stream: true });
  }
  return text + decoder.decode();
}

const tooLarge: Answer = { status: 413, body: { error: `The body is larger than ${MAX_BODY} bytes, this lab's limit.` } };
const notAllowed = (allow: string, method: string, route: string): Answer => ({
  status: 405,
  headers: { allow },
  body: { error: `${route} exists, but not for ${method}.`, allow: allow.split(", ") },
});

/** A JSON body, or the answer to send instead: 415 when it isn't declared as JSON, 400 when it doesn't parse. */
async function jsonBody(request: Request): Promise<{ value: unknown } | Answer> {
  if (mediaType(request) !== "application/json") {
    return { status: 415, body: { error: "Send the body as JSON with the header Content-Type: application/json.", received: request.headers.get("content-type") } };
  }
  const text = await readText(request);
  if (text === null) return tooLarge;
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { status: 400, body: { error: "The body is not valid JSON.", parser: error instanceof Error ? error.message : String(error) } };
  }
}

async function echo(request: Request, url: URL): Promise<Answer> {
  const text = request.method === "GET" || request.method === "HEAD" ? "" : await readText(request);
  if (text === null) return tooLarge;
  let json: unknown;
  let parsed = false;
  if (text && mediaType(request) === "application/json") {
    try {
      json = JSON.parse(text);
      parsed = true;
    } catch {
      parsed = false;
    }
  }
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (!hidden.test(name)) headers[name] = value;
  });
  return {
    status: 200,
    body: {
      received: {
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers,
        body: { bytes: new TextEncoder().encode(text).byteLength, text, ...(parsed ? { json } : {}) },
      },
      note: "This is what Kitab's server received. Headers your browser refused to send, or added itself, show up here.",
    },
  };
}

function status(code: number): Answer {
  const meaning = statusMeanings[code];
  if (!meaning) return { status: 404, body: { error: `This lab doesn't return ${code}.`, available: Object.keys(statusMeanings).map(Number) } };
  const headers: Record<string, string> = {};
  if (code === 301 || code === 302) headers.location = `/api/lab/echo?redirectedFrom=${code}`;
  if (code === 401) headers["www-authenticate"] = 'Bearer realm="kitab-lab"';
  if (code === 405) headers.allow = "GET";
  if (code === 429 || code === 503) headers["retry-after"] = "30";
  if (code === 201) headers.location = "/api/lab/books/4";
  if (code === 204) return { status: code, headers };
  return { status: code, headers, body: { status: code, reason: reasons[code] ?? "", meaning } };
}

const cachePolicies: Record<string, string> = {
  "no-store": "no-store",
  "max-age": "public, max-age=60",
  private: "private, max-age=60",
  etag: "no-cache",
};

function cache(request: Request, policy: string): Answer {
  const control = cachePolicies[policy];
  if (!control) return { status: 404, body: { error: `Unknown policy "${policy}".`, available: Object.keys(cachePolicies) } };
  const etag = `"lab-${policy}-v1"`;
  const headers = { "cache-control": control, etag };
  // The tag never changes, so a client that sends it back has the current version.
  if (request.headers.get("if-none-match")?.split(",").map((tag) => tag.trim()).includes(etag)) return { status: 304, headers };
  return { status: 200, headers, body: { policy, cacheControl: control, etag, generatedAt: new Date().toISOString(), note: "If generatedAt doesn't change between two requests, the second one never reached the server." } };
}

function negotiate(request: Request): Answer {
  const accept = (request.headers.get("accept") ?? "*/*").toLowerCase();
  const wants = (type: string) => accept.split(",").some((part) => part.split(";")[0].trim() === type);
  const book = books[0];
  if (wants("application/json") || wants("*/*") || wants("application/*")) return { status: 200, headers: { vary: "Accept" }, body: book };
  if (wants("text/plain") || wants("text/*")) return { status: 200, headers: { vary: "Accept" }, text: `${book.title} by ${book.author} (${book.year})\n` };
  return { status: 406, headers: { vary: "Accept" }, body: { error: `This resource is available as application/json or text/plain, not ${accept}.` } };
}

async function booksRoute(request: Request, id: string | undefined): Promise<Answer> {
  const route = id === undefined ? "/api/lab/books" : "/api/lab/books/:id";
  const tag = (handler: string, answer: Answer): Answer => ({ ...answer, headers: { ...answer.headers, "x-lab-route": `${request.method} ${route}`, "x-lab-handler": handler } });
  if (id === undefined) {
    if (request.method === "GET") return tag("listBooks", { status: 200, body: { books } });
    if (request.method !== "POST") return tag("none", notAllowed("GET, POST", request.method, route));
    const parsed = await jsonBody(request);
    if (!("value" in parsed)) return tag("createBook", parsed);
    const value = parsed.value as Record<string, unknown> | null;
    const errors: Record<string, string> = {};
    if (typeof value !== "object" || value === null || Array.isArray(value)) return tag("createBook", { status: 422, body: { error: "The body must be a JSON object." } });
    if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 120) errors.title = "Required: text, 1 to 120 characters.";
    if (typeof value.author !== "string" || !value.author.trim() || value.author.length > 120) errors.author = "Required: text, 1 to 120 characters.";
    if (value.year !== undefined && (!Number.isInteger(value.year) || (value.year as number) < 1450 || (value.year as number) > 2100)) errors.year = "Optional: a whole number from 1450 to 2100.";
    if (Object.keys(errors).length) return tag("createBook", { status: 422, body: { error: "Some fields are invalid.", fields: errors } });
    const created = { id: books.length + 1, title: (value.title as string).trim(), author: (value.author as string).trim(), year: value.year ?? null };
    return tag("createBook", {
      status: 201,
      headers: { location: `/api/lab/books/${created.id}` },
      body: { book: created, saved: false, note: "This teaching API keeps no data: a real one would write to a database here." },
    });
  }
  if (request.method !== "GET") return tag("none", notAllowed("GET", request.method, route));
  const book = /^\d{1,6}$/.test(id) ? books.find((item) => item.id === Number(id)) : undefined;
  return book ? tag("getBook", { status: 200, body: book }) : tag("getBook", { status: 404, body: { error: `No book has id ${JSON.stringify(id)}.` } });
}

async function orders(request: Request): Promise<Answer> {
  if (request.method !== "POST") return notAllowed("POST", request.method, "/api/lab/orders");
  const parsed = await jsonBody(request);
  if (!("value" in parsed)) return parsed;
  const version = request.headers.get("x-api-version") ?? "2";
  // A deliberate server-side defect for the troubleshooting lab: the retired v1 handler crashes.
  if (version === "1") {
    return { status: 500, body: { error: "Internal server error.", incident: "The v1 order handler failed while serializing the order. The client did nothing wrong; v1 is retired. Version 2 works." } };
  }
  if (version !== "2") return { status: 400, body: { error: `Unknown API version ${JSON.stringify(version)}. Supported: 2.` } };
  const value = parsed.value as Record<string, unknown> | null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { status: 422, body: { error: "The body must be a JSON object." } };
  const errors: Record<string, string> = {};
  if (typeof value.item !== "string" || !value.item.trim() || value.item.length > 60) errors.item = "Required: text, 1 to 60 characters.";
  if (!Number.isInteger(value.quantity) || (value.quantity as number) < 1 || (value.quantity as number) > 10) errors.quantity = "Required: a whole number from 1 to 10.";
  if (Object.keys(errors).length) return { status: 422, body: { error: "Some fields are invalid.", fields: errors } };
  return {
    status: 201,
    headers: { location: "/api/lab/orders/1001" },
    body: { order: { id: 1001, item: (value.item as string).trim(), quantity: value.quantity, status: "accepted" }, saved: false },
  };
}

async function slow(url: URL): Promise<Answer> {
  const asked = Number(url.searchParams.get("ms") ?? 1000);
  const ms = Number.isFinite(asked) ? Math.max(0, Math.min(MAX_WAIT_MS, Math.round(asked))) : 1000;
  const started = Date.now();
  await sleep(ms);
  return { status: 200, body: { waitedMs: ms, maxMs: MAX_WAIT_MS, measuredMs: Date.now() - started } };
}

async function answer(request: Request, url: URL): Promise<Answer> {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  if (path === "/api/lab/echo") return echo(request, url);
  const code = /^\/api\/lab\/status\/(\d{3})$/.exec(path);
  if (code) return method === "GET" || method === "HEAD" ? status(Number(code[1])) : notAllowed("GET", method, "/api/lab/status/:code");
  const policy = /^\/api\/lab\/cache\/([a-z-]{1,20})$/.exec(path);
  if (policy) return method === "GET" ? cache(request, policy[1]) : notAllowed("GET", method, "/api/lab/cache/:policy");
  if (path === "/api/lab/negotiate") return method === "GET" ? negotiate(request) : notAllowed("GET", method, "/api/lab/negotiate");
  const book = /^\/api\/lab\/books(?:\/([^/]+))?$/.exec(path);
  if (book) return booksRoute(request, book[1]);
  if (path === "/api/lab/orders") return orders(request);
  if (path === "/api/lab/slow") return method === "GET" ? slow(url) : notAllowed("GET", method, "/api/lab/slow");
  return {
    status: 404,
    body: {
      error: `No route matches ${method} ${url.pathname}.`,
      routes: ["/api/lab/echo", "/api/lab/status/:code", "/api/lab/cache/:policy", "/api/lab/negotiate", "/api/lab/books", "/api/lab/books/:id", "/api/lab/orders", "/api/lab/slow?ms="],
    },
  };
}

export async function handleLab(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const result = await answer(request, url);
  const headers: Record<string, string> = { "cache-control": "no-store", "x-content-type-options": "nosniff", ...result.headers };
  let body: string | null = null;
  if (result.status !== 204 && result.status !== 304 && request.method !== "HEAD") {
    if (result.text !== undefined) (headers["content-type"] = "text/plain; charset=utf-8"), (body = result.text);
    else (headers["content-type"] = "application/json; charset=utf-8"), (body = JSON.stringify(result.body ?? null, null, 2));
  }
  return new Response(body, { status: result.status, headers });
}
