// Incident progress in this browser (kitab.incidents.v1, through keyed-store): the attempt in progress and the
// history of finished ones. Only the learner's decisions are stored (mode, steps, evidence, hypotheses, notes);
// runs are recomputed from the scenario's seed and those steps, so no event stream is ever saved. Every field is
// bounded. A record this Kitab can't read is kept untouched; completion is only ever written by `finish`, which
// the page calls when the assessment says the attempt is complete.
import { z } from "zod";
import { readStore, updateStore, type StorageLike } from "../learning/keyed-store.ts";
import type { Attempt } from "./assess.ts";

export const INCIDENTS_KEY = "kitab.incidents.v1";
const text = (n: number) => z.string().max(n);
const time = text(40);
const value = z.union([text(80), z.number().finite(), z.boolean()]);
const step = z.union([z.object({ kind: z.literal("set"), path: text(60), value }).strict(), z.object({ kind: z.literal("action"), id: text(60) }).strict()]);
const evidence = z.object({ id: text(80), title: text(200), detail: text(600), abnormal: z.boolean(), source: text(120) }).strict();
const attemptSchema = z.object({
  variant: text(40),
  startedAt: time,
  mode: z.enum(["guided", "independent"]),
  steps: z.array(step).max(30),
  evidence: z.array(evidence).max(40),
  hypotheses: z.array(z.object({ id: text(40), status: z.enum(["unresolved", "confirmed", "rejected"]), evidence: z.array(text(80)).max(12) }).strict()).max(12),
  hints: z.number().int().min(0).max(10),
  diagnostics: z.array(text(40)).max(40),
  verifications: z.array(z.object({ steps: z.array(step).max(30), label: text(80), fully: z.boolean(), safe: z.boolean(), worse: z.boolean(), recovered: z.boolean(), stress: z.boolean(), root: z.boolean() }).strict()).max(20),
  notes: z.record(text(30), text(2000)),
}).strict();
const record = z.object({
  version: text(20),
  attempts: z.number().int().min(0).max(1000),
  current: attemptSchema.nullable(),
  history: z.array(z.object({ variant: text(40), startedAt: time.optional(), finishedAt: time, assisted: z.boolean(), mode: z.enum(["guided", "independent"]) }).strict()).max(30),
  completedAt: time.optional(),
}).strict();

export type StoredAttempt = z.infer<typeof attemptSchema>;
export type IncidentRecord = z.infer<typeof record>;
const collections = { incidents: record };

export function loadIncidents(storage: StorageLike) {
  const { records, status } = readStore(storage, INCIDENTS_KEY, 1, collections);
  return { records: records.incidents, status };
}

function update(storage: StorageLike, id: string, version: string, change: (r: IncidentRecord) => void) {
  let out: IncidentRecord | undefined;
  const { saved } = updateStore(storage, INCIDENTS_KEY, 1, collections, (records) => {
    const existing = records.incidents[id];
    // A new scenario version starts a fresh record; history from the old one is kept with it as completion.
    const r: IncidentRecord = existing && existing.version === version ? existing : { version, attempts: existing?.attempts ?? 0, current: null, history: existing?.history ?? [], completedAt: existing?.completedAt };
    change(r);
    records.incidents[id] = out = r;
  });
  return { record: out!, saved };
}

export const newAttempt = (variant: string, mode: StoredAttempt["mode"]): StoredAttempt => ({ variant, startedAt: new Date().toISOString(), mode, steps: [], evidence: [], hypotheses: [], hints: 0, diagnostics: [], verifications: [], notes: {} });

/** Saves the attempt in progress (parsed first, so a bad value is never written). */
export function saveAttempt(storage: StorageLike, id: string, version: string, attempt: StoredAttempt) {
  const parsed = attemptSchema.safeParse(attempt);
  if (!parsed.success) return { saved: false };
  return update(storage, id, version, (r) => {
    r.current = parsed.data;
  });
}

/** Starts the next attempt (the next variant comes from the attempt count). */
export function startAttempt(storage: StorageLike, id: string, version: string, attempt: StoredAttempt) {
  return update(storage, id, version, (r) => {
    r.attempts++;
    r.current = attempt;
  });
}

/** Records a verified completion. Called only when `assess` says the attempt is complete. */
export function finish(storage: StorageLike, id: string, version: string, attempt: StoredAttempt, assisted: boolean) {
  return update(storage, id, version, (r) => {
    const at = new Date().toISOString();
    // Once per attempt: reopening a finished attempt doesn't record it again.
    if (!r.history.some((h) => h.startedAt === attempt.startedAt)) r.history = [...r.history, { variant: attempt.variant, startedAt: attempt.startedAt, finishedAt: at, assisted, mode: attempt.mode }].slice(-30);
    r.completedAt ??= at;
    r.current = attempt;
  });
}

/** Explicit reset of one incident: the attempt in progress goes, history stays. */
export function resetAttempt(storage: StorageLike, id: string, version: string) {
  return update(storage, id, version, (r) => {
    r.current = null;
  });
}

export const toAttempt = (a: StoredAttempt): Attempt => a as Attempt;
export type IncidentState = "not-started" | "in-progress" | "completed";
export const stateOf = (r: IncidentRecord | undefined): IncidentState => (r?.completedAt ? "completed" : r?.current ? "in-progress" : "not-started");
