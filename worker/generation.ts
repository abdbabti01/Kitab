import { engineKinds, hasEngineEvidence, selectEngineKind, type EngineKind } from "../src/visual-engine/core/visualization-spec.ts";
import { DRAFT_CONTRACT, draftContractSchema, type DraftContract } from "../src/learning/draft-contract.ts";
import { AiError, runBudgeted } from "./ai.ts";
import { limit, modelFor, type D1Database, type Env, type WorkerContext } from "./env.ts";
import { failure, HttpError, json, readJson, requester, sha256 } from "./http.ts";
import { reserve } from "./quota.ts";

export const GENERATED_SCHEMA_VERSION = 2;
export const PROMPT_VERSION = "draft-prompt/3";

export type GeneratedLesson = {
  schemaVersion: 2;
  title: string;
  category: string;
  level: "Beginner" | "Beginner → Intermediate";
  summary: string;
  analogy: string;
  sections: { heading: string; body: string }[];
  terms: { term: string; definition: string }[];
  visualization: {
    engine: EngineKind;
    title: string;
    actors: { label: string; role: string }[];
    links: { from: number; to: number; label: string }[];
    events: { from: number; to: number; label: string; detail: string; state: string; payload: string }[];
  };
  tryIt: string[];
};

const textPair = (a: string, b: string) => ({ type: "object", additionalProperties: false, properties: { [a]: { type: "string" }, [b]: { type: "string" } }, required: [a, b] });

export const generatedLessonJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "integer", enum: [2] },
    title: { type: "string" },
    category: { type: "string" },
    level: { type: "string", enum: ["Beginner", "Beginner → Intermediate"] },
    summary: { type: "string" },
    analogy: { type: "string" },
    sections: { type: "array", minItems: 3, maxItems: 5, items: textPair("heading", "body") },
    terms: { type: "array", minItems: 3, maxItems: 6, items: textPair("term", "definition") },
    visualization: {
      type: "object",
      additionalProperties: false,
      properties: {
        engine: { type: "string", enum: [...engineKinds] },
        title: { type: "string" },
        actors: { type: "array", minItems: 2, maxItems: 8, items: textPair("label", "role") },
        links: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, properties: { from: { type: "integer", minimum: 0, maximum: 7 }, to: { type: "integer", minimum: 0, maximum: 7 }, label: { type: "string" } }, required: ["from", "to", "label"] } },
        events: {
          type: "array",
          minItems: 4,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            properties: { from: { type: "integer", minimum: 0, maximum: 7 }, to: { type: "integer", minimum: 0, maximum: 7 }, label: { type: "string" }, detail: { type: "string" }, state: { type: "string" }, payload: { type: "string" } },
            required: ["from", "to", "label", "detail", "state", "payload"],
          },
        },
      },
      required: ["engine", "title", "actors", "links", "events"],
    },
    tryIt: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
  },
  required: ["schemaVersion", "title", "category", "level", "summary", "analogy", "sections", "terms", "visualization", "tryIt"],
};

export function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9+#.\- ]/g, " ").replace(/\s+/g, " ").trim();
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validTextPair = (value: unknown, a: string, b: string) => Boolean(value && typeof value === "object" && nonEmpty((value as Record<string, unknown>)[a]) && nonEmpty((value as Record<string, unknown>)[b]));

const genericQueryWords = new Set(["about", "computer", "concept", "data", "explain", "introduction", "learn", "programming", "science", "structure", "structures", "system", "systems", "the", "what"]);

function lessonSemanticText(lesson: GeneratedLesson) {
  return [
    lesson.summary,
    lesson.analogy,
    ...lesson.sections.flatMap((section) => [section.heading, section.body]),
    ...lesson.terms.flatMap((term) => [term.term, term.definition]),
    lesson.visualization.title,
    ...lesson.visualization.actors.flatMap((actor) => [actor.label, actor.role]),
    ...lesson.visualization.events.flatMap((event) => [event.label, event.detail, event.state, event.payload]),
    ...lesson.tryIt,
  ].join(" ");
}

/** The single, trusted engine decision. The client renders whatever this returns. */
export function applyEnginePolicy(concept: string, lesson: GeneratedLesson): GeneratedLesson {
  const engine = selectEngineKind({ engine: lesson.visualization.engine, title: `${concept} ${lesson.title} ${lesson.summary}`, category: lesson.category });
  return { ...lesson, schemaVersion: GENERATED_SCHEMA_VERSION, visualization: { ...lesson.visualization, engine } };
}

/** Relevance heuristics. Passing this is NOT editorial review or factual verification. */
export function lessonMatchesConcept(concept: string, lesson: GeneratedLesson) {
  const semanticText = lessonSemanticText(lesson);
  const words = normalize(semanticText).split(" ");
  const tokens = normalize(concept).split(" ").filter((token) => token.length >= 3 && !genericQueryWords.has(token));
  const tokenMatch = tokens.length === 0 || tokens.some((token) => {
    const singular = token.endsWith("s") ? token.slice(0, -1) : token;
    return words.some((word) => word === token || word === singular);
  });
  if (!tokenMatch) return false;
  const broadDataStructures = /^data structures?$/i.test(concept.trim());
  if (!hasEngineEvidence(lesson.visualization.engine, semanticText, broadDataStructures ? 2 : 1)) return false;
  if (broadDataStructures && /\b(?:book|catalog|library)\b/i.test(semanticText) && !hasEngineEvidence("memory", semanticText, 3)) return false;
  return true;
}

export function validateLesson(value: unknown): GeneratedLesson {
  if (!value || typeof value !== "object") throw new Error("Incomplete lesson.");
  const lesson = value as Partial<GeneratedLesson>;
  if (
    lesson.schemaVersion !== GENERATED_SCHEMA_VERSION || !nonEmpty(lesson.title) || !nonEmpty(lesson.category) ||
    !["Beginner", "Beginner → Intermediate"].includes(lesson.level ?? "") || !nonEmpty(lesson.summary) || !nonEmpty(lesson.analogy) ||
    !Array.isArray(lesson.sections) || lesson.sections.length < 3 || lesson.sections.length > 5 || !lesson.sections.every((item) => validTextPair(item, "heading", "body")) ||
    !Array.isArray(lesson.terms) || lesson.terms.length < 3 || lesson.terms.length > 6 || !lesson.terms.every((item) => validTextPair(item, "term", "definition")) ||
    !Array.isArray(lesson.tryIt) || lesson.tryIt.length < 3 || lesson.tryIt.length > 5 || !lesson.tryIt.every(nonEmpty)
  ) throw new Error("Incomplete lesson.");
  const visualization = lesson.visualization;
  if (
    !visualization || !engineKinds.includes(visualization.engine) || !nonEmpty(visualization.title) ||
    !Array.isArray(visualization.actors) || visualization.actors.length < 2 || visualization.actors.length > 8 || !visualization.actors.every((item) => validTextPair(item, "label", "role")) ||
    !Array.isArray(visualization.links) || visualization.links.length < 1 || visualization.links.length > 12 ||
    !Array.isArray(visualization.events) || visualization.events.length < 4 || visualization.events.length > 8
  ) throw new Error("Invalid simulation.");
  const count = visualization.actors.length;
  const ref = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < count;
  if (!visualization.links.every((link) => ref(link.from) && ref(link.to) && nonEmpty(link.label))) throw new Error("Invalid simulation.");
  if (!visualization.events.every((event) => ref(event.from) && ref(event.to) && nonEmpty(event.label) && nonEmpty(event.detail) && nonEmpty(event.state) && nonEmpty(event.payload))) throw new Error("Invalid simulation.");
  return lesson as GeneratedLesson;
}

const clip = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

/** Builds and strictly validates the versioned client contract. */
export function toContract(slug: string, lesson: GeneratedLesson, meta: DraftContract["meta"]): DraftContract {
  const v = lesson.visualization;
  return draftContractSchema.parse({
    contract: DRAFT_CONTRACT,
    slug: clip(slug, 120),
    title: clip(lesson.title, 120),
    category: clip(lesson.category, 80),
    level: lesson.level,
    summary: clip(lesson.summary, 800),
    analogy: clip(lesson.analogy, 600),
    sections: lesson.sections.map((section) => ({ heading: clip(section.heading, 120), body: clip(section.body, 1600) })),
    terms: lesson.terms.map((term) => ({ term: clip(term.term, 80), definition: clip(term.definition, 400) })),
    tryIt: lesson.tryIt.map((item) => clip(item, 300)),
    visualization: {
      engine: v.engine,
      title: clip(v.title, 120),
      actors: v.actors.map((actor) => ({ label: clip(actor.label, 60), role: clip(actor.role, 160) })),
      links: v.links.map((link) => ({ from: link.from, to: link.to, label: clip(link.label, 60) })),
      events: v.events.map((event) => ({ from: event.from, to: event.to, label: clip(event.label, 80), detail: clip(event.detail, 420), state: clip(event.state, 140), payload: clip(event.payload, 70) })),
    },
    meta,
  });
}

/** Re-checks saved content against the current policy and contract. Throws when stale. */
export function governSaved(key: string, content: unknown) {
  const saved = validateLesson(content);
  const governed = applyEnginePolicy(key, saved);
  if (governed.visualization.engine !== saved.visualization.engine || !lessonMatchesConcept(key, governed)) throw new Error("Saved draft failed the current policy.");
  return governed;
}

function prompt(concept: string) {
  return `Create an accurate lesson about this computer-science or programming concept: "${concept.replace(/"/g, "'")}".
Write for a true beginner without removing important technical truth. If the term is ambiguous, interpret it in computing. If it is unrelated to computing, say so clearly.
Set schemaVersion to 2. Describe the real causal mechanism, not a themed analogy or decorative diagram. Suggest exactly one visualization engine; Kitab will verify and may override it:
- protocol: packets, protocol layers, endpoints, headers, routing, delivery or loss
- request: ordered web, DNS, API, database or processing pipelines
- memory: arrays, linked structures, hashes, queues, buffers, allocation or pointers
- tree: trees, graphs, traversal, indexes or hierarchical relationships
- execution: functions, recursion, call stacks, instructions, compilers or runtimes
- concurrency: processes, threads, scheduling, locks, races, ordering or shared resources
- distributed: services, brokers, replicas, caches, consensus or multi-service messages
- state-machine: lifecycles, cycles, comparisons and transitions between named states
Actors must be real components. Links describe stable structural relationships. Events form a chronological trace of movement or state change with valid actor indexes. Every event names the visible action, explains why it occurs, gives the resulting state and a short payload label. Do not generate drawing coordinates, CSS, SVG, HTML or executable code.`;
}

type Usage = { calls: number; inputTokens: number; outputTokens: number; latencyMs: number };

const MAX_INFERENCE_CALLS = 3;
const GENERATION_TIMEOUT_MS = 25_000;

async function generate(env: Env, concept: string, usage: Usage): Promise<GeneratedLesson> {
  const model = modelFor(env);
  const base = [
    { role: "system", content: "You create accurate, beginner-friendly computer-science lessons as structured JSON. Return JSON only and follow the supplied schema exactly. Never output drawing coordinates or HTML." },
    { role: "user", content: prompt(concept) },
  ];
  const attempts = [
    { messages: base, response_format: { type: "json_schema", json_schema: generatedLessonJsonSchema }, temperature: 0.2 },
    { messages: [...base, { role: "user", content: `Return one valid JSON object only, matching this schema: ${JSON.stringify(generatedLessonJsonSchema)}` }], response_format: { type: "json_object" }, temperature: 0.1 },
    { messages: [...base, { role: "user", content: `The previous answer was rejected as off-topic or vague. Regenerate the lesson about exactly "${concept.replace(/"/g, "'")}" using its real components, operations and state changes. No themed CRUD story.` }], response_format: { type: "json_schema", json_schema: generatedLessonJsonSchema }, temperature: 0.2 },
  ];
  let lastError: unknown = new Error("No attempt ran.");
  for (const attempt of attempts.slice(0, MAX_INFERENCE_CALLS)) {
    try {
      // Every attempt, including retries, reserves from the shared daily token allowance first.
      const result = await runBudgeted(env.DB!, limit(env.DAILY_TOKEN_BUDGET, 2_000_000), env.AI!, model, { ...attempt, max_tokens: 2400 }, limit(env.AI_TIMEOUT_MS, GENERATION_TIMEOUT_MS));
      usage.calls += 1;
      usage.inputTokens += result.inputTokens ?? 0;
      usage.outputTokens += result.outputTokens ?? 0;
      usage.latencyMs += result.latencyMs;
      const lesson = applyEnginePolicy(concept, validateLesson(result.value));
      if (lessonMatchesConcept(concept, lesson)) return lesson;
      lastError = new Error("Generated lesson failed concept relevance validation.");
    } catch (error) {
      lastError = error;
      if (error instanceof AiError && error.code === "AI_BUDGET_EXHAUSTED") throw error; // no reservation, no call
      usage.calls += 1;
      usage.inputTokens += (error instanceof AiError ? error.usage?.inputTokens : null) ?? 0;
      usage.outputTokens += (error instanceof AiError ? error.usage?.outputTokens : null) ?? 0;
      if (error instanceof AiError && error.code === "AI_TIMEOUT") break; // don't stack timeouts
    }
  }
  throw lastError;
}

async function findConcept(db: D1Database, key: string) {
  return db
    .prepare("SELECT id, content_json, source, status FROM concepts WHERE normalized_name = ? AND status IN ('published', 'draft') ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END LIMIT 1")
    .bind(key)
    .first<{ id: number; content_json: string; source: "curated" | "ai"; status: "draft" | "published" }>();
}

async function latestVersion(db: D1Database, conceptId: number) {
  return db.prepare("SELECT id, version FROM lesson_versions WHERE concept_id = ? ORDER BY version DESC LIMIT 1").bind(conceptId).first<{ id: number; version: number }>();
}

/**
 * Returns the saved draft as a contract, repairing a missing immutable
 * version row (left behind by older releases) so feedback can attach to it.
 */
async function savedContract(db: D1Database, key: string, row: NonNullable<Awaited<ReturnType<typeof findConcept>>>, model: string | null) {
  const lesson = row.source === "ai" ? governSaved(key, JSON.parse(row.content_json)) : validateLesson(JSON.parse(row.content_json));
  let version = await latestVersion(db, row.id);
  if (!version) {
    const content = JSON.stringify(lesson);
    version = await db
      .prepare("INSERT INTO lesson_versions (concept_id, version, engine, spec_json, source, validation_status, checksum) VALUES (?, 1, ?, ?, ?, 'schema-valid', ?) ON CONFLICT(concept_id, version) DO UPDATE SET version = version RETURNING id, version")
      .bind(row.id, `generated.${lesson.visualization.engine}`, content, row.source, await sha256(content))
      .first<{ id: number; version: number }>();
  }
  return toContract(key, lesson, { status: row.status, review: "not-reviewed", versionId: version?.id ?? null, contentVersion: version?.version ?? null, source: "database", cached: true, model });
}

/** Same-instance coalescing only. Cross-instance coalescing uses the D1 lease below. */
const inflight = new Map<string, Promise<Response>>();

const LEASE_MS = 90_000;
const FOLLOWER_WAIT_MS = 30_000;
const FOLLOWER_POLL_MS = 750;

export function cacheKey(key: string) {
  return `${PROMPT_VERSION}:${GENERATED_SCHEMA_VERSION}:${key}`;
}

async function acquireLease(db: D1Database, key: string, owner: string, now = Date.now()) {
  const row = await db
    .prepare(
      `INSERT INTO generation_jobs (cache_key, normalized_query, status, owner, lease_expires_at) VALUES (?, ?, 'running', ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET status = 'running', owner = excluded.owner, lease_expires_at = excluded.lease_expires_at, error_code = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE generation_jobs.status != 'running' OR generation_jobs.lease_expires_at < ?
       RETURNING owner`,
    )
    .bind(cacheKey(key), key, owner, now + LEASE_MS, now)
    .first<{ owner: string }>();
  return row?.owner === owner;
}

async function completeLease(db: D1Database, key: string, owner: string, versionId: number | null) {
  await db.prepare("UPDATE generation_jobs SET status = 'completed', version_id = ?, error_code = NULL, updated_at = CURRENT_TIMESTAMP WHERE cache_key = ? AND owner = ?").bind(versionId, cacheKey(key), owner).run();
}

async function settleLease(db: D1Database, key: string, owner: string, status: "failed" | "released", code: string) {
  await db.prepare("UPDATE generation_jobs SET status = ?, error_code = ?, updated_at = CURRENT_TIMESTAMP WHERE cache_key = ? AND owner = ?").bind(status, code, cacheKey(key), owner).run();
}

async function waitForLeader(env: Env, key: string, sleep: (ms: number) => Promise<void>) {
  const db = env.DB!;
  const deadline = Date.now() + FOLLOWER_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(FOLLOWER_POLL_MS);
    const job = await db.prepare("SELECT status, error_code FROM generation_jobs WHERE cache_key = ?").bind(cacheKey(key)).first<{ status: string; error_code: string | null }>();
    if (job?.status === "completed") {
      const row = await findConcept(db, key);
      if (row) return json({ ...(await savedContract(db, key, row, null)), coalesced: true });
    }
    if (job && job.status !== "running") return failure(502, job.error_code ?? "AI_GENERATION_FAILED", "The draft could not be generated. Please try again.");
  }
  return failure(503, "GENERATION_IN_PROGRESS", "This draft is still being written. Try again in a few seconds.", { retryAfterSeconds: 5 });
}

/**
 * Test seams. `localCoalescing: false` simulates requests landing on different Worker instances;
 * `beforeLease` pauses a request between its cache miss and its lease, to reproduce interleavings.
 */
export type GenerationDeps = { sleep?: (ms: number) => Promise<void>; owner?: string; localCoalescing?: boolean; beforeLease?: () => Promise<void> };

export async function handleGenerate(request: Request, env: Env, ctx: WorkerContext, deps: GenerationDeps = {}) {
  if (!env.DB) return failure(503, "DB_UNAVAILABLE", "The concept database is not connected. Check the D1 binding and migrations.");
  const body = (await readJson(request, 2_048)) as { concept?: unknown } | null;
  const concept = typeof body?.concept === "string" ? body.concept.trim() : "";
  if (concept.length < 2 || concept.length > 120) return failure(400, "INVALID_CONCEPT", "Enter a concept between 2 and 120 characters.");
  const key = normalize(concept);
  if (key.length < 2) return failure(400, "INVALID_CONCEPT", "Enter a valid programming or computer-science concept.");

  const db = env.DB;
  let existing: Awaited<ReturnType<typeof findConcept>>;
  try {
    existing = await findConcept(db, key);
  } catch (error) {
    console.error("D1 lookup failed.", error);
    return failure(503, "D1_LOOKUP_FAILED", "The concept database is not connected correctly. Check the D1 database ID and migrations.");
  }
  if (existing) {
    try {
      const contract = await savedContract(db, key, existing, null);
      ctx.waitUntil(db.prepare("UPDATE concepts SET hit_count = hit_count + 1, last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(existing.id).run().catch(() => undefined));
      return json(contract);
    } catch (error) {
      console.warn("Ignoring stale or off-topic saved draft; regenerating.", error);
    }
  }

  if (deps.localCoalescing === false) return leaderOrFollower(request, env, key, concept, deps);
  const same = inflight.get(key);
  if (same) return (await same).clone();
  const work = leaderOrFollower(request, env, key, concept, deps);
  inflight.set(key, work);
  try {
    return (await work).clone();
  } finally {
    inflight.delete(key);
  }
}

async function leaderOrFollower(request: Request, env: Env, key: string, concept: string, deps: GenerationDeps) {
  const db = env.DB!;
  const owner = deps.owner ?? crypto.randomUUID();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let leader: boolean;
  await deps.beforeLease?.();
  try {
    leader = await acquireLease(db, key, owner);
  } catch (error) {
    console.error("D1 lease failed.", error);
    return failure(503, "D1_UNAVAILABLE", "The lesson service is temporarily unavailable.");
  }
  if (!leader) return waitForLeader(env, key, sleep);

  // Another request may have saved this query between our cache miss and this lease (its lease is then
  // 'completed', which we may take over). Reuse valid current-policy content before spending any quota.
  try {
    const saved = await findConcept(db, key);
    if (saved) {
      const contract = await savedContract(db, key, saved, null).catch(() => null); // stale content → regenerate below
      if (contract) {
        await completeLease(db, key, owner, contract.meta.versionId).catch(() => undefined);
        return json({ ...contract, coalesced: true });
      }
    }
  } catch (error) {
    console.error("D1 recheck after lease failed.", error);
    await settleLease(db, key, owner, "released", "D1_LOOKUP_FAILED").catch(() => undefined);
    return failure(503, "D1_LOOKUP_FAILED", "The lesson service is temporarily unavailable.");
  }

  if (!env.AI) {
    await settleLease(db, key, owner, "released", "AI_UNAVAILABLE").catch(() => undefined);
    return failure(503, "AI_UNAVAILABLE", "Draft generation is not configured on this deployment. Reviewed missions still work.");
  }

  const who = await requester(request);
  let reservation: Awaited<ReturnType<typeof reserve>>;
  try {
    reservation = await reserve(db, [
      { scope: "generate-ip", subject: who.ip, limit: limit(env.DAILY_GENERATIONS_PER_IP, 20) },
      { scope: "generate-session", subject: who.session, limit: limit(env.DAILY_GENERATIONS_PER_SESSION, 20) },
      { scope: "generate-global", subject: "global", limit: limit(env.DAILY_GENERATIONS_GLOBAL, 500) },
    ]);
  } catch (error) {
    console.error("D1 quota reservation failed.", error);
    await settleLease(db, key, owner, "released", "QUOTA_UNAVAILABLE").catch(() => undefined);
    return failure(503, "QUOTA_UNAVAILABLE", "The lesson service is temporarily unavailable.");
  }
  if (!reservation.ok) {
    await settleLease(db, key, owner, "released", "QUOTA_EXHAUSTED").catch(() => undefined);
    return failure(429, "QUOTA_EXHAUSTED", "Today's new-draft limit was reached. Saved drafts and reviewed missions remain available.", { scope: reservation.exhausted });
  }

  const model = modelFor(env);
  const started = Date.now();
  let requestId: number | null = null;
  try {
    requestId = (await db.prepare("INSERT INTO generation_requests (normalized_query, model, status, prompt_version, schema_version) VALUES (?, ?, 'started', ?, ?) RETURNING id").bind(key, model, PROMPT_VERSION, GENERATED_SCHEMA_VERSION).first<{ id: number }>())?.id ?? null;
  } catch (error) {
    console.error("D1 generation record start failed.", error);
  }

  const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  let lesson: GeneratedLesson;
  try {
    lesson = await generate(env, concept, usage);
  } catch (error) {
    const code = error instanceof AiError ? error.code : "AI_GENERATION_FAILED";
    const exhausted = code === "AI_BUDGET_EXHAUSTED";
    console.error("Workers AI generation failed.", error);
    await Promise.allSettled([
      settleLease(db, key, owner, exhausted ? "released" : "failed", code),
      requestId ? db.prepare("UPDATE generation_requests SET status = 'failed', error_code = ?, validation_outcome = 'rejected', inference_calls = ?, latency_ms = ?, input_tokens = ?, output_tokens = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(code, usage.calls, Date.now() - started, usage.inputTokens, usage.outputTokens, requestId).run() : Promise.resolve(),
      // Nothing was inferred: give the per-IP/session call back.
      exhausted && usage.calls === 0 ? reservation.release() : Promise.resolve(),
    ]);
    if (exhausted) return failure(429, "QUOTA_EXHAUSTED", "Today's AI allowance is used up. Saved drafts and reviewed missions remain available.", { scope: "ai-tokens" });
    return failure(code === "AI_TIMEOUT" ? 504 : 502, code, "Workers AI could not produce a valid draft. Please try again later.");
  }

  const content = JSON.stringify(lesson);
  const checksum = await sha256(content);
  let versionRow: { id: number; version: number } | undefined;
  try {
    // Concept, immutable version, audit record and job state commit together or not at all.
    const results = await db.batch<{ id: number; version: number }>([
      db.prepare(
        `INSERT INTO concepts (normalized_name, display_name, category, content_json, source, status, hit_count, last_accessed_at)
         VALUES (?, ?, ?, ?, 'ai', 'draft', 1, CURRENT_TIMESTAMP)
         ON CONFLICT(normalized_name) DO UPDATE SET content_json = excluded.content_json, display_name = excluded.display_name, category = excluded.category,
           source = 'ai', status = 'draft', updated_at = CURRENT_TIMESTAMP, last_accessed_at = CURRENT_TIMESTAMP`,
      ).bind(key, lesson.title.slice(0, 120), lesson.category.slice(0, 80), content),
      db.prepare(
        `INSERT INTO lesson_versions (concept_id, version, engine, spec_json, source, validation_status, checksum)
         SELECT id, COALESCE((SELECT MAX(version) + 1 FROM lesson_versions WHERE concept_id = concepts.id), 1), ?, ?, 'ai', 'schema-valid', ?
         FROM concepts WHERE normalized_name = ? RETURNING id, version`,
      ).bind(`generated.${lesson.visualization.engine}`, content, checksum, key),
      db.prepare(
        `UPDATE generation_requests SET status = 'completed', validation_outcome = 'schema-valid+relevance', inference_calls = ?, latency_ms = ?, input_tokens = ?, output_tokens = ?,
           lesson_version_id = (SELECT MAX(v.id) FROM lesson_versions v JOIN concepts c ON c.id = v.concept_id WHERE c.normalized_name = ?), completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(usage.calls, Date.now() - started, usage.inputTokens, usage.outputTokens, key, requestId),
      db.prepare(
        `UPDATE generation_jobs SET status = 'completed', version_id = (SELECT MAX(v.id) FROM lesson_versions v JOIN concepts c ON c.id = v.concept_id WHERE c.normalized_name = ?), updated_at = CURRENT_TIMESTAMP
         WHERE cache_key = ? AND owner = ?`,
      ).bind(key, cacheKey(key), owner),
    ]);
    versionRow = results[1]?.results?.[0];
    if (!versionRow) throw new Error("Version row was not created.");
  } catch (error) {
    console.error("D1 save failed; nothing was committed.", error);
    await Promise.allSettled([
      settleLease(db, key, owner, "failed", "D1_SAVE_FAILED"),
      requestId ? db.prepare("UPDATE generation_requests SET status = 'failed', error_code = 'D1_SAVE_FAILED', inference_calls = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(usage.calls, requestId).run() : Promise.resolve(),
    ]);
    return failure(503, "D1_SAVE_FAILED", "The draft was generated but could not be saved, so it was not published. Please try again.");
  }
  return json(toContract(key, lesson, { status: "draft", review: "not-reviewed", versionId: versionRow.id, contentVersion: versionRow.version, source: "workers-ai", cached: false, model }));
}

export async function handleReadLesson(request: Request, env: Env) {
  if (!env.DB) return failure(503, "DB_UNAVAILABLE", "The concept database is not connected.");
  const raw = new URL(request.url).pathname.slice("/api/lessons/".length);
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return failure(400, "INVALID_SLUG", "That lesson address is malformed.");
  }
  const key = normalize(slug);
  if (!key || key.length > 120) return failure(400, "INVALID_SLUG", "Enter a lesson name.");
  try {
    const row = await findConcept(env.DB, key);
    if (!row) return failure(404, "NOT_FOUND", "Lesson not found.");
    try {
      return json(await savedContract(env.DB, key, row, null));
    } catch {
      return failure(409, "STALE_GENERATED_LESSON", "This saved draft is outdated. Search for it again to rebuild it.");
    }
  } catch (error) {
    console.error("D1 lesson read failed.", error);
    return failure(503, "D1_LOOKUP_FAILED", "The lesson could not be opened.");
  }
}

export async function handleListConcepts(request: Request, env: Env) {
  if (!env.DB) return json({ concepts: [] });
  const query = normalize(new URL(request.url).searchParams.get("q") ?? "").slice(0, 120);
  const pattern = `%${query.replace(/[%_]/g, "")}%`;
  try {
    const result = await env.DB
      .prepare(
        `SELECT c.normalized_name AS slug, c.display_name AS title, c.category, c.source, c.status, c.hit_count
         FROM concepts c
         WHERE (? = '' OR c.normalized_name LIKE ? OR lower(c.display_name) LIKE ? OR EXISTS (SELECT 1 FROM concept_aliases a WHERE a.concept_id = c.id AND a.normalized_alias LIKE ?))
           AND c.status IN ('published', 'draft')
           AND (c.source = 'curated' OR (c.source = 'ai' AND json_extract(c.content_json, '$.schemaVersion') = 2))
         ORDER BY CASE c.status WHEN 'published' THEN 0 ELSE 1 END, c.hit_count DESC, c.updated_at DESC LIMIT 20`,
      )
      .bind(query, pattern, pattern, pattern)
      .all();
    return json({ concepts: result.results ?? [] });
  } catch (error) {
    console.error("D1 concept search failed.", error);
    return failure(503, "D1_SEARCH_FAILED", "The concept library is temporarily unavailable.");
  }
}

export { HttpError };
