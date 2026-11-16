// Architecture labs: small, deterministic simulations of one correctness or resilience mechanism each (duplicate
// charges, lost updates, retry storms...). The playground's simulator models capacity and queueing but not data
// contents, duplicates or lag; these labs model exactly the state their mechanism needs, and nothing more.
//
// Pure TypeScript, no React or DOM. A lab turns (config, scenario) into one event stream; everything shown (the
// sequence or chart, the numbers, the checks) is a fold of that stream (`lab.facts`), never a second model.
import { Heap, prng } from "../simulate.ts";

export { prng };

export type Tone = "info" | "good" | "warn" | "bad";

export type LabEvent = {
  i: number;
  t: number;
  /** The lane the event happens on (an actor id). */
  actor: string;
  /** message: one actor sends to another; note: something happens on one actor; effect: a side effect that
   *  matters to the checks (a charge, a stock change); fault: an injected failure; tick: one time bucket of an
   *  aggregate lab (its numbers are in `data`). */
  kind: "message" | "note" | "effect" | "fault" | "tick";
  /** For a message: the recipient lane. */
  to?: string;
  /** For a message: lost on the way (never arrives). */
  lost?: boolean;
  text: string;
  tone: Tone;
  /** The business entity the event belongs to ("order-1"), for "follow one" filtering. */
  ref?: string;
  /** Numbers the lab's fold reads (charges, versions, queue depth...). */
  data?: Record<string, number>;
};

export type ControlOption = { value: string; label: string; help?: string };
export type Control = { id: string; label: string; help: string } & (
  | { type: "select"; options: ControlOption[] }
  | { type: "number"; min: number; max: number; step: number; unit?: string }
  | { type: "toggle" }
);
export type ConfigValue = string | number | boolean;
export type LabConfig = Record<string, ConfigValue>;

export type Facts = Record<string, number>;

export type LabScenario = { id: string; title: string; description: string; seed: number; params: Record<string, number> };

/** One requirement, judged in one scenario from that run's facts. */
export type LabCheck = {
  id: string;
  scenario: string;
  requirement: string;
  passed: (facts: Facts) => boolean;
  /** What the run showed, in words, with its numbers. */
  observed: (facts: Facts) => string;
};

export type ReasoningQuestion = {
  id: string;
  prompt: string;
  /** Exactly one is correct; every option explains itself once chosen. */
  options: { text: string; correct?: true; why: string }[];
};

export type PredictionVariant = {
  id: string;
  /** The question for this variant, with its numbers. */
  question: string;
  scenario: LabScenario;
  /** Applied over the starter configuration. */
  config?: LabConfig;
};

export type LabView = { kind: "sequence"; lanes: { id: string; label: string }[] } | { kind: "series"; lines: { key: string; label: string }[]; limit?: { key: string; label: string } };

export type Lab = {
  id: string;
  /** A new version starts a fresh progress record. */
  version: string;
  title: string;
  summary: string;
  /** The problem, in plain words, before any mechanism. */
  story: string[];
  /** The System Design unit that teaches the concept. */
  unit: string;
  view: LabView;
  controls: Control[];
  /** The broken system the learner starts from. */
  starter: LabConfig;
  /** Controls the learner can't change (the scenario's givens). */
  locked?: string[];
  scenarios: LabScenario[];
  simulate: (config: LabConfig, scenario: LabScenario) => LabEvent[];
  /** Fold events (all, or up to a playback cursor) into the numbers the checks and the view read. */
  facts: (events: LabEvent[]) => Facts;
  /** The facts worth showing, with labels. */
  shown: { key: string; label: string; bad?: "above-zero" }[];
  checks: LabCheck[];
  prediction: { unit: string; answer: string; variants: PredictionVariant[] };
  questions: ReasoningQuestion[];
  /** What the run means, in words, from its facts. */
  explain: (facts: Facts, config: LabConfig) => string;
  hints: string[];
  assumptions: string[];
  notModelled: string[];
};

export type LabRun = { events: LabEvent[]; facts: Facts; cutShort: boolean };

export const MAX_LAB_EVENTS = 20_000;

/** Collects events in time order (ties keep insertion order) and runs scheduled work. */
export class Timeline {
  events: LabEvent[] = [];
  now = 0;
  cutShort = false;
  private heap = new Heap();
  private seq = 0;
  at(t: number, run: () => void) {
    this.heap.push({ t, seq: this.seq++, run });
  }
  after(ms: number, run: () => void) {
    this.at(this.now + ms, run);
  }
  log(event: Omit<LabEvent, "i" | "t">) {
    if (this.events.length >= MAX_LAB_EVENTS) {
      this.cutShort = true;
      return;
    }
    this.events.push({ i: this.events.length, t: this.now, ...event });
  }
  /** Runs scheduled work in time order until none is left, the horizon passes or the event bound is hit. */
  drain(horizonMs = Infinity) {
    while (this.heap.items.length && !this.cutShort) {
      const task = this.heap.pop();
      if (task.t > horizonMs) break;
      this.now = task.t;
      task.run();
    }
    return this.events;
  }
}

/** Untrusted values (saved progress) → a valid configuration, or null: unknown keys or values are refused. */
export function parseConfig(lab: Lab, raw: unknown): LabConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: LabConfig = { ...lab.starter };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const control = lab.controls.find((c) => c.id === key);
    if (!control || !validValue(control, value)) return null;
    out[key] = value as ConfigValue;
  }
  for (const key of lab.locked ?? []) out[key] = lab.starter[key];
  return out;
}

export function validValue(control: Control, value: unknown) {
  if (control.type === "select") return typeof value === "string" && control.options.some((o) => o.value === value);
  if (control.type === "toggle") return typeof value === "boolean";
  return typeof value === "number" && Number.isFinite(value) && value >= control.min && value <= control.max && Math.abs((value - control.min) / control.step - Math.round((value - control.min) / control.step)) < 1e-9;
}

export function runLab(lab: Lab, config: LabConfig, scenario: LabScenario): LabRun {
  const events = lab.simulate(config, scenario);
  return { events, facts: lab.facts(events), cutShort: events.length >= MAX_LAB_EVENTS };
}

export type LabEvaluation = { passed: boolean; checks: { id: string; scenario: string; requirement: string; passed: boolean; observed: string }[] };

/** Every check in its scenario: one run per scenario, judged only from that run's facts. */
export function evaluateLab(lab: Lab, config: LabConfig): LabEvaluation {
  const facts = new Map<string, Facts>();
  const checks = lab.checks.map((check) => {
    if (!facts.has(check.scenario)) facts.set(check.scenario, runLab(lab, config, lab.scenarios.find((s) => s.id === check.scenario)!).facts);
    const f = facts.get(check.scenario)!;
    return { id: check.id, scenario: check.scenario, requirement: check.requirement, passed: check.passed(f), observed: check.observed(f) };
  });
  return { passed: checks.every((c) => c.passed), checks };
}

/** The variant an attempt predicts: attempts rotate through them, so a retry asks for a different number. */
export const predictionVariant = (lab: Lab, attempt: number) => lab.prediction.variants[attempt % lab.prediction.variants.length];
export const questionFor = (lab: Lab, attempt: number) => lab.questions[attempt % lab.questions.length];

/** The engine's answer for a variant: the starter (plus the variant's changes) run in the variant's scenario. */
export function predictionAnswer(lab: Lab, variant: PredictionVariant) {
  const run = runLab(lab, { ...lab.starter, ...variant.config }, variant.scenario);
  return run.facts[lab.prediction.answer];
}

/**
 * Four whole-number options including the engine's answer, in ascending order. Small answers get neighbours;
 * large ones get proportional distractors, with the answer's position varying by its value.
 */
export function predictionOptions(answer: number) {
  if (answer < 20) {
    const candidates = [answer, answer + 1, answer - 1, answer + 2, answer * 2, answer - 2, 0, 1, 3];
    return [...new Set(candidates.filter((n) => n >= 0))].slice(0, 4).sort((a, b) => a - b);
  }
  const patterns = [[1, 2, 3, 4], [0.5, 1, 2, 3], [0.25, 0.5, 1, 2], [1 / 3, 0.5, 2 / 3, 1]];
  const round = (n: number) => (n >= 100 ? Math.round(n / 10) * 10 : Math.round(n));
  const digits = [...String(Math.round(answer))].reduce((sum, d) => sum + Number(d), 0);
  const pattern = patterns[digits % patterns.length];
  return pattern.map((m) => (m === 1 ? answer : round(answer * m))).sort((a, b) => a - b);
}

/** Facts from events that carry `data`, summed per key. Most labs fold this way. */
export function sumData(events: LabEvent[], keys: string[]) {
  const out: Facts = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const e of events) if (e.data) for (const k of keys) if (e.data[k] !== undefined) out[k] += e.data[k];
  return out;
}
