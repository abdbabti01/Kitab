import { z } from "zod";
import { engineKinds } from "../visual-engine/core/visualization-spec.ts";

export const DRAFT_CONTRACT = "kitab.draft/3";

const text = (max: number) => z.string().trim().min(1).max(max);
const index = z.number().int().min(0).max(7);

/**
 * What the Worker returns for an AI-assisted draft. The engine is chosen once,
 * on the server, from semantic evidence; the client renders it as given.
 */
export const draftContractSchema = z
  .object({
    contract: z.literal(DRAFT_CONTRACT),
    slug: text(120),
    title: text(120),
    category: text(80),
    level: z.enum(["Beginner", "Beginner → Intermediate"]),
    summary: text(800),
    analogy: text(600),
    sections: z.array(z.object({ heading: text(120), body: text(1600) }).strict()).min(3).max(5),
    terms: z.array(z.object({ term: text(80), definition: text(400) }).strict()).min(3).max(6),
    tryIt: z.array(text(300)).min(3).max(5),
    visualization: z
      .object({
        engine: z.enum(engineKinds),
        title: text(120),
        actors: z.array(z.object({ label: text(60), role: text(160) }).strict()).min(2).max(8),
        links: z.array(z.object({ from: index, to: index, label: text(60) }).strict()).min(1).max(12),
        events: z.array(z.object({ from: index, to: index, label: text(80), detail: text(420), state: text(140), payload: text(70) }).strict()).min(4).max(8),
      })
      .strict()
      .superRefine((value, context) => {
        const count = value.actors.length;
        [...value.links, ...value.events].forEach((item, position) => {
          if (item.from >= count || item.to >= count) context.addIssue({ code: "custom", message: `Reference ${position} points at a missing actor.` });
        });
      }),
    meta: z
      .object({
        status: z.enum(["draft", "published"]),
        review: z.literal("not-reviewed"),
        versionId: z.number().int().positive().nullable(),
        contentVersion: z.number().int().positive().nullable(),
        source: z.enum(["database", "workers-ai"]),
        cached: z.boolean(),
        model: z.string().max(80).nullable(),
      })
      .strict(),
  })
  .strict();

export type DraftContract = z.infer<typeof draftContractSchema>;

export function parseDraftContract(value: unknown) {
  return draftContractSchema.safeParse(value);
}
