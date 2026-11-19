// The sandbox's protocol: message shapes, the frame document, and what counts as passing. The launcher that
// creates the frame is src/lab/run.ts (it needs the DOM).
//
// Learner code runs in isolation. Each run gets a fresh <iframe sandbox="allow-scripts"> (an opaque origin: no
// access to Kitab's storage, cookies or DOM) whose CSP blocks every network request, and the code runs in a Worker
// inside it so a busy loop never blocks this page. The run ends, and the frame is removed (terminating the Worker),
// on completion, an error, the time limit, stop(), or the page being left. Messages are accepted only from the
// current frame with the current run id, and only in the expected shape.
import { z } from "zod";
import { harnessSource } from "./harness.ts";

export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:";
/** Messages one run may send before it is stopped, so a flood can't swamp the page. */
const MAX_MESSAGES = 600;

export const sandboxMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("log"), level: z.enum(["log", "warn", "error"]), text: z.string().max(25_000) }),
  z.object({ type: z.literal("test-start"), name: z.string().max(300) }),
  z.object({ type: z.literal("test"), name: z.string().max(300), passed: z.boolean(), message: z.string().max(5_000) }),
  z.object({ type: z.literal("error"), kind: z.enum(["syntax", "runtime", "internal", "unsupported", "flood"]), name: z.string().max(200).optional(), message: z.string().max(5_000), line: z.number().int().nullable().optional() }),
  z.object({ type: z.literal("done"), ms: z.number().optional(), value: z.string().max(25_000).optional() }),
]);
export type SandboxMessage = z.infer<typeof sandboxMessage>;

export type LogLine = { level: "log" | "warn" | "error"; text: string };
export type TestResult = { name: string; passed: boolean; message: string };
export type RunError = { kind: "syntax" | "runtime" | "internal" | "unsupported" | "flood"; name?: string; message: string; line?: number | null };
export type RunStatus = "finished" | "error" | "timeout" | "stopped" | "unsupported";
export type RunOutcome = {
  mode: "run" | "check";
  status: RunStatus;
  logs: LogLine[];
  tests: TestResult[];
  /** The test that was running when the time limit hit, if any. */
  pendingTest?: string;
  error?: RunError;
  value?: string;
  ms?: number;
  timeoutMs: number;
};

export type RunJob = { mode: "run" | "check"; code: string; exports: string[]; tests: string; timeoutMs: number };

/** The frame's whole document. It relays one job to a Worker and the Worker's messages back, capped. */
export function frameDocument(runId: string, parentOrigin: string) {
  // JSON inside a script element: "<" escaped so no value can close the element.
  const js = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c");
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><script>
const runId = ${js(runId)}, to = ${js(parentOrigin)}, harness = ${js(harnessSource)};
let worker = null, count = 0;
const send = (data) => parent.postMessage(Object.assign({}, data, { runId }), to);
onmessage = (event) => {
  if (event.source !== parent || worker) return;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([harness], { type: "text/javascript" })));
  } catch (error) {
    return send({ type: "error", kind: "unsupported", message: String(error && error.message || error) });
  }
  worker.onmessage = (e) => {
    count += 1;
    if (count > ${MAX_MESSAGES}) {
      if (count === ${MAX_MESSAGES} + 1) { worker.terminate(); send({ type: "error", kind: "flood", message: "Your program sent too many messages too fast, so it was stopped." }); send({ type: "done" }); }
      return;
    }
    if (e.data && typeof e.data === "object") send(e.data);
  };
  worker.onerror = (e) => { e.preventDefault(); send({ type: "error", kind: "runtime", name: "Error", message: e.message || "The program failed.", line: null }); send({ type: "done" }); };
  worker.postMessage(event.data);
};
send({ type: "ready" });
</script>`;
}

/** All tests ran and passed: the only way a code lab is completed. */
export const allPassed = (outcome: RunOutcome, expectedTests?: number) =>
  outcome.mode === "check" && outcome.status === "finished" && outcome.tests.length > 0 && outcome.tests.every((t) => t.passed) && (expectedTests === undefined || outcome.tests.length === expectedTests);
