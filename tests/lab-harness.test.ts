// The sandbox harness's own behaviour (the exact source the browser runs), in a Node worker: output capture and
// caps, syntax and runtime errors with the learner's line, early returns, unhandled rejections, removed network
// globals, test reporting, and stopping a run that never finishes. Plus the frame document the browser uses.
import assert from "node:assert/strict";
import test from "node:test";
import { frameDocument, SANDBOX_CSP, allPassed } from "../src/lab/sandbox.ts";
import { runInNode } from "./support/harness-node.ts";

const run = (code: string, timeoutMs = 2000) => runInNode({ mode: "run", code, exports: [], tests: "", timeoutMs });
const check = (code: string, exports: string[], tests: string, timeoutMs = 2000) => runInNode({ mode: "check", code, exports, tests, timeoutMs });

test("console output is captured in order, with values formatted safely", async () => {
  const o = await run('const a = [1, "two", { x: null }]; a.push(a); console.log("hi", a); console.error(new TypeError("bad")); console.warn(new Map([[1, 2]]));');
  assert.equal(o.status, "finished");
  assert.deepEqual(o.logs, [
    { level: "log", text: 'hi [1, "two", {x: null}, [Circular]]' },
    { level: "error", text: "TypeError: bad" },
    { level: "warn", text: "Map(1) {1 => 2}" },
  ]);
});

test("a top-level return value is reported on Run, and top-level await works", async () => {
  const o = await run("await sleep(5); return { done: true };");
  assert.equal(o.value, "{done: true}");
});

test("output stops after 200 lines with a notice, and the program keeps running", async () => {
  const o = await run('for (let i = 0; i < 1000; i++) console.log(i); return "end";');
  assert.equal(o.logs.length, 201);
  assert.match(o.logs.at(-1)!.text, /Output stopped/);
  assert.equal(o.value, '"end"');
});

test("a syntax error is reported as such, before anything runs", async () => {
  const o = await run('console.log("never");\nfunction (');
  assert.equal(o.error?.kind, "syntax");
  assert.equal(o.error?.name, "SyntaxError");
  assert.equal(o.logs.length, 0);
});

test("a runtime error names the learner's own line", async () => {
  const o = await run('const a = 1;\nconsole.log("before");\nmissingFunction();\n');
  assert.equal(o.error?.kind, "runtime");
  assert.equal(o.error?.name, "ReferenceError");
  assert.equal(o.error?.line, 3);
  assert.deepEqual(o.logs, [{ level: "log", text: "before" }]);
});

test("network and storage globals are removed inside the sandbox (defence in depth)", async () => {
  const o = await run('console.log(typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof importScripts, typeof indexedDB);');
  assert.equal(o.logs[0].text, "undefined undefined undefined undefined undefined");
});

test("an unhandled rejection is shown, not swallowed", async () => {
  const o = await run('Promise.reject(new Error("lost")); await sleep(20);');
  assert.ok(o.logs.some((l) => l.level === "error" && /Unhandled promise rejection: Error: lost/.test(l.text)));
});

test("an infinite loop never reports done: the run is stopped at the time limit", async () => {
  const started = Date.now();
  const o = await run("while (true) {}", 300);
  assert.equal(o.status, "timeout");
  assert.ok(Date.now() - started < 2000);
});

test("Check reports every test, with expected and received values for failures", async () => {
  const o = await check("function add(a, b) { return a - b; }", ["add"], 'test("adds", () => assert.equal(lab.add(2, 3), 5, "add(2, 3)")); test("zero", () => assert.equal(lab.add(0, 0), 0));');
  assert.equal(o.tests.length, 2);
  assert.equal(o.tests[0].passed, false);
  assert.match(o.tests[0].message, /add\(2, 3\)\n {2}expected: 5\n {2}received: -1/);
  assert.equal(o.tests[1].passed, true);
  assert.equal(allPassed(o), false);
});

test("an error thrown by the learner's function inside a test names their line", async () => {
  const o = await check("function f() {\n  return undefinedThing;\n}", ["f"], 'test("calls f", () => lab.f());');
  assert.match(o.tests[0].message, /ReferenceError: undefinedThing is not defined \(your line 2\)/);
});

test("a function that isn't defined reaches the tests as undefined, not a crash", async () => {
  const o = await check("const x = 1;", ["missing"], 'test("exists", () => assert.ok(typeof lab.missing === "function", "missing should be a function"));');
  assert.equal(o.status, "finished");
  assert.equal(o.tests[0].passed, false);
});

test("a top-level return makes Check explain why it can't reach the functions", async () => {
  const o = await check("function f() {}\nreturn 1;", ["f"], 'test("t", () => {});');
  assert.equal(o.error?.name, "Early return");
  assert.equal(o.tests.length, 0);
});

test("a Check with no tests, or a Run, never counts as passing", async () => {
  assert.equal(allPassed(await check("1;", [], "")), false);
  assert.equal(allPassed(await run("1;")), false);
});

test("the frame document: a restrictive CSP, no way to close its script early, and messages to the parent's origin only", () => {
  assert.equal(SANDBOX_CSP, "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:");
  assert.doesNotMatch(SANDBOX_CSP, /connect-src|allow/);
  const doc = frameDocument('run"</script><script>alert(1)', "https://kitab.test");
  assert.equal(doc.match(/<\/script>/g)?.length, 1);
  assert.match(doc, /parent\.postMessage\(Object\.assign\(\{\}, data, \{ runId \}\), to\)/);
  assert.match(doc, /if \(event\.source !== parent \|\| worker\) return;/);
});
