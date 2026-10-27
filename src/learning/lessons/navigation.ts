import type { FactValue } from "../types.ts";
import { JOURNEY, type Track } from "./runtime.ts";
import type { Lesson } from "./schema.ts";

/**
 * Where the learner is. Pure data, so rapid input is applied in order with functional updates, and
 * a saved copy can be validated and restored.
 */
export type NavState = {
  lessonId: string;
  lessonVersion: string;
  params: Record<string, FactValue>;
  /** "journey" or an experiment id. */
  track: string;
  stepId: string;
  /** The journey step to return to when an experiment ends. */
  journeyStepId: string;
  /** A level the learner opened: its introduction first, then only its steps. */
  level: { id: string; stage: "intro" | "explore"; returnStepId: string } | null;
  /** Increments when the learner asks to replay the current transition. */
  replay: number;
};

export type NavAction =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "GOTO"; stepId: string }
  | { type: "GOTO_CHAPTER"; chapterId: string }
  | { type: "OPEN_LEVEL"; levelId: string }
  | { type: "EXPLORE_LEVEL" }
  | { type: "CLOSE_LEVEL"; resume: "return" | "here" }
  | { type: "START_EXPERIMENT"; id: string }
  | { type: "END_EXPERIMENT" }
  | { type: "SET_PARAMS"; params: Record<string, FactValue> }
  | { type: "REPLAY" };

/** Resolves a track for (params, track id). Supplied by the caller so the reducer stays pure and testable. */
export type TrackFor = (params: Record<string, FactValue>, trackId: string) => Track;

export function createNav(lesson: Lesson, track: Track, params: Record<string, FactValue> = {}): NavState {
  const first = track.steps[0].id;
  return { lessonId: lesson.id, lessonVersion: lesson.version, params, track: JOURNEY, stepId: first, journeyStepId: first, level: null, replay: 0 };
}

/** The steps Next/Back walk through: a level's own steps while exploring it, otherwise the whole track. */
export function visibleSteps(state: NavState, track: Track) {
  return state.level?.stage === "explore" ? track.steps.filter((step) => step.level === state.level!.id) : track.steps;
}

export function currentStep(state: NavState, track: Track) {
  return track.steps.find((step) => step.id === state.stepId) ?? track.steps[0];
}

/** A step id that exists in `track`: the same id, else the first step of the same chapter, else the first step. */
function carry(stepId: string, from: Track | null, to: Track) {
  if (to.steps.some((step) => step.id === stepId)) return stepId;
  const chapter = from?.steps.find((step) => step.id === stepId)?.chapterId;
  return to.steps.find((step) => step.chapterId === chapter)?.id ?? to.steps[0].id;
}

export function navReducer(state: NavState, action: NavAction, trackFor: TrackFor): NavState {
  const track = trackFor(state.params, state.track);
  const step = currentStep(state, track);
  switch (action.type) {
    case "NEXT":
    case "BACK": {
      const list = visibleSteps(state, track);
      const index = list.findIndex((item) => item.id === step.id);
      // Exploring a level from a step at another level: the first press lands on that level's nearest step.
      const target = index < 0
        ? (action.type === "NEXT" ? list.find((item) => item.frameIndex >= step.frameIndex) ?? list.at(-1) : [...list].reverse().find((item) => item.frameIndex <= step.frameIndex) ?? list[0])
        : list[Math.max(0, Math.min(list.length - 1, index + (action.type === "NEXT" ? 1 : -1)))];
      if (!target || target.id === step.id) return state;
      return { ...state, stepId: target.id, level: state.level?.stage === "intro" ? null : state.level };
    }
    case "GOTO":
      return track.steps.some((item) => item.id === action.stepId) ? { ...state, stepId: action.stepId } : state;
    case "GOTO_CHAPTER": {
      const first = track.chapters.find((chapter) => chapter.id === action.chapterId)?.stepIds[0];
      return first ? { ...state, stepId: first, level: null } : state;
    }
    case "OPEN_LEVEL":
      return { ...state, level: { id: action.levelId, stage: "intro", returnStepId: state.level?.returnStepId ?? step.id } };
    case "EXPLORE_LEVEL": {
      if (!state.level) return state;
      const own = track.steps.filter((item) => item.level === state.level!.id);
      if (!own.length) return state;
      // Start from the current step if it belongs to the level, else from the level's step nearest to here.
      const start = own.find((item) => item.id === step.id) ?? own.find((item) => item.frameIndex >= step.frameIndex) ?? own[0];
      return { ...state, stepId: start.id, level: { ...state.level, stage: "explore" } };
    }
    case "CLOSE_LEVEL":
      if (!state.level) return state;
      return { ...state, stepId: action.resume === "return" ? carry(state.level.returnStepId, track, track) : step.id, level: null };
    case "START_EXPERIMENT": {
      const experiment = trackFor(state.params, action.id);
      if (experiment.id === JOURNEY) return state;
      return { ...state, track: experiment.id, stepId: experiment.steps[0].id, journeyStepId: state.track === JOURNEY ? step.id : state.journeyStepId, level: null };
    }
    case "END_EXPERIMENT": {
      if (state.track === JOURNEY) return state;
      const journey = trackFor(state.params, JOURNEY);
      return { ...state, track: JOURNEY, stepId: carry(state.journeyStepId, journey, journey), level: null };
    }
    case "SET_PARAMS": {
      const next = trackFor(action.params, state.track);
      return { ...state, params: action.params, stepId: carry(step.id, track, next), journeyStepId: carry(state.journeyStepId, trackFor(state.params, JOURNEY), trackFor(action.params, JOURNEY)) };
    }
    case "REPLAY":
      return { ...state, replay: state.replay + 1 };
  }
}

/** A saved position, checked against the current lesson. Anything that no longer fits starts cleanly. */
export function restoreNav(lesson: Lesson, saved: Partial<NavState> | null | undefined, trackFor: TrackFor, safe: (raw: unknown) => Record<string, FactValue>): NavState | null {
  if (!saved || saved.lessonId !== lesson.id || saved.lessonVersion !== lesson.version) return null;
  const params = safe(saved.params);
  const trackId = typeof saved.track === "string" && (saved.track === JOURNEY || lesson.experiments.some((item) => item.id === saved.track)) ? saved.track : JOURNEY;
  const track = trackFor(params, trackId);
  const journey = trackFor(params, JOURNEY);
  const stepId = typeof saved.stepId === "string" && track.steps.some((step) => step.id === saved.stepId) ? saved.stepId : track.steps[0].id;
  const journeyStepId = typeof saved.journeyStepId === "string" && journey.steps.some((step) => step.id === saved.journeyStepId) ? saved.journeyStepId : journey.steps[0].id;
  return { lessonId: lesson.id, lessonVersion: lesson.version, params, track: track.id, stepId, journeyStepId, level: null, replay: 0 };
}
