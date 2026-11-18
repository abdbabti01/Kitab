// Guided experiments in this browser: one small record per experiment version (`<id>@<version>`), never an event
// stream. Its own additive store through keyed-store.ts, so a damaged or newer record is kept, another tab's
// records are never overwritten, and nothing else (missions, lessons, labs, challenges) is read or changed.
// Completion and understanding dates, once set, are never rewritten; starting again keeps them.
import { z } from "zod";
import { readStore, updateStore, type StorageLike } from "./keyed-store.ts";
import { canFinish, initialCycle, trialOf, understood, type AnyCycle, type CycleState } from "./cycle.ts";

export const CYCLES_KEY = "kitab.experiments.v1";
const id = z.string().max(40);
const result = z.object({ trial: id, prediction: id, outcome: id, supported: id, reason: id }).strict();
const stateSchema = z.object({
  attempt: z.number().int().min(1).max(10_000),
  trial: id,
  phase: z.enum(["ready", "running", "observed", "explained", "completed"]),
  prediction: id.nullable(),
  outcome: id.nullable(),
  supported: id.nullable(),
  reason: id.nullable(),
  done: z.array(result).max(20),
}).strict();
const record = z.object({
  attempts: z.number().int().min(0),
  lastAt: z.string().max(40),
  completedAt: z.string().max(40).optional(),
  understoodAt: z.string().max(40).optional(),
  /** Where the learner is, to resume: answers only. The runs are rebuilt from the deterministic engine. */
  state: stateSchema.optional(),
}).strict();
export type CycleRecord = z.infer<typeof record>;
const collections = { cycles: record };

export const recordKey = (cycle: Pick<AnyCycle, "id" | "version">) => `${cycle.id}@${cycle.version}`;

export function loadCycleRecords(storage: StorageLike): Record<string, CycleRecord> {
  return readStore(storage, CYCLES_KEY, 1, collections).records.cycles;
}

/** "completed", "understood" (completed with the first prediction and its reason right), "started" or null. */
export function cycleStatus(record: CycleRecord | undefined): "understood" | "completed" | "started" | null {
  if (!record) return null;
  if (record.understoodAt && record.completedAt) return "understood";
  if (record.completedAt) return "completed";
  return record.attempts > 0 ? "started" : null;
}

/** A saved state this cycle can still use: every id it names exists in this version. Otherwise null. */
export function usableState(cycle: AnyCycle, state: CycleState | undefined): CycleState | null {
  if (!state) return null;
  const known = (trialId: string) => trialOf(cycle, trialId);
  const fits = (trialId: string, ids: { choice?: string | null; reason?: string | null }[]) => {
    const t = known(trialId);
    return !!t && ids.every(({ choice, reason }) => (choice == null || t.choices.some((c) => c.id === choice)) && (reason == null || t.reasons.some((c) => c.id === reason)));
  };
  if (!fits(state.trial, [{ choice: state.prediction, reason: state.reason }, { choice: state.outcome, reason: state.supported }])) return null;
  if (!state.done.every((r) => fits(r.trial, [{ choice: r.prediction, reason: r.reason }, { choice: r.outcome, reason: r.supported }]))) return null;
  // Each phase's own fields must be present.
  const p = state.phase;
  if (p !== "ready" && !state.prediction) return null;
  if ((p === "observed" || p === "explained" || p === "completed") && (!state.outcome || !state.supported)) return null;
  if ((p === "explained" || p === "completed") && !state.reason) return null;
  if (p === "completed" && !canFinish(cycle, state)) return null;
  if (state.trial !== "base" && !state.done.some((r) => r.trial === "base")) return null;
  return agreesWithEngine(cycle, state) ? state : null;
}

/** The saved outcomes are still what the engine computes today (an engine change makes old answers meaningless). */
function agreesWithEngine(cycle: AnyCycle, state: CycleState) {
  const checks = [...state.done.map((r) => ({ trial: r.trial, outcome: r.outcome, supported: r.supported })), ...(state.outcome ? [{ trial: state.trial, outcome: state.outcome, supported: state.supported }] : [])];
  if (!checks.length) return true;
  const base = cycle.run(cycle.base.setup, null);
  return checks.every(({ trial: trialId, outcome, supported }) => {
    const t = trialOf(cycle, trialId)!;
    const run = trialId === "base" ? base : cycle.run(t.setup, base);
    const before = trialId === "base" ? null : base;
    return t.outcome(run, before) === outcome && t.reason(run, before) === supported;
  });
}

/** The state to resume, or a fresh first attempt. */
export function resumeState(cycle: AnyCycle, record: CycleRecord | undefined): CycleState {
  return usableState(cycle, record?.state) ?? initialCycle(record?.state ? record.state.attempt + 1 : 1);
}

/** Saves where the learner is. `saved` is false when this browser didn't keep it (storage full or blocked). */
export function saveCycleState(storage: StorageLike, cycle: AnyCycle, state: CycleState, now = new Date().toISOString()): { record: CycleRecord; saved: boolean } {
  const key = recordKey(cycle);
  let next: CycleRecord = { attempts: 0, lastAt: now };
  const { saved } = updateStore(storage, CYCLES_KEY, 1, collections, (records) => {
    const old = records.cycles[key];
    next = {
      ...old,
      // An attempt counts once a prediction is committed in it.
      attempts: Math.max(old?.attempts ?? 0, state.phase === "ready" ? state.attempt - 1 : state.attempt),
      lastAt: now,
      state,
    };
    if (state.phase === "completed") {
      next.completedAt ??= now;
      if (understood(state)) next.understoodAt ??= now;
    }
    records.cycles[key] = next;
  });
  return { record: next, saved };
}
