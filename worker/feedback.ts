import { z } from "zod";
import { findMission } from "../src/learning/missions/catalog.ts";
import type { D1Database, Env } from "./env.ts";
import { failure, json, readJson, requester, requireJson } from "./http.ts";
import { admit } from "./quota.ts";

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

/**
 * Retired mission versions still accepted from tabs opened before a deploy. The event and feedback shape is
 * unchanged and every row keeps its version, so they never mix with the current version's data. When bumping a
 * mission's version, add the old one here; anything unlisted is rejected.
 */
const RETIRED_VERSIONS: Record<string, string[]> = {
  "tcp-lost-segment": ["1.0.0"],
  "tcp-send-window": ["1.0.0"],
  "tcp-lab": ["1.0.0"],
};

/** A mission this Worker serves, at its current or a listed retired version, on the current engine version. */
function isKnown(target: { missionId: string; missionVersion: string; engineVersion: string; scenarioKey: string }) {
  const mission = findMission(target.missionId);
  if (!mission || mission.engine.version !== target.engineVersion || !target.scenarioKey.startsWith(`${mission.engine.id}@${target.engineVersion}:`)) return false;
  return mission.version === target.missionVersion || Boolean(RETIRED_VERSIONS[mission.id]?.includes(target.missionVersion));
}

/**
 * Daily (UTC) write caps for the public endpoints, in their own usage_counters scopes: they never draw on AI
 * quotas. Keyed on the client network (IPv4 address or IPv6 /64), plus a global ceiling that bounds D1 writes
 * however many addresses an abuser holds. x-kitab-session is client-chosen, so it gates nothing here.
 * A network cap fits a ~30-learner classroom behind one NAT.
 */
// ponytail: constants, move to wrangler vars if they need tuning without a deploy.
export const DAILY_LIMITS = {
  feedback: { network: 50, global: 500 },
  events: { network: 2_000, global: 10_000 },
};

const LIMITED_MESSAGE = {
  feedback: "Feedback limit reached for today on this network. Please try again tomorrow.",
  events: "Learning event limit reached for today.",
};

/** `release` when admitted; otherwise `limited`, a 429 that holds until the UTC day resets. A rejection writes nothing to D1. */
async function rateLimit(db: D1Database, kind: keyof typeof DAILY_LIMITS, network: string) {
  const limits = DAILY_LIMITS[kind];
  const result = await admit(db, [
    { scope: `${kind}-network`, subject: network, limit: limits.network },
    { scope: `${kind}-global`, subject: "global", limit: limits.global },
  ]);
  if (result.ok) return { release: result.release };
  // Measured without a D1 write: this log line and the 429s in Workers analytics.
  console.warn(JSON.stringify({ message: "rate-limited", endpoint: kind, scope: result.exhausted }));
  const now = new Date();
  const retryAfter = Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
  return { limited: json({ error: LIMITED_MESSAGE[kind], code: "RATE_LIMITED" }, 429, { "retry-after": String(retryAfter) }) };
}

export async function handleFeedback(request: Request, env: Env) {
  requireJson(request);
  const parsed = feedbackSchema.safeParse(await readJson(request, 4_096));
  if (!parsed.success) return failure(400, "INVALID_FEEDBACK", "Feedback needs a rating from 1 to 5 and a valid target.");
  if (!env.DB) return failure(503, "DB_UNAVAILABLE", "Feedback storage is not connected.");
  const { target, rating, comment } = parsed.data;
  if (target.kind === "mission" && !isKnown(target)) return failure(409, "UNKNOWN_TARGET", "That mission version is no longer available.");
  let release: (() => Promise<unknown>) | undefined;
  try {
    const gate = await rateLimit(env.DB, "feedback", (await requester(request)).network);
    if (gate.limited) return gate.limited;
    release = gate.release;
    if (target.kind === "mission") {
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
    // A save that never happened does not use up the learner's quota.
    await release?.().catch(() => undefined);
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

/** Meaningful learning events only; the client never sends per-frame events. Over the daily cap they are dropped with a 429. */
export async function handleEvent(request: Request, env: Env) {
  requireJson(request);
  const parsed = eventSchema.safeParse(await readJson(request, 2_048));
  if (!parsed.success || !isKnown(parsed.data)) return failure(400, "INVALID_EVENT", "Unknown learning event.");
  if (!env.DB) return json({ ok: false, stored: false }, 202);
  const event = parsed.data;
  let release: (() => Promise<unknown>) | undefined;
  try {
    const who = await requester(request);
    const gate = await rateLimit(env.DB, "events", who.network);
    if (gate.limited) return gate.limited;
    release = gate.release;
    await env.DB.prepare("INSERT INTO learning_events (session_hash, event_type, mission_id, mission_version, engine_version, scenario_key, correct) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(who.session, event.type, event.missionId, event.missionVersion, event.engineVersion, event.scenarioKey, event.correct === undefined ? null : Number(event.correct))
      .run();
    return json({ ok: true, stored: true }, 201);
  } catch (error) {
    await release?.().catch(() => undefined);
    console.error("Learning event save failed.", error);
    return json({ ok: false, stored: false }, 202);
  }
}
