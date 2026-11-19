// Runs the Engineering Lab harness (the exact source the browser sandbox runs) in a Node worker thread, with the
// same message protocol, so lab content and harness behaviour can be tested without a browser. A worker thread
// is not the browser's isolation boundary; this exists only for tests.
import { Worker } from "node:worker_threads";
import { harnessSource } from "../../src/lab/harness.ts";
import type { RunJob, RunOutcome, SandboxMessage } from "../../src/lab/sandbox.ts";

export function runInNode(job: RunJob): Promise<RunOutcome & { messages: SandboxMessage[] }> {
  const bootstrap = `
const { parentPort } = require("node:worker_threads");
globalThis.self = globalThis;
globalThis.postMessage = (m) => parentPort.postMessage(m);
process.on("unhandledRejection", (reason) => globalThis.onunhandledrejection && globalThis.onunhandledrejection({ reason, preventDefault() {} }));
parentPort.once("message", (data) => globalThis.onmessage({ data }));
${harnessSource}`;
  const worker = new Worker(bootstrap, { eval: true });
  const outcome: RunOutcome & { messages: SandboxMessage[] } = { mode: job.mode, status: "finished", logs: [], tests: [], timeoutMs: job.timeoutMs, messages: [] };
  return new Promise((resolve) => {
    let finished = false;
    const finish = (status: RunOutcome["status"]) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      outcome.status = status;
      resolve(outcome);
    };
    const timer = setTimeout(() => finish("timeout"), job.timeoutMs);
    worker.on("message", (m: SandboxMessage) => {
      outcome.messages.push(m);
      if (m.type === "log") outcome.logs.push({ level: m.level, text: m.text });
      else if (m.type === "test-start") outcome.pendingTest = m.name;
      else if (m.type === "test") outcome.tests.push({ name: m.name, passed: m.passed, message: m.message });
      else if (m.type === "error") outcome.error = { kind: m.kind, name: m.name, message: m.message, line: m.line ?? null };
      else if (m.type === "done") (outcome.value = m.value), finish(outcome.error ? "error" : "finished");
    });
    worker.on("error", (error) => ((outcome.error = { kind: "runtime", message: String(error) }), finish("error")));
    worker.postMessage({ mode: job.mode, code: job.code, exports: job.exports, tests: job.tests });
  });
}
