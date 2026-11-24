// The Real Engineering Lab's contracts. A lab is data: what the learner is asked to do, what is real and what is a
// model, how the work is judged (tests that run the learner's code, or checks over a real HTTP exchange), hints, a
// worked solution, and where it connects to the rest of Kitab. Pure types and helpers: no React, no DOM.
import type { glossary } from "../learning/glossary.ts";

export type Subject = "networking" | "structures" | "architecture" | "identity";
export const SUBJECTS: readonly Subject[] = ["networking", "structures", "architecture", "identity"];
export const subjectLabel: Record<Subject, string> = {
  networking: "Networking",
  structures: "Data structures & programming",
  architecture: "System design",
  identity: "Identity & security",
};

export type ExecutionMode = "real-execution" | "real-protocol" | "real-configuration" | "emulated" | "simulated" | "unavailable";
export const modeLabel: Record<ExecutionMode, string> = {
  "real-execution": "Real execution",
  "real-protocol": "Real protocol",
  "real-configuration": "Real configuration",
  emulated: "Emulated",
  simulated: "Simulated",
  unavailable: "Unavailable in the browser",
};
export const modeMeaning: Record<ExecutionMode, string> = {
  "real-execution": "Your code runs on this browser's own JavaScript engine, in an isolated sandbox.",
  "real-protocol": "Real HTTP requests go from this browser to Kitab's server, and its real responses come back.",
  "real-configuration": "A genuine parser or application interprets your configuration.",
  emulated: "A disclosed interpreter implements part of a technology.",
  simulated: "Kitab's deterministic simulator models the behaviour.",
  unavailable: "Needs a real operating system or server that can't run safely in a browser.",
};

export type Difficulty = "beginner" | "intermediate" | "advanced";
export const difficultyLabel: Record<Difficulty, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

/** One step of "what the computer does". observed: Kitab shows the real evidence for it; otherwise it's explained. */
export type ComputerStep = { title: string; detail: string; observed: boolean };

/** A setting or value that matters in real systems: what, why, where, who, how to change and verify it, and what Kitab does with it. */
export type ConfigNote = {
  name: string;
  what: string;
  why: string;
  where: string;
  who: string;
  change: string;
  verify: string;
  effect: string;
  kitab: string;
  example?: { label: string; code: string };
};

export type Related = { label: string; path: string; kind: "learn" | "practice" | "playground" };
export type StageLink = { track: "networking" | "data-structures" | "system-design" | "identity"; stage: string };

type LabBase = {
  id: string;
  /** Raise when the starter, tests or tasks change meaning; saved work from an older version is kept and flagged. */
  version: number;
  subject: Subject;
  title: string;
  summary: string;
  difficulty: Difficulty;
  minutes: number;
  /** The real mode, plus any model it uses, shown on the lab: e.g. a real resolver over a modeled zone. */
  modes: ExecutionMode[];
  /** Exactly what is real and what isn't, in one or two sentences. */
  modeNote: string;
  objective: string;
  problem: string;
  build: string;
  canChange: string;
  tools: string;
  verify: string;
  success: string;
  computer: ComputerStep[];
  configs: ConfigNote[];
  terms: (keyof typeof glossary)[];
  related: Related[];
  stages: StageLink[];
  /** Values the learner uses in the tasks (for example synthetic tokens), shown beside the workspace with a copy button. */
  reference?: { title: string; note: string; items: { label: string; value: string }[] };
};

export type CodeLab = LabBase & {
  kind: "code";
  file: string;
  starter: string;
  solution: string;
  /** Names the tests call on the learner's code. */
  exports: string[];
  /** JavaScript run after the learner's code on Check, given test(), assert, lab (the exports) and sleep(). */
  tests: string;
  timeoutMs: number;
  hints: string[];
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
export const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

/** A request as the learner writes it. Only paths under /api/lab/ can be sent. */
export type RequestDraft = {
  method: HttpMethod;
  path: string;
  headers: { name: string; value: string }[];
  body: string;
  timeoutMs: number;
  /** fetch's cache mode: "no-store" bypasses the browser's HTTP cache, "default" lets it answer. */
  cache: "no-store" | "default";
};

export type Timing = {
  protocol: string;
  dnsMs: number;
  connectMs: number;
  tlsMs: number;
  /** True when the browser reports no connection setup for this request: it used one already open. */
  reused: boolean;
  waitMs: number;
  totalMs: number;
  transferSize: number;
};

export type SentRequest = { method: HttpMethod; url: string; path: string; headers: [string, string][]; body: string; timeoutMs: number; cache: RequestDraft["cache"] };
export type ReceivedResponse = { status: number; statusText: string; headers: [string, string][]; body: string; json?: unknown; redirected: boolean; url: string; truncated: boolean };

/** One send and what really came of it. Never stored: it exists only in the page that made it. */
export type Observation = {
  at: number;
  request: SentRequest;
  outcome: "response" | "timeout" | "network-error" | "refused";
  error?: string;
  response?: ReceivedResponse;
  timing?: Timing | null;
  elapsedMs: number;
};

export type HttpCheck = {
  label: string;
  /** Reads only the real exchange(s): the latest observation and this task's earlier ones, oldest first. */
  test: (latest: Observation, history: Observation[]) => boolean;
};

/** A question answered from the evidence; the right option is computed from what was observed, never stored. */
export type EvidenceQuestion = {
  prompt: string;
  options: { id: string; label: string }[];
  answer: (history: Observation[]) => string | null;
  explain: string;
};

export type HttpTask = {
  id: string;
  title: string;
  goal: string;
  starter: RequestDraft;
  solution: RequestDraft;
  checks: HttpCheck[];
  question?: EvidenceQuestion;
  hints: string[];
  /** Shows the browser-cache option in the builder. */
  cacheControl?: boolean;
};

export type HttpLab = LabBase & { kind: "http"; tasks: HttpTask[] };

export type Lab = CodeLab | HttpLab;

export type FutureLab = { id: string; title: string; subject: Subject; needs: string; localPath: string };

export const labPath = (lab: Pick<Lab, "subject" | "id">) => `/lab/${lab.subject}/${lab.id}`;

export const draft = (method: HttpMethod, path: string, extra: Partial<RequestDraft> = {}): RequestDraft => ({
  method,
  path,
  headers: [],
  body: "",
  timeoutMs: 8000,
  cache: "no-store",
  ...extra,
});

// ---- helpers for checks: read the real exchange ----

export const header = (pairs: [string, string][] | undefined, name: string) => pairs?.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
export const status = (o: Observation) => o.response?.status;
/** What Kitab's echo endpoint says it received, if this was an echo response. */
export function received(o: Observation): { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: { bytes: number; text: string; json?: unknown } } | undefined {
  const value = o.response?.json as { received?: unknown } | undefined;
  const r = value && typeof value === "object" ? value.received : undefined;
  return r && typeof r === "object" ? (r as ReturnType<typeof received>) : undefined;
}
