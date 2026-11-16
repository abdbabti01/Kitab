import { assertCompleteTimeline, type SimulationTimeline } from "../../core/simulation.ts";

export type RecursionConfig = {
  fn: "factorial" | "sum";
  n: number;
  baseCase: boolean;
  stackLimit: number;
};

export type CallFrame = {
  /** Stable identity of one call, kept while the frame is on the stack. */
  id: string;
  fn: RecursionConfig["fn"];
  n: number;
  status: "running" | "waiting" | "returning";
  returnValue?: number;
};

export type RecursionEvent = {
  id: string;
  kind: "start" | "call" | "base" | "return" | "overflow" | "complete";
  title: string;
  explanation: string;
  /** 1-based line in `recursionSource` that is executing. */
  line: number;
  stack: CallFrame[];
  returned?: { frameId: string; value: number };
};

export type RecursionTimeline = SimulationTimeline<RecursionEvent> & {
  config: RecursionConfig;
  outcome: {
    status: "returned" | "overflow";
    result: number | null;
    maxDepth: number;
    calls: number;
    firstReturn: string | null;
  };
};

export const defaultRecursionConfig: RecursionConfig = { fn: "factorial", n: 4, baseCase: true, stackLimit: 8 };

export function normalizeRecursionConfig(input: Partial<RecursionConfig>): RecursionConfig {
  const n = Number(input.n);
  const limit = Number(input.stackLimit);
  return {
    fn: input.fn === "sum" ? "sum" : "factorial",
    n: Number.isFinite(n) ? Math.round(Math.max(1, Math.min(6, n))) : defaultRecursionConfig.n,
    baseCase: input.baseCase !== false,
    stackLimit: Number.isFinite(limit) ? Math.round(Math.max(4, Math.min(12, limit))) : defaultRecursionConfig.stackLimit,
  };
}

export function recursionSource(config: Pick<RecursionConfig, "fn" | "baseCase">) {
  const op = config.fn === "factorial" ? "*" : "+";
  return [
    `function ${config.fn}(n) {`,
    config.baseCase ? "  if (n <= 1) return 1;" : "  // base case removed",
    `  return n ${op} ${config.fn}(n - 1);`,
    "}",
  ];
}

const label = (fn: string, n: number) => `${fn}(${n})`;

export function buildRecursionTimeline(input: Partial<RecursionConfig>): RecursionTimeline {
  const config = normalizeRecursionConfig(input);
  const events: RecursionEvent[] = [];
  let stack: CallFrame[] = [];
  let calls = 0;
  let maxDepth = 0;
  let firstReturn: string | null = null;

  const emit = (event: Omit<RecursionEvent, "id" | "stack"> & { id?: string }) => {
    events.push({ ...event, id: event.id ?? `event-${events.length}`, stack: stack.map((frame) => ({ ...frame })) });
  };

  emit({
    id: "start",
    kind: "start",
    title: `main() calls ${label(config.fn, config.n)}`,
    explanation: "main() is the only frame. Each call will push a new frame with its own copy of n.",
    line: 1,
  });

  const push = (n: number) => {
    stack = stack.map((frame) => ({ ...frame, status: "waiting" as const }));
    calls += 1;
    stack.push({ id: `call-${calls}`, fn: config.fn, n, status: "running" });
    maxDepth = Math.max(maxDepth, stack.length);
    emit({
      kind: "call",
      title: `Push ${label(config.fn, n)}`,
      explanation: stack.length === 1
        ? `A new frame stores n = ${n} and where to return in main().`
        : `${label(config.fn, n + 1)} pauses at line 3 while a new frame stores n = ${n}.`,
      line: 1,
    });
  };

  let n = config.n;
  push(n);
  let overflow = false;
  while (true) {
    if (config.baseCase && n <= 1) {
      const top = stack.at(-1)!;
      stack = [...stack.slice(0, -1), { ...top, status: "returning", returnValue: 1 }];
      firstReturn = label(config.fn, n);
      emit({
        kind: "base",
        title: `Base case: ${label(config.fn, n)} returns 1`,
        explanation: "n <= 1, so this call returns without making another call. The stack stops growing.",
        line: 2,
      });
      break;
    }
    if (stack.length >= config.stackLimit) {
      overflow = true;
      emit({
        id: "overflow",
        kind: "overflow",
        title: "Stack overflow",
        explanation: config.baseCase
          ? `The base case exists, but it is ${n - 1} more calls away and the stack already holds its limit of ${stack.length} frames. The runtime refuses to push another frame and throws.`
          : `No base case stops the calls. After ${stack.length} frames the runtime refuses to push another frame and throws.`,
        line: 3,
      });
      break;
    }
    n -= 1;
    push(n);
  }

  let result: number | null = null;
  if (!overflow) {
    let value = 1;
    // Pop the base-case frame, then resume each waiting caller in reverse order.
    while (stack.length) {
      const finished = stack.at(-1)!;
      stack = stack.slice(0, -1);
      const caller = stack.at(-1);
      if (!caller) {
        result = value;
        emit({
          kind: "return",
          title: `${label(config.fn, finished.n)} returns ${value} to main()`,
          explanation: "The last frame pops. Only main() remains, holding the final result.",
          line: 3,
          returned: { frameId: finished.id, value },
        });
        break;
      }
      const received = value;
      value = config.fn === "factorial" ? caller.n * received : caller.n + received;
      stack = [...stack.slice(0, -1), { ...caller, status: "returning", returnValue: value }];
      emit({
        kind: "return",
        title: `Pop ${label(config.fn, finished.n)}; ${label(config.fn, caller.n)} resumes`,
        explanation: `${label(config.fn, finished.n)} returns ${received}. The waiting frame finishes line 3: ${caller.n} ${config.fn === "factorial" ? "×" : "+"} ${received} = ${value}.`,
        line: 3,
        returned: { frameId: finished.id, value: received },
      });
    }
  }

  emit({
    id: "complete",
    kind: "complete",
    title: overflow ? "The program crashed" : `Result: ${result}`,
    explanation: overflow
      ? "No frame ever returned a value. The error unwinds every pending frame, so none finishes its line 3. (Kitab's limit is a small teaching number; real runtimes allow thousands of frames, for example JavaScript's RangeError: Maximum call stack size exceeded.)"
      : "Frames returned in the reverse order they were pushed: last in, first out.",
    line: 4,
  });

  const timeline: RecursionTimeline = {
    config,
    events,
    terminalEventId: "complete",
    outcome: { status: overflow ? "overflow" : "returned", result, maxDepth, calls, firstReturn },
  };
  assertCompleteTimeline(timeline);
  return timeline;
}
