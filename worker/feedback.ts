import { z } from "zod";
import { findMission } from "../src/learning/missions/catalog.ts";
import type { Env } from "./env.ts";
import { failure, json, readJson, requester } from "./http.ts";

const frameId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);

const feedbackSchema = z
  .object({
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("mission"), missionId: z.string().max(64), missionVersion: z.string().max(20), engineVersion: z.string().max(20), scenarioKey: z.string().max(600), frameId }).strict(),
      z.object({ kind: z.literal("draft"), versionId: z.number().int().positive(), frameId }).strict(),
    ]),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(1000).default(""),
  })
  .strict();

export async function handleFeedback(request: Request, env: Env) {
  const parsed = feedbackSchema.safeParse(await readJson(request, 4_096));
  if (!parsed.success) return failure(400, "INVALID_FEEDBACK", "Feedback needs a rating from 1 to 5 and a valid target.");
  if (!env.DB) return failure(503, "DB_UNAVAILABLE", "Feedback storage is not connected.");
  const { target, rating, comment } = parsed.data;
  try {
    if (target.kind === "mission") {
      const mission = findMission(target.missionId);
      if (!mission || mission.version !== target.missionVersion || !target.scenarioKey.startsWith(`${mission.engine.id}@${target.engineVersion}:`)) {
        return failure(409, "UNKNOWN_TARGET", "That mission version is no longer available.");
      }
      const row = await env.DB.prepare("INSERT INTO mission_feedback (mission_id, mission_version, engine_version, scenario_key, frame_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(target.missionId, target.missionVersion, target.engineVersion, target.scenarioKey, target.frameId, rating, comment.trim() || null)
        .first<{ id: number }>();
      return json({ ok: true, id: row!.id }, 201);
    }
    const version = await env.DB.prepare("SELECT id FROM lesson_versions WHERE id = ?").bind(target.versionId).first<{ id: number }>();
    if (!version) return failure(404, "UNKNOWN_VERSION", "That draft version does not exist.");
    const row = await env.DB.prepare("INSERT INTO lesson_feedback (lesson_version_id, event_id, rating, comment) VALUES (?, ?, ?, ?) RETURNING id")
      .bind(target.versionId, target.frameId, rating, comment.trim() || null)
      .first<{ id: number }>();
    return json({ ok: true, id: row!.id }, 201);
  } catch (error) {
    console.error("Feedback save failed.", error);
    return failure(503, "D1_SAVE_FAILED", "Feedback could not be saved. Please try again.");
  }
}

const eventSchema = z
  .object({
    type: z.enum(["prediction-submitted", "mission-mastered", "attempt-finished"]),
    missionId: z.string().max(64),
    missionVersion: z.string().max(20),
    engineVersion: z.string().max(20),
    scenarioKey: z.string().max(600),
    correct: z.boolean().optional(),
  })
  .strict();

/** Meaningful learning events only; the client never sends per-frame events. */
export async function handleEvent(request: Request, env: Env) {
  const parsed = eventSchema.safeParse(await readJson(request, 2_048));
  if (!parsed.success || !findMission(parsed.data.missionId)) return failure(400, "INVALID_EVENT", "Unknown learning event.");
  if (!env.DB) return json({ ok: false, stored: false }, 202);
  const event = parsed.data;
  try {
    await env.DB.prepare("INSERT INTO learning_events (session_hash, event_type, mission_id, mission_version, engine_version, scenario_key, correct) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind((await requester(request)).session, event.type, event.missionId, event.missionVersion, event.engineVersion, event.scenarioKey, event.correct === undefined ? null : Number(event.correct))
      .run();
    return json({ ok: true, stored: true }, 201);
  } catch (error) {
    console.error("Learning event save failed.", error);
    return json({ ok: false, stored: false }, 202);
  }
}
