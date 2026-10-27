import { z } from "zod";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const factValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

/**
 * One guided step. It is bound to an engine frame (or, with `each`, expanded over every frame whose id
 * matches), so what the learner sees is always computed state. Text may use {fact:id}, {param.x},
 * {outcome.x}, {frame.title} and {frame.narration}; it never states engine values on its own.
 */
const step = z
  .object({
    id,
    frame: z.string().min(1).max(80).optional(),
    /** Expand over every frame whose id matches `id` (a regular expression) and/or whose engine chapter is `chapter`. */
    each: z.object({ id: z.string().min(1).max(120).optional(), chapter: z.string().min(1).max(60).optional() }).strict().refine((value) => value.id || value.chapter, "each needs id or chapter").optional(),
    /** Lesson level id. Optional only when the engine declares the frame's level. */
    level: id.optional(),
    title: text(110).optional(),
    actor: text(80).optional(),
    what: text(360),
    why: text(420),
    focus: z.array(z.string().min(1).max(64)).max(8).default([]),
    terms: z.array(id).max(4).default([]),
    kitab: text(240).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.frame) !== Boolean(value.each), "A step needs exactly one of frame or each.");

const chapter = z
  .object({ id, title: text(60), goal: text(300), steps: z.array(step).min(1).max(40) })
  .strict();

const control = z.discriminatedUnion("control", [
  z.object({ key: z.string().min(1).max(40), label: text(40), control: z.literal("text"), maxLength: z.number().int().min(1).max(64), help: text(160) }).strict(),
  z.object({ key: z.string().min(1).max(40), label: text(40), control: z.literal("choice"), options: z.array(z.object({ value: factValue, label: text(40) }).strict()).min(2).max(8), help: text(160) }).strict(),
]);

export const lessonSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    title: text(90),
    question: text(140),
    summary: text(260),
    topic: text(40),
    review: z.object({ status: z.enum(["reviewed", "draft"]), note: z.string().max(200).optional() }).strict(),
    engine: z.object({ id: z.string().min(1), version: z.string().min(1) }).strict(),
    scenario: z.record(z.string(), factValue),
    /** What the example includes and deliberately leaves out. Shown before the first step. */
    scope: z.array(text(220)).min(1).max(6),
    prerequisites: text(200),
    levels: z.array(z.object({ id, name: text(30), short: text(70), intro: text(500) }).strict()).min(2).max(6),
    glossary: z.array(z.object({ id, term: text(40), definition: text(320) }).strict()).max(40),
    /** What each kind of selectable object represents and why it matters, keyed by entity kind. */
    kinds: z.record(z.string(), z.object({ represents: text(240), matters: text(240) }).strict()),
    controls: z.array(control).max(3).default([]),
    chapters: z.array(chapter).min(2).max(10),
    experiments: z
      .array(
        z
          .object({
            id,
            title: text(80),
            question: text(160),
            params: z.record(z.string(), factValue),
            /** First frame of the experiment's own trace; everything before it is identical to the journey. */
            startFrame: z.string().min(1).max(80),
            chapters: z.array(chapter).min(1).max(3),
            compare: z.array(z.object({ outcome: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/), label: text(60) }).strict()).min(1).max(6),
          })
          .strict(),
      )
      .max(3)
      .default([]),
    practice: z.array(z.object({ missionId: id, why: text(200) }).strict()).max(4).default([]),
    sources: z.array(z.object({ id, text: text(600) }).strict()).min(1).max(8),
  })
  .strict()
  .superRefine((lesson, context) => {
    const levels = new Set(lesson.levels.map((level) => level.id));
    const terms = new Set(lesson.glossary.map((term) => term.id));
    const steps = [...lesson.chapters, ...lesson.experiments.flatMap((experiment) => experiment.chapters)].flatMap((item) => item.steps);
    const seen = new Set<string>();
    for (const item of [...lesson.chapters, ...lesson.experiments.flatMap((experiment) => experiment.chapters)]) {
      if (seen.has(item.id)) context.addIssue({ code: "custom", message: `Duplicate chapter ${item.id}` });
      seen.add(item.id);
    }
    const stepIds = new Set<string>();
    for (const item of steps) {
      if (stepIds.has(item.id)) context.addIssue({ code: "custom", message: `Duplicate step ${item.id}` });
      stepIds.add(item.id);
      if (item.level && !levels.has(item.level)) context.addIssue({ code: "custom", message: `Step ${item.id}: unknown level ${item.level}` });
      for (const term of item.terms) if (!terms.has(term)) context.addIssue({ code: "custom", message: `Step ${item.id}: unknown term ${term}` });
    }
  });

export type Lesson = z.infer<typeof lessonSchema>;
export type LessonStep = z.infer<typeof step>;
export type LessonChapter = z.infer<typeof chapter>;
export type LessonControl = z.infer<typeof control>;
export type Experiment = Lesson["experiments"][number];

export function parseLesson(value: unknown): Lesson {
  return lessonSchema.parse(value);
}
