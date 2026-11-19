// System design labs. S1 sends real HTTP requests to Kitab's teaching API; S2-S5 run the learner's code for real
// against controlled, reproducible stand-ins (timers for I/O, an injected clock, scripted failures), each stated.
import { draft, header, status, type CodeLab, type ComputerStep, type HttpLab } from "../model.ts";

const codeSteps: ComputerStep[] = [
  { title: "Your code is saved, then a fresh sandbox starts", detail: "An isolated frame with no network and no access to Kitab's data, with a Web Worker inside it.", observed: false },
  { title: "Your functions are compiled and run", detail: "The browser's JavaScript engine runs your code. Promises and timers use the same event loop a Node.js server uses.", observed: true },
  { title: "The tests drive your code with controlled stand-ins", detail: "Instead of real servers, the tests pass in functions that wait, fail or succeed on a script, so every run is reproducible.", observed: true },
  { title: "Measurements are real", detail: "Elapsed times and call counts in the test messages are measured from your code's run, not assumed.", observed: true },
];

export const architectureLabs: (CodeLab | HttpLab)[] = [
  {
    kind: "http",
    id: "api-request-flow",
    version: 1,
    subject: "architecture",
    title: "Follow a request through an API",
    summary: "Call a real teaching API: list, read, miss and create, and see which route and handler answered each time.",
    difficulty: "beginner",
    minutes: 15,
    modes: ["real-protocol"],
    modeNote: "Every request really goes to Kitab's server, where a router picks a handler. The API keeps no data: creating a book returns 201 but nothing is saved, and it says so.",
    objective: "Tell apart what happens in the browser (building and sending the request) from what happens on the service (routing, the handler, the response), and who decides each error.",
    problem: "A mobile app's book list is empty and nobody knows whether the app, the router or the handler is at fault. Every response from this API names the route and the handler that produced it.",
    build: "Complete four tasks against /api/lab/books: list the collection, read one item, ask for one that doesn't exist, and create one.",
    canChange: "The method, path, headers and body of each request.",
    tools: "The request builder sends with fetch. The response inspector shows status, headers (look for X-Lab-Route and X-Lab-Handler) and body.",
    verify: "Each task's checks read the real response. A task completes when every check passes on an actual reply.",
    success: "All four tasks pass, and you can say whether a 404 came from the router or from the handler.",
    computer: [
      { title: "The browser builds the request", detail: "fetch() turns your method, path, headers and body into an HTTP request.", observed: true },
      { title: "It travels over an existing or new connection", detail: "HTTP/2 or HTTP/3 to Kitab in production, HTTP/1.1 to a local dev server. The Timing tab shows what the browser reports.", observed: true },
      { title: "The Worker's router matches the path and method", detail: "Kitab's server compares the request against its route table. No match is a router-level 404, with no X-Lab-Route header.", observed: true },
      { title: "A handler runs", detail: "The matched handler (listBooks, getBook, createBook) validates the input and builds a response. A handler can also answer 404 or 422.", observed: true },
      { title: "The response comes back", detail: "Status line, headers and body. Your browser hands them to the page, which shows them here.", observed: true },
    ],
    configs: [
      {
        name: "API route",
        what: "A pattern (method + path) mapped to the code that handles it, such as GET /books/:id → getBook.",
        why: "It decouples URLs from code: one server serves many operations, and each request reaches exactly one handler.",
        where: "In application code: app.get('/books/:id', getBook) in Express, [HttpGet(\"{id}\")] in ASP.NET Core, a Worker's route table, or a gateway's config.",
        who: "The service's developers; an API gateway's operators for routes at the edge.",
        change: "Edit the route table and redeploy.",
        verify: "Call the path: a matched route answers from its handler. Here, X-Lab-Route shows which route matched.",
        effect: "A route that's too broad catches requests meant for others; a missing route is a 404 before any handler runs.",
        kitab: "Real: Kitab's Worker routes these requests in worker/lab.ts and adds headers naming the route and handler.",
        example: { label: "Representative: an Express route", code: "app.get('/api/books/:id', async (req, res) => {\n  const book = await db.findBook(req.params.id);\n  if (!book) return res.status(404).json({ error: 'not found' });\n  res.json(book);\n});" },
      },
    ],
    terms: ["rps", "latency"],
    related: [
      { label: "Learn: clients, servers and databases", path: "/learn/system-design/fundamentals", kind: "learn" },
      { label: "Playground: client, API, database", path: "/practice/architecture?template=three-tier", kind: "playground" },
    ],
    stages: [{ track: "system-design", stage: "fundamentals" }],
    tasks: [
      {
        id: "list",
        title: "List the collection",
        goal: "Send GET /api/lab/books and find which handler answered.",
        starter: draft("GET", "/api/lab/books"),
        solution: draft("GET", "/api/lab/books"),
        checks: [
          { label: "The response status is 200", test: (o) => status(o) === 200 },
          { label: "The listBooks handler answered (X-Lab-Handler)", test: (o) => header(o.response?.headers, "x-lab-handler") === "listBooks" },
        ],
        hints: ["Press Send, then open the Headers tab of the response and find X-Lab-Handler."],
      },
      {
        id: "read",
        title: "Read one item",
        goal: "Fetch a single book by its id. The ids are in the list you just received.",
        starter: draft("GET", "/api/lab/books"),
        solution: draft("GET", "/api/lab/books/2"),
        checks: [
          { label: "The response status is 200", test: (o) => status(o) === 200 },
          { label: "The getBook handler answered", test: (o) => header(o.response?.headers, "x-lab-handler") === "getBook" },
          { label: "The body is one book with an id", test: (o) => typeof (o.response?.json as { id?: unknown } | undefined)?.id === "number" },
        ],
        hints: ["Items in a collection usually live at /collection/:id. Try /api/lab/books/2."],
      },
      {
        id: "missing",
        title: "Ask for something that isn't there",
        goal: "Request a book id that doesn't exist, then decide who said 404: the router or the handler.",
        starter: draft("GET", "/api/lab/books/2"),
        solution: draft("GET", "/api/lab/books/99"),
        checks: [
          { label: "The response status is 404", test: (o) => status(o) === 404 },
          { label: "It is a missing book, not a missing route", test: (o) => header(o.response?.headers, "x-lab-route") === "GET /api/lab/books/:id" },
        ],
        question: {
          prompt: "Who decided this response was 404?",
          options: [
            { id: "router", label: "The router: no route matched the path" },
            { id: "handler", label: "The handler: the route matched, but the book doesn't exist" },
          ],
          answer: (history) => {
            const last = history.at(-1);
            if (!last || status(last) !== 404) return null;
            return header(last.response?.headers, "x-lab-handler") && header(last.response?.headers, "x-lab-handler") !== "none" ? "handler" : "router";
          },
          explain: "X-Lab-Route and X-Lab-Handler are present, so a route matched and getBook ran: the handler looked for the book and didn't find it. Compare GET /api/lab/nothing-here, where no route matches and those headers are absent.",
        },
        hints: ["Change the id to one that isn't in the list, such as 99.", "Look at the headers: if X-Lab-Handler is there, a handler ran."],
      },
      {
        id: "create",
        title: "Create a book",
        goal: "POST a new book as JSON. The server validates it and answers 201 Created with a Location header.",
        starter: draft("POST", "/api/lab/books", { headers: [{ name: "Content-Type", value: "application/json" }], body: '{\n  "title": "Designing Data-Intensive Applications"\n}' }),
        solution: draft("POST", "/api/lab/books", { headers: [{ name: "Content-Type", value: "application/json" }], body: '{\n  "title": "Designing Data-Intensive Applications",\n  "author": "Martin Kleppmann"\n}' }),
        checks: [
          { label: "The method is POST", test: (o) => o.request.method === "POST" },
          { label: "The response status is 201 Created", test: (o) => status(o) === 201 },
          { label: "The response says where the new book lives (Location)", test: (o) => !!header(o.response?.headers, "location") },
        ],
        hints: ["Send the starter first and read the 422 body: it lists the invalid fields.", "Add an \"author\" field to the JSON body."],
      },
    ],
  },
  {
    kind: "code",
    id: "capacity",
    version: 1,
    subject: "architecture",
    title: "Concurrency, throughput and capacity",
    summary: "Write a concurrency limiter, measure real throughput at different limits, and apply Little's law.",
    difficulty: "intermediate",
    minutes: 25,
    modes: ["real-execution"],
    modeNote: "Your limiter really runs and Kitab really measures it. Each 'request' is a timer standing in for I/O such as a database call, so the numbers measure your code's concurrency, not a real server's capacity.",
    objective: "Separate offered load (requests per second arriving) from capacity (what can be finished), and see concurrency raise throughput without making any single request faster.",
    problem: "A service calls a database that can handle only a few queries at a time. Running everything at once overloads it; one at a time is far too slow.",
    build: "Rewrite runWithLimit(tasks, limit) so up to limit tasks run at the same time, results stay in task order, and an invalid limit is refused. Then write concurrencyNeeded(rps, latencyMs) using Little's law.",
    canChange: "Everything in limiter.js. The bottom of the file measures throughput at several limits: change the numbers and Run.",
    tools: "Run prints measured elapsed time and throughput. Check measures how many tasks were active at once and how long a batch takes.",
    verify: "Run the starter: every limit takes the same time, because it ignores the limit. After your fix, a higher limit finishes sooner.",
    success: "All tests pass: never more than limit at once, the full limit used, faster with a higher limit (measured), results in order.",
    computer: codeSteps,
    configs: [
      {
        name: "Worker concurrency / connection pool size",
        what: "How many operations one process lets run at the same time against a dependency.",
        why: "Every dependency has a limit. A pool or limiter keeps a service under it, and queues the rest.",
        where: "A database driver's pool (maximum-pool-size), a job runner's concurrency (Sidekiq -c, Celery --concurrency), a semaphore in code.",
        who: "The service's developers or operators, matched to what the dependency can take.",
        change: "In configuration or at startup; for example spring.datasource.hikari.maximum-pool-size=10.",
        verify: "Measure: throughput and latency at several settings under the same load, and the dependency's own active connections.",
        effect: "Higher concurrency raises throughput only until the dependency saturates; beyond that, latency rises and nothing finishes faster.",
        kitab: "Real: your limiter and its measured timing. Modeled: the tasks are timers, so there is no dependency to saturate.",
      },
    ],
    terms: ["throughput", "rps", "latency", "slot", "pool"],
    related: [
      { label: "Learn: throughput, latency and Little's law", path: "/learn/system-design/performance#littles-law", kind: "learn" },
      { label: "Playground: find the bottleneck as traffic grows", path: "/practice/architecture?template=load-balanced", kind: "playground" },
    ],
    stages: [{ track: "system-design", stage: "scalability" }, { track: "system-design", stage: "performance" }],
    file: "limiter.js",
    starter: `// runWithLimit(tasks, limit): run task functions (each returns a promise), at most limit at a time.
//   Resolves to the results in the same order as tasks. limit must be a whole number >= 1 (else RangeError).
async function runWithLimit(tasks, limit) {
  // Correct results, but one task at a time: it ignores limit.
  const results = [];
  for (const task of tasks) {
    results.push(await task());
  }
  return results;
}

// concurrencyNeeded(rps, latencyMs): Little's law. How many requests are in progress at once,
// on average, when rps arrive per second and each takes latencyMs? Round up to a whole number.
function concurrencyNeeded(rps, latencyMs) {
  // TODO
}

// Measure it: 8 "requests" that each wait 50 ms (a stand-in for a database call).
const request = () => sleep(50);
for (const limit of [1, 2, 4, 8]) {
  const started = performance.now();
  await runWithLimit(Array.from({ length: 8 }, () => request), limit);
  const ms = performance.now() - started;
  console.log("limit " + limit + ": " + Math.round(ms) + " ms, " + Math.round(8 / (ms / 1000)) + " requests/s");
}
`,
    solution: `async function runWithLimit(tasks, limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a whole number of at least 1");
  const results = new Array(tasks.length);
  let next = 0;
  // Start up to limit workers. Each takes the next task as soon as it finishes one.
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function concurrencyNeeded(rps, latencyMs) {
  return Math.ceil(rps * (latencyMs / 1000));
}

const request = () => sleep(50);
for (const limit of [1, 2, 4, 8]) {
  const started = performance.now();
  await runWithLimit(Array.from({ length: 8 }, () => request), limit);
  const ms = performance.now() - started;
  console.log("limit " + limit + ": " + Math.round(ms) + " ms, " + Math.round(8 / (ms / 1000)) + " requests/s");
}
`,
    exports: ["runWithLimit", "concurrencyNeeded"],
    tests: `
function tracked(n, ms) {
  const stats = { active: 0, max: 0 };
  const tasks = Array.from({ length: n }, (_, i) => async () => {
    stats.active++; stats.max = Math.max(stats.max, stats.active);
    await sleep(ms);
    stats.active--;
    return i;
  });
  return { tasks, stats };
}
test("never runs more than limit at once, and uses all of it", async () => {
  const { tasks, stats } = tracked(12, 30);
  await lab.runWithLimit(tasks, 4);
  assert.equal(stats.max, 4, "most tasks running at the same time with limit 4 (measured)");
});
test("a higher limit finishes the same work sooner (measured)", async () => {
  const time = async (limit) => { const t = performance.now(); await lab.runWithLimit(tracked(8, 40).tasks, limit); return performance.now() - t; };
  const one = await time(1), four = await time(4);
  assert.ok(four < one / 2, "limit 1 took " + Math.round(one) + " ms and limit 4 took " + Math.round(four) + " ms; 4 should take less than half");
});
test("results come back in task order, even when tasks finish out of order", async () => {
  const delays = [60, 10, 40, 0, 20];
  const tasks = delays.map((ms, i) => async () => { await sleep(ms); return "task" + i; });
  assert.equal(await lab.runWithLimit(tasks, 3), ["task0", "task1", "task2", "task3", "task4"], "results");
});
test("a limit larger than the number of tasks, and no tasks at all", async () => {
  assert.equal(await lab.runWithLimit(tracked(2, 5).tasks, 10), [0, 1], "2 tasks with limit 10");
  assert.equal(await lab.runWithLimit([], 3), [], "no tasks");
});
test("an invalid limit is refused with a RangeError", async () => {
  await assert.rejects(() => lab.runWithLimit([], 0), RangeError, "runWithLimit([], 0) should reject with a RangeError");
  await assert.rejects(() => lab.runWithLimit([], 1.5), RangeError, "runWithLimit([], 1.5) should reject with a RangeError");
});
test("Little's law: requests in progress = arrival rate x time each takes", () => {
  assert.equal(lab.concurrencyNeeded(200, 50), 10, "concurrencyNeeded(200 req/s, 50 ms)");
  assert.equal(lab.concurrencyNeeded(30, 1000), 30, "concurrencyNeeded(30 req/s, 1000 ms)");
  assert.equal(lab.concurrencyNeeded(10, 25), 1, "concurrencyNeeded(10 req/s, 25 ms) rounds up");
  assert.equal(lab.concurrencyNeeded(0, 80), 0, "concurrencyNeeded(0, 80)");
});
`,
    timeoutMs: 6000,
    hints: [
      "Run the starter: every limit takes about 400 ms, because await inside the loop waits for each task before starting the next.",
      "Start limit 'workers' at once. Each worker loops: take the next task index, await it, store the result at that index.",
      "A shared counter (let next = 0) hands out task indexes; results[index] = ... keeps the order.",
      "Little's law: L = λ × W. With W in seconds: rps × latencyMs / 1000, then Math.ceil.",
    ],
  },
  {
    kind: "code",
    id: "caching",
    version: 1,
    subject: "architecture",
    title: "Build a cache with expiry and invalidation",
    summary: "Implement hits, misses, time-to-live and invalidation, then a read-through helper, and prove each with tests.",
    difficulty: "intermediate",
    minutes: 20,
    modes: ["real-execution"],
    modeNote: "Your cache really runs, in the sandbox's memory. Time comes from a clock the tests control, so expiry is exact and repeatable. This is a browser-local cache, not Redis: no network, no sharing between servers, no eviction under memory pressure.",
    objective: "Count hits and misses, expire stale values, invalidate on change, and see why a cache that ignores time serves old data.",
    problem: "A product page loads prices from a slow database. A cache makes it fast, but after a price changes, customers still see the old price for hours.",
    build: "Fix get() so entries older than ttlMs are misses, write invalidate(key), and write readThrough(cache, key, load) that only calls load on a miss.",
    canChange: "Everything in cache.js.",
    tools: "Run prints hits, misses and values over a simulated hour. Check drives your cache with a controlled clock.",
    verify: "Run the starter: after the price changes, the cache keeps returning the old one.",
    success: "All tests pass: hits and misses counted, a value of 0 still a hit, expiry at exactly ttlMs, invalidation, and readThrough calling load only when needed.",
    computer: [
      ...codeSteps.slice(0, 2),
      { title: "A Map holds the entries", detail: "Each key maps to { value, storedAt }. A get compares now() - storedAt with ttlMs.", observed: true },
      { title: "The tests move the clock", detail: "now() is a function the tests control, so 'one hour later' takes no time and is exact.", observed: true },
    ],
    configs: [
      {
        name: "Time to live (TTL)",
        what: "How long a cached value may be served before it must be fetched again.",
        why: "It bounds how stale data can get without the cache having to know when the source changed.",
        where: "Redis: SET key value EX 60, or EXPIRE key 60. HTTP: Cache-Control: max-age=60. Application caches: a ttl option.",
        who: "The service's developers, per kind of data: seconds for prices, days for images.",
        change: "Where the value is written (the EX argument) or in the cache's configuration.",
        verify: "Read the key's remaining time (Redis TTL key) or watch hits turn into misses after it.",
        effect: "Longer TTL: more hits, staler data. Shorter: fresher data, more load on the source.",
        kitab: "Real: your TTL logic with a controlled clock. Not modeled: memory limits, eviction policies, and a cache shared by many servers.",
        example: { label: "Representative: Redis from a shell", code: "SET price:42 1999 EX 60\nGET price:42\nTTL price:42" },
      },
      {
        name: "Invalidation",
        what: "Removing a cached value when the source of truth changes.",
        why: "TTL alone serves stale data until expiry; invalidating on write makes the next read fetch the new value.",
        where: "In the code that writes: after updating the database, DEL price:42.",
        who: "The service's developers.",
        change: "Add the delete to every write path.",
        verify: "Write, then read: the read is a miss and returns the new value.",
        effect: "Missed write paths leave stale entries; invalidating too much loses the cache's benefit.",
        kitab: "Real: your invalidate().",
      },
    ],
    terms: ["cacheHit", "latency"],
    related: [
      { label: "Learn: databases and caches", path: "/learn/system-design/storage-caching", kind: "learn" },
      { label: "Playground: an API with a cache", path: "/practice/architecture?template=cached-api", kind: "playground" },
      { label: "Lab: handle a cache stampede (model)", path: "/practice/architecture/labs/cache-stampede", kind: "practice" },
    ],
    stages: [{ track: "system-design", stage: "storage-caching" }],
    file: "cache.js",
    starter: `// createCache({ ttlMs, now }) returns a cache:
//   get(key)          the value if present and younger than ttlMs, otherwise undefined. Counts a hit or a miss.
//   set(key, value)   stores value with the time now()
//   invalidate(key)   removes key
//   stats()           { hits, misses }
// now is a function returning the current time in ms (the tests control it).
function createCache({ ttlMs, now }) {
  const entries = new Map();
  let hits = 0, misses = 0;
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry) { hits++; return entry.value; }
      misses++;
      return undefined;
    },
    set(key, value) { entries.set(key, { value, storedAt: now() }); },
    invalidate(key) { /* TODO */ },
    stats() { return { hits, misses }; },
  };
}

// readThrough(cache, key, load): the cached value, or on a miss await load(key), store it and return it.
async function readThrough(cache, key, load) {
  // TODO
}

// A simulated hour: the price changes at minute 30, and the cache's TTL is 10 minutes.
let clock = 0;
const cache = createCache({ ttlMs: 10 * 60_000, now: () => clock });
let price = 1999;
for (const minute of [0, 5, 20, 31, 45]) {
  clock = minute * 60_000;
  if (minute === 31) price = 1499;
  const value = await readThrough(cache, "price:42", async () => price);
  console.log("minute " + minute + ": price shown " + value);
}
console.log(cache.stats());
`,
    solution: `function createCache({ ttlMs, now }) {
  const entries = new Map();
  let hits = 0, misses = 0;
  return {
    get(key) {
      const entry = entries.get(key);
      // has() and the age check, not "if (entry.value)": 0 and "" are real values.
      if (entry !== undefined && now() - entry.storedAt < ttlMs) { hits++; return entry.value; }
      if (entry !== undefined) entries.delete(key); // expired
      misses++;
      return undefined;
    },
    set(key, value) { entries.set(key, { value, storedAt: now() }); },
    invalidate(key) { entries.delete(key); },
    stats() { return { hits, misses }; },
  };
}

async function readThrough(cache, key, load) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const value = await load(key);
  cache.set(key, value);
  return value;
}

let clock = 0;
const cache = createCache({ ttlMs: 10 * 60_000, now: () => clock });
let price = 1999;
for (const minute of [0, 5, 20, 31, 45]) {
  clock = minute * 60_000;
  if (minute === 31) price = 1499;
  const value = await readThrough(cache, "price:42", async () => price);
  console.log("minute " + minute + ": price shown " + value);
}
console.log(cache.stats());
`,
    exports: ["createCache", "readThrough"],
    tests: `
function setup(ttlMs = 1000) {
  const clock = { t: 0 };
  return { clock, cache: lab.createCache({ ttlMs, now: () => clock.t }) };
}
test("a miss, then a hit", () => {
  const { cache } = setup();
  assert.equal(cache.get("a"), undefined, "get before set");
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1, "get after set");
  assert.equal(cache.stats(), { hits: 1, misses: 1 }, "stats()");
});
test("falsy values such as 0 are still hits", () => {
  const { cache } = setup();
  cache.set("zero", 0);
  assert.equal(cache.get("zero"), 0, "get of a cached 0");
  assert.equal(cache.stats().hits, 1, "hits after reading a cached 0");
});
test("an entry is fresh just before ttlMs and stale at ttlMs", () => {
  const { cache, clock } = setup(1000);
  cache.set("a", "v1");
  clock.t = 999;
  assert.equal(cache.get("a"), "v1", "get at 999 ms (ttl 1000)");
  clock.t = 1000;
  assert.equal(cache.get("a"), undefined, "get at 1000 ms (ttl 1000)");
  assert.equal(cache.stats(), { hits: 1, misses: 1 }, "stats()");
});
test("set again restarts the clock for that key", () => {
  const { cache, clock } = setup(1000);
  cache.set("a", "v1");
  clock.t = 800; cache.set("a", "v2");
  clock.t = 1500;
  assert.equal(cache.get("a"), "v2", "get 700 ms after the second set");
});
test("invalidate makes the next get a miss; other keys stay", () => {
  const { cache } = setup();
  cache.set("a", 1); cache.set("b", 2);
  cache.invalidate("a");
  assert.equal(cache.get("a"), undefined, "get after invalidate");
  assert.equal(cache.get("b"), 2, "another key after invalidating a");
});
test("readThrough loads once, then serves from the cache", async () => {
  const { cache } = setup();
  let loads = 0;
  const load = async (key) => { loads++; return key.toUpperCase(); };
  assert.equal(await lab.readThrough(cache, "x", load), "X", "first read");
  assert.equal(await lab.readThrough(cache, "x", load), "X", "second read");
  assert.equal(loads, 1, "times load() was called for two reads");
});
test("readThrough loads again after expiry and after invalidation", async () => {
  const { cache, clock } = setup(1000);
  let version = 1, loads = 0;
  const load = async () => { loads++; return "v" + version; };
  await lab.readThrough(cache, "k", load);
  version = 2; clock.t = 1000;
  assert.equal(await lab.readThrough(cache, "k", load), "v2", "read after the TTL passed");
  version = 3; cache.invalidate("k");
  assert.equal(await lab.readThrough(cache, "k", load), "v3", "read after invalidate");
  assert.equal(loads, 3, "load() calls");
});
`,
    timeoutMs: 3000,
    hints: [
      "Run the starter. After minute 31 the price is 1499, but the cache keeps showing 1999: get() never looks at storedAt.",
      "In get(), a value is fresh only if now() - entry.storedAt < ttlMs.",
      "Test 'falsy values' fails if you write if (entry.value). Compare with undefined instead.",
      "readThrough: const cached = cache.get(key); if it's not undefined return it; otherwise await load(key), cache.set, and return the value.",
    ],
  },
  {
    kind: "code",
    id: "retries-timeouts",
    version: 1,
    subject: "architecture",
    title: "Bounded retries with backoff and timeouts",
    summary: "Implement retries that stop, wait longer each time and never repeat unsafe operations, plus a timeout.",
    difficulty: "advanced",
    minutes: 25,
    modes: ["real-execution"],
    modeNote: "Your retry and timeout code really runs with real delays. The failing service is a scripted stand-in in the sandbox (it fails a set number of times), so every run fails the same way.",
    objective: "Retry transient failures a bounded number of times with exponential backoff, give up with the last error, never retry a non-idempotent operation automatically, and abandon a call that takes too long.",
    problem: "A checkout calls a payment service that sometimes fails for a moment. Without retries, customers see errors; with careless retries, an outage turns into a flood, and a retried charge bills a customer twice.",
    build: "Fix retry(operation, { attempts, delayMs, idempotent }) and write withTimeout(promise, ms).",
    canChange: "Everything in retry.js.",
    tools: "Run prints each attempt with its measured time. Check uses scripted operations and measures the delays between your attempts.",
    verify: "Run the starter: an operation that never succeeds is retried forever, until Kitab's time limit stops it.",
    success: "All tests pass: success stops retrying, attempts are bounded, delays double, non-idempotent operations run once, and a slow call times out.",
    computer: [
      ...codeSteps,
      { title: "Waiting doesn't block", detail: "await sleep(ms) hands control back to the event loop; a timer resumes your function later. Nothing spins while it waits.", observed: false },
    ],
    configs: [
      {
        name: "Retry policy",
        what: "How many times a failed call is tried again, and how long to wait between tries.",
        why: "Many failures are momentary (a restart, a dropped connection). A retry hides them from users.",
        where: "Client libraries and service meshes: Polly in .NET, resilience4j in Java, the AWS SDK's maxAttempts, Envoy's retry_policy.",
        who: "The team that owns the calling service.",
        change: "In the client's configuration; for example AWS SDK: maxAttempts: 3.",
        verify: "Fail the dependency on purpose and count attempts in logs or metrics.",
        effect: "More attempts hide more failures but multiply load during an outage (a retry storm). Backoff and jitter spread retries out.",
        kitab: "Real: your retry loop and its measured delays. Modeled: the dependency, scripted to fail a fixed number of times.",
        example: { label: "Representative: Envoy proxy route retry policy", code: "retry_policy:\n  retry_on: 5xx,connect-failure\n  num_retries: 2\n  retry_back_off: { base_interval: 0.1s, max_interval: 1s }" },
      },
      {
        name: "Timeout",
        what: "How long a caller waits for a response before giving up.",
        why: "Without one, a hung dependency holds the caller's threads or connections forever.",
        where: "HTTP clients (HttpClient.Timeout, axios timeout), database drivers (statement timeouts), gateways (proxy_read_timeout).",
        who: "The calling service's team; gateways' operators.",
        change: "Client configuration; for example new HttpClient { Timeout = TimeSpan.FromSeconds(2) }.",
        verify: "Point the client at a slow endpoint and confirm it fails after the timeout.",
        effect: "Too short fails healthy-but-slow calls; too long ties up resources. A timeout says nothing about whether the server did the work.",
        kitab: "Real: your withTimeout and real timers.",
      },
    ],
    terms: ["retry", "idempotency", "breaker"],
    related: [
      { label: "Learn: timeouts, backoff and circuit breakers", path: "/learn/system-design/resilience", kind: "learn" },
      { label: "Learn: idempotency and safe retries", path: "/learn/system-design/idempotency", kind: "learn" },
      { label: "Lab: stop a retry storm (model)", path: "/practice/architecture/labs/retry-storm", kind: "practice" },
    ],
    stages: [{ track: "system-design", stage: "reliability" }, { track: "system-design", stage: "resilience" }],
    file: "retry.js",
    starter: `// retry(operation, { attempts, delayMs, idempotent }):
//   Calls operation(attempt) with attempt = 1, 2, ... until it resolves. At most attempts calls in total.
//   Before retry n (n = 1, 2, ...), waits delayMs * 2^(n-1): delayMs, then 2x, then 4x...
//   If idempotent is false, calls once only and passes any error on: repeating it could do the work twice.
//   If every attempt fails, rejects with the last error.
async function retry(operation, { attempts, delayMs, idempotent = true }) {
  let attempt = 1;
  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      attempt++;
    }
  }
}

// withTimeout(promise, ms): settles like promise, or rejects with an Error whose name is "TimeoutError" after ms.
function withTimeout(promise, ms) {
  // TODO
  return promise;
}

// A payment service that is down for good. How many times is it called?
let calls = 0;
const started = performance.now();
const down = async (attempt) => {
  calls++;
  if (calls <= 20) console.log("attempt " + attempt + " at " + Math.round(performance.now() - started) + " ms");
  throw new Error("503 Service Unavailable");
};
try {
  await retry(down, { attempts: 4, delayMs: 50 });
} catch (error) {
  console.log("gave up after " + calls + " calls: " + error.message);
}
`,
    solution: `async function retry(operation, { attempts, delayMs, idempotent = true }) {
  const limit = idempotent ? attempts : 1;
  let lastError;
  for (let attempt = 1; attempt <= limit; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < limit) await sleep(delayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Timed out after " + ms + " ms");
      error.name = "TimeoutError";
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let calls = 0;
const started = performance.now();
const down = async (attempt) => {
  calls++;
  if (calls <= 20) console.log("attempt " + attempt + " at " + Math.round(performance.now() - started) + " ms");
  throw new Error("503 Service Unavailable");
};
try {
  await retry(down, { attempts: 4, delayMs: 50 });
} catch (error) {
  console.log("gave up after " + calls + " calls: " + error.message);
}
`,
    exports: ["retry", "withTimeout"],
    tests: `
// A scripted service: fails the first failures calls, then succeeds. Records when each call happened.
function service(failures) {
  const s = { calls: [], times: [] };
  const t0 = performance.now();
  s.op = async (attempt) => {
    s.calls.push(attempt);
    s.times.push(performance.now() - t0);
    if (s.calls.length <= failures) throw new Error("failure " + s.calls.length);
    return "ok on call " + s.calls.length;
  };
  return s;
}
test("success on the first try: called once", async () => {
  const s = service(0);
  assert.equal(await lab.retry(s.op, { attempts: 3, delayMs: 10 }), "ok on call 1", "result");
  assert.equal(s.calls.length, 1, "calls");
});
test("two transient failures, then success", async () => {
  const s = service(2);
  assert.equal(await lab.retry(s.op, { attempts: 5, delayMs: 10 }), "ok on call 3", "result");
  assert.equal(s.calls, [1, 2, 3], "attempt numbers passed to the operation");
});
test("never more than attempts calls, then the last error", async () => {
  const s = service(Infinity);
  await assert.rejects(() => lab.retry(s.op, { attempts: 3, delayMs: 5 }), /failure 3/, "should reject with the third (last) error");
  assert.equal(s.calls.length, 3, "calls with attempts: 3");
});
test("delays double between attempts (measured)", async () => {
  const s = service(Infinity);
  await lab.retry(s.op, { attempts: 3, delayMs: 40 }).catch(() => {});
  const first = s.times[1] - s.times[0], second = s.times[2] - s.times[1];
  assert.ok(first >= 35, "wait before the 2nd attempt was " + Math.round(first) + " ms; expected about 40");
  assert.ok(second >= 75, "wait before the 3rd attempt was " + Math.round(second) + " ms; expected about 80");
  assert.ok(second < 400, "wait before the 3rd attempt was " + Math.round(second) + " ms; expected about 80");
});
test("a non-idempotent operation is never retried automatically", async () => {
  const s = service(1);
  await assert.rejects(() => lab.retry(s.op, { attempts: 5, delayMs: 5, idempotent: false }), /failure 1/, "should pass the first error on");
  assert.equal(s.calls.length, 1, "calls of a non-idempotent operation");
});
test("withTimeout passes a fast result through", async () => {
  assert.equal(await lab.withTimeout(sleep(5).then(() => "fast"), 200), "fast", "result");
});
test("withTimeout passes a rejection through", async () => {
  await assert.rejects(() => lab.withTimeout(Promise.reject(new Error("boom")), 200), /boom/, "should reject with the original error");
});
test("withTimeout rejects a slow call with a TimeoutError, on time (measured)", async () => {
  const t = performance.now();
  let error = null;
  try { await lab.withTimeout(sleep(600), 50); } catch (e) { error = e; }
  const took = performance.now() - t;
  assert.ok(error && error.name === "TimeoutError", "expected an error named TimeoutError, got " + (error ? error.name : "no error"));
  assert.ok(took < 400, "the timeout fired after " + Math.round(took) + " ms; expected about 50");
});
`,
    timeoutMs: 6000,
    hints: [
      "Run the starter: it's stopped at the time limit. while (true) never gives up.",
      "Loop from attempt 1 to attempts. Remember the error each time; after the loop, throw the last one.",
      "Wait only between attempts: if (attempt < limit) await sleep(delayMs * 2 ** (attempt - 1)).",
      "If idempotent is false, the limit is 1. For withTimeout, race the promise against a timer that rejects with an Error whose name you set to 'TimeoutError'.",
    ],
  },
  {
    kind: "code",
    id: "troubleshooting",
    version: 1,
    subject: "architecture",
    title: "Troubleshoot a misbehaving API handler",
    summary: "Users report wrong users, missing 404s and confusing errors. Reproduce each report, find the cause and fix it.",
    difficulty: "intermediate",
    minutes: 25,
    modes: ["real-execution"],
    modeNote: "The handler is your code and runs for real; requests are plain objects passed to it, so no network is involved. The live HTTP version of routing is in 'Follow a request through an API'.",
    objective: "Reproduce a bug report from observed behaviour, find the faulty assumption (here, in a route pattern and status codes), fix it, and verify every report.",
    problem: "Support tickets: 'Asking for user 42 shows Ada (user 4).' 'A user that doesn't exist returns 200 with nothing.' 'DELETE says Not Found, but the user exists.' '/users/4/orders shows a user instead of 404.'",
    build: "Fix handle(request) so each ticket is resolved: correct user ids, 404 for a missing user, 405 with an Allow: GET header for other methods, and 404 for paths that only start like a user path.",
    canChange: "Everything in app.js. The requests at the bottom reproduce the tickets.",
    tools: "Run prints the response to each ticket's request. Check sends those and more.",
    verify: "Run and compare each line with the ticket. Fix one cause, Run again, then Check.",
    success: "All tests pass: right users, real 404s, 405 with Allow, and JSON everywhere.",
    computer: codeSteps.slice(0, 2),
    configs: [],
    terms: [],
    related: [
      { label: "Lab: follow a real request through an API", path: "/lab/architecture/api-request-flow", kind: "practice" },
      { label: "Learn: clients, servers and databases", path: "/learn/system-design/fundamentals", kind: "learn" },
    ],
    stages: [{ track: "system-design", stage: "production" }],
    file: "app.js",
    starter: `const users = new Map([
  [4, { id: 4, name: "Ada" }],
  [42, { id: 42, name: "Grace" }],
]);
const json = { "content-type": "application/json" };

// handle({ method, path }) returns { status, headers, body }.
function handle(request) {
  const match = /^\\/users\\/(\\d)/.exec(request.path);
  if (match) {
    if (request.method === "GET") {
      const user = users.get(Number(match[1]));
      return { status: 200, headers: json, body: user ?? null };
    }
  }
  return { status: 404, headers: json, body: { error: "Not found" } };
}

// The support tickets, reproduced:
for (const request of [
  { method: "GET", path: "/users/42" },
  { method: "GET", path: "/users/7" },
  { method: "DELETE", path: "/users/4" },
  { method: "GET", path: "/users/4/orders" },
]) {
  const response = handle(request);
  console.log(request.method, request.path, "->", response.status, JSON.stringify(response.headers), JSON.stringify(response.body));
}
`,
    solution: `const users = new Map([
  [4, { id: 4, name: "Ada" }],
  [42, { id: 42, name: "Grace" }],
]);
const json = { "content-type": "application/json" };

function handle(request) {
  // One or more digits, then the end of the path: /users/42 but not /users/4/orders.
  const match = /^\\/users\\/(\\d+)$/.exec(request.path);
  if (!match) return { status: 404, headers: json, body: { error: "Not found" } };
  if (request.method !== "GET") {
    return { status: 405, headers: { ...json, allow: "GET" }, body: { error: "Method not allowed" } };
  }
  const user = users.get(Number(match[1]));
  if (!user) return { status: 404, headers: json, body: { error: "No such user" } };
  return { status: 200, headers: json, body: user };
}

for (const request of [
  { method: "GET", path: "/users/42" },
  { method: "GET", path: "/users/7" },
  { method: "DELETE", path: "/users/4" },
  { method: "GET", path: "/users/4/orders" },
]) {
  const response = handle(request);
  console.log(request.method, request.path, "->", response.status, JSON.stringify(response.headers), JSON.stringify(response.body));
}
`,
    exports: ["handle"],
    tests: `
const get = (path) => lab.handle({ method: "GET", path });
test("GET /users/4 returns Ada", () => {
  const r = get("/users/4");
  assert.equal([r.status, r.body && r.body.name], [200, "Ada"], "status and name for /users/4");
});
test("GET /users/42 returns Grace, not Ada", () => {
  const r = get("/users/42");
  assert.equal([r.status, r.body && r.body.name], [200, "Grace"], "status and name for /users/42");
});
test("a user that doesn't exist is 404", () => {
  assert.equal(get("/users/7").status, 404, "status for /users/7");
});
test("other methods on a user are 405 with Allow: GET", () => {
  const r = lab.handle({ method: "DELETE", path: "/users/4" });
  assert.equal(r.status, 405, "status for DELETE /users/4");
  assert.equal(r.headers && (r.headers.allow || r.headers.Allow), "GET", "Allow header for DELETE /users/4");
});
test("paths that only start like a user path are 404", () => {
  for (const path of ["/users/4/orders", "/users/abc", "/users/", "/users/42x"]) assert.equal(get(path).status, 404, "status for " + path);
});
test("every response says it's JSON", () => {
  for (const path of ["/users/4", "/users/7", "/nope"]) {
    const h = get(path).headers || {};
    assert.equal(h["content-type"], "application/json", "content-type for " + path);
  }
});
`,
    timeoutMs: 2000,
    hints: [
      "Run it. /users/42 shows Ada: the pattern (\\d) captures one digit only, so 42 becomes 4.",
      "\\d+ matches one or more digits; $ makes the pattern end there, so /users/4/orders no longer matches.",
      "users.get() returns undefined for a missing id: return a 404 instead of 200 with null.",
      "When the path matches but the method isn't GET, return 405 with headers that include allow: \"GET\".",
    ],
  },
];
