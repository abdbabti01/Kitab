// Progress in networking missions, kept on this device. Completion and mastery are separate:
// fixing the network completes a mission; mastery needs stronger evidence on two different versions.
import { z } from "zod";
import { legacyChallenges, type NetworkMission } from "./missions.ts";
import { CHALLENGES_KEY } from "./storage.ts";
import type { PracticeState } from "../../learning/practice-state.ts";

export const MISSIONS_KEY = "kitab.network-missions.v1";
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const attempt = z
  .object({
    variant: z.string().max(64),
    startedAt: z.string().max(40),
    completedAt: z.string().max(40).nullable(),
    /** First diagnosis right, later right, or never right; null if not diagnosed. */
    diagnosis: z.enum(["first-try", "later", "wrong"]).nullable(),
    /** The learner pointed at an event that shows the problem. */
    evidence: z.boolean(),
    explanation: z.boolean().nullable(),
    prediction: z.boolean().nullable(),
    /** Highest hint level used, 0–3. */
    hints: z.number().int().min(0).max(3),
  })
  .strict();
const record = z
  .object({
    missionVersion: z.string().max(20),
    attempts: z.array(attempt).max(40),
    completedAt: z.string().max(40).nullable(),
    masteredAt: z.string().max(40).nullable(),
    /** Completed as a challenge in the earlier playground; kept, never counted as mastery. */
    legacy: z.boolean().optional(),
  })
  .strict();
const store = z.object({ version: z.literal(1), missions: z.record(z.string().max(64), record) }).strict();
export type MissionAttempt = z.infer<typeof attempt>;
export type MissionRecord = z.infer<typeof record>;
export type MissionStore = z.infer<typeof store>;

/** Loads progress, recovering from damaged data and carrying over completions of the old challenges. */
export function loadMissionStore(storage: StorageLike): MissionStore {
  let saved: MissionStore = { version: 1, missions: {} };
  try {
    const raw = storage.getItem(MISSIONS_KEY);
    if (raw) saved = store.parse(JSON.parse(raw));
  } catch {
    saved = { version: 1, missions: {} };
  }
  try {
    const old = JSON.parse(storage.getItem(CHALLENGES_KEY) ?? "[]");
    for (const id of Array.isArray(old) ? old : []) {
      const mission = legacyChallenges[String(id)];
      if (mission && !saved.missions[mission])
        saved.missions[mission] = { missionVersion: "legacy", attempts: [], completedAt: "earlier", masteredAt: null, legacy: true };
    }
  } catch {
    // Unreadable old progress is ignored; it is never overwritten.
  }
  return saved;
}
export function saveMissionStore(storage: StorageLike, value: MissionStore) {
  try {
    storage.setItem(MISSIONS_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** The attempt's evidence of understanding, beyond fixing the network. */
export function masteryGaps(a: MissionAttempt, mission: NetworkMission): string[] {
  const gaps: string[] = [];
  if (!a.completedAt) gaps.push(mission.kind === "fix" ? "Fix the network so every check passes." : "Answer the question about the retransmission.");
  if (mission.kind === "fix" && a.diagnosis !== "first-try") gaps.push("Name the faulty device and setting correctly on your first try.");
  if (!a.evidence) gaps.push("Point to the step in the journey that shows the problem.");
  if (a.explanation !== true) gaps.push("Choose the explanation of why it works.");
  if (a.hints >= 3) gaps.push("Solve it without the last hint.");
  return gaps;
}

// Two versions count as different when their causes differ, so the same fix twice is not mastery.
const causeOf = (mission: NetworkMission, variant: string) => {
  const v = mission.variants.find((x) => x.id === variant);
  return v?.faults.length ? v.faults.map((f) => `${f.device}:${f.area}`).sort().join("|") : variant;
};
export function masteredVariants(r: MissionRecord | undefined, mission: NetworkMission) {
  const strong = (r?.attempts ?? []).filter((a) => !masteryGaps(a, mission).length);
  const causes = new Map<string, string>();
  for (const a of strong) if (!causes.has(causeOf(mission, a.variant))) causes.set(causeOf(mission, a.variant), a.variant);
  return [...causes.values()];
}

export function missionState(r: MissionRecord | undefined, mission: NetworkMission): PracticeState {
  if (!r) return "not-started";
  if (r.missionVersion === mission.version && r.masteredAt) return "mastered";
  if (r.completedAt) return "completed";
  return r.attempts.length ? "in-progress" : "not-started";
}

/** Why a completed mission is not yet mastered, in the learner's terms. */
export function notYetMastered(r: MissionRecord | undefined, mission: NetworkMission): string[] {
  if (missionState(r, mission) === "mastered") return [];
  const solved = masteredVariants(r, mission);
  const last = r?.attempts.at(-1);
  const reasons = last ? masteryGaps(last, mission) : [];
  if (solved.length < 2)
    reasons.push(
      solved.length
        ? "Solve one more version with a different cause, with the same evidence."
        : "Solve two versions with different causes, each with a first-try diagnosis, evidence and explanation.",
    );
  if (r?.legacy && !r.attempts.length) reasons.unshift("You completed the earlier version of this challenge. Try the new mission to work towards mastery.");
  return [...new Set(reasons)];
}

/** Records an attempt's latest state and recomputes completion and mastery. */
export function recordAttempt(s: MissionStore, mission: NetworkMission, a: MissionAttempt, now = new Date().toISOString()): MissionStore {
  const prev = s.missions[mission.id];
  const base: MissionRecord =
    prev && prev.missionVersion === mission.version
      ? prev
      : { missionVersion: mission.version, attempts: prev?.attempts ?? [], completedAt: prev?.completedAt ?? null, masteredAt: null, legacy: prev?.legacy };
  const attempts = [...base.attempts.filter((x) => x.startedAt !== a.startedAt), a].slice(-40);
  const next: MissionRecord = { ...base, attempts, completedAt: base.completedAt ?? (a.completedAt ? now : null) };
  if (!next.masteredAt && masteredVariants(next, mission).length >= 2) next.masteredAt = now;
  return { ...s, missions: { ...s.missions, [mission.id]: next } };
}
