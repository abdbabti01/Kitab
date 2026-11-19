// Every Engineering Lab is checked against the real thing it claims to use: each code lab's worked solution passes
// all its tests in the real harness and its starter does not; each HTTP task's solution passes its checks against
// the real Worker handler and its starter does not. Links, terms and track units must exist.
import assert from "node:assert/strict";
import test from "node:test";
import { futureLabs, labs, labsForStage } from "../src/lab/catalog.ts";
import { draft, labPath, received, type HttpTask, type Observation, type RequestDraft } from "../src/lab/model.ts";
import { allPassed } from "../src/lab/sandbox.ts";
import { buildHeaders, labUrl } from "../src/lab/http.ts";
import { parseRoute } from "../src/app/routes.ts";
import { tracks } from "../src/learning/tracks.ts";
import { glossary } from "../src/learning/glossary.ts";
import { handleLab } from "../worker/lab.ts";
import { runInNode } from "./support/harness-node.ts";

const ORIGIN = "http://lab.test";

/** Send a draft to the real Worker handler, the way sendRequest does in the browser (minus timing). */
async function exchange(d: RequestDraft): Promise<Observation> {
  const at = Date.now();
  const target = labUrl(d.path, ORIGIN);
  const sent = { method: d.method, url: "", path: d.path.trim(), headers: [] as [string, string][], body: "", timeoutMs: d.timeoutMs, cache: d.cache };
  if ("error" in target) return { at, request: sent, outcome: "refused", error: target.error, elapsedMs: 0 };
  const built = buildHeaders(d.headers);
  if ("error" in built) return { at, request: sent, outcome: "refused", error: built.error, elapsedMs: 0 };
  if (["GET", "HEAD"].includes(d.method) && d.body) return { at, request: sent, outcome: "refused", error: "body on GET", elapsedMs: 0 };
  const hasBody = !["GET", "HEAD"].includes(d.method) && d.body !== "";
  if (hasBody && !built.headers.has("content-type")) built.headers.set("content-type", "text/plain;charset=UTF-8"); // what fetch adds for a string body
  Object.assign(sent, { url: target.url.href, headers: [...built.headers], body: hasBody ? d.body : "" });
  const slow = /\/api\/lab\/slow/.test(target.url.pathname) ? Number(target.url.searchParams.get("ms")) : 0;
  if (slow > d.timeoutMs) return { at, request: sent, outcome: "timeout", error: "timeout", elapsedMs: d.timeoutMs };
  const url = new URL(target.url);
  if (slow) url.searchParams.set("ms", "1"); // the delay itself isn't under test here
  const response = await handleLab(new Request(url, { method: d.method, headers: built.headers, body: hasBody ? d.body : undefined }));
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    at,
    request: sent,
    outcome: "response",
    response: { status: response.status, statusText: "", headers: [...response.headers], body: text, json, redirected: false, url: url.href, truncated: false },
    timing: null,
    elapsedMs: 1,
  };
}

const passes = (task: HttpTask, history: Observation[]) => {
  const latest = history.at(-1)!;
  const checks = task.checks.every((c) => c.test(latest, history));
  const question = !task.question || task.question.answer(history) !== null;
  return checks && question;
};

test("lab ids are unique, paths route to the lab page, and versions are positive", () => {
  assert.equal(new Set(labs.map((l) => l.id)).size, labs.length);
  assert.equal(new Set(futureLabs.map((l) => l.id)).size, futureLabs.length);
  for (const lab of labs) {
    assert.deepEqual(parseRoute(labPath(lab)), { name: "engineering-lab", subject: lab.subject, id: lab.id }, lab.id);
    assert.ok(lab.version >= 1, lab.id);
    assert.ok(lab.modes.length > 0 && !lab.modes.includes("unavailable"), `${lab.id} must run here`);
  }
  assert.deepEqual(parseRoute("/lab"), { name: "engineering-labs" });
});

test("every subject has five labs, and every lab explains itself completely", () => {
  for (const subject of ["networking", "structures", "architecture"] as const) assert.equal(labs.filter((l) => l.subject === subject).length, 5, subject);
  for (const lab of labs) {
    for (const field of ["objective", "problem", "build", "canChange", "tools", "verify", "success", "modeNote", "summary"] as const) assert.ok(lab[field].trim().length > 20, `${lab.id}.${field}`);
    assert.ok(lab.computer.length >= 2, `${lab.id} explains what the computer does`);
    assert.ok(lab.computer.some((s) => s.observed), `${lab.id} links an explanation to real evidence`);
    for (const c of lab.configs) for (const k of ["what", "why", "where", "who", "change", "verify", "effect", "kitab"] as const) assert.ok(c[k].length > 10, `${lab.id} config ${c.name}.${k}`);
    for (const term of lab.terms) assert.ok(glossary[term], `${lab.id} term ${term}`);
  }
});

test("related links resolve to real pages, and unit links name real track units", () => {
  for (const lab of labs) {
    for (const link of lab.related) {
      const path = link.path.split(/[?#]/)[0];
      assert.notEqual(parseRoute(path).name, "not-found", `${lab.id} → ${link.path}`);
    }
    for (const s of lab.stages) {
      const track = tracks.find((t) => t.id === s.track);
      assert.ok(track?.stages.some((stage) => stage.id === s.stage), `${lab.id} → ${s.track}/${s.stage}`);
    }
  }
  assert.ok(labsForStage("networking", "internet").length >= 3);
  assert.ok(labsForStage("data-structures", "arrays").some((l) => l.id === "arrays"));
});

for (const lab of labs) {
  if (lab.kind !== "code") continue;
  test(`code lab ${lab.id}: the worked solution passes every test in the real harness`, async () => {
    const outcome = await runInNode({ mode: "check", code: lab.solution, exports: lab.exports, tests: lab.tests, timeoutMs: lab.timeoutMs + 4000 });
    assert.equal(outcome.status, "finished", JSON.stringify(outcome.error));
    const failed = outcome.tests.filter((t) => !t.passed);
    assert.deepEqual(failed, [], failed.map((t) => `${t.name}: ${t.message}`).join("\n"));
    assert.ok(outcome.tests.length >= 4, `${lab.id} has at least four tests`);
    assert.ok(allPassed(outcome));
  });
  test(`code lab ${lab.id}: the starter does not pass (completion needs real work)`, async () => {
    const outcome = await runInNode({ mode: "check", code: lab.starter, exports: lab.exports, tests: lab.tests, timeoutMs: lab.timeoutMs });
    assert.equal(allPassed(outcome), false);
  });
  test(`code lab ${lab.id}: the starter runs and prints something`, async () => {
    const outcome = await runInNode({ mode: "run", code: lab.starter, exports: lab.exports, tests: "", timeoutMs: lab.timeoutMs });
    assert.ok(outcome.logs.length > 0 || outcome.status !== "finished", `${lab.id} Run shows output`);
    assert.notEqual(outcome.error?.kind, "syntax");
  });
}

for (const lab of labs) {
  if (lab.kind !== "http") continue;
  for (const task of lab.tasks) {
    // The browser cache can't be reproduced outside a browser: this task is covered by the browser tests.
    if (task.id === "browser-cache") continue;
    test(`HTTP lab ${lab.id}/${task.id}: the solution passes against the real handler; the starter doesn't`, async () => {
      const history = [await exchange(task.solution), await exchange(task.solution)];
      assert.ok(passes(task, history), `${lab.id}/${task.id} solution: ${JSON.stringify(history.at(-1)?.response?.status ?? history.at(-1)?.error)}`);
      // An observation task (send this and read it) starts ready to send; any other starter must need fixing.
      if (JSON.stringify(task.starter) !== JSON.stringify(task.solution)) {
        assert.equal(passes(task, [await exchange(task.starter)]), false, `${lab.id}/${task.id} starter already passes`);
      }
      // Nothing passes without a real response.
      const refused: Observation = { at: 0, request: history[0].request, outcome: "refused", error: "x", elapsedMs: 0 };
      assert.equal(task.checks.every((c) => c.test(refused, [refused])), false, `${lab.id}/${task.id} passes with no response`);
    });
  }
}

test("the troubleshooting order task fails in sequence, one real fault at a time", async () => {
  const task = labs.find((l) => l.id === "http-troubleshooting" && l.kind === "http")!;
  const order = task.kind === "http" ? task.tasks[0] : undefined;
  assert.ok(order);
  const json = { name: "Content-Type", value: "application/json" };
  const steps: [RequestDraft, string | number][] = [
    [order.starter, "refused"],
    [{ ...order.starter, method: "POST" }, 404],
    [{ ...order.starter, method: "POST", path: "/api/lab/orders" }, 415],
    [{ ...order.starter, method: "POST", path: "/api/lab/orders", headers: [...order.starter.headers, json] }, 500],
    [{ ...order.starter, method: "POST", path: "/api/lab/orders", headers: [{ name: "X-Api-Version", value: "2" }, json] }, 422],
    [order.solution, 201],
  ];
  for (const [d, expected] of steps) {
    const o = await exchange(d);
    assert.equal(o.outcome === "refused" ? "refused" : o.response?.status, expected, `${d.method} ${d.path}`);
  }
});

test("POST without Content-Type reaches the echo as text/plain, as fetch sends it", async () => {
  const o = await exchange(draft("POST", "/api/lab/echo", { body: '{"name":"Ada"}' }));
  assert.equal(received(o)?.headers["content-type"], "text/plain;charset=UTF-8");
  assert.equal(received(o)?.body.json, undefined);
});

test("only paths under /api/lab/ on the same origin can be sent", () => {
  for (const bad of ["https://evil.test/api/lab/echo", "//evil.test/api/lab/echo", "/api/tutor", "/api/concept", "api/lab/echo", "/api/labx/echo", "/api/lab/../tutor"]) {
    assert.ok("error" in labUrl(bad, ORIGIN), bad);
  }
  assert.ok("url" in labUrl("/api/lab/echo?x=1", ORIGIN));
});

test("invalid header names are refused before sending, with the reason", () => {
  const result = buildHeaders([{ name: "X Api Version", value: "2" }]);
  assert.ok("error" in result && /refused/.test(result.error));
  assert.ok("headers" in buildHeaders([{ name: "", value: "" }, { name: "X-Ok", value: "1" }]));
});
