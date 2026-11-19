// Networking labs. Four send real HTTP requests from this browser to Kitab's /api/lab/ endpoints and judge the real
// exchange; the DNS lab runs the learner's resolver for real over a small zone that is data, not the Internet's DNS.
import { draft, header, received, status, type CodeLab, type ComputerStep, type ConfigNote, type HttpLab, type Observation } from "../model.ts";

const httpSteps: ComputerStep[] = [
  { title: "Your page asks for a request", detail: "Kitab calls fetch() with the method, path, headers and body you wrote.", observed: true },
  { title: "The browser prepares it", detail: "It checks the headers (refusing invalid names and dropping ones pages may not set, such as Host or Cookie), adds its own (User-Agent, Accept-Encoding...) and picks a connection.", observed: true },
  { title: "A transport carries it", detail: "To Kitab in production: HTTP/2 or HTTP/3 over an encrypted connection (TLS over TCP, or QUIC over UDP). To a local dev server: HTTP/1.1 over TCP. The Timing tab shows the protocol the browser reports. The packets themselves aren't visible to a web page.", observed: false },
  { title: "The server receives it", detail: "Kitab's Worker reads the request line, headers and body. The echo endpoint sends back exactly what arrived.", observed: true },
  { title: "A route and handler decide the answer", detail: "The path and method select code that builds the response: a status code, headers and a body.", observed: true },
  { title: "The response comes back", detail: "Over the same connection. The browser decodes it and gives the page the status, the headers it may read, and the body.", observed: true },
  { title: "Kitab shows what arrived", detail: "Everything in the response inspector is what fetch reported. The 'as an HTTP message' views are reconstructions for reading, not captured bytes.", observed: true },
];

const contentType: ConfigNote = {
  name: "Content-Type",
  what: "A header naming the format of a message's body, such as application/json or text/html.",
  why: "Bytes don't describe themselves. The receiver uses it to decide how to parse the body.",
  where: "Set by whoever sends the body: the client for a request (your code or an HTTP library), the server for a response (the framework, often automatically).",
  who: "Request: the client application. Response: the server's application or web server configuration.",
  change: "Request: add the header in code (fetch headers, curl -H). Response: res.type('json') in Express, or the web server's MIME types.",
  verify: "Look at the request in the echo, or the response headers here, in browser DevTools, or with curl -i.",
  effect: "A wrong type makes the receiver misread the body or refuse it (415 Unsupported Media Type).",
  kitab: "Real: your header is sent; the echo shows what arrived and whether the server parsed the body as JSON.",
};

const clientTimeout: ConfigNote = {
  name: "Client timeout",
  what: "How long the client waits for a response before giving up.",
  why: "A server that never answers would otherwise hold the client (and the user) forever.",
  where: "In the calling code or HTTP library: an AbortController timer with fetch, HttpClient.Timeout in .NET, axios's timeout, curl --max-time.",
  who: "The client application's developers.",
  change: "Here, the Timeout field. In code, the library's setting.",
  verify: "Call an endpoint slower than the timeout and confirm the request is abandoned.",
  effect: "A timeout tells the client nothing about whether the server finished the work. Too short and slow-but-working calls fail.",
  kitab: "Real: Kitab aborts the real request at your timeout.",
};

const isRealRoute = (o: Observation) => !!(o.response?.json as { routes?: unknown } | undefined)?.routes;
const generatedAt = (o: Observation | undefined) => (o?.response?.json as { generatedAt?: string } | undefined)?.generatedAt;

export const networkingLabs: (CodeLab | HttpLab)[] = [
  {
    kind: "http",
    id: "http-inspector",
    version: 1,
    subject: "networking",
    title: "Send and inspect real HTTP requests",
    summary: "Build GET and POST requests, send them to Kitab's server, and compare what you wrote with what the server received.",
    difficulty: "beginner",
    minutes: 15,
    modes: ["real-protocol"],
    modeNote: "Your requests really leave this browser and reach Kitab's server. The echo endpoint replies with exactly what it received. Packets, TCP and TLS are not visible to a web page, so they're explained, not shown.",
    objective: "Name the parts of an HTTP request and response, send data with POST, and see which headers your browser adds or refuses.",
    problem: "A form on a website 'sends nothing' to the server. To find out why, you need to see the request the server actually receives, not the one you meant to send.",
    build: "Three requests to /api/lab/echo: a GET, a POST with a JSON body the server can parse, and a GET with your own header.",
    canChange: "Method, path, headers, body and timeout. Requests can only go to paths under /api/lab/ on Kitab's own server.",
    tools: "Request builder, response inspector (status, headers, body, timing), and the same request as a curl command for your own terminal.",
    verify: "Each task's checks read the echo's reply: the method, headers and body the server says it received.",
    success: "All three tasks pass on real replies from Kitab's server.",
    computer: httpSteps,
    configs: [contentType],
    terms: ["port", "dns"],
    related: [
      { label: "Learn: a request across the Internet", path: "/concepts/dns", kind: "learn" },
      { label: "Learn: follow GET /hello through TCP and IP (recorded run)", path: "/learn/hello-tcp", kind: "learn" },
      { label: "Playground: load a page across the Internet (simulated)", path: "/practice/network?starter=internet", kind: "playground" },
    ],
    stages: [{ track: "networking", stage: "internet" }],
    tasks: [
      {
        id: "get",
        title: "Send your first request",
        goal: "Send a GET request to /api/lab/echo and read the response.",
        starter: draft("GET", "/api/lab/echo"),
        solution: draft("GET", "/api/lab/echo"),
        checks: [
          { label: "A real response arrived", test: (o) => o.outcome === "response" },
          { label: "The status is 200 OK", test: (o) => status(o) === 200 },
          { label: "The server received a GET", test: (o) => received(o)?.method === "GET" },
        ],
        hints: ["Press Send. Then look at the response body: received.headers lists headers you never wrote, added by your browser."],
      },
      {
        id: "post-json",
        title: "Send JSON with POST",
        goal: "POST a JSON object with a \"name\" field so that the server parses it as JSON.",
        starter: draft("POST", "/api/lab/echo", { body: '{ "name": "Ada" }' }),
        solution: draft("POST", "/api/lab/echo", { headers: [{ name: "Content-Type", value: "application/json" }], body: '{ "name": "Ada" }' }),
        checks: [
          { label: "The method is POST", test: (o) => received(o)?.method === "POST" },
          { label: "The server received Content-Type: application/json", test: (o) => (received(o)?.headers["content-type"] ?? "").startsWith("application/json") },
          { label: "The server parsed a JSON body with a name", test: (o) => typeof (received(o)?.body.json as { name?: unknown } | undefined)?.name === "string" },
        ],
        hints: [
          "Send the starter and look at received.headers in the reply: content-type is text/plain. fetch chose that because nothing said the text was JSON.",
          "Add a header: Content-Type with the value application/json.",
        ],
      },
      {
        id: "custom-header",
        title: "Add your own header",
        goal: "Send a GET to /api/lab/echo with a header named X-Learner and any value. Then try adding a Host header too, and see what arrives.",
        starter: draft("GET", "/api/lab/echo"),
        solution: draft("GET", "/api/lab/echo", { headers: [{ name: "X-Learner", value: "me" }] }),
        checks: [
          { label: "The server received your X-Learner header", test: (o) => !!received(o)?.headers["x-learner"] },
        ],
        hints: ["Use + Add header. Header names aren't case-sensitive: the server shows them in lower case.", "A Host header you add is silently dropped: browsers set Host themselves."],
      },
    ],
  },
  {
    kind: "http",
    id: "headers-status",
    version: 1,
    subject: "networking",
    title: "Headers, status codes and caching",
    summary: "Trigger 404, 405, 304 and content negotiation for real, and let the browser's own HTTP cache answer a request.",
    difficulty: "intermediate",
    minutes: 20,
    modes: ["real-protocol"],
    modeNote: "Every status code and header here comes from Kitab's server, or from your browser's real HTTP cache. Kitab writes none of them in the page.",
    objective: "Tell what the client controls (method, path, request headers) from what the server controls (status, response headers), and use caching headers on purpose.",
    problem: "An app shows 'error' for every failure. To handle them properly it must tell a missing page from a wrong method, ask for the format it can read, and avoid downloading what it already has.",
    build: "Five tasks: a missing route, a wrong method, a different format, a 304 Not Modified, and a response served from your browser's cache.",
    canChange: "Method, path, headers, timeout, and whether the browser's HTTP cache may answer.",
    tools: "Request builder, response inspector, and the Timing tab (a response from the browser cache transfers 0 bytes).",
    verify: "Each task's checks read the real response, and for caching, the earlier responses in this task.",
    success: "All five tasks pass, each on a real response: 404, 405, a text/plain body, 304, and a reply from the browser's cache.",
    computer: [
      ...httpSteps.slice(0, 5),
      { title: "Caches can answer instead", detail: "With caching allowed, the browser may answer from its own HTTP cache without contacting the server, if the earlier response's Cache-Control allows it.", observed: true },
      ...httpSteps.slice(5),
    ],
    configs: [
      contentType,
      {
        name: "Cache-Control",
        what: "A response header telling caches whether and for how long they may reuse the response.",
        why: "Reusing a response saves the network round trip and the server's work.",
        where: "Set by the server: the application, the web server (Nginx's expires / add_header), or a CDN rule.",
        who: "The server's developers or operators. The client can ask for fresh data (Cache-Control: no-cache in the request) but can't force a server to allow caching.",
        change: "In the response: Cache-Control: public, max-age=60 (reuse for 60 s), no-cache (revalidate first), no-store (never keep).",
        verify: "Request twice: if generatedAt is unchanged and the Timing tab shows 0 bytes transferred, the browser cache answered.",
        effect: "Longer max-age means fewer requests and staler data. ETags let a cache check cheaply whether its copy is still current (304).",
        kitab: "Real: the headers come from Kitab's server and caching is done by your browser.",
        example: { label: "Representative: Nginx", code: "location /static/ {\n  add_header Cache-Control \"public, max-age=86400\";\n}" },
      },
    ],
    terms: [],
    related: [
      { label: "Learn: follow GET /hello (recorded run)", path: "/learn/hello-tcp", kind: "learn" },
      { label: "Learn: caching at scale", path: "/learn/system-design/performance", kind: "learn" },
    ],
    stages: [{ track: "networking", stage: "internet" }],
    tasks: [
      {
        id: "missing-route",
        title: "Find a missing route",
        goal: "Get a 404 Not Found by requesting a path under /api/lab/ that doesn't exist.",
        starter: draft("GET", "/api/lab/echo"),
        solution: draft("GET", "/api/lab/no-such-page"),
        checks: [
          { label: "The status is 404 Not Found", test: (o) => status(o) === 404 },
          { label: "No route matched (the server lists the routes it has)", test: isRealRoute },
        ],
        hints: ["Change the path to something like /api/lab/no-such-page."],
      },
      {
        id: "wrong-method",
        title: "Use the wrong method",
        goal: "/api/lab/books/1 can only be read. Send it a method it doesn't allow and find out which methods it accepts.",
        starter: draft("GET", "/api/lab/books/1"),
        solution: draft("DELETE", "/api/lab/books/1"),
        checks: [
          { label: "The status is 405 Method Not Allowed", test: (o) => status(o) === 405 },
          { label: "The response has an Allow header", test: (o) => !!header(o.response?.headers, "allow") },
        ],
        hints: ["Change the method to DELETE (or PUT) and send.", "The Allow header lists the methods this path accepts."],
      },
      {
        id: "negotiate",
        title: "Ask for a different format",
        goal: "GET /api/lab/negotiate returns JSON by default. Ask for plain text instead, using a request header.",
        starter: draft("GET", "/api/lab/negotiate"),
        solution: draft("GET", "/api/lab/negotiate", { headers: [{ name: "Accept", value: "text/plain" }] }),
        checks: [
          { label: "You sent an Accept header asking for text/plain", test: (o) => (header(o.request.headers, "accept") ?? "").includes("text/plain") },
          { label: "The response's Content-Type is text/plain", test: (o) => status(o) === 200 && (header(o.response?.headers, "content-type") ?? "").startsWith("text/plain") },
        ],
        hints: ["The client says which formats it can read with the Accept header.", "Add Accept: text/plain."],
      },
      {
        id: "etag",
        title: "Get a 304 Not Modified",
        goal: "GET /api/lab/cache/etag, copy the ETag from the response headers, then send it back in an If-None-Match header.",
        starter: draft("GET", "/api/lab/cache/etag"),
        solution: draft("GET", "/api/lab/cache/etag", { headers: [{ name: "If-None-Match", value: '"lab-etag-v1"' }] }),
        checks: [
          { label: "You sent If-None-Match", test: (o) => !!header(o.request.headers, "if-none-match") },
          { label: "The server answered 304 Not Modified", test: (o) => status(o) === 304 },
        ],
        hints: ["Send the starter, then find ETag in the response headers. Its value includes the quotes.", "Add If-None-Match with that exact value, quotes included."],
      },
      {
        id: "browser-cache",
        title: "Let the browser cache answer",
        goal: "Allow the browser's HTTP cache, then GET /api/lab/cache/max-age twice. Show that the second response never reached the server.",
        cacheControl: true,
        starter: draft("GET", "/api/lab/cache/max-age"),
        solution: draft("GET", "/api/lab/cache/max-age", { cache: "default" }),
        checks: [
          { label: "The browser's HTTP cache was allowed", test: (o) => o.request.cache === "default" },
          { label: "The response is the same one as before (same generatedAt): the server wasn't asked", test: (o, history) => status(o) === 200 && !!generatedAt(o) && history.slice(0, -1).some((h) => h.request.cache === "default" && generatedAt(h) === generatedAt(o)) },
        ],
        hints: ["Set 'Browser cache' to 'Allowed', then press Send twice.", "Compare generatedAt in the two bodies, and the bytes transferred in the Timing tab."],
      },
    ],
  },
  {
    kind: "code",
    id: "dns-resolver",
    version: 1,
    subject: "networking",
    title: "Write a DNS resolver",
    summary: "Follow CNAME chains to addresses, and report missing names, missing records and loops like a real resolver.",
    difficulty: "intermediate",
    minutes: 20,
    modes: ["real-execution"],
    modeNote: "Your resolver code really runs. The zone it reads is a small table of records (a model), not the Internet's DNS: no DNS packets are sent. To watch a DNS query cross a network, open the Network Playground, which simulates it.",
    objective: "Understand what DNS records are, how a resolver follows CNAMEs to an address, and the difference between a name that doesn't exist and a name with no address.",
    problem: "www.kitab.test and cdn.kitab.test are aliases. A resolver must follow them to an IP address, answer 'no such name' correctly, and never loop forever on a misconfigured zone.",
    build: "Finish resolve(name, zone): follow CNAMEs until A records, ignore letter case and a trailing dot, and throw errors named NXDOMAIN, NODATA or LOOP.",
    canChange: "Everything in resolver.js, including the zone.",
    tools: "Run prints lookups against the example zone. Check tests chains, case, missing names and loops with its own zones.",
    verify: "Run the starter: only names with a direct A record resolve.",
    success: "All tests pass: chains, case, NXDOMAIN, NODATA and loops.",
    computer: [
      { title: "An application asks for a name", detail: "In real life the browser asks the operating system's stub resolver, which asks a recursive resolver (your ISP's, or 1.1.1.1).", observed: false },
      { title: "The resolver looks up records", detail: "Here, your code reads the zone table. A real recursive resolver asks root, top-level-domain and authoritative servers over UDP or TCP port 53, and caches answers for their TTL.", observed: false },
      { title: "A CNAME means 'ask for this other name'", detail: "Your resolver restarts with the target name, recording the chain.", observed: true },
      { title: "A records give IPv4 addresses", detail: "The answer is every A record at the final name.", observed: true },
      { title: "Errors are answers too", detail: "NXDOMAIN: the name doesn't exist. NODATA: it exists but has no record of the requested type (like a name with only MX).", observed: true },
    ],
    configs: [
      {
        name: "DNS record",
        what: "One entry in a zone: a name, a type (A, AAAA, CNAME, MX, TXT...), a value and a TTL.",
        why: "It maps human names to the addresses and services machines need.",
        where: "In the zone at the domain's authoritative DNS provider (Cloudflare, Route 53...), or a zone file on a BIND server.",
        who: "The domain's owner or whoever manages its DNS.",
        change: "In the provider's dashboard or API, or by editing the zone file and reloading.",
        verify: "dig www.example.com or nslookup www.example.com shows the chain and the answer.",
        effect: "Resolvers cache records for their TTL, so a change can take that long to be seen everywhere.",
        kitab: "Real: your resolver logic. Modeled: the zone is a JavaScript object; nothing is sent over the network.",
        example: { label: "Representative: a BIND zone file", code: "kitab.test.      3600 IN A     203.0.113.10\nwww.kitab.test.  3600 IN CNAME kitab.test.\nmail.kitab.test. 3600 IN MX    10 mx.kitab.test." },
      },
    ],
    terms: ["dns", "ip"],
    related: [
      { label: "Learn: how a name becomes an address", path: "/concepts/dns", kind: "learn" },
      { label: "Playground: a DNS lookup across a network (simulated)", path: "/practice/network?starter=internet", kind: "playground" },
    ],
    stages: [{ track: "networking", stage: "internet" }],
    file: "resolver.js",
    starter: `// A zone: the records DNS servers would hold, as data.
const zone = {
  "kitab.test": [{ type: "A", value: "203.0.113.10" }],
  "www.kitab.test": [{ type: "CNAME", value: "kitab.test" }],
  "cdn.kitab.test": [{ type: "CNAME", value: "edge.example.net" }],
  "edge.example.net": [{ type: "A", value: "198.51.100.7" }, { type: "A", value: "198.51.100.8" }],
  "mail.kitab.test": [{ type: "MX", value: "10 mx.kitab.test" }],
  "loop-a.test": [{ type: "CNAME", value: "loop-b.test" }],
  "loop-b.test": [{ type: "CNAME", value: "loop-a.test" }],
};

// resolve(name, zone) returns { addresses: [...], chain: [every name visited, in order] }.
//   Follow CNAME records until A records are found. Names ignore case and may end with ".".
//   No records at all for a name: throw an Error whose name is "NXDOMAIN".
//   Records, but no A and no CNAME: throw an Error named "NODATA".
//   More than 8 CNAMEs followed: throw an Error named "LOOP".
function resolve(name, zone) {
  const records = zone[name] || [];
  return { addresses: records.filter((r) => r.type === "A").map((r) => r.value), chain: [name] };
}

function fail(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

for (const name of ["kitab.test", "WWW.kitab.test.", "cdn.kitab.test", "nope.kitab.test", "mail.kitab.test", "loop-a.test"]) {
  try {
    const { addresses, chain } = resolve(name, zone);
    console.log(name, "->", addresses.join(", ") || "(no addresses)", " via", chain.join(" -> "));
  } catch (error) {
    console.log(name, "->", error.name + ":", error.message);
  }
}
`,
    solution: `const zone = {
  "kitab.test": [{ type: "A", value: "203.0.113.10" }],
  "www.kitab.test": [{ type: "CNAME", value: "kitab.test" }],
  "cdn.kitab.test": [{ type: "CNAME", value: "edge.example.net" }],
  "edge.example.net": [{ type: "A", value: "198.51.100.7" }, { type: "A", value: "198.51.100.8" }],
  "mail.kitab.test": [{ type: "MX", value: "10 mx.kitab.test" }],
  "loop-a.test": [{ type: "CNAME", value: "loop-b.test" }],
  "loop-b.test": [{ type: "CNAME", value: "loop-a.test" }],
};

const normalize = (name) => name.toLowerCase().replace(/\\.$/, "");

function resolve(name, zone) {
  const chain = [];
  let current = normalize(name);
  for (let hops = 0; ; hops++) {
    chain.push(current);
    const records = zone[current];
    if (!records || records.length === 0) throw fail("NXDOMAIN", current + " does not exist");
    const addresses = records.filter((r) => r.type === "A").map((r) => r.value);
    if (addresses.length) return { addresses, chain };
    const alias = records.find((r) => r.type === "CNAME");
    if (!alias) throw fail("NODATA", current + " has no A or CNAME record");
    if (hops >= 8) throw fail("LOOP", "followed more than 8 CNAMEs from " + normalize(name));
    current = normalize(alias.value);
  }
}

function fail(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

for (const name of ["kitab.test", "WWW.kitab.test.", "cdn.kitab.test", "nope.kitab.test", "mail.kitab.test", "loop-a.test"]) {
  try {
    const { addresses, chain } = resolve(name, zone);
    console.log(name, "->", addresses.join(", ") || "(no addresses)", " via", chain.join(" -> "));
  } catch (error) {
    console.log(name, "->", error.name + ":", error.message);
  }
}
`,
    exports: ["resolve"],
    tests: `
const zone = {
  "a.test": [{ type: "A", value: "192.0.2.1" }],
  "b.test": [{ type: "CNAME", value: "a.test" }],
  "c.test": [{ type: "CNAME", value: "b.test" }],
  "multi.test": [{ type: "A", value: "192.0.2.10" }, { type: "A", value: "192.0.2.11" }, { type: "TXT", value: "hello" }],
  "txt.test": [{ type: "TXT", value: "v=spf1 -all" }],
  "dangling.test": [{ type: "CNAME", value: "gone.test" }],
  "x.test": [{ type: "CNAME", value: "y.test" }],
  "y.test": [{ type: "CNAME", value: "x.test" }],
};
const errorName = (fn) => { try { fn(); return "no error"; } catch (e) { return e && e.name; } };
test("a direct A record", () => {
  assert.equal(lab.resolve("a.test", zone), { addresses: ["192.0.2.1"], chain: ["a.test"] }, "resolve('a.test')");
});
test("a CNAME chain is followed to the address, and recorded", () => {
  assert.equal(lab.resolve("c.test", zone), { addresses: ["192.0.2.1"], chain: ["c.test", "b.test", "a.test"] }, "resolve('c.test')");
});
test("every A record is returned; other types are ignored", () => {
  assert.equal(lab.resolve("multi.test", zone).addresses, ["192.0.2.10", "192.0.2.11"], "addresses of multi.test");
});
test("names ignore case and a trailing dot", () => {
  assert.equal(lab.resolve("B.Test.", zone).addresses, ["192.0.2.1"], "resolve('B.Test.')");
});
test("a name with no records is NXDOMAIN", () => {
  assert.equal(errorName(() => lab.resolve("missing.test", zone)), "NXDOMAIN", "error name for missing.test");
});
test("a CNAME to a missing name is NXDOMAIN", () => {
  assert.equal(errorName(() => lab.resolve("dangling.test", zone)), "NXDOMAIN", "error name for dangling.test");
});
test("a name with records but no address is NODATA, not NXDOMAIN", () => {
  assert.equal(errorName(() => lab.resolve("txt.test", zone)), "NODATA", "error name for txt.test");
});
test("a CNAME loop stops with LOOP", () => {
  assert.equal(errorName(() => lab.resolve("x.test", zone)), "LOOP", "error name for x.test");
});
`,
    timeoutMs: 2000,
    hints: [
      "Run the starter: www.kitab.test prints no addresses. It only has a CNAME, which the starter ignores.",
      "Loop: look up the current name; if it has A records, return them; if it has a CNAME, continue with its value.",
      "Normalize each name first: name.toLowerCase().replace(/\\.$/, '').",
      "Count CNAMEs followed; after 8, throw the LOOP error. The fail() helper makes errors with a name.",
    ],
  },
  {
    kind: "http",
    id: "tcp-vs-http",
    version: 1,
    subject: "networking",
    title: "TCP connections versus HTTP requests",
    summary: "Use what your browser really reports about each request (protocol, connection setup, reuse) to separate the connection from the messages.",
    difficulty: "intermediate",
    minutes: 15,
    modes: ["real-protocol"],
    modeNote: "The requests are real, and the protocol and connection timings are what your browser's Resource Timing API reports. A web page can't see TCP segments or packets, so those are explained, not shown.",
    objective: "Distinguish a transport connection (opened once, reused) from the HTTP request/response messages that travel over it, and see that a timeout ends an HTTP exchange, not necessarily the connection.",
    problem: "A team thinks every API call 'opens a TCP connection', and blames connection setup for slowness. Your browser can show whether that's true.",
    build: "Three tasks: read the protocol of one request, send two requests and decide from the evidence whether the second opened a new connection, and make a client give up on a slow response.",
    canChange: "Method, path, headers and timeout.",
    tools: "Timing tab: protocol (nextHopProtocol), DNS, connect and TLS time, waiting time. Zero connect time means the browser used a connection that was already open.",
    verify: "Questions are marked from your own observations: the right answer is computed from what your browser reported.",
    success: "All three tasks pass, with each answer computed from what your own browser reported.",
    computer: [
      { title: "A connection is opened once", detail: "TCP's three-way handshake (SYN, SYN-ACK, ACK) and, for HTTPS, a TLS handshake set up an encrypted byte stream. With HTTP/3, QUIC does both over UDP. The browser reports how long this took as connect and TLS time.", observed: true },
      { title: "HTTP messages travel over it", detail: "A request (method, path, headers, body) and a response (status, headers, body). With HTTP/1.1 one at a time per connection; with HTTP/2 and HTTP/3 many at once, interleaved as streams.", observed: true },
      { title: "The connection is kept open", detail: "Browsers keep connections alive and reuse them, so later requests skip the handshakes. The Timing tab then shows 0 ms connect time.", observed: true },
      { title: "TCP delivers bytes reliably underneath", detail: "Segments, sequence numbers, acknowledgments and retransmissions happen inside the operating system. A web page can't observe them; Kitab's TCP missions model them instead.", observed: false },
      { title: "Giving up ends the exchange", detail: "Aborting a request ends that HTTP exchange. On HTTP/2 the browser cancels just that stream; on HTTP/1.1 it usually closes the connection. Which happened isn't reported to the page.", observed: false },
    ],
    configs: [
      clientTimeout,
      {
        name: "Keep-alive / connection reuse",
        what: "Keeping a connection open after a response, so the next request can use it.",
        why: "Each new connection costs at least one round trip for TCP and more for TLS.",
        where: "Browsers do it automatically. Servers set how long idle connections stay open: Nginx keepalive_timeout, Node's server.keepAliveTimeout. HTTP client libraries pool connections.",
        who: "The server's operators (idle timeout) and the client library (pooling).",
        change: "Nginx: keepalive_timeout 65s; Node.js: server.keepAliveTimeout = 5000.",
        verify: "Connect time 0 in Resource Timing, or curl -v showing 'Re-using existing connection'.",
        effect: "Longer idle timeouts save handshakes but hold server memory for idle clients.",
        kitab: "Real: your browser's own reuse decision, as it reports it.",
      },
    ],
    terms: ["port"],
    related: [
      { label: "Learn: follow GET /hello through sockets and TCP (recorded run)", path: "/learn/hello-tcp", kind: "learn" },
      { label: "Practice: predict the acknowledgment after a lost segment (TCP model)", path: "/missions/tcp-lost-segment", kind: "practice" },
    ],
    stages: [{ track: "networking", stage: "internet" }],
    tasks: [
      {
        id: "protocol",
        title: "What carried your request?",
        goal: "Send a GET to /api/lab/echo, open the Timing tab, and answer from what your browser reported.",
        starter: draft("GET", "/api/lab/echo"),
        solution: draft("GET", "/api/lab/echo"),
        checks: [{ label: "A real response arrived", test: (o) => o.outcome === "response" && status(o) === 200 }],
        question: {
          prompt: "Which HTTP version did your browser report for this request?",
          options: [
            { id: "http/1.1", label: "HTTP/1.1" },
            { id: "h2", label: "HTTP/2" },
            { id: "h3", label: "HTTP/3" },
            { id: "none", label: "The browser didn't report it" },
          ],
          answer: (history) => {
            const t = history.filter((h) => h.outcome === "response").at(-1)?.timing;
            if (!t || !["http/1.1", "h2", "h3"].includes(t.protocol)) return "none";
            return t.protocol;
          },
          explain: "Your browser's Resource Timing entry names the protocol (nextHopProtocol). HTTP/1.1 and HTTP/2 run over TCP (with TLS for HTTPS); HTTP/3 runs over QUIC on UDP. The HTTP request itself looks the same to the server either way.",
        },
        hints: ["Send, then open the Timing tab of the response. 'Protocol' is what the browser reported."],
      },
      {
        id: "reuse",
        title: "Two requests, one connection?",
        goal: "Send at least two requests in a row, then decide from the Timing tab whether the latest one needed a new connection.",
        starter: draft("GET", "/api/lab/echo"),
        solution: draft("GET", "/api/lab/echo"),
        checks: [{ label: "At least two real responses in this task", test: (_o, history) => history.filter((h) => h.outcome === "response").length >= 2 }],
        question: {
          prompt: "Did your latest request open a new connection?",
          options: [
            { id: "reused", label: "No: it used a connection that was already open (0 ms connect time)" },
            { id: "new", label: "Yes: the browser spent time setting up a connection first" },
            { id: "none", label: "The browser didn't report connection timing" },
          ],
          answer: (history) => {
            const t = history.filter((h) => h.outcome === "response").at(-1)?.timing;
            return !t ? "none" : t.reused ? "reused" : "new";
          },
          explain: "Connect time is the TCP (and TLS) setup the browser measured for this request. Zero means it reused an open connection: many HTTP requests, one connection. That's why 'one request = one TCP connection' is usually false.",
        },
        hints: ["Press Send twice, then compare 'Connection setup' in the Timing tab."],
      },
      {
        id: "timeout",
        title: "Give up on a slow response",
        goal: "/api/lab/slow?ms=3000 answers after 3 seconds. Make the client give up first.",
        starter: draft("GET", "/api/lab/slow?ms=3000"),
        solution: draft("GET", "/api/lab/slow?ms=3000", { timeoutMs: 1000 }),
        checks: [
          { label: "The request went to /api/lab/slow", test: (o) => o.request.path.startsWith("/api/lab/slow") },
          { label: "The client timed out before any response", test: (o) => o.outcome === "timeout" },
        ],
        hints: ["Set Timeout (ms) lower than 3000, for example 1000, and send.", "No status code arrives: an abandoned request has no response at all."],
      },
    ],
  },
  {
    kind: "http",
    id: "http-troubleshooting",
    version: 1,
    subject: "networking",
    title: "Troubleshoot a failing HTTP request",
    summary: "A client can't place an order. Fix the request one fault at a time, guided only by what the browser and server report.",
    difficulty: "intermediate",
    minutes: 25,
    modes: ["real-protocol"],
    modeNote: "Every failure is real: refused by your browser, or answered by Kitab's server with a real status code and body. Kitab never writes a fake error.",
    objective: "Read failures in order (the browser's refusals, then status codes, then response bodies), change one thing at a time, and verify each change by resending.",
    problem: "Support says: 'Ordering a notebook fails.' The client team's request has several faults. Each fix reveals the next one, exactly as in real debugging.",
    build: "Three tasks: make the order request succeed (201 Created), fix a header your browser won't send, and get an answer from a slow report endpoint without changing the server.",
    canChange: "Method, path, headers, body and timeout.",
    tools: "Request builder, response inspector, and this task's attempt history, which keeps the status of every send so you can see your progress.",
    verify: "Change one thing, Send, read the new result. The checks read only the real response.",
    success: "All three tasks pass: an order created (201), a valid header sent, and the slow report received.",
    computer: httpSteps,
    configs: [contentType, clientTimeout],
    terms: [],
    related: [
      { label: "Lab: headers, status codes and caching", path: "/lab/networking/headers-status", kind: "practice" },
      { label: "Learn: follow GET /hello (recorded run)", path: "/learn/hello-tcp", kind: "learn" },
    ],
    stages: [{ track: "networking", stage: "internet" }],
    tasks: [
      {
        id: "order",
        title: "Place the order",
        goal: "The client must create an order with POST /api/lab/orders. Make the server answer 201 Created.",
        starter: draft("GET", "/api/lab/order", { headers: [{ name: "X-Api-Version", value: "1" }], body: '{ "item": "notebook", "quantity": 12 }' }),
        solution: draft("POST", "/api/lab/orders", { headers: [{ name: "X-Api-Version", value: "2" }, { name: "Content-Type", value: "application/json" }], body: '{ "item": "notebook", "quantity": 2 }' }),
        checks: [
          { label: "The server answered 201 Created", test: (o) => status(o) === 201 },
          { label: "The response says where the order is (Location)", test: (o) => !!header(o.response?.headers, "location") },
        ],
        hints: [
          "Send the starter. Your browser refuses it before it leaves: read that message first.",
          "Each status code points somewhere: 404 is the path, 405 the method, 415 the Content-Type header.",
          "A 500 is the server failing, not your request being invalid. Read the body: it says which API version works.",
          "422 means the JSON was understood but a value is invalid. The body names the field and the allowed range.",
        ],
      },
      {
        id: "bad-header",
        title: "A header the browser won't send",
        goal: "This request never leaves the browser. Find out why and fix it so the order is created.",
        starter: draft("POST", "/api/lab/orders", { headers: [{ name: "X Api Version", value: "2" }, { name: "Content-Type", value: "application/json" }], body: '{ "item": "pen", "quantity": 1 }' }),
        solution: draft("POST", "/api/lab/orders", { headers: [{ name: "X-Api-Version", value: "2" }, { name: "Content-Type", value: "application/json" }], body: '{ "item": "pen", "quantity": 1 }' }),
        checks: [
          { label: "The request was sent with an X-Api-Version header", test: (o) => o.outcome === "response" && !!header(o.request.headers, "x-api-version") },
          { label: "The server answered 201 Created", test: (o) => status(o) === 201 },
        ],
        hints: ["Send it and read the browser's message.", "Header names can't contain spaces. Use hyphens: X-Api-Version."],
      },
      {
        id: "slow",
        title: "A report that's too slow for the client",
        goal: "GET /api/lab/slow?ms=2500 simulates a report that takes 2.5 s. The client gives up too early. Get the report without changing the server's delay.",
        starter: draft("GET", "/api/lab/slow?ms=2500", { timeoutMs: 1000 }),
        solution: draft("GET", "/api/lab/slow?ms=2500", { timeoutMs: 4000 }),
        checks: [
          { label: "The request still asks for the 2.5 s report", test: (o) => /[?&]ms=2500(?:&|$)/.test(o.request.path) },
          { label: "A 200 response arrived", test: (o) => status(o) === 200 },
        ],
        hints: ["Send it: no response, just a timeout. The server never got the chance to answer.", "Raise Timeout (ms) above the server's 2,500 ms, for example to 4000."],
      },
    ],
  },
];
