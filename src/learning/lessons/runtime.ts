import { fillTemplate } from "../assessment.ts";
import { buildTrace, factDelta, getEngine } from "../registry.ts";
import type { FactValue, LearningFrame, Trace } from "../types.ts";
import type { Lesson, LessonChapter } from "./schema.ts";

export class LessonContentError extends Error {}

export type ResolvedStep = {
  id: string;
  chapterId: string;
  chapterIndex: number;
  indexInChapter: number;
  chapterSize: number;
  level: string;
  actor: string;
  title: string;
  what: string;
  why: string;
  kitab: string | null;
  frameIndex: number;
  focus: string[];
  terms: Lesson["glossary"];
};

export type ResolvedChapter = { id: string; title: string; goal: string; stepIds: string[] };

/** One followable sequence of steps over one engine trace: the journey, or an experiment. */
export type Track = { id: string; title: string; trace: Trace; steps: ResolvedStep[]; chapters: ResolvedChapter[]; startFrame: number };

export const JOURNEY = "journey";

const plain = new Intl.NumberFormat("en-US", { useGrouping: false });
const formatValue = (value: FactValue) => (typeof value === "boolean" ? (value ? "yes" : "no") : typeof value === "number" ? plain.format(value) : value);

/**
 * Fills step text from the frame and the trace: {frame.title|narration} first, then {param.x}/{outcome.x}
 * (so they can build a fact id, as in {fact:slot-{param.index}}), then {fact:id} from the frame's computed
 * facts. Unknown tokens are content errors, never blanks.
 * One pass over the template only: substituted values (such as a learner's message containing "{value}")
 * are never scanned again as tokens.
 */
export function fillStepText(template: string, trace: Trace, frame: LearningFrame) {
  return template.replace(/\{fact:((?:[a-z0-9-]|\{[a-zA-Z.]+\})+)\}|\{frame\.(title|narration)\}|\{[a-zA-Z.]+\}/g, (token, factId?: string, key?: "title" | "narration") => {
    if (key) return frame[key];
    if (factId === undefined) return fillTemplate(token, trace);
    const id = fillTemplate(factId, trace);
    const fact = frame.facts.find((item) => item.id === id);
    if (!fact) throw new LessonContentError(`Fact ${id} is not present in frame ${frame.id}.`);
    return formatValue(fact.value);
  });
}

export function trackParams(lesson: Lesson, params: Record<string, FactValue>, trackId: string) {
  const experiment = lesson.experiments.find((item) => item.id === trackId);
  return { ...lesson.scenario, ...params, ...(experiment?.params ?? {}) };
}

function resolveChapters(lesson: Lesson, chapters: LessonChapter[], trace: Trace): { steps: ResolvedStep[]; chapters: ResolvedChapter[] } {
  const levels = new Set(lesson.levels.map((level) => level.id));
  const glossary = new Map(lesson.glossary.map((term) => [term.id, term]));
  const steps: ResolvedStep[] = [];
  const resolvedChapters: ResolvedChapter[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    const local: Omit<ResolvedStep, "indexInChapter" | "chapterSize">[] = [];
    for (const step of chapter.steps) {
      const each = step.each;
      const pattern = each?.id ? new RegExp(`^(?:${each.id})$`) : null;
      const frames = each
        ? trace.frames.filter((frame) => (!pattern || pattern.test(frame.id)) && (!each.chapter || frame.chapter === each.chapter))
        : trace.frames.filter((frame) => frame.id === step.frame);
      if (!frames.length) throw new LessonContentError(`Step ${step.id}: no frame ${step.frame ?? JSON.stringify(each)} in ${trace.scenarioKey}.`);
      for (const frame of frames) {
        const level = step.level ?? frame.level;
        if (!level || !levels.has(level)) throw new LessonContentError(`Step ${step.id}: level ${level ?? "(none)"} is not a lesson level.`);
        local.push({
          id: step.each ? `${step.id}~${frame.id}` : step.id,
          chapterId: chapter.id,
          chapterIndex,
          level,
          actor: step.actor ? fillStepText(step.actor, trace, frame) : frame.actor ?? "",
          title: fillStepText(step.title ?? "{frame.title}", trace, frame),
          what: fillStepText(step.what, trace, frame),
          why: fillStepText(step.why, trace, frame),
          kitab: step.kitab ? fillStepText(step.kitab, trace, frame) : null,
          frameIndex: frame.index,
          // No authored focus: point where the engine points.
          focus: step.focus.length ? step.focus.map((target) => fillStepText(target, trace, frame)) : [...frame.focus],
          terms: step.terms.map((term) => glossary.get(term)!).filter(Boolean),
        });
      }
    }
    local.forEach((item, index) => steps.push({ ...item, indexInChapter: index, chapterSize: local.length }));
    resolvedChapters.push({ id: chapter.id, title: fillTemplate(chapter.title, trace), goal: fillTemplate(chapter.goal, trace), stepIds: local.map((item) => item.id) });
  });
  return { steps, chapters: resolvedChapters };
}

/** Per lesson object, so content can never be served from another lesson's (or another version's) tracks. */
const caches = new WeakMap<Lesson, Map<string, Track>>();

/** Builds (and caches) a track. Same lesson version + parameters + track → the same object. */
export function resolveTrack(lesson: Lesson, params: Record<string, FactValue>, trackId: string = JOURNEY): Track {
  const experiment = lesson.experiments.find((item) => item.id === trackId);
  const id = experiment ? experiment.id : JOURNEY;
  const trace = buildTrace(lesson.engine.id, trackParams(lesson, params, id));
  const key = `${id}:${trace.scenarioKey}`;
  const cache = caches.get(lesson) ?? new Map<string, Track>();
  caches.set(lesson, cache);
  const cached = cache.get(key);
  if (cached) return cached;
  const startFrame = experiment ? trace.frames.findIndex((frame) => frame.id === experiment.startFrame) : 0;
  if (startFrame < 0) throw new LessonContentError(`Experiment ${id}: start frame ${experiment!.startFrame} missing.`);
  const resolved = resolveChapters(lesson, experiment ? experiment.chapters : lesson.chapters, trace);
  const track: Track = { id, title: experiment?.title ?? lesson.title, trace, startFrame, ...resolved };
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  cache.set(key, track);
  return track;
}

/** Parameters a learner may set, validated by the engine itself; anything else falls back to the lesson scenario. */
export function safeParams(lesson: Lesson, raw: unknown): Record<string, FactValue> {
  const allowed = new Set(lesson.controls.map((control) => control.key));
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const picked: Record<string, FactValue> = {};
  for (const control of lesson.controls) {
    const value = source[control.key];
    if (!allowed.has(control.key) || value === undefined) continue;
    if (control.control === "choice" && control.options.some((option) => option.value === value)) picked[control.key] = value as FactValue;
    if (control.control === "text" && typeof value === "string") picked[control.key] = value.slice(0, control.maxLength * 4);
  }
  try {
    const trace = buildTrace(lesson.engine.id, { ...lesson.scenario, ...picked });
    // Store the engine-normalized values, so the saved state is exactly what was computed.
    return Object.fromEntries(Object.keys(picked).map((key) => [key, trace.params[key]]));
  } catch {
    return {};
  }
}

/** Fact changes between two steps' frames, focused entities first. */
export function stepDelta(track: Track, from: ResolvedStep | undefined, to: ResolvedStep) {
  if (!from || from.frameIndex === to.frameIndex) return [];
  const before = track.trace.frames[from.frameIndex];
  const after = track.trace.frames[to.frameIndex];
  const focused = new Set(to.focus);
  const lines = factDelta(before.facts, after.facts);
  const priority = new Set(after.facts.filter((fact) => fact.entityId && focused.has(fact.entityId)).map((fact) => fact.label));
  return [...lines.filter((line) => priority.has(line.split(":")[0])), ...lines.filter((line) => !priority.has(line.split(":")[0]))];
}

// ---------------------------------------------------------------- content validation

/** Every scenario a learner can reach: the base scenario, each choice option and sample texts (incl. multi-byte). */
function reachableParams(lesson: Lesson): Record<string, FactValue>[] {
  const samples: Record<string, FactValue>[] = [{}];
  for (const control of lesson.controls) {
    if (control.control === "choice") samples.push(...control.options.map((option) => ({ [control.key]: option.value })));
    if (control.control === "text") samples.push({ [control.key]: "A" }, { [control.key]: "héllo 👋" }, { [control.key]: "x".repeat(control.maxLength) });
  }
  return samples;
}

/**
 * Checks every reachable track: steps resolve, text references only present facts, focus targets exist,
 * levels are lesson levels, steps follow the trace in order and cover every frame (the journey from the
 * first frame, experiments from their start frame), and every selectable kind has a description.
 */
export function validateLessonContent(lesson: Lesson, missionExists: (id: string) => boolean = () => true) {
  const problems: string[] = [];
  const adapter = getEngine(lesson.engine.id);
  if (!adapter) return [`${lesson.id}: unknown engine ${lesson.engine.id}`];
  if (adapter.version !== lesson.engine.version) problems.push(`${lesson.id}: engine ${adapter.id}@${adapter.version} but lesson expects ${lesson.engine.version}`);
  for (const practice of lesson.practice) if (!missionExists(practice.missionId)) problems.push(`${lesson.id}: practice mission ${practice.missionId} missing`);
  const levels = new Set(lesson.levels.map((level) => level.id));
  for (const params of reachableParams(lesson)) {
    for (const trackId of [JOURNEY, ...lesson.experiments.map((item) => item.id)]) {
      const where = `${lesson.id}/${trackId}/${JSON.stringify(params)}`;
      try {
        const track = resolveTrack(lesson, params, trackId);
        if (track.trace.diagnostics.length) problems.push(`${where}: ${track.trace.diagnostics.join(" ")}`);
        let previous = -1;
        const covered = new Set<number>();
        for (const step of track.steps) {
          if (step.frameIndex < previous) problems.push(`${where}: step ${step.id} goes back in the trace`);
          previous = step.frameIndex;
          covered.add(step.frameIndex);
          const frame = track.trace.frames[step.frameIndex];
          const entities = new Set(frame.entities.map((entity) => entity.id));
          for (const target of step.focus) if (!entities.has(target)) problems.push(`${where}: step ${step.id} focuses ${target}, absent in ${frame.id}`);
          if (!step.actor) problems.push(`${where}: step ${step.id} names no actor`);
        }
        for (let index = track.startFrame; index < track.trace.frames.length; index += 1) {
          if (!covered.has(index)) problems.push(`${where}: frame ${track.trace.frames[index].id} is never shown`);
        }
        for (const frame of track.trace.frames) {
          if (frame.level && !levels.has(frame.level)) problems.push(`${where}: frame ${frame.id} level ${frame.level} is not a lesson level`);
          for (const entity of frame.entities) if (!lesson.kinds[entity.kind]) problems.push(`${where}: no description for kind ${entity.kind}`);
        }
        if (trackId !== JOURNEY) {
          const journey = resolveTrack(lesson, params, JOURNEY);
          const prefix = track.trace.frames.slice(0, track.startFrame).map((frame) => frame.id).join(",");
          if (journey.trace.frames.slice(0, track.startFrame).map((frame) => frame.id).join(",") !== prefix) problems.push(`${where}: frames before the start frame differ from the journey`);
          const experiment = lesson.experiments.find((item) => item.id === trackId)!;
          for (const item of experiment.compare) if (!(item.outcome in track.trace.outcome)) problems.push(`${where}: compare ${item.outcome} is not an outcome`);
        }
      } catch (error) {
        problems.push(`${where}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return [...new Set(problems)];
}
