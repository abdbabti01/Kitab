import { z } from "zod";
import {
  buildRecursionTimeline,
  normalizeRecursionConfig,
  recursionSource,
  type RecursionConfig,
  type RecursionEvent,
} from "../../visual-engine/engines/execution/recursion-engine.ts";
import type { EngineAdapter, Fact } from "../types.ts";
import { normalizeNumberWords } from "../claims.ts";

const params = z
  .object({ fn: z.string().optional(), n: z.unknown().optional(), baseCase: z.unknown().optional(), stackLimit: z.unknown().optional() })
  .strict()
  .transform((input) => {
    const config = normalizeRecursionConfig({ ...input, baseCase: input.baseCase === false || input.baseCase === "false" ? false : true } as Partial<RecursionConfig>);
    return { ...config } as Record<string, string | number | boolean>;
  });

export type RecursionFrameData = { event: RecursionEvent; source: string[] };

const name = (frame: { fn: string; n: number }) => `${frame.fn}(${frame.n})`;

export const recursionAdapter: EngineAdapter<Record<string, string | number | boolean>, RecursionFrameData> = {
  id: "recursion",
  version: "1.0.0",
  title: "Recursion and the call stack",
  params: params as never,
  vocabulary: ["frame", "stack", "call", "return", "base case", "recurs", "push", "pop", "depth", "overflow", "unwind", "factorial", "sum"],
  build(input) {
    const config = input as unknown as RecursionConfig;
    const timeline = buildRecursionTimeline(config);
    const source = recursionSource(config);
    const frames = timeline.events.map((event) => {
      const top = event.stack.at(-1);
      const facts: Fact[] = [
        { id: "depth", label: "Frames on the stack (excluding main)", value: event.stack.length, entityId: top?.id },
        { id: "top", label: "Top of stack", value: top ? name(top) : "main()", entityId: top?.id ?? "main" },
        { id: "line", label: "Executing line", value: `${event.line}: ${source[event.line - 1].trim()}` },
        ...event.stack.map((frame) => ({
          id: `frame-${frame.id}`,
          label: name(frame),
          value: frame.returnValue === undefined ? frame.status : `${frame.status}, returns ${frame.returnValue}`,
          entityId: frame.id,
        })),
      ];
      if (event.returned) facts.push({ id: "returned", label: "Value just returned", value: event.returned.value });
      return {
        id: event.id,
        title: event.title,
        narration: event.explanation,
        technical: source[event.line - 1].trim(),
        chapter: event.kind,
        facts,
        focus: top ? [top.id] : ["main"],
        entities: [{ id: "main", label: "main()", kind: "frame" }, ...event.stack.map((frame) => ({ id: frame.id, label: name(frame), kind: "frame" }))],
        durationMs: 1200,
        invariant: "Only the top frame runs; frames return in reverse order of their calls.",
        data: { event, source },
      };
    });
    const outcome = timeline.outcome;
    return {
      frames,
      outcome: {
        status: outcome.status,
        result: outcome.result ?? "none",
        maxDepth: outcome.maxDepth,
        calls: outcome.calls,
        firstReturn: outcome.firstReturn ?? "none",
        turningFrame: timeline.events.find((event) => event.kind === "base" || event.kind === "overflow")!.id,
        lastFrame: "complete",
      },
      outcomeLabels: { status: "Outcome", result: "Returned value", maxDepth: "Deepest stack", calls: "Calls made", firstReturn: "First call to return" },
    };
  },
  checkClaims(text, facts) {
    const problems: string[] = [];
    const depth = facts.find((fact) => fact.id === "depth");
    const claim = normalizeNumberWords(text).match(/\b(\d+)\s+frames?\b/i);
    if (claim && depth && !facts.some((fact) => String(fact.value) === claim[1])) problems.push(`Claims ${claim[1]} frames; the trace shows ${depth.value}.`);
    if (/\bfirst call (?:returns|finishes) first\b/i.test(text)) problems.push("Claims the first call returns first; the most recent call returns first.");
    return problems;
  },
};
