// Identity track progress in this browser: unit checks, challenge attempts, and the Playground's last scenario.
// Its own additive store through keyed-store.ts (damaged or newer records are kept aside, other tabs' records are
// never overwritten, nothing else is read or changed). Only zod: the track reads this on every page.
//
// Never stored here: tokens, passwords, secrets or keys, and no protocol traces (runs are rebuilt from the
// deterministic engine). The Playground keeps only a scenario id and its validated control values.
import { z } from "zod";
import { readStore, updateStore, type StorageLike } from "../learning/keyed-store.ts";

export const IDENTITY_KEY = "kitab.identity.v1";
const time = z.string().max(40);
const unitRecord = z.object({
  answers: z.record(z.string().max(80), z.object({ correct: z.boolean(), at: time }).strict()),
  completedAt: time.optional(),
}).strict();
const challengeRecord = z.object({
  version: z.string().max(20),
  lastAt: time,
  /** The variant being worked on. */
  variant: z.string().max(40),
  attempts: z.number().int().min(0).max(100_000),
  /** Variants passed, each once. */
  passed: z.array(z.string().max(40)).max(20),
  passedAt: time.optional(),
  masteredAt: time.optional(),
}).strict();
const prefsRecord = z.object({
  scenario: z.string().max(40).optional(),
  config: z.record(z.string().max(40), z.string().max(60)).optional(),
  at: time,
}).strict();
const collections = { units: unitRecord, challenges: challengeRecord, prefs: prefsRecord };

export type IdentityProgress = { units: Record<string, z.infer<typeof unitRecord>>; challenges: Record<string, z.infer<typeof challengeRecord>>; prefs: Record<string, z.infer<typeof prefsRecord>> };
export type ChallengeRecord = z.infer<typeof challengeRecord>;

export const emptyIdentityProgress = (): IdentityProgress => ({ units: {}, challenges: {}, prefs: {} });

export function loadIdentityProgress(storage: StorageLike): IdentityProgress {
  return readStore(storage, IDENTITY_KEY, 1, collections).records;
}

function update(storage: StorageLike, change: (p: IdentityProgress) => void): IdentityProgress & { saved: boolean } {
  let progress = emptyIdentityProgress();
  const { saved } = updateStore(storage, IDENTITY_KEY, 1, collections, (records) => change((progress = records)));
  return { ...progress, saved };
}

/** Records a unit check; the unit completes once every check id has been answered right (never un-completes). */
export function recordUnitCheck(storage: StorageLike, unit: string, check: string, correct: boolean, all: string[], now = new Date().toISOString()) {
  return update(storage, (p) => {
    const record = (p.units[unit] ??= { answers: {} });
    record.answers[check] = { correct, at: now };
    if (!record.completedAt && all.every((id) => record.answers[id]?.correct)) record.completedAt = now;
  });
}

export function challengeRecordFor(progress: IdentityProgress, id: string, version: string) {
  const record = progress.challenges[id];
  return record && record.version === version ? record : undefined;
}

/** Not started / in progress / completed (passed one variant) / mastered (passed two different variants). */
export function challengeState(record: ChallengeRecord | undefined): "not-started" | "in-progress" | "completed" | "mastered" {
  if (!record) return "not-started";
  if (record.masteredAt) return "mastered";
  if (record.passedAt) return "completed";
  return record.attempts > 0 ? "in-progress" : "not-started";
}

/** One judged submission. Passing in a second distinct variant masters a challenge that has several variants. */
export function recordAttempt(storage: StorageLike, id: string, version: string, variant: string, passed: boolean, variants: number, now = new Date().toISOString()) {
  return update(storage, (p) => {
    const existing = challengeRecordFor(p, id, version);
    const record = existing ?? { version, lastAt: now, variant, attempts: 0, passed: [] };
    record.lastAt = now;
    record.variant = variant;
    record.attempts += 1;
    if (passed && !record.passed.includes(variant)) record.passed.push(variant);
    if (passed && !record.passedAt) record.passedAt = now;
    if (!record.masteredAt && variants > 1 && record.passed.length >= 2) record.masteredAt = now;
    p.challenges[id] = record;
  });
}

/** Moves to another variant ("try another version"); keeps every pass. */
export function chooseVariant(storage: StorageLike, id: string, version: string, variant: string, now = new Date().toISOString()) {
  return update(storage, (p) => {
    const record = challengeRecordFor(p, id, version) ?? { version, lastAt: now, variant, attempts: 0, passed: [] };
    record.variant = variant;
    record.lastAt = now;
    p.challenges[id] = record;
  });
}

/** The Playground's last scenario and settings (validated again by parseConfig when read). */
export function savePlayground(storage: StorageLike, scenario: string, config: Record<string, string>, now = new Date().toISOString()) {
  return update(storage, (p) => {
    p.prefs.playground = { scenario, config: Object.fromEntries(Object.entries(config).slice(0, 12).map(([k, v]) => [k.slice(0, 40), v.slice(0, 60)])), at: now };
  });
}
