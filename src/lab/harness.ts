// The program that runs inside the sandbox's Worker. It is shipped as source text (harnessSource) and must stay
// self-contained: no imports, no closures over this module. It compiles the learner's code, captures console
// output (capped), runs it, and on Check runs the lab's tests against the functions the lab names.
//
// None of this is a security boundary. The boundary is the opaque-origin sandboxed frame and its CSP (sandbox.ts);
// removing network globals here is defence in depth, and a learner can forge their own results (formative only).

/* eslint-disable */
export function harness() {
  const scope = self as unknown as Record<string, unknown> & { postMessage(message: unknown): void; onmessage: unknown; onunhandledrejection: unknown };
  const post = scope.postMessage.bind(scope);
  const MAX_LINES = 200;
  const MAX_CHARS = 20000;
  let lines = 0;
  let chars = 0;
  let full = false;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;

  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "importScripts", "indexedDB", "caches", "BroadcastChannel"]) {
    try {
      Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false });
    } catch {
      /* not present here */
    }
  }

  function format(value: unknown, depth = 0, seen: unknown[] = []): string {
    if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
    if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
    if (typeof value === "bigint") return `${value}n`;
    if (value === undefined || value === null || typeof value === "boolean" || typeof value === "symbol") return String(value);
    if (typeof value === "function") return `[Function ${(value as { name?: string }).name || "anonymous"}]`;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (seen.includes(value)) return "[Circular]";
    if (depth > 3) return Array.isArray(value) ? "[Array]" : "[Object]";
    const next = [...seen, value];
    if (Array.isArray(value)) {
      const items = value.slice(0, 50).map((item) => format(item, depth + 1, next));
      if (value.length > 50) items.push(`… ${value.length - 50} more`);
      return `[${items.join(", ")}]`;
    }
    if (value instanceof Map) return `Map(${value.size}) {${[...value].slice(0, 30).map(([k, v]) => `${format(k, depth + 1, next)} => ${format(v, depth + 1, next)}`).join(", ")}}`;
    if (value instanceof Set) return `Set(${value.size}) {${[...value].slice(0, 30).map((v) => format(v, depth + 1, next)).join(", ")}}`;
    if (value instanceof Promise) return "Promise { … }";
    const name = (value as object).constructor?.name;
    const entries = Object.keys(value as object).slice(0, 30).map((key) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${format((value as Record<string, unknown>)[key], depth + 1, next)}`);
    return `${name && name !== "Object" ? `${name} ` : ""}{${entries.join(", ")}}`;
  }

  function emit(level: string, args: unknown[]) {
    if (full) return;
    const text = args.map((arg) => format(arg)).join(" ");
    lines += 1;
    chars += text.length;
    if (lines > MAX_LINES || chars > MAX_CHARS) {
      full = true;
      post({ type: "log", level: "warn", text: `Output stopped: more than ${MAX_LINES} lines or ${MAX_CHARS} characters. Your program kept running.` });
      return;
    }
    post({ type: "log", level, text });
  }
  const console = {
    log: (...args: unknown[]) => emit("log", args),
    info: (...args: unknown[]) => emit("log", args),
    debug: (...args: unknown[]) => emit("log", args),
    warn: (...args: unknown[]) => emit("warn", args),
    error: (...args: unknown[]) => emit("error", args),
    table: (...args: unknown[]) => emit("log", args),
  };
  const sleep = (ms: unknown) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(Number(ms) || 0, 10000))));

  /** The learner's line for an error thrown in their code (named learner.js); new Function adds two lines before the body. */
  function where(error: unknown) {
    const stack = String((error as { stack?: string })?.stack ?? "");
    const match = /learner\.js:(\d+):(\d+)/.exec(stack);
    return match ? Math.max(1, Number(match[1]) - 2) : null;
  }
  const describe = (error: unknown) =>
    error instanceof Error
      ? { name: error.name, message: error.message, line: where(error) }
      : { name: "Thrown value", message: `Your code threw ${format(error)}, which is not an Error.`, line: null };

  function equal(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((key) => Object.prototype.hasOwnProperty.call(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  class Failure extends Error {}
  const fail = (message: string) => {
    throw new Failure(message);
  };
  const matches = (error: unknown, expected?: unknown) => {
    if (expected === undefined) return true;
    if (expected instanceof RegExp) return expected.test(String((error as Error)?.message ?? error));
    return typeof expected === "function" && error instanceof (expected as new () => unknown);
  };
  const assert = {
    equal(actual: unknown, expected: unknown, message = "Values differ") {
      if (!equal(actual, expected)) fail(`${message}\n  expected: ${format(expected, 1)}\n  received: ${format(actual, 1)}`);
    },
    ok(value: unknown, message = "Expected a true value") {
      if (!value) fail(message);
    },
    throws(fn: () => unknown, expected?: unknown, message = "Expected an error") {
      let threw = false;
      try {
        fn();
      } catch (error) {
        threw = true;
        if (!matches(error, expected)) fail(`${message}\n  but it threw ${format(error)}`);
      }
      if (!threw) fail(`${message}\n  but nothing was thrown`);
    },
    async rejects(work: Promise<unknown> | (() => Promise<unknown>), expected?: unknown, message = "Expected the promise to reject") {
      try {
        await (typeof work === "function" ? work() : work);
      } catch (error) {
        if (!matches(error, expected)) fail(`${message}\n  but it rejected with ${format(error)}`);
        return;
      }
      fail(`${message}\n  but it resolved`);
    },
  };

  scope.onunhandledrejection = (event: { reason: unknown; preventDefault(): void }) => {
    event.preventDefault();
    post({ type: "log", level: "error", text: `Unhandled promise rejection: ${format(event.reason)}` });
  };

  let started = false;
  scope.onmessage = async (event: { data: { mode: "run" | "check"; code: string; exports: string[]; tests: string } }) => {
    if (started) return;
    started = true;
    const { mode, code, exports, tests } = event.data;
    const marker = "__kitabExports";
    const ret = mode === "check" ? `\n;return { ${marker}: true, ${exports.map((n) => `${JSON.stringify(n)}: typeof ${n} === "undefined" ? undefined : ${n}`).join(", ")} };` : "";
    let program: (...values: unknown[]) => Promise<unknown>;
    try {
      program = new AsyncFunction("console", "sleep", `${code}${ret}\n//# sourceURL=learner.js`);
    } catch (error) {
      post({ type: "error", kind: "syntax", ...describe(error) });
      return post({ type: "done" });
    }
    const t0 = performance.now();
    let value: unknown;
    try {
      value = await program(console, sleep);
    } catch (error) {
      post({ type: "error", kind: "runtime", ...describe(error) });
      return post({ type: "done", ms: performance.now() - t0 });
    }
    if (mode === "run") return post({ type: "done", ms: performance.now() - t0, value: value === undefined ? undefined : format(value, 1) });
    if (!value || typeof value !== "object" || !(value as Record<string, unknown>)[marker]) {
      post({ type: "error", kind: "runtime", name: "Early return", message: "Your program returned before its last line, so Check couldn't reach your functions. Remove the top-level return.", line: null });
      return post({ type: "done" });
    }
    const list: { name: string; fn: () => unknown }[] = [];
    try {
      await new AsyncFunction("test", "assert", "lab", "sleep", "console", `${tests}\n//# sourceURL=lab-tests.js`)((name: string, fn: () => unknown) => list.push({ name, fn }), assert, value, sleep, console);
    } catch (error) {
      post({ type: "error", kind: "internal", name: "Test setup failed", message: String((error as Error)?.message ?? error), line: null });
      return post({ type: "done" });
    }
    for (const { name, fn } of list) {
      post({ type: "test-start", name });
      try {
        await fn();
        post({ type: "test", name, passed: true, message: "" });
      } catch (error) {
        const message = error instanceof Failure ? error.message : `${describe(error).name}: ${describe(error).message}${describe(error).line ? ` (your line ${describe(error).line})` : ""}`;
        post({ type: "test", name, passed: false, message });
      }
    }
    post({ type: "done", ms: performance.now() - t0 });
  };
}

export const harnessSource = `(${harness.toString()})();`;
