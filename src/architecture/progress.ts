// System Design progress in this browser: challenge checks and passes, and lesson experiments run. Its own
// additive store; damaged data is kept aside. Only zod: this module loads on every page, with the track.
import { z } from "zod";
import { readStore, updateStore } from "../learning/keyed-store.ts";

export const PROGRESS_KEY = "kitab.architecture.progress.v1";
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const challengeRecord = z.object({
  /** The challenge version the record was made against; a new version starts a fresh record. */
  version: z.string().max(20),
  attempts: z.number().int().min(0),
  lastAt: z.string().max(40),
  passedAt: z.string().max(40).optional(),
  /** The learner's working design for this challenge (parsed when used). */
  design: z.unknown().optional(),
  /** The cheapest passing design's cost and p95, for comparing solutions. */
  best: z.object({ cost: z.number(), p95: z.number().nullable() }).strict().optional(),
}).strict();
const progressSchema = z.object({
  version: z.literal(1),
  challenges: z.record(z.string().max(80), challengeRecord),
  lessons: z.record(z.string().max(80), z.object({ experimentAt: z.string().max(40) }).strict()),
}).strict();
export type ArchitectureProgress = z.infer<typeof progressSchema>;
export type ChallengeRecord = z.infer<typeof challengeRecord>;

export const emptyProgress = (): ArchitectureProgress => ({ version: 1, challenges: {}, lessons: {} });

const collections = { challenges: challengeRecord, lessons: progressSchema.shape.lessons.valueType };

/** Readable records; a damaged or newer record is kept as it is (see keyed-store.ts), never removed. */
export function loadArchitectureProgress(storage: StorageLike): ArchitectureProgress {
  return { version: 1, ...readStore(storage, PROGRESS_KEY, 1, collections).records };
}

/** The progress after the change; `saved` is false when this browser didn't keep it (storage full or blocked). */
function updateProgress(storage: StorageLike, change: (progress: ArchitectureProgress) => void): ArchitectureProgress & { saved: boolean } {
  let progress = emptyProgress();
  const { saved } = updateStore(storage, PROGRESS_KEY, 1, collections, (records) => change((progress = { version: 1, ...records })));
  return { ...progress, saved };
}

export function recordExperiment(storage: StorageLike, lessonId: string, now = new Date().toISOString()) {
  return updateProgress(storage, (p) => {
    p.lessons[lessonId] = { experimentAt: now };
  });
}

/** The challenge's record for this version, or a fresh one (an older version's record is not carried over). */
export function challengeRecordFor(progress: ArchitectureProgress, id: string, version: string): ChallengeRecord | undefined {
  const record = progress.challenges[id];
  return record && record.version === version ? record : undefined;
}

export function saveChallengeDesign(storage: StorageLike, id: string, version: string, design: unknown, now = new Date().toISOString()) {
  return updateProgress(storage, (p) => {
    const record = challengeRecordFor(p, id, version) ?? { version, attempts: 0, lastAt: now };
    p.challenges[id] = { ...record, lastAt: now, design };
  });
}

export function recordChallengeCheck(storage: StorageLike, id: string, version: string, result: { passed: boolean; cost: number; p95: number | null }, now = new Date().toISOString()) {
  return updateProgress(storage, (p) => {
    const record = challengeRecordFor(p, id, version) ?? { version, attempts: 0, lastAt: now };
    const next: ChallengeRecord = { ...record, attempts: record.attempts + 1, lastAt: now };
    if (result.passed) {
      next.passedAt = record.passedAt ?? now;
      if (!record.best || result.cost < record.best.cost) next.best = { cost: result.cost, p95: result.p95 };
    }
    p.challenges[id] = next;
  });
}
