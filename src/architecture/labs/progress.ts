// Progress in architecture labs and in the concept checks of System Design units, in this browser. Its own
// additive store (the v1 architecture store is strict and stays as it is); damaged data is kept aside.
// Only zod: the track reads this on every page.
//
// Mastery of a lab needs one attempt with all three: the first prediction right, a configuration that passes
// every check, and the first answer to the reasoning question right. Passing the checks alone completes it.
import { z } from "zod";
import { readStore, updateStore } from "../../learning/keyed-store.ts";

export const LABS_KEY = "kitab.architecture.labs.v1";
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const time = z.string().max(40);
const attemptSchema = z.object({
  variant: z.string().max(40),
  question: z.string().max(40),
  startedAt: time,
  predicted: z.object({ value: z.number(), correct: z.boolean() }).strict().optional(),
  passedAt: time.optional(),
  answered: z.object({ choice: z.number().int().min(0).max(9), correct: z.boolean() }).strict().optional(),
  masteredAt: time.optional(),
}).strict();
const labRecord = z.object({
  version: z.string().max(20),
  lastAt: time,
  attempts: z.array(attemptSchema).max(50),
  /** The learner's working configuration (parsed against the lab's controls when used). */
  config: z.record(z.string().max(40), z.union([z.string().max(60), z.number(), z.boolean()])).optional(),
  passedAt: time.optional(),
  masteredAt: time.optional(),
}).strict();
const unitRecord = z.object({
  /** Concept id → whether the last answer to its check was right. */
  answers: z.record(z.string().max(80), z.object({ correct: z.boolean(), at: time }).strict()),
  completedAt: time.optional(),
}).strict();
const schema = z.object({
  version: z.literal(1),
  labs: z.record(z.string().max(80), labRecord),
  units: z.record(z.string().max(80), unitRecord),
}).strict();

export type LabProgress = z.infer<typeof schema>;
export type LabRecord = z.infer<typeof labRecord>;
export type LabAttempt = z.infer<typeof attemptSchema>;

export const emptyLabProgress = (): LabProgress => ({ version: 1, labs: {}, units: {} });

const collections = { labs: labRecord, units: unitRecord };

/** Readable records; a damaged or newer record is kept as it is (see keyed-store.ts), never removed. */
export function loadLabProgress(storage: StorageLike): LabProgress {
  return { version: 1, ...readStore(storage, LABS_KEY, 1, collections).records };
}

/** The progress after the change; `saved` is false when this browser didn't keep it (storage full or blocked). */
function update(storage: StorageLike, change: (progress: LabProgress) => void): LabProgress & { saved: boolean } {
  let progress = emptyLabProgress();
  const { saved } = updateStore(storage, LABS_KEY, 1, collections, (records) => change((progress = { version: 1, ...records })));
  return { ...progress, saved };
}

/** This version's record; an older version's record is not carried over. */
export function labRecordFor(progress: LabProgress, id: string, version: string): LabRecord | undefined {
  const record = progress.labs[id];
  return record && record.version === version ? record : undefined;
}

export const currentAttempt = (record: LabRecord | undefined) => record?.attempts.at(-1);

export function labState(record: LabRecord | undefined): "not-started" | "in-progress" | "completed" | "mastered" {
  if (!record) return "not-started";
  if (record.masteredAt) return "mastered";
  if (record.passedAt) return "completed";
  return record.attempts.some((a) => a.predicted) ? "in-progress" : "not-started";
}

function withLab(storage: StorageLike, id: string, version: string, now: string, change: (record: LabRecord) => void) {
  return update(storage, (p) => {
    const record = labRecordFor(p, id, version) ?? { version, lastAt: now, attempts: [] };
    change(record);
    record.lastAt = now;
    p.labs[id] = record;
  });
}

/** Opens a new attempt for this variant and question; only the latest 50 are kept. */
export function startAttempt(storage: StorageLike, id: string, version: string, variant: string, question: string, now = new Date().toISOString()) {
  return withLab(storage, id, version, now, (record) => {
    record.attempts = [...record.attempts, { variant, question, startedAt: now }].slice(-50);
    delete record.config;
  });
}

const latest = (record: LabRecord) => record.attempts.at(-1);

function settle(record: LabRecord, attempt: LabAttempt, now: string) {
  if (!attempt.masteredAt && attempt.predicted?.correct && attempt.passedAt && attempt.answered?.correct) {
    attempt.masteredAt = now;
    record.masteredAt ??= now;
  }
}

/** Only the first prediction of an attempt counts. */
export function recordPrediction(storage: StorageLike, id: string, version: string, value: number, correct: boolean, now = new Date().toISOString()) {
  return withLab(storage, id, version, now, (record) => {
    const attempt = latest(record);
    if (attempt && !attempt.predicted) attempt.predicted = { value, correct };
  });
}

export function recordLabCheck(storage: StorageLike, id: string, version: string, passed: boolean, now = new Date().toISOString()) {
  return withLab(storage, id, version, now, (record) => {
    const attempt = latest(record);
    if (!passed || !attempt) return;
    attempt.passedAt ??= now;
    record.passedAt ??= now;
    settle(record, attempt, now);
  });
}

/** Only the first answer of an attempt counts, and only once its checks have passed. */
export function recordAnswer(storage: StorageLike, id: string, version: string, choice: number, correct: boolean, now = new Date().toISOString()) {
  return withLab(storage, id, version, now, (record) => {
    const attempt = latest(record);
    if (!attempt?.passedAt || attempt.answered) return;
    attempt.answered = { choice, correct };
    settle(record, attempt, now);
  });
}

export function saveLabConfig(storage: StorageLike, id: string, version: string, config: Record<string, string | number | boolean>, now = new Date().toISOString()) {
  return withLab(storage, id, version, now, (record) => {
    record.config = config;
  });
}

/** A concept check answered. The unit completes the first time every one of its concepts is answered right. */
export function recordConceptCheck(storage: StorageLike, unit: string, concept: string, correct: boolean, conceptIds: string[], now = new Date().toISOString()) {
  return update(storage, (p) => {
    const record = p.units[unit] ?? { answers: {} };
    record.answers[concept] = { correct, at: now };
    if (!record.completedAt && conceptIds.every((c) => record.answers[c]?.correct)) record.completedAt = now;
    p.units[unit] = record;
  });
}
