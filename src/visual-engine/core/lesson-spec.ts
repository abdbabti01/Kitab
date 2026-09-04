import { z } from "zod";

export const lessonLevelSchema = z.enum([
  "Beginner",
  "Beginner → Intermediate",
  "Intermediate",
]);

export const lessonChapterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
});

export const lessonCheckpointSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  prompt: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2).max(4),
  correctIndex: z.number().int().nonnegative(),
  explanation: z.string().min(1),
});

export const lessonSpecSchema = z
  .object({
    version: z.number().int().positive(),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    family: z.string().min(1),
    level: lessonLevelSchema,
    engine: z.string().min(1),
    verified: z.boolean(),
    summary: z.string().min(1),
    objectives: z.array(z.string().min(1)).min(1),
    glossary: z
      .array(
        z.object({
          term: z.string().min(1),
          definition: z.string().min(1),
        }),
      )
      .min(1),
    chapters: z.array(lessonChapterSchema).min(1),
    checkpoints: z.array(lessonCheckpointSchema),
    defaultParameters: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
  })
  .superRefine((lesson, context) => {
    const chapterIds = new Set(lesson.chapters.map((chapter) => chapter.id));
    if (chapterIds.size !== lesson.chapters.length) {
      context.addIssue({
        code: "custom",
        path: ["chapters"],
        message: "Chapter ids must be unique.",
      });
    }

    const checkpointIds = new Set<string>();
    lesson.checkpoints.forEach((checkpoint, index) => {
      if (checkpointIds.has(checkpoint.id)) {
        context.addIssue({
          code: "custom",
          path: ["checkpoints", index, "id"],
          message: "Checkpoint ids must be unique.",
        });
      }
      checkpointIds.add(checkpoint.id);
      if (checkpoint.correctIndex >= checkpoint.choices.length) {
        context.addIssue({
          code: "custom",
          path: ["checkpoints", index, "correctIndex"],
          message: "The correct answer must reference an existing choice.",
        });
      }
    });
  });

export type LessonSpec = z.infer<typeof lessonSpecSchema>;
export type LessonCheckpoint = z.infer<typeof lessonCheckpointSchema>;

export function parseLessonSpec(value: unknown): LessonSpec {
  return lessonSpecSchema.parse(value);
}

