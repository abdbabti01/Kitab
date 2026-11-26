// Runs, verification, assessment and the postmortem. A learner's remediation is a list of validated steps; it is
// applied to the running store at the scenario's fix time and the simulation continues. Every outcome here is read
// from those runs and the scenario's declared criteria: nothing is granted for choosing an option.
import { validValue } from "../architecture/labs/kernel.ts";
import { applyPatch, getPath, simulate, type Change, type Operation, type Patch, type Run, type State, type Value } from "./engine.ts";
import { startState, truthOf, type Scenario, type Variant } from "./scenarios.ts";
import { BUCKET_MS, buckets, requestFacts, type Finding, type RequestFacts, type Window } from "./telemetry.ts";

export type Step = { kind: "set"; path: string; value: Value } | { kind: "action"; id: string };

/** Why a step can't be applied, or null. Only declared controls and actions, with in-range values, are accepted. */
export function stepError(s: Scenario, step: Step): string | null {
  if (step.kind === "action") return s.actions.some((a) => a.id === step.id) ? null : `Unknown action ${step.id}`;
  const control = s.controls.find((c) => c.id === step.path);
  if (!control) return `${step.path} can't be changed in this incident`;
  const value = control.type === "select" && typeof step.value !== "string" ? String(step.value) : step.value;
  return validValue(control, value) ? null : `${String(step.value)} is not a valid value for ${control.label}`;
}

/** The state value a control's option stands for (select options are strings; some settings are numbers). */
function typed(state: State, path: string, value: Value): Value {
  const current = getPath(state, path);
  return typeof current === "number" && typeof value === "string" ? Number(value) : value;
}

/** Folds steps into one change: later settings win; actions add their patch and operations in order. */
export function combine(s: Scenario, steps: Step[]): { patch: Patch; ops: Operation[]; labels: string[] } {
  const patch: Patch = {};
  const ops: Operation[] = [];
  const labels: string[] = [];
  const base = startState(s);
  for (const step of steps) {
    if (stepError(s, step)) continue;
    if (step.kind === "set") {
      const control = s.controls.find((c) => c.id === step.path)!;
      patch[step.path] = typed(base, step.path, step.value);
      const option = control.type === "select" ? control.options.find((o) => o.value === String(step.value))?.label : undefined;
      labels.push(`${control.label}: ${option ?? (typeof step.value === "boolean" ? (step.value ? "on" : "off") : `${step.value}${control.type === "number" && control.unit ? ` ${control.unit}` : ""}`)}`);
    } else {
      const action = s.actions.find((a) => a.id === step.id)!;
      Object.assign(patch, action.patch ?? {});
      ops.push(...(action.ops ?? []));
      labels.push(action.label);
    }
  }
  return { patch, ops, labels };
}

const builds = (s: Scenario, v: Variant) => ({ api: { ...s.builds.api, ...v.builds }, worker: s.builds.worker });
const sortChanges = (changes: Change[]) => changes.map((c, i) => ({ c, i })).sort((a, b) => a.c.atMs - b.c.atMs || a.i - b.i).map((x) => x.c);

/** What happened up to the moment the learner is paged and starts working: the scenario's changes before the fix time. */
export function incidentRun(s: Scenario, v: Variant): Run {
  return simulate({ seed: s.seed, state: startState(s), changes: v.changes.filter((c) => c.atMs < s.timing.fixAtMs), builds: builds(s, v), features: s.features, endMs: s.timing.fixAtMs });
}

/** The same store, the same requests, with the learner's steps applied at the fix time and the run continued. */
export function continuedRun(s: Scenario, v: Variant, steps: Step[], stress: boolean): Run {
  const { patch, ops, labels } = combine(s, steps);
  const t = s.timing.fixAtMs;
  const mine: Change[] = steps.length ? [{ atMs: t, kind: "remediation", label: `Your changes: ${labels.join("; ")}`, patch, ops, visible: true, by: "learner" }] : [];
  const stressChanges = stress ? (v.stress ?? s.stress).changes(t) : [];
  return simulate({ seed: s.seed, state: startState(s), changes: sortChanges([...v.changes, ...mine, ...stressChanges]), builds: builds(s, v), features: s.features, endMs: s.timing.endMs });
}

/** The state the store is in after the learner's steps (for root-cause rules and invariants). */
export function stateAfter(s: Scenario, v: Variant, steps: Step[]): State {
  let state = startState(s);
  for (const change of v.changes) if (change.patch && change.atMs < s.timing.fixAtMs) state = applyPatch(state, change.patch);
  return applyPatch(state, combine(s, steps).patch);
}

export const incidentWindow = (s: Scenario): Window => ({ from: s.timing.faultAtMs, to: s.timing.fixAtMs });
export const recoveryWindow = (s: Scenario): Window => ({ from: s.timing.fixAtMs + s.timing.settleMs, to: s.timing.endMs });

export type CriterionResult = { id: string; label: string; why: string; run: "target" | "stress"; value: number; threshold: number; op: "<=" | ">="; unit: string; passed: boolean };
export type Outcome = {
  label: string;
  explanation: string;
  /** Recovery criteria met under today's workload. */
  serviceRecovered: boolean;
  stressPassed: boolean;
  rootCauseFixed: boolean;
  safe: boolean;
  symptomReduced: boolean;
  worse: boolean;
  fullyRecovered: boolean;
};
export type Verification = {
  target: Run;
  stress: Run;
  criteria: CriterionResult[];
  invariants: { id: string; label: string; ok: boolean; observed: string }[];
  rootCause: { label: string; fixed: boolean }[];
  incident: RequestFacts;
  after: RequestFacts;
  /** Milliseconds from the fix until the error rate stayed at or below 1% for the rest of the run, or null. */
  recoveryMs: number | null;
  outcome: Outcome;
};

export function verify(s: Scenario, v: Variant, steps: Step[], incident = incidentRun(s, v)): Verification {
  const target = continuedRun(s, v, steps, false);
  const stress = continuedRun(s, v, steps, true);
  const w = recoveryWindow(s);
  const criteria = s.criteria.map((c): CriterionResult => {
    const run = c.run === "target" ? target : stress;
    const window = c.window ? { from: c.window[0], to: c.window[1] } : w;
    const value = c.measure(run, window);
    return { id: c.id, label: c.label, why: c.why, run: c.run, value, threshold: c.threshold, op: c.op, unit: c.unit, passed: c.op === "<=" ? value <= c.threshold : value >= c.threshold };
  });
  const state = stateAfter(s, v, steps);
  const invariants = s.invariants.flatMap((inv) => [target, stress].map((run, i) => ({ id: inv.id, label: inv.label + (i ? " (under stress)" : ""), ...inv.check(run, state, s.timing.fixAtMs) }))).filter((r, i, all) => i % 2 === 0 || !r.ok || !all[i - 1].ok);
  const b = builds(s, v);
  const rootCause = v.rootCause.map((r) => ({ label: r.label, fixed: r.fixed(state, b) }));
  const before = requestFacts(incident, incidentWindow(s));
  const after = requestFacts(target, w);
  const serviceRecovered = criteria.filter((c) => c.run === "target").every((c) => c.passed);
  const stressPassed = criteria.filter((c) => c.run === "stress").every((c) => c.passed);
  const rootCauseFixed = rootCause.every((r) => r.fixed);
  const safe = invariants.every((r) => r.ok);
  // Better by at least 30% on the error rate, p95, or any target criterion, compared with the incident window.
  const iw = incidentWindow(s);
  const better = (now: number, then: number, op: "<=" | ">=") => (op === "<=" ? then > 0 && now <= then * 0.7 : now >= then * 1.3);
  const symptomReduced = better(after.errorRate, before.errorRate, "<=") || better(after.p95, before.p95, "<=") || s.criteria.some((c, i) => c.run === "target" && !c.window && better(criteria[i].value, c.measure(incident, iw), c.op));
  const worse = after.errorRate > before.errorRate + 2 || after.p95 > before.p95 * 1.3 + 100;
  const fullyRecovered = serviceRecovered && stressPassed && rootCauseFixed && safe;
  const failedInvariant = invariants.find((r) => !r.ok);
  const [label, explanation] = !safe
    ? ["Not safe", `${failedInvariant!.label}: ${failedInvariant!.observed}. While a safety or security requirement is broken the service doesn't count as recovered, whatever the other numbers say.`]
    : fullyRecovered
      ? ["Service fully recovered", "Every recovery criterion holds, under today's workload and under stress, and the root cause is no longer present."]
      : serviceRecovered && rootCauseFixed
        ? ["Root cause fixed, not yet robust", "The cause is gone and today's workload recovers, but the stress workload still fails a criterion."]
        : serviceRecovered
          ? ["Mitigated, root cause still present", `Customers are fine under today's workload, but ${rootCause.filter((r) => !r.fixed).map((r) => r.label.toLowerCase()).join(" and ")} isn't true yet${stressPassed ? "" : ", and the stress workload fails"}. The incident can come back.`]
          : rootCauseFixed
            ? ["Root cause fixed, service not recovered yet", "The cause is gone, but a recovery criterion still fails in the measured window (a backlog may still be draining, or capacity is short)."]
            : worse
              ? ["Worse than before", "After this change customers fare worse than during the incident."]
              : symptomReduced
                ? ["Symptom reduced", "Things improved, but the recovery criteria aren't met and the root cause is still present."]
                : ["No improvement", "Customers see about the same as during the incident."];
  return { target, stress, criteria, invariants, rootCause, incident: before, after, recoveryMs: recoveryTime(target, s.timing.fixAtMs), outcome: { label, explanation, serviceRecovered, stressPassed, rootCauseFixed, safe, symptomReduced, worse, fullyRecovered } };
}

/** First time after `from` from which every later bucket has an error rate of at most 1%. */
export function recoveryTime(run: Run, from: number): number | null {
  const list = buckets(run).filter((b) => b.from >= from && b.values.rps > 0);
  for (let i = 0; i < list.length; i++) if (list.slice(i).every((b) => b.values.errorRate <= 1)) return list[i].from - from;
  return null;
}

/** When a simple alert (error rate > 2% or p95 above twice the pre-incident p95 in one 2 s bucket) would first fire. */
export function detection(run: Run, faultAtMs: number) {
  const baseline = requestFacts(run, { from: 0, to: faultAtMs });
  const hit = buckets(run).find((b) => b.from >= faultAtMs && b.values.rps > 0 && (b.values.errorRate > 2 || b.values.p95 > baseline.p95 * 2));
  if (!hit) return null;
  return { atMs: hit.from, why: hit.values.errorRate > 2 ? `error rate ${hit.values.errorRate.toFixed(1)}% > 2%` : `p95 ${Math.round(hit.values.p95)} ms > 2 × ${Math.round(baseline.p95)} ms`, rule: `Simulated alert rule: error rate above 2%, or p95 above twice the pre-incident p95, in one ${BUCKET_MS / 1000} s bucket` };
}

// ---- Attempts and assessment ----

export type HypothesisState = { id: string; status: "unresolved" | "confirmed" | "rejected"; evidence: string[] };
export type Evidence = Finding & { source: string };
export type VerificationSummary = { steps: Step[]; label: string; fully: boolean; safe: boolean; worse: boolean; recovered: boolean; stress: boolean; root: boolean };
export type Attempt = {
  variant: string;
  steps: Step[];
  evidence: Evidence[];
  hypotheses: HypothesisState[];
  hints: number;
  diagnostics: string[];
  verifications: VerificationSummary[];
  notes: Record<string, string>;
};

export const summarize = (steps: Step[], v: Verification): VerificationSummary => ({ steps, label: v.outcome.label, fully: v.outcome.fullyRecovered, safe: v.outcome.safe, worse: v.outcome.worse, recovered: v.outcome.serviceRecovered, stress: v.outcome.stressPassed, root: v.outcome.rootCauseFixed });

export type Mark = "met" | "partly" | "not-met";
export type Dimension = { id: string; label: string; mark: Mark; detail: string };
export type Assessment = { dimensions: Dimension[]; completed: boolean; assisted: boolean };

/**
 * The rubric, from the attempt and the runs only. It checks what the learner established and did, never how they
 * phrased it, and accepts any remediation that meets the criteria. It can't measure judgement: it says which
 * observable parts of a good investigation happened.
 */
export function assess(s: Scenario, v: Variant, a: Attempt): Assessment {
  const has = new Set(a.evidence.map((e) => e.id));
  const abnormal = a.evidence.filter((e) => e.abnormal).length;
  const key = v.keyEvidence.filter((id) => has.has(id));
  const required = s.hypotheses.filter((h) => truthOf(h, v.id) === "root");
  const state = (id: string) => a.hypotheses.find((h) => h.id === id);
  const supported = (h: (typeof required)[number]) => (state(h.id)?.evidence ?? []).some((id) => h.supports.includes(id) && has.has(id));
  const rootsOk = required.filter((h) => state(h.id)?.status === "confirmed" && supported(h));
  const wrong = s.hypotheses.filter((h) => truthOf(h, v.id) === "false" && state(h.id)?.status === "confirmed");
  const rejectedRoots = required.filter((h) => state(h.id)?.status === "rejected");
  const last = a.verifications.at(-1);
  const current = last && JSON.stringify(last.steps) === JSON.stringify(a.steps);
  const harmful = a.verifications.filter((x) => x.worse || !x.safe).length;
  const dims: Dimension[] = [
    { id: "symptoms", label: "Identified the symptoms", mark: abnormal >= 2 ? "met" : abnormal === 1 ? "partly" : "not-met", detail: `${abnormal} abnormal finding${abnormal === 1 ? "" : "s"} collected as evidence` },
    { id: "evidence", label: "Gathered evidence for the cause", mark: key.length >= Math.min(3, v.keyEvidence.length) ? "met" : key.length ? "partly" : "not-met", detail: `${key.length} of the ${v.keyEvidence.length} findings that best explain this incident: ${key.join(", ") || "none yet"}` },
    {
      id: "root-cause", label: "Formed a defensible root-cause hypothesis",
      mark: rootsOk.length === required.length && !wrong.length ? "met" : rootsOk.length ? "partly" : "not-met",
      detail: `${rootsOk.length} of ${required.length} root cause${required.length === 1 ? "" : "s"} confirmed with supporting evidence attached${wrong.length ? `; ${wrong.length} hypothesis the evidence contradicts was confirmed` : ""}${rejectedRoots.length ? `; ${rejectedRoots.length} root cause was rejected` : ""}`,
    },
    { id: "safety", label: "Avoided harmful changes", mark: !a.verifications.length ? "not-met" : harmful === 0 ? "met" : last?.safe && !last.worse ? "partly" : "not-met", detail: a.verifications.length ? `${harmful} of ${a.verifications.length} verified change sets made things worse or broke a safety requirement` : "Nothing verified yet" },
    { id: "recovery", label: "Restored the service", mark: last?.fully ? "met" : last?.recovered ? "partly" : "not-met", detail: last ? `Last verification: ${last.label}` : "Nothing verified yet" },
    { id: "verification", label: "Verified the final change, including under stress", mark: current && last!.stress ? "met" : current ? "partly" : "not-met", detail: !last ? "Nothing verified yet" : current ? `Verified after the last change; stress ${last!.stress ? "passed" : "failed"}` : "Changed something after the last verification" },
  ];
  return { dimensions: dims, completed: !!last?.fully && !!current && rootsOk.length === required.length && !wrong.length, assisted: a.hints >= s.hints.length };
}

// ---- Postmortem ----

export type Source = "system" | "hypothesis" | "simulator" | "learner";
export type Entry = { source: Source; text: string };
export type Section = { id: string; title: string; entries: Entry[]; editable: boolean };
export const SOURCE_LABELS: Record<Source, string> = { system: "Verified system evidence", hypothesis: "Your hypothesis", simulator: "Simulator conclusion", learner: "Your analysis" };

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
export { clock };

/** The postmortem: facts from the runs, the learner's own hypotheses and notes, and the simulator's conclusion only once the incident is resolved. */
export function postmortem(s: Scenario, v: Variant, a: Attempt, incident: Run, verification: Verification | null, resolved: boolean): Section[] {
  const w = incidentWindow(s);
  const during = requestFacts(incident, w);
  const det = detection(incident, s.timing.faultAtMs);
  const sys = (text: string): Entry => ({ source: "system", text });
  const note = (id: string): Entry[] => (a.notes[id]?.trim() ? [{ source: "learner", text: a.notes[id].trim() }] : []);
  const byEndpoint = s.endpoints.map((e) => [e, requestFacts(incident, w, e)] as const).filter(([, f]) => f.requests);
  const changes = incident.events.filter((e) => e.type === "change" && v.changes.some((c) => c.visible && c.label === e.label));
  const confirmed = s.hypotheses.filter((h) => a.hypotheses.find((x) => x.id === h.id)?.status === "confirmed");
  const ev = (id: string) => a.evidence.find((e) => e.id === id);
  const ver = verification;
  return [
    { id: "summary", title: "Incident summary", editable: true, entries: [sys(`${s.title}. ${s.report}`), ...note("summary")] },
    { id: "impact", title: "Customer impact", editable: true, entries: [sys(`From ${clock(w.from)} to ${clock(w.to)}: ${during.failures} of ${during.requests} customer requests failed (${during.errorRate.toFixed(1)}%), p95 ${Math.round(during.p95)} ms.`), ...byEndpoint.map(([e, f]) => sys(`${e}: ${f.failures} of ${f.requests} failed (${f.errorRate.toFixed(1)}%), p95 ${Math.round(f.p95)} ms`)), ...note("impact")] },
    { id: "detection", title: "Detection", editable: true, entries: [sys(det ? `${det.rule}: it would have fired at ${clock(det.atMs)} (${det.why}).` : "The simulated alert rule never fired."), ...note("detection")] },
    { id: "timeline", title: "Timeline", editable: true, entries: [...changes.map((e) => sys(`${clock(e.t)} ${e.label}`)), ...(det ? [sys(`${clock(det.atMs)} Alert condition met (${det.why})`)] : []), ...(ver && a.steps.length ? [sys(`${clock(s.timing.fixAtMs)} Your changes applied: ${combine(s, a.steps).labels.join("; ")}`), sys(ver.recoveryMs === null ? "The error rate did not stay at or below 1% before the end of the run" : `${clock(s.timing.fixAtMs + ver.recoveryMs)} Error rate back at or below 1% and stayed there`)] : []), ...note("timeline")] },
    { id: "evidence", title: "Evidence gathered", editable: false, entries: a.evidence.length ? a.evidence.map((e) => sys(`${e.title}: ${e.detail} (${e.source})`)) : [sys("No evidence collected.")] },
    { id: "root-cause", title: "Root cause", editable: true, entries: [...(confirmed.length ? confirmed.map((h) => ({ source: "hypothesis" as const, text: `${h.text}${(a.hypotheses.find((x) => x.id === h.id)?.evidence ?? []).length ? `, supported by: ${a.hypotheses.find((x) => x.id === h.id)!.evidence.map((id) => ev(id)?.title ?? id).join("; ")}` : " (no evidence attached)"}` })) : [{ source: "hypothesis" as const, text: "No hypothesis confirmed." }]), ...(resolved ? [{ source: "simulator" as const, text: v.conclusion }] : []), ...note("root-cause")] },
    { id: "contributing", title: "Contributing factors", editable: true, entries: [...s.hypotheses.filter((h) => truthOf(h, v.id) === "contributing" && a.hypotheses.find((x) => x.id === h.id)?.status === "confirmed").map((h) => ({ source: "hypothesis" as const, text: h.text })), ...note("contributing")] },
    { id: "mitigation", title: "Mitigation", editable: true, entries: [...a.verifications.map((x, i) => sys(`Verification ${i + 1}: ${x.steps.length ? combine(s, x.steps).labels.join("; ") : "no change"} → ${x.label}`)), ...note("mitigation")] },
    { id: "resolution", title: "Resolution", editable: true, entries: [...(ver ? ver.rootCause.map((r) => sys(`${r.fixed ? "Resolved" : "Not resolved"}: ${r.label}`)) : []), ...note("resolution")] },
    { id: "verification", title: "Verification", editable: false, entries: ver ? [...ver.criteria.map((c) => sys(`${c.passed ? "Passed" : "Failed"}: ${c.label} (measured ${fmt(c.value)} ${c.unit}${c.run === "stress" ? ", stress run" : ""})`)), ...ver.invariants.map((r) => sys(`${r.ok ? "Held" : "Broken"}: ${r.label}. ${r.observed}`))] : [sys("Not verified.")] },
    { id: "prevention", title: "Preventive actions", editable: true, entries: [...note("prevention"), ...(resolved ? s.prevention.map((p) => ({ source: "simulator" as const, text: p })) : [])] },
    { id: "lessons", title: "Lessons learned", editable: true, entries: note("lessons") },
  ];
}
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(n < 10 ? 2 : 1));

export function postmortemMarkdown(s: Scenario, sections: Section[]) {
  const lines = [`# Postmortem: ${s.title}`, "", `Kitab Production Incident Simulator, scenario "${s.family}". Every fact below comes from a simulated store, not a real system.`, ""];
  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    if (!section.entries.length) lines.push("_Nothing yet._", "");
    for (const e of section.entries) lines.push(`- **${SOURCE_LABELS[e.source]}:** ${e.text}`);
    lines.push("");
  }
  return lines.join("\n");
}
