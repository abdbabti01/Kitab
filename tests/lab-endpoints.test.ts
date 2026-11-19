// The Engineering Lab's /api/lab/* endpoints, through the Worker's real entry point with no bindings: they need
// neither D1 nor AI, never make an outbound request, and never reflect credentials or proxy headers.
import assert from "node:assert/strict";
import test from "node:test";
import { handle } from "../worker/index.ts";

const ctx = { waitUntil: () => undefined };
const call = (path: string, init: RequestInit = {}) => handle(new Request(`https://kitab.test${path}`, init), {} as never, ctx);
const body = async (response: Response) => JSON.parse(await response.text());

test("lab endpoints never make an outbound request", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("outbound fetch attempted");
  }) as typeof fetch;
  t.after(() => (globalThis.fetch = original));
  for (const path of ["/api/lab/echo", "/api/lab/status/503", "/api/lab/cache/etag", "/api/lab/negotiate", "/api/lab/books", "/api/lab/books/1", "/api/lab/slow?ms=1", "/api/lab/nothing"]) {
    const response = await call(path);
    assert.ok(response.status < 600, path);
  }
  await call("/api/lab/orders", { method: "POST", headers: { "content-type": "application/json" }, body: '{"item":"pen","quantity":1}' });
});

test("echo returns what arrived, without cookies or Cloudflare and proxy headers", async () => {
  const response = await call("/api/lab/echo?x=1", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "session=secret", "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9", "x-real-ip": "1.2.3.4", "x-learner": "me" },
    body: '{"name":"Ada"}',
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-type")!, /^application\/json/);
  const { received } = await body(response);
  assert.equal(received.method, "POST");
  assert.equal(received.path, "/api/lab/echo");
  assert.deepEqual(received.query, { x: "1" });
  assert.deepEqual(received.body.json, { name: "Ada" });
  assert.equal(received.headers["x-learner"], "me");
  for (const name of ["cookie", "cf-connecting-ip", "x-forwarded-for", "x-real-ip"]) assert.equal(received.headers[name], undefined, name);
});

test("echo refuses bodies over 8 KB, even without a Content-Length", async () => {
  const big = "x".repeat(9000);
  assert.equal((await call("/api/lab/echo", { method: "POST", body: big })).status, 413);
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
  assert.equal((await call("/api/lab/echo", { method: "POST", body: stream, duplex: "half" } as RequestInit)).status, 413);
});

test("status codes come only from the allowlist, with the headers each one needs", async () => {
  assert.equal((await call("/api/lab/status/404")).status, 404);
  assert.equal((await call("/api/lab/status/599")).status, 404);
  const r405 = await call("/api/lab/status/405");
  assert.equal(r405.headers.get("allow"), "GET");
  assert.equal((await call("/api/lab/status/429")).headers.get("retry-after"), "30");
  const r204 = await call("/api/lab/status/204");
  assert.equal(r204.status, 204);
  assert.equal(await r204.text(), "");
  const r301 = await call("/api/lab/status/301");
  assert.equal(r301.headers.get("location"), "/api/lab/echo?redirectedFrom=301");
  assert.equal((await call("/api/lab/status/200", { method: "POST" })).status, 405);
});

test("cache endpoints set Cache-Control and answer a matching If-None-Match with an empty 304", async () => {
  const first = await call("/api/lab/cache/etag");
  assert.equal(first.headers.get("cache-control"), "no-cache");
  const etag = first.headers.get("etag")!;
  const again = await call("/api/lab/cache/etag", { headers: { "if-none-match": etag } });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
  assert.equal((await call("/api/lab/cache/etag", { headers: { "if-none-match": '"other"' } })).status, 200);
  assert.equal((await call("/api/lab/cache/max-age")).headers.get("cache-control"), "public, max-age=60");
  assert.equal((await call("/api/lab/cache/unknown")).status, 404);
});

test("content negotiation follows Accept", async () => {
  assert.match((await call("/api/lab/negotiate")).headers.get("content-type")!, /json/);
  const text = await call("/api/lab/negotiate", { headers: { accept: "text/plain" } });
  assert.match(text.headers.get("content-type")!, /^text\/plain/);
  assert.equal(text.headers.get("vary"), "Accept");
  assert.equal((await call("/api/lab/negotiate", { headers: { accept: "image/png" } })).status, 406);
});

test("the books API: route and handler headers, 404 from the handler, 405, 415, 400, 422 and 201", async () => {
  const list = await call("/api/lab/books");
  assert.equal(list.headers.get("x-lab-handler"), "listBooks");
  assert.equal((await body(list)).books.length, 3);
  const missing = await call("/api/lab/books/99");
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("x-lab-route"), "GET /api/lab/books/:id");
  assert.equal(missing.headers.get("x-lab-handler"), "getBook");
  const route404 = await call("/api/lab/nothing-here");
  assert.equal(route404.status, 404);
  assert.equal(route404.headers.get("x-lab-route"), null);
  assert.equal((await call("/api/lab/books/1", { method: "DELETE" })).headers.get("allow"), "GET");
  assert.equal((await call("/api/lab/books", { method: "POST", body: "{}" })).status, 415);
  assert.equal((await call("/api/lab/books", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" })).status, 400);
  const invalid = await call("/api/lab/books", { method: "POST", headers: { "content-type": "application/json" }, body: '{"title":"T"}' });
  assert.equal(invalid.status, 422);
  assert.ok((await body(invalid)).fields.author);
  const created = await call("/api/lab/books", { method: "POST", headers: { "content-type": "application/json" }, body: '{"title":"T","author":"A"}' });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("location"), "/api/lab/books/4");
  assert.equal((await body(created)).saved, false);
});

test("orders: the deliberate v1 server error, validation, and success", async () => {
  const post = (headers: Record<string, string>, payload: string) => call("/api/lab/orders", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: payload });
  assert.equal((await call("/api/lab/orders")).status, 405);
  assert.equal((await post({ "x-api-version": "1" }, '{"item":"pen","quantity":1}')).status, 500);
  assert.equal((await post({ "x-api-version": "9" }, '{"item":"pen","quantity":1}')).status, 400);
  assert.equal((await post({}, '{"item":"pen","quantity":0}')).status, 422);
  assert.equal((await post({}, '{"item":"pen","quantity":1}')).status, 201);
});

test("slow waits at most 5 seconds, and reports what it waited", async () => {
  const r = await body(await call("/api/lab/slow?ms=20"));
  assert.equal(r.waitedMs, 20);
  assert.equal(r.maxMs, 5000);
  assert.ok(r.measuredMs >= 15);
  assert.equal((await body(await call("/api/lab/slow?ms=-5"))).waitedMs, 0);
  assert.equal((await body(await call("/api/lab/slow?ms=abc"))).waitedMs, 1000);
});

test("an unknown lab path is a JSON 404 listing the routes, never HTML", async () => {
  const r = await call("/api/lab/<script>alert(1)</script>");
  assert.equal(r.status, 404);
  assert.match(r.headers.get("content-type")!, /^application\/json/);
  assert.ok(Array.isArray((await body(r)).routes));
});
