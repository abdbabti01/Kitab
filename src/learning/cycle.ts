// The guided experiment shared by every subject: understand a scenario, commit a prediction, run the real
// simulator, read what it recorded, choose the reason the evidence supports, then change one thing and compare.
// Pure: no React, no DOM. A cycle's content (src/architecture/cycles.ts, src/structures/cycles.ts,
// src/practice/network/cycles.ts) supplies the engine run and reads every answer from that run: which outcome
// happened, which reason holds and which way a variation moved a value. Nothing is a fixed answer key.
import type { TermId } from "./glossary.ts";

export type Subject = "system-design" | "networking" | "data-structures" | "identity";
/** `miss`: shown when the learner chose this and the run supported something else (a common misconception). */
export type Choice = { id: string; text: string; miss?: string };
/** One recorded value. `at`: the step or event of the run that shows it, when the view can go there. */
export type Evidence = { label: string; value: string; at?: number };

export type Trial<S, R> = {
  /** "base" for the first run; a variation's own id otherwise. */
  id: string;
  label: string;
  /** Variations: the one thing changed from the first run, in words. */
  change?: string;
  setup: S;
  question: string;
  choices: Choice[];
  /** The choice this run supports. Variations compare with the first run (`base`). */
  outcome: (run: R, base: R | null) => string;
  /** Statements about why; exactly one is supported by any run. */
  reasons: Choice[];
  reason: (run: R, base: R | null) => string;
  /** The explanation, built from this run's values. */
  explain: (run: R, base: R | null) => string;
};

/** A value compared between the first run and a variation. */
export type Reading<R> = { label: string; read: (run: R) => number | null; format: (value: number) => string };

export type Cycle<S, R> = {
  id: string;
  /** Raised when a change makes earlier saved answers meaningless; records are kept per version. */
  version: number;
  subject: Subject;
  /** The unit or lesson this belongs to (a track stage id or a System Design lesson id). */
  unit: string;
  title: string;
  concept: string;
  scenario: string;
  /** The question being investigated. */
  question: string;
  /** What to look at in the run. */
  watch: string;
  terms: TermId[];
  /** What the model does not establish. */
  limits: string;
  /** A focused hint, shown after a reason that the run doesn't support. */
  hint: string;
  /** The starting configuration, from the setup alone: never from the run, so it can't give the answer away. */
  start: (setup: S) => Evidence[];
  base: Trial<S, R>;
  variations: Trial<S, R>[];
  /** The real engine. A variation also receives the first run (e.g. to continue its session). */
  run: (setup: S, base: R | null) => R;
  /** The most important result first. */
  evidence: (run: R, base: R | null) => Evidence[];
  readings: Reading<R>[];
};
// Content modules use concrete setup and run types; the shared view and store only need the cycle's shape.
export type AnyCycle = Cycle<any, any>;

export type Phase = "ready" | "running" | "observed" | "explained" | "completed";
/** One explained trial: what the learner said, and what the run supported. */
export type TrialResult = { trial: string; prediction: string; outcome: string; supported: string; reason: string };
export type CycleState = {
  attempt: number;
  trial: string;
  phase: Phase;
  /** Committed: set only by "predict", never changed until the next trial or attempt. */
  prediction: string | null;
  /** What the run of this attempt and trial supported. */
  outcome: string | null;
  supported: string | null;
  reason: string | null;
  /** This attempt's explained trials, the first run first. */
  done: TrialResult[];
};
export type CycleAction =
  | { type: "predict"; choice: string }
  | { type: "observed"; attempt: number; trial: string; outcome: string; supported: string }
  | { type: "explain"; reason: string }
  | { type: "vary"; trial: string }
  | { type: "finish" }
  | { type: "again" };

export const initialCycle = (attempt = 1): CycleState => ({ attempt, trial: "base", phase: "ready", prediction: null, outcome: null, supported: null, reason: null, done: [] });

export const trialOf = (cycle: AnyCycle, id: string) => (id === "base" ? cycle.base : cycle.variations.find((v) => v.id === id));
const has = (choices: Choice[], id: string) => choices.some((c) => c.id === id);

/** Every rule of the cycle in one place. An action that breaks one leaves the state unchanged. */
export function reduceCycle(cycle: AnyCycle, state: CycleState, action: CycleAction): CycleState {
  const trial = trialOf(cycle, state.trial);
  if (!trial) return state;
  switch (action.type) {
    case "predict":
      return state.phase === "ready" && has(trial.choices, action.choice) ? { ...state, phase: "running", prediction: action.choice } : state;
    case "observed":
      // Only the run of this attempt and this trial: a late result from an earlier one is ignored.
      if (state.phase !== "running" || action.attempt !== state.attempt || action.trial !== state.trial) return state;
      if (!has(trial.choices, action.outcome) || !has(trial.reasons, action.supported)) return state;
      return { ...state, phase: "observed", outcome: action.outcome, supported: action.supported };
    case "explain": {
      if (state.phase !== "observed" || !has(trial.reasons, action.reason)) return state;
      const result: TrialResult = { trial: state.trial, prediction: state.prediction!, outcome: state.outcome!, supported: state.supported!, reason: action.reason };
      return { ...state, phase: "explained", reason: action.reason, done: [...state.done.filter((r) => r.trial !== state.trial), result] };
    }
    case "vary":
      if ((state.phase !== "explained" && state.phase !== "completed") || !baseDone(state) || action.trial === "base" || !trialOf(cycle, action.trial)) return state;
      return { ...state, trial: action.trial, phase: "ready", prediction: null, outcome: null, supported: null, reason: null };
    case "finish":
      return state.phase === "explained" && canFinish(cycle, state) ? { ...state, phase: "completed" } : state;
    case "again":
      return initialCycle(state.attempt + 1);
  }
}

const baseDone = (state: CycleState) => state.done.some((r) => r.trial === "base");
/** Complete: the first run predicted, run and explained, and one variation too when the cycle has any. */
export const canFinish = (cycle: AnyCycle, state: CycleState) => baseDone(state) && (cycle.variations.length === 0 || state.done.some((r) => r.trial !== "base"));
/** Understanding shown: the first run's outcome predicted and its reason chosen, in the same attempt. */
export const understood = (state: CycleState) => state.done.some((r) => r.trial === "base" && r.prediction === r.outcome && r.reason === r.supported);

/** "lower", "same" or "higher": `same` is the largest difference still counted as about the same. */
export function direction(before: number | null, after: number | null, same: number): "lower" | "same" | "higher" {
  if (before === null || after === null || Math.abs(after - before) <= same) return "same";
  return after < before ? "lower" : "higher";
}

/** The three comparison choices for a value, worded by the content. Their ids are what `direction` returns. */
export const compareChoices = (lower: string, same: string, higher: string, miss: Partial<Record<"lower" | "same" | "higher", string>> = {}): Choice[] => [
  { id: "lower", text: lower, miss: miss.lower },
  { id: "same", text: same, miss: miss.same },
  { id: "higher", text: higher, miss: miss.higher },
];

/**
 * Checks content against its own engine: every choice and reason id is unique, every trial's outcome and reason
 * resolve to one of its own choices for the real run, and evidence exists. Returns problems; empty when valid.
 */
export function validateCycle(cycle: AnyCycle): string[] {
  const problems: string[] = [];
  const unique = (ids: string[], what: string) => new Set(ids).size !== ids.length && problems.push(`${cycle.id}: duplicate ${what}`);
  unique([cycle.base.id, ...cycle.variations.map((v) => v.id)], "trial ids");
  if (cycle.base.id !== "base") problems.push(`${cycle.id}: the first trial must be "base"`);
  const base = cycle.run(cycle.base.setup, null);
  for (const trial of [cycle.base, ...cycle.variations]) {
    unique(trial.choices.map((c) => c.id), `${trial.id} choices`);
    unique(trial.reasons.map((c) => c.id), `${trial.id} reasons`);
    if (trial.choices.length < 2 || trial.reasons.length < 2) problems.push(`${cycle.id}/${trial.id}: needs at least two choices and two reasons`);
    const run = trial.id === "base" ? base : cycle.run(trial.setup, base);
    const before = trial.id === "base" ? null : base;
    if (!has(trial.choices, trial.outcome(run, before))) problems.push(`${cycle.id}/${trial.id}: outcome is not one of its choices`);
    if (!has(trial.reasons, trial.reason(run, before))) problems.push(`${cycle.id}/${trial.id}: reason is not one of its reasons`);
    if (!trial.explain(run, before)) problems.push(`${cycle.id}/${trial.id}: no explanation`);
    if (!cycle.evidence(run, before).length) problems.push(`${cycle.id}/${trial.id}: no evidence`);
  }
  if (!cycle.start(cycle.base.setup).length) problems.push(`${cycle.id}: no starting configuration`);
  return problems;
}
