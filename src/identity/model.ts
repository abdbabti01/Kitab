// The Identity Playground's protocol model. A scenario run produces ONE canonical event stream; the sequence view,
// the inspector, the state panel (browser, application, identity provider, API), validation results, the outcome
// and every guided experiment and challenge read that stream or a fold of it. Pure: no React, no DOM, no clock,
// no randomness. Identifiers, codes and token values are fixed synthetic strings so runs replay exactly.
//
// Signatures here are MODELLED: a token records which key signed it and every verifier checks that against the keys
// it trusts. Real signing and verification (Web Crypto) is in jwt.ts and the Token Inspector, and is labelled so.

export type ActorId = "user" | "browser" | "app" | "app-b" | "idp" | "api" | "service" | "device" | "phone" | "authenticator" | "attacker";
export type Actor = { id: ActorId; label: string; role: string; origin?: string };

/** front: travels through the browser by redirect or form post. back: a direct HTTPS request between two parties. internal: work inside one party. */
export type Channel = "front" | "back" | "internal";
export type EventKind = "request" | "response" | "redirect" | "action";

export type Token = {
  kind: "id_token" | "access_token" | "refresh_token" | "code" | "session" | "saml_assertion" | "logout_token" | "device_code" | "credential" | "otp";
  label: string;
  format: "jwt" | "opaque" | "xml" | "cookie" | "other";
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  /** Modelled signature: the key that signed it, or "none". */
  signedBy?: string;
  value: string;
};

export type Check = {
  id: string;
  label: string;
  ok: boolean;
  /** What was compared, with the actual values. */
  detail: string;
  /** "security": the protocol ran, but something it should prevent happened (an attacker gained access). */
  kind?: "protocol" | "security";
  /** Where the rule comes from, e.g. "RFC 7636 §4.6". */
  rule?: string;
};

export type StateChange = { at: ActorId; key: string; value: string | null; token?: Token; note?: string };

export type FlowEvent = {
  step: number;
  /** Seconds after the scenario starts. */
  t: number;
  from: ActorId;
  to: ActorId;
  kind: EventKind;
  channel: Channel;
  /** Short label on the arrow. */
  title: string;
  method?: string;
  /** Full URL or path the message goes to. */
  endpoint?: string;
  status?: number;
  headers?: [string, string][];
  params?: [string, string][];
  body?: string;
  tokens?: Token[];
  checks?: Check[];
  sets?: StateChange[];
  /** Why this message exists. */
  purpose: string;
  /** What protects it in transit or at rest. */
  protects?: string;
  /** What happens if one of its checks fails (shown even when they pass). */
  ifFails?: string;
  /** What comes next. */
  next?: string;
};

export type Option = { value: string; label: string; /** When false for a configuration, the option can't be chosen. */ when?: (c: Config) => boolean };
export type Control = { id: string; label: string; help: string; level: "basic" | "advanced" | "fault"; options: Option[] };
export type Config = Record<string, string>;

export type Scenario = {
  id: string;
  title: string;
  summary: string;
  /** The specifications the scenario follows. */
  standards: string[];
  actors: Actor[];
  controls: Control[];
  run: (config: Config) => Omit<FlowEvent, "step">[];
  /** What is modelled and what isn't, shown beside the run. */
  modelNote: string;
  notModelled: string[];
};

export type FlowRun = { scenario: string; config: Config; actors: Actor[]; events: FlowEvent[] };

export const MAX_EVENTS = 60;

/** Each control's value from untrusted input (a query string, saved prefs); anything unknown or unavailable takes the first option. */
export function parseConfig(scenario: Scenario, raw: Record<string, string | undefined>): Config {
  const config: Config = {};
  for (const control of scenario.controls) config[control.id] = control.options[0].value;
  // Faults and dependent options are resolved after the basics, in declaration order.
  for (const control of scenario.controls) {
    const value = raw[control.id];
    const option = control.options.find((o) => o.value === value);
    if (option && (!option.when || option.when(config))) config[control.id] = value!;
  }
  for (const control of scenario.controls) {
    const chosen = control.options.find((o) => o.value === config[control.id]);
    if (chosen?.when && !chosen.when(config)) config[control.id] = control.options[0].value;
  }
  return config;
}

export function runScenario(scenario: Scenario, raw: Record<string, string | undefined> = {}): FlowRun {
  const config = parseConfig(scenario, raw);
  const events = scenario.run(config).slice(0, MAX_EVENTS).map((e, step) => ({ ...e, step }));
  return { scenario: scenario.id, config, actors: scenario.actors, events };
}

/** The first failed check, and the event it failed in. Null when every check passed. */
export function firstFailure(run: FlowRun) {
  for (const event of run.events) {
    const check = event.checks?.find((c) => !c.ok);
    if (check) return { event, check };
  }
  return null;
}

export type Outcome = { ok: boolean; at: number | null; check: Check | null; summary: string };

/** The run's result, read from the events: success, a check that stopped the flow, or a security failure. */
export function outcomeOf(run: FlowRun): Outcome {
  const failure = firstFailure(run);
  const last = run.events.at(-1);
  if (!failure) return { ok: true, at: null, check: null, summary: last ? `Completed: ${last.title}` : "Nothing ran." };
  const { event, check } = failure;
  return {
    ok: false,
    at: event.step,
    check,
    summary: check.kind === "security" ? `Security failure at step ${event.step + 1}: ${check.label}` : `Stopped at step ${event.step + 1}: ${check.label}`,
  };
}

export type Held = { value: string; token?: Token; since: number; note?: string };
export type World = Partial<Record<ActorId, Record<string, Held>>>;

/** What each party holds after `upTo` (inclusive): a pure fold of the events' state changes. */
export function stateAt(run: FlowRun, upTo: number): World {
  const world: World = {};
  for (const event of run.events) {
    if (event.step > upTo) break;
    for (const change of event.sets ?? []) {
      const place = (world[change.at] ??= {});
      if (change.value === null) delete place[change.key];
      else place[change.key] = { value: change.value, token: change.token, since: event.step, note: change.note };
    }
  }
  return world;
}

/**
 * Builds a scenario's events. Once a check fails, the flow stops: only the failure's consequence (`after`) is
 * added, and later steps are ignored, as a real implementation would stop.
 */
export function flow() {
  const events: Omit<FlowEvent, "step">[] = [];
  let stopped = false;
  let t = 0;
  const api = {
    get stopped() {
      return stopped;
    },
    /** Advance the scenario clock. */
    wait(seconds: number) {
      t += seconds;
    },
    get now() {
      return t;
    },
    add(event: Omit<FlowEvent, "step" | "t">, after?: Omit<FlowEvent, "step" | "t">) {
      if (stopped) return false;
      events.push({ ...event, t });
      if (event.checks?.some((c) => !c.ok)) {
        stopped = true;
        if (after) events.push({ ...after, t });
        return false;
      }
      return true;
    },
    events,
  };
  return api;
}

export const check = (id: string, label: string, ok: boolean, detail: string, rule?: string, kind?: Check["kind"]): Check => ({ id, label, ok, detail, rule, kind });
