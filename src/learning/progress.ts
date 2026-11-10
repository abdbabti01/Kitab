import { z } from "zod";
import type { PracticeState } from "./practice-state.ts";
import type { MissionState } from "./mission-controller.ts";

const factValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
const answer = z.union([z.object({ optionId: z.string().max(64) }).strict(), z.object({ number: z.number().finite() }).strict()]);

const attempt = z
  .object({
    id: z.string().min(1).max(80),
    number: z.number().int().min(1).max(10_000),
    variantId: z.string().max(64),
    params: z.record(z.string(), factValue),
    optionOrder: z.array(z.string().max(64)).max(8),
    prediction: z.object({ answer, correct: z.boolean(), misconception: z.string().max(64).optional(), reasoning: z.string().max(600) }).strict().nullable(),
    skippedPrediction: z.boolean(),
    runCompleted: z.boolean(),
    explanation: z.object({ choiceId: z.string().max(64), correct: z.boolean(), misconception: z.string().max(64).optional() }).strict().nullable(),
    reflection: z.string().max(600),
    mastered: z.boolean(),
    needsEvidence: z.boolean().optional(),
    evidence: z.object({ index: z.number().int(), correct: z.boolean(), revealed: z.boolean() }).strict().nullable().optional(),
  })
  .strict();

const missionState = z
  .object({ missionId: z.string(), missionVersion: z.string(), phase: z.enum(["inspect", "predict", "run", "explain", "result"]), attempt })
  .strict();

const summary = z
  .object({
    attemptId: z.string().max(80),
    number: z.number().int(),
    variantId: z.string().max(64),
    scenarioKey: z.string().max(600),
    status: z.string().max(40),
    predictionCorrect: z.boolean().nullable(),
    explanationCorrect: z.boolean().nullable(),
    reasoning: z.string().max(600),
    at: z.string().max(40),
  })
  .strict();

const record = z
  .object({
    missionVersion: z.string(),
    visits: z.number().int().min(0),
    lastVisitedAt: z.string(),
    masteredAt: z.string().nullable(),
    attempts: z.array(summary).max(30),
    current: missionState.nullable(),
  })
  .strict();

const progressSchema = z.object({ version: z.literal(1), missions: z.record(z.string(), record) }).strict();

export type Progress = z.infer<typeof progressSchema>;
export type MissionProgress = z.infer<typeof record>;
export type AttemptSummary = z.infer<typeof summary>;

export const PROGRESS_KEY = "kitab.progress.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Falls back to memory when storage is blocked, full or absent (private mode, previews). */
export function safeStorage(): StorageLike {
  try {
    const storage = globalThis.localStorage;
    const probe = "kitab.probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    const memory = new Map<string, string>();
    return { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => void memory.set(key, value), removeItem: (key) => void memory.delete(key) };
  }
}

const empty = (): Progress => ({ version: 1, missions: {} });

export function loadProgress(storage: StorageLike): { progress: Progress; recovered: boolean } {
  let raw: string | null = null;
  try {
    raw = storage.getItem(PROGRESS_KEY);
  } catch {
    return { progress: empty(), recovered: true };
  }
  if (!raw) return { progress: empty(), recovered: false };
  try {
    const parsed = progressSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { progress: parsed.data, recovered: false };
  } catch {
    // fall through: malformed JSON
  }
  // Malformed or stale-shape progress: keep a copy for diagnosis, start clean.
  try {
    storage.setItem(`${PROGRESS_KEY}.corrupt`, raw.slice(0, 50_000));
    storage.removeItem(PROGRESS_KEY);
  } catch {
    // storage unavailable; nothing else to do
  }
  return { progress: empty(), recovered: true };
}

export function saveProgress(storage: StorageLike, progress: Progress) {
  try {
    storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

function base(progress: Progress, missionId: string, missionVersion: string): MissionProgress {
  const existing = progress.missions[missionId];
  if (existing && existing.missionVersion === missionVersion) return existing;
  // A new mission version keeps attempt history but cannot carry over an in-progress attempt or mastery.
  return { missionVersion, visits: existing?.visits ?? 0, lastVisitedAt: "", masteredAt: null, attempts: existing?.attempts ?? [], current: null };
}

export function recordVisit(progress: Progress, missionId: string, missionVersion: string, now = new Date().toISOString()): Progress {
  const item = base(progress, missionId, missionVersion);
  return { ...progress, missions: { ...progress.missions, [missionId]: { ...item, visits: item.visits + 1, lastVisitedAt: now } } };
}

/**
 * The saved attempt, if it belongs to this mission version. The evidence-step fields are not stored
 * (see recordState), so they are rebuilt here: a mastered attempt had found the evidence; an open one
 * asks for it again.
 */
export function restoreState(progress: Progress, missionId: string, missionVersion: string, needsEvidence = false): MissionState | null {
  const item = progress.missions[missionId];
  if (!item || item.missionVersion !== missionVersion || !item.current) return null;
  if (item.current.missionId !== missionId || item.current.missionVersion !== missionVersion) return null;
  const state = item.current as MissionState;
  if (!needsEvidence) return state;
  const evidence = state.attempt.mastered ? { index: -1, correct: true, revealed: false } : null;
  return { ...state, attempt: { ...state.attempt, needsEvidence: true, evidence } };
}

/** Distinct versions mastered so far, counting the current attempt. */
export function masteredVersions(progress: Progress, missionId: string, current?: MissionState) {
  const ids = new Set((progress.missions[missionId]?.attempts ?? []).filter((a) => a.status === "mastered").map((a) => a.variantId));
  if (current?.attempt.mastered) ids.add(current.attempt.variantId);
  return ids.size;
}

export function recordState(progress: Progress, state: MissionState, scenarioKey: string, status: string, now = new Date().toISOString(), requiredVersions = 1): Progress {
  const item = base(progress, state.missionId, state.missionVersion);
  const { attempt } = state;
  let attempts = item.attempts;
  if (state.phase === "result") {
    const entry: AttemptSummary = {
      attemptId: attempt.id,
      number: attempt.number,
      variantId: attempt.variantId,
      scenarioKey: scenarioKey.slice(0, 600),
      status,
      predictionCorrect: attempt.prediction ? attempt.prediction.correct : null,
      explanationCorrect: attempt.explanation ? attempt.explanation.correct : null,
      reasoning: attempt.prediction?.reasoning ?? "",
      at: now,
    };
    attempts = [...attempts.filter((existing) => existing.attemptId !== attempt.id), entry].slice(-30);
  }
  const versions = new Set([...attempts.filter((a) => a.status === "mastered").map((a) => a.variantId), ...(attempt.mastered ? [attempt.variantId] : [])]);
  const masteredAt = item.masteredAt ?? (attempt.mastered && versions.size >= requiredVersions ? now : null);
  // The evidence-step fields stay in memory only. Earlier releases read progress with a strict schema and would
  // discard all of it on an unknown key, so leaving them out keeps a rollback from wiping learners' progress.
  const { needsEvidence: _needs, evidence: _evidence, ...stored } = attempt;
  return { ...progress, missions: { ...progress.missions, [state.missionId]: { ...item, attempts, masteredAt, current: { ...state, attempt: stored } } } };
}

/** The shared four-state view of a framework mission: a finished run counts as completed. */
export function practiceState(progress: Progress, missionId: string, missionVersion: string): PracticeState {
  const item = progress.missions[missionId];
  if (!item) return "not-started";
  if (item.missionVersion === missionVersion && item.masteredAt) return "mastered";
  if (item.attempts.some((a) => a.explanationCorrect !== null)) return "completed";
  return "in-progress";
}

export function missionStatus(progress: Progress, missionId: string, missionVersion: string) {
  const item = progress.missions[missionId];
  if (!item) return "new" as const;
  if (item.missionVersion === missionVersion && item.masteredAt) return "mastered" as const;
  if (item.attempts.length || item.current?.attempt.prediction) return "practiced" as const;
  return "visited" as const;
}
