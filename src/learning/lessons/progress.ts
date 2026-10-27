import { z } from "zod";
import type { NavState } from "./navigation.ts";
import { JOURNEY, type Track } from "./runtime.ts";
import type { Lesson } from "./schema.ts";

/**
 * Learning progress, kept apart from mission practice and mastery (progress.ts). Seeing or completing a
 * walkthrough never writes a mission attempt or mastery; only missions do.
 */
const factValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

const position = z
  .object({ params: z.record(z.string().max(40), factValue), track: z.string().max(64), stepId: z.string().max(160), journeyStepId: z.string().max(160) })
  .strict();

const record = z
  .object({
    lessonVersion: z.string().max(20),
    visits: z.number().int().min(0),
    lastVisitedAt: z.string().max(40),
    /** Journey step ids the learner has seen. */
    seen: z.array(z.string().max(160)).max(400),
    /** Journey steps for the scenario last seen, so the home page can show progress without building traces. */
    total: z.number().int().min(0).max(400),
    chaptersSeen: z.array(z.string().max(64)).max(20),
    completedAt: z.string().max(40).nullable(),
    experimentsCompleted: z.array(z.string().max(64)).max(10),
    position: position.nullable(),
    /** The lesson changed since this learner's last visit, so earlier progress was set aside. */
    updated: z.boolean(),
  })
  .strict();

const learningSchema = z.object({ version: z.literal(1), lessons: z.record(z.string().max(64), record) }).strict();

export type Learning = z.infer<typeof learningSchema>;
export type LessonRecord = z.infer<typeof record>;
export const LEARNING_KEY = "kitab.learning.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const empty = (): Learning => ({ version: 1, lessons: {} });

export function loadLearning(storage: StorageLike): { learning: Learning; recovered: boolean } {
  let raw: string | null = null;
  try {
    raw = storage.getItem(LEARNING_KEY);
  } catch {
    return { learning: empty(), recovered: true };
  }
  if (!raw) return { learning: empty(), recovered: false };
  try {
    const parsed = learningSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { learning: parsed.data, recovered: false };
  } catch {
    // malformed JSON
  }
  try {
    storage.setItem(`${LEARNING_KEY}.corrupt`, raw.slice(0, 50_000));
    storage.removeItem(LEARNING_KEY);
  } catch {
    // storage unavailable
  }
  return { learning: empty(), recovered: true };
}

export function saveLearning(storage: StorageLike, learning: Learning) {
  try {
    storage.setItem(LEARNING_KEY, JSON.stringify(learning));
    return true;
  } catch {
    return false;
  }
}

function base(learning: Learning, lesson: Lesson): LessonRecord {
  const existing = learning.lessons[lesson.id];
  if (existing && existing.lessonVersion === lesson.version) return existing;
  // A changed lesson cannot carry over a position, seen steps or completion: they may not mean the same thing.
  return { lessonVersion: lesson.version, visits: existing?.visits ?? 0, lastVisitedAt: existing?.lastVisitedAt ?? "", seen: [], total: 0, chaptersSeen: [], completedAt: null, experimentsCompleted: [], position: null, updated: Boolean(existing) };
}

export function recordLessonVisit(learning: Learning, lesson: Lesson, now = new Date().toISOString()): Learning {
  const item = base(learning, lesson);
  return { ...learning, lessons: { ...learning.lessons, [lesson.id]: { ...item, visits: item.visits + 1, lastVisitedAt: now } } };
}

/** Records where the learner is and what they have seen. Completion needs the final step and every chapter seen. */
export function recordStep(learning: Learning, lesson: Lesson, nav: NavState, track: Track, now = new Date().toISOString()): Learning {
  const item = base(learning, lesson);
  const step = track.steps.find((candidate) => candidate.id === nav.stepId);
  if (!step) return learning;
  let { seen, total, chaptersSeen, completedAt, experimentsCompleted } = item;
  if (track.id === JOURNEY) {
    if (!seen.includes(step.id)) seen = [...seen, step.id].slice(-400);
    total = track.steps.length;
    if (!chaptersSeen.includes(step.chapterId)) chaptersSeen = [...chaptersSeen, step.chapterId];
    const last = track.steps.at(-1)!;
    if (!completedAt && step.id === last.id && lesson.chapters.every((chapter) => chaptersSeen.includes(chapter.id))) completedAt = now;
  } else if (step.id === track.steps.at(-1)!.id && !experimentsCompleted.includes(track.id)) {
    experimentsCompleted = [...experimentsCompleted, track.id];
  }
  const saved = { params: nav.params, track: nav.track, stepId: nav.stepId, journeyStepId: nav.journeyStepId };
  return { ...learning, lessons: { ...learning.lessons, [lesson.id]: { ...item, seen, total, chaptersSeen, completedAt, experimentsCompleted, position: saved } } };
}

export type LessonStatus = { state: "new" | "visited" | "learning" | "completed"; seen: number; total: number };

/** Plain learning status. It says nothing about practice or mastery. */
export function lessonStatus(learning: Learning, lesson: Lesson, journeySteps?: number): LessonStatus {
  const item = learning.lessons[lesson.id];
  const total = journeySteps ?? (item?.lessonVersion === lesson.version ? item.total : 0);
  if (!item || item.lessonVersion !== lesson.version) return { state: item ? "visited" : "new", seen: 0, total };
  const seen = total ? Math.min(total, item.seen.length) : item.seen.length;
  return { state: item.completedAt ? "completed" : seen > 1 ? "learning" : "visited", seen, total };
}
