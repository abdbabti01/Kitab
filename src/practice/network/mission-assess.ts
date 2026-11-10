// Judging a mission attempt from the network the learner built and the runs it produces.
// Pure and deterministic: no UI state, no text matching on what the learner typed.
import { newSession, simulate } from "./engine.ts";
import { failures } from "./explanations.ts";
import type { Device, Network, Trace } from "./model.ts";
import type { Area, Aspect, FixMission, InvestigateMission, Lock, NetworkMission, Variant } from "./missions.ts";

export type CheckResult = {
  id: string;
  label: string;
  passed: boolean;
  /** Why it failed or does not count yet; empty when passed. */
  message: string;
  /** The run behind the result, and the event that proves it either way. */
  trace: Trace;
  evidence: number;
};
export type Assessment = {
  completed: boolean;
  checks: CheckResult[];
  /** Settings the mission keeps fixed that were changed, with why. */
  locked: string[];
  /** Changes that hide the problem instead of solving it. */
  shortcuts: string[];
};

/** Runs a sequence of actions on one fresh session, stopping at the first failure. */
export function runSequence(network: Network, actions: import("./model.ts").Action[]): Trace {
  let session = newSession(),
    trace!: Trace;
  for (const action of actions) {
    trace = simulate(network, session, action);
    session = trace.session;
    if (!trace.success) break;
  }
  return trace;
}

export function runChecks(mission: FixMission, variant: Variant, network: Network): CheckResult[] {
  return mission.checks.map((check) => {
    const trace = runSequence(network, check.actions(network, variant));
    const last = trace.events.length - 1;
    if (!trace.success) {
      const title = trace.reason ? failures[trace.reason].title : "Delivery stopped";
      // The summary is only what was observed; the diagnosis and advice stay with the learner.
      return { id: check.id, label: check.label, passed: false, message: `${title}: ${trace.summary}`, trace, evidence: last };
    }
    const missing = check.expect?.(trace.events, network) ?? null;
    const proof = check.proof?.(trace.events) ?? -1;
    return { id: check.id, label: check.label, passed: !missing, message: missing ?? "", trace, evidence: proof >= 0 ? proof : last };
  });
}

/** The value of one lockable aspect of a device, for comparing before and after. */
export function aspectOf(d: Device, aspect: Aspect): string {
  const ports = (keys: (keyof Device["interfaces"][number])[]) =>
    JSON.stringify(d.interfaces.map((p) => keys.map((k) => p[k])));
  switch (aspect) {
    case "addresses":
      return d.interfaces.some((p) => p.mode === "dhcp") ? ports(["mode"]) : ports(["ip", "prefix"]);
    case "gateways":
      return ports(["gateway"]);
    case "dns":
      return ports(["dns"]);
    case "ports":
      return ports(["enabled"]);
    case "mode":
      return ports(["mode"]);
    case "wifi":
      return JSON.stringify([d.ssid, d.password]);
    case "routes":
      return JSON.stringify(d.routes);
    case "nat":
      return JSON.stringify([d.nat, d.inside, d.outside]);
    case "dhcp":
      return JSON.stringify(d.dhcp);
    case "services":
      return JSON.stringify([d.records, d.web]);
  }
}
const lockApplies = (lock: Lock, id: string) => !lock.devices || lock.devices.includes(id);

/** The lock an edit to one device would break, if any. */
export function lockBroken(mission: NetworkMission, before: Device, after: Device): Lock | undefined {
  return mission.locks.find((lock) => lockApplies(lock, before.id) && aspectOf(before, lock.aspect) !== aspectOf(after, lock.aspect));
}
const topology = (n: Network) =>
  JSON.stringify([
    n.devices.map((d) => d.id).sort(),
    n.links.map((l) => [`${l.a.device}/${l.a.port}`, `${l.b.device}/${l.b.port}`].sort().join("~")).sort(),
  ]);

export function lockedChanges(mission: NetworkMission, variant: Variant, network: Network): string[] {
  const start = variant.build();
  const out: string[] = [];
  if (mission.topologyLocked && topology(start) !== topology(network)) out.push(`The cabling or devices changed. ${mission.topologyLocked}`);
  for (const before of start.devices) {
    const after = network.devices.find((d) => d.id === before.id);
    const lock = after && lockBroken(mission, before, after);
    if (lock) out.push(`${after!.name}: ${lock.why}`);
  }
  return [...new Set(out)];
}

export function assessFix(mission: FixMission, variant: Variant, network: Network): Assessment {
  const checks = runChecks(mission, variant, network);
  const locked = lockedChanges(mission, variant, network);
  const shortcuts = (mission.shortcuts ?? []).filter((s) => s.detect(network)).map((s) => s.message);
  return { completed: checks.every((c) => c.passed) && !locked.length && !shortcuts.length, checks, locked, shortcuts };
}

export type Diagnosis = { device: string; area: Area };
export function diagnose(variant: Variant, guess: Diagnosis, network: Network) {
  const name = network.devices.find((d) => d.id === guess.device)?.name ?? guess.device;
  if (variant.faults.some((f) => f.device === guess.device && f.area === guess.area))
    return { correct: true, message: `Yes: the problem is ${name}'s setting.` };
  if (variant.faults.some((f) => f.device === guess.device))
    return { correct: false, message: `${name} is involved, but that kind of setting is fine. Compare what it was asked to do with what it did.` };
  return { correct: false, message: `${name} is not where the problem starts. Follow the journey to the step where delivery stopped, then work back.` };
}

/**
 * Whether an event shows the problem: in a run that failed, the step where it stopped or any step taken
 * by, or sent to, the device at fault. For an investigation, one of the mission's evidence events.
 */
export function evidenceShows(mission: NetworkMission, variant: Variant, trace: Trace, index: number) {
  const e = trace.events[index];
  if (!e) return false;
  if (mission.kind === "investigate") return (mission as InvestigateMission).evidence(trace.events).includes(index);
  if (trace.success) return false;
  const devices = variant.faults.map((f) => f.device);
  return e.error === true || devices.includes(e.actor) || (!!e.hop && (devices.includes(e.hop.from) || devices.includes(e.hop.to)));
}

/** The answer to an investigation's question, computed from the variant's own run. */
export function investigationAnswer(mission: InvestigateMission, variant: Variant) {
  const trace = simulate(variant.build(), newSession(), variant.probe);
  return mission.question.answer(trace.events);
}
