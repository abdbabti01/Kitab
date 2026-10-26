import type { EngineAdapter, FactValue, Fact, LearningFrame, Trace } from "./types.ts";

const engines = new Map<string, EngineAdapter<any, any>>();
const cache = new Map<string, Trace<any>>();
const CACHE_LIMIT = 48;

export function registerEngine(adapter: EngineAdapter<any, any>) {
  engines.set(adapter.id, adapter);
}

export function getEngine(id: string): EngineAdapter<any, any> | undefined {
  return engines.get(id);
}

export function engineIds() {
  return [...engines.keys()];
}

function canonical(value: Record<string, FactValue>) {
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]));
}

function format(value: FactValue) {
  return typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
}

export function factDelta(previous: Fact[] | undefined, next: Fact[]) {
  if (!previous) return [];
  const before = new Map(previous.map((fact) => [fact.id, fact]));
  return next.flatMap((fact) => {
    const old = before.get(fact.id);
    if (!old) return [`${fact.label}: ${format(fact.value)}`];
    return old.value === fact.value ? [] : [`${fact.label}: ${format(old.value)} → ${format(fact.value)}`];
  });
}

export class EngineError extends Error {}

/** Validates parameters and builds an immutable trace. Same input → same trace object. */
export function buildTrace<TData = unknown>(engineId: string, rawParams: unknown): Trace<TData> {
  const adapter = engines.get(engineId);
  if (!adapter) throw new EngineError(`Unknown engine: ${engineId}`);
  const parsed = adapter.params.safeParse(rawParams ?? {});
  if (!parsed.success) throw new EngineError(`Invalid parameters for ${engineId}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  const params = parsed.data as Record<string, FactValue>;
  const scenarioKey = `${adapter.id}@${adapter.version}:${canonical(params)}`;
  const cached = cache.get(scenarioKey);
  if (cached) return cached as Trace<TData>;

  const built = adapter.build(params);
  if (built.frames.length < 2) throw new EngineError(`${engineId} produced fewer than two frames.`);
  const ids = new Set<string>();
  const frames: LearningFrame<TData>[] = built.frames.map((frame, index) => {
    if (ids.has(frame.id)) throw new EngineError(`${engineId} produced duplicate frame id ${frame.id}.`);
    ids.add(frame.id);
    const entityIds = new Set(frame.entities.map((entity) => entity.id));
    for (const id of frame.focus) if (!entityIds.has(id)) throw new EngineError(`${engineId} frame ${frame.id} focuses unknown entity ${id}.`);
    return { ...frame, index, delta: factDelta(built.frames[index - 1]?.facts, frame.facts) };
  });
  const trace: Trace<TData> = {
    engine: { id: adapter.id, version: adapter.version },
    scenarioKey,
    params,
    frames,
    outcome: built.outcome,
    outcomeLabels: built.outcomeLabels,
    diagnostics: built.diagnostics ?? [],
  };
  deepFreeze(trace);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(scenarioKey, trace);
  return trace;
}

function deepFreeze(value: unknown) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
}

/** Clamps any index (including NaN or a stale one from a previous trace) into the trace. */
export function frameAt<TData>(trace: Trace<TData>, index: number) {
  const safe = Number.isFinite(index) ? Math.max(0, Math.min(trace.frames.length - 1, Math.trunc(index))) : 0;
  return trace.frames[safe];
}
