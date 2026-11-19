// Starts one isolated run in the browser: see sandbox.ts for the isolation model and the message protocol.
import { frameDocument, sandboxMessage, type RunError, type RunJob, type RunOutcome, type RunStatus } from "./sandbox.ts";

export function supportsSandbox() {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && "sandbox" in document.createElement("iframe");
}

/** Start one isolated run. onUpdate receives the outcome so far after every message; result settles once. */
export function startRun(job: RunJob, onUpdate: (outcome: RunOutcome) => void = () => undefined) {
  const outcome: RunOutcome = { mode: job.mode, status: "finished", logs: [], tests: [], timeoutMs: job.timeoutMs };
  let settle!: (value: RunOutcome) => void;
  const result = new Promise<RunOutcome>((resolve) => (settle = resolve));
  if (!supportsSandbox()) {
    settle({ ...outcome, status: "unsupported", error: { kind: "unsupported", message: "This browser can't run code in an isolated sandbox (it needs sandboxed iframes and Web Workers)." } });
    return { result, stop: () => undefined };
  }
  const runId = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.title = "Code sandbox";
  frame.className = "lab-sandbox-frame";
  frame.srcdoc = frameDocument(runId, window.location.origin);
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A frame that never says it's ready (blocked, crashed) is given up on, so a run can't hang forever.
  const startup = setTimeout(() => finish("unsupported", { kind: "unsupported", message: "The sandbox didn't start. Try again; if it keeps happening, this browser may block sandboxed frames." }), 8000);

  function finish(status: RunStatus, error?: RunError) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearTimeout(startup);
    window.removeEventListener("message", listen);
    frame.remove();
    outcome.status = status;
    if (error) outcome.error = error;
    if (status !== "timeout") delete outcome.pendingTest;
    onUpdate({ ...outcome });
    settle({ ...outcome, logs: [...outcome.logs], tests: [...outcome.tests] });
  }

  function listen(event: MessageEvent) {
    if (done || event.source !== frame.contentWindow) return;
    const data = event.data as { runId?: unknown } | null;
    if (!data || typeof data !== "object" || data.runId !== runId) return;
    const parsed = sandboxMessage.safeParse(data);
    if (!parsed.success) return; // not a shape Kitab sends: ignored, never rendered
    const m = parsed.data;
    if (m.type === "ready") {
      clearTimeout(startup);
      frame.contentWindow?.postMessage({ mode: job.mode, code: job.code, exports: job.exports, tests: job.tests }, "*");
      timer = setTimeout(() => finish("timeout"), job.timeoutMs);
      return;
    }
    if (m.type === "log") outcome.logs.push({ level: m.level, text: m.text });
    else if (m.type === "test-start") outcome.pendingTest = m.name;
    else if (m.type === "test") (outcome.tests.push({ name: m.name, passed: m.passed, message: m.message }), delete outcome.pendingTest);
    else if (m.type === "error") outcome.error = { kind: m.kind, name: m.name, message: m.message, line: m.line ?? null };
    else if (m.type === "done") {
      outcome.ms = m.ms;
      outcome.value = m.value;
      return finish(outcome.error ? (outcome.error.kind === "unsupported" ? "unsupported" : "error") : "finished", outcome.error);
    }
    onUpdate({ ...outcome, logs: [...outcome.logs], tests: [...outcome.tests] });
  }

  window.addEventListener("message", listen);
  document.body.append(frame);
  return { result, stop: () => finish("stopped") };
}

