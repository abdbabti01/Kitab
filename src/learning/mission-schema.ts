import { z } from "zod";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const factValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

/** A value is either a literal or a reference to an engine-computed outcome fact or parameter. */
export const valueRefSchema = z.union([
  z.object({ literal: factValue }).strict(),
  z.object({ fact: z.string().regex(/^(outcome|param)\.[A-Za-z][A-Za-z0-9]*$/) }).strict(),
]);

const choiceOption = z
  .object({ id, text: text(160), value: valueRefSchema, misconception: id.optional() })
  .strict();

const learnerParam = z.discriminatedUnion("control", [
  z.object({ key: z.string().min(1).max(40), label: text(40), control: z.literal("choice"), options: z.array(z.object({ value: factValue, label: text(40), onlyWhen: z.object({ key: z.string(), values: z.array(factValue).min(1) }).strict().optional() }).strict()).min(2).max(24) }).strict(),
  z.object({ key: z.string().min(1).max(40), label: text(40), control: z.literal("range"), min: z.number(), max: z.number(), step: z.number().positive(), unit: z.string().max(8).optional() }).strict(),
]);

export const missionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    title: text(90),
    concept: id,
    topic: text(40),
    objective: text(220),
    summary: text(260),
    review: z.object({ status: z.enum(["reviewed", "draft"]), note: z.string().max(200).optional() }).strict(),
    engine: z.object({ id: z.string().min(1), version: z.string().min(1) }).strict(),
    scenario: z.record(z.string(), factValue),
    variants: z.array(z.object({ id, label: text(60), params: z.record(z.string(), factValue) }).strict()).min(1).max(8),
    learnerParams: z.array(learnerParam).max(6).default([]),
    prediction: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("choice"), prompt: text(240), options: z.array(choiceOption).min(3).max(5), answer: z.object({ fact: z.string() }).strict(), evidenceFrame: text(80) }).strict(),
      z.object({ kind: z.literal("numeric"), prompt: text(240), answer: z.object({ fact: z.string() }).strict(), unit: z.string().max(20).optional(), min: z.number(), max: z.number(), evidenceFrame: text(80) }).strict(),
    ]),
    explanation: z
      .object({ prompt: text(200), options: z.array(z.object({ id, text: text(220), correct: z.boolean(), misconception: id.optional() }).strict()).min(3).max(4) })
      .strict()
      .refine((value) => value.options.filter((option) => option.correct).length === 1, "Exactly one explanation must be correct."),
    hints: z.array(z.object({ text: text(240), beforePrediction: z.boolean(), target: z.string().max(64).optional() }).strict()).min(2).max(4),
    misconceptions: z.record(id, z.object({ label: text(80), message: text(260), target: z.string().max(64).optional() }).strict()),
    sources: z.array(z.object({ id, text: text(600) }).strict()).min(1).max(6),
  })
  .strict()
  .superRefine((mission, context) => {
    const optionIds = new Set<string>();
    if (mission.prediction.kind === "choice") {
      for (const option of mission.prediction.options) {
        if (optionIds.has(option.id)) context.addIssue({ code: "custom", message: `Duplicate option ${option.id}` });
        optionIds.add(option.id);
        if (option.misconception && !mission.misconceptions[option.misconception]) context.addIssue({ code: "custom", message: `Unknown misconception ${option.misconception}` });
      }
    }
    for (const option of mission.explanation.options) {
      if (option.misconception && !mission.misconceptions[option.misconception]) context.addIssue({ code: "custom", message: `Unknown misconception ${option.misconception}` });
    }
    const variantIds = new Set(mission.variants.map((variant) => variant.id));
    if (variantIds.size !== mission.variants.length) context.addIssue({ code: "custom", message: "Variant ids must be unique." });
    if (!mission.hints.some((hint) => hint.beforePrediction)) context.addIssue({ code: "custom", message: "At least one hint must be safe before prediction." });
  });

export type Mission = z.infer<typeof missionSchema>;
export type ValueRef = z.infer<typeof valueRefSchema>;

export function parseMission(value: unknown): Mission {
  return missionSchema.parse(value);
}
