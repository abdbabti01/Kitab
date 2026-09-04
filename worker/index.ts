interface D1Result<T> {
  results?: T[];
  success?: boolean;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(sql: string): D1Statement;
}

interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface Env {
  AI: AiBinding;
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

type StoredConcept = {
  id: number;
  content_json: string;
  source: "curated" | "ai";
  status: "draft" | "published" | "archived";
};

type GeneratedLesson = {
  title: string;
  category: string;
  level: "Beginner" | "Beginner → Intermediate";
  summary: string;
  analogy: string;
  sections: { heading: string; body: string }[];
  terms: { term: string; definition: string }[];
  visualization: {
    engine:
      | "protocol"
      | "request"
      | "memory"
      | "tree"
      | "execution"
      | "concurrency"
      | "distributed"
      | "state-machine";
    title: string;
    actors: { label: string; role: string }[];
    links: { from: number; to: number; label: string }[];
    events: {
      from: number;
      to: number;
      label: string;
      detail: string;
      state: string;
      payload: string;
    }[];
  };
  tryIt: string[];
};

const generatedLessonJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    category: { type: "string" },
    level: {
      type: "string",
      enum: ["Beginner", "Beginner → Intermediate"],
    },
    summary: { type: "string" },
    analogy: { type: "string" },
    sections: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
        },
        required: ["heading", "body"],
      },
    },
    terms: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          term: { type: "string" },
          definition: { type: "string" },
        },
        required: ["term", "definition"],
      },
    },
    visualization: {
      type: "object",
      additionalProperties: false,
      properties: {
        engine: {
          type: "string",
          enum: [
            "protocol",
            "request",
            "memory",
            "tree",
            "execution",
            "concurrency",
            "distributed",
            "state-machine",
          ],
        },
        title: { type: "string" },
        actors: {
          type: "array",
          minItems: 2,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              role: { type: "string" },
            },
            required: ["label", "role"],
          },
        },
        links: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              from: { type: "integer", minimum: 0, maximum: 7 },
              to: { type: "integer", minimum: 0, maximum: 7 },
              label: { type: "string" },
            },
            required: ["from", "to", "label"],
          },
        },
        events: {
          type: "array",
          minItems: 4,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              from: { type: "integer", minimum: 0, maximum: 7 },
              to: { type: "integer", minimum: 0, maximum: 7 },
              label: { type: "string" },
              detail: { type: "string" },
              state: { type: "string" },
              payload: { type: "string" },
            },
            required: ["from", "to", "label", "detail", "state", "payload"],
          },
        },
      },
      required: ["engine", "title", "actors", "links", "events"],
    },
    tryIt: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string" },
    },
  },
  required: [
    "title",
    "category",
    "level",
    "summary",
    "analogy",
    "sections",
    "terms",
    "visualization",
    "tryIt",
  ],
};

const DAILY_NEW_LESSON_LIMIT = 20;
const visualizationEngines = [
  "protocol",
  "request",
  "memory",
  "tree",
  "execution",
  "concurrency",
  "distributed",
  "state-machine",
] as const;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

function lessonFromAi(data: unknown): unknown {
  const value = (data as { response?: unknown } | null)?.response ?? data;
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") throw new Error("Workers AI returned no lesson.");
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Workers AI returned invalid JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validTextPair(value: unknown, first: string, second: string) {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return nonEmpty(record[first]) && nonEmpty(record[second]);
}

function validateLesson(value: unknown): GeneratedLesson {
  if (!value || typeof value !== "object") throw new Error("Incomplete lesson.");
  const lesson = value as Partial<GeneratedLesson>;
  if (
    !nonEmpty(lesson.title) ||
    !nonEmpty(lesson.category) ||
    !nonEmpty(lesson.summary) ||
    !nonEmpty(lesson.analogy) ||
    !Array.isArray(lesson.sections) ||
    lesson.sections.length < 3 ||
    lesson.sections.length > 5 ||
    !lesson.sections.every((item) => validTextPair(item, "heading", "body")) ||
    !Array.isArray(lesson.terms) ||
    lesson.terms.length < 3 ||
    lesson.terms.length > 6 ||
    !lesson.terms.every((item) => validTextPair(item, "term", "definition")) ||
    !Array.isArray(lesson.tryIt) ||
    !lesson.tryIt.every(nonEmpty)
  ) {
    throw new Error("Incomplete lesson.");
  }

  const visualization = lesson.visualization;
  if (
    !visualization ||
    !visualizationEngines.includes(visualization.engine) ||
    !nonEmpty(visualization.title) ||
    !Array.isArray(visualization.actors) ||
    visualization.actors.length < 2 ||
    visualization.actors.length > 8 ||
    !visualization.actors.every((item) => validTextPair(item, "label", "role")) ||
    !Array.isArray(visualization.links) ||
    visualization.links.length < 1 ||
    visualization.links.length > 12 ||
    !Array.isArray(visualization.events) ||
    visualization.events.length < 4 ||
    visualization.events.length > 8
  ) {
    throw new Error("Invalid simulation.");
  }

  const actorCount = visualization.actors.length;
  const validLinks = visualization.links.every(
    (link) =>
      Number.isInteger(link.from) &&
      Number.isInteger(link.to) &&
      link.from >= 0 &&
      link.to >= 0 &&
      link.from < actorCount &&
      link.to < actorCount &&
      nonEmpty(link.label),
  );
  const validEvents = visualization.events.every(
    (event) =>
      Number.isInteger(event.from) &&
      Number.isInteger(event.to) &&
      event.from >= 0 &&
      event.to >= 0 &&
      event.from < actorCount &&
      event.to < actorCount &&
      nonEmpty(event.label) &&
      nonEmpty(event.detail) &&
      nonEmpty(event.state) &&
      nonEmpty(event.payload),
  );
  if (!validLinks || !validEvents) throw new Error("Invalid simulation.");
  return lesson as GeneratedLesson;
}

async function generateLesson(env: Env, prompt: string) {
  const messages = [
    {
      role: "system",
      content:
        "You create accurate, beginner-friendly computer-science lessons as structured JSON. Return JSON only and follow the supplied schema exactly. Never output drawing coordinates or HTML.",
    },
    { role: "user", content: prompt },
  ];

  try {
    return validateLesson(
      lessonFromAi(
        await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
          messages,
          response_format: {
            type: "json_schema",
            json_schema: generatedLessonJsonSchema,
          },
          max_tokens: 2400,
          temperature: 0.2,
        }),
      ),
    );
  } catch (firstError) {
    console.warn("Structured generation failed; retrying.", firstError);
    return validateLesson(
      lessonFromAi(
        await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
          messages: [
            ...messages,
            {
              role: "user",
              content: `Return one valid JSON object only. It must match this schema: ${JSON.stringify(generatedLessonJsonSchema)}`,
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 2400,
          temperature: 0.1,
        }),
      ),
    );
  }
}

async function findStoredConcept(env: Env, normalizedName: string) {
  return env.DB
    .prepare(
      "SELECT id, content_json, source, status FROM concepts WHERE normalized_name = ? AND status IN ('published', 'draft') ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END LIMIT 1",
    )
    .bind(normalizedName)
    .first<StoredConcept>();
}

async function listConcepts(request: Request, env: Env) {
  const url = new URL(request.url);
  const query = normalize(url.searchParams.get("q") ?? "");
  const pattern = `%${query}%`;
  try {
    const result = await env.DB
      .prepare(
        `SELECT c.normalized_name AS slug, c.display_name AS title, c.category,
                c.source, c.status, c.hit_count
         FROM concepts c
         WHERE ? = ''
            OR c.normalized_name LIKE ?
            OR lower(c.display_name) LIKE ?
            OR EXISTS (
              SELECT 1 FROM concept_aliases a
              WHERE a.concept_id = c.id AND a.normalized_alias LIKE ?
            )
         ORDER BY CASE c.status WHEN 'published' THEN 0 ELSE 1 END,
                  c.hit_count DESC, c.updated_at DESC
         LIMIT 20`,
      )
      .bind(query, pattern, pattern, pattern)
      .all();
    return json({ concepts: result.results ?? [] });
  } catch (error) {
    console.error("D1 concept search failed.", error);
    return json(
      {
        error: "The concept library is temporarily unavailable.",
        code: "D1_SEARCH_FAILED",
      },
      503,
    );
  }
}

async function readConcept(request: Request, env: Env) {
  const url = new URL(request.url);
  const slug = decodeURIComponent(url.pathname.slice("/api/lessons/".length));
  const key = normalize(slug);
  if (!key) return json({ error: "Enter a lesson name." }, 400);
  try {
    const concept = await findStoredConcept(env, key);
    if (!concept) return json({ error: "Lesson not found." }, 404);
    return json({
      ...JSON.parse(concept.content_json),
      _meta: {
        source: concept.source,
        cached: true,
        quality:
          concept.source === "curated" && concept.status === "published"
            ? "verified"
            : "generated-draft",
      },
    });
  } catch (error) {
    console.error("D1 lesson read failed.", error);
    return json({ error: "The lesson could not be opened." }, 500);
  }
}

async function consumeGenerationAllowance(request: Request, env: Env) {
  const ipHash = await hash(request.headers.get("CF-Connecting-IP") || "unknown");
  const day = new Date().toISOString().slice(0, 10);
  const current = await env.DB
    .prepare(
      "SELECT generation_count FROM generation_limits WHERE ip_hash = ? AND day = ?",
    )
    .bind(ipHash, day)
    .first<{ generation_count: number }>();
  if ((current?.generation_count ?? 0) >= DAILY_NEW_LESSON_LIMIT) return false;
  await env.DB
    .prepare(
      "INSERT INTO generation_limits (ip_hash, day, generation_count) VALUES (?, ?, 1) ON CONFLICT(ip_hash, day) DO UPDATE SET generation_count = generation_count + 1",
    )
    .bind(ipHash, day)
    .run();
  return true;
}

async function saveLessonVersion(
  env: Env,
  key: string,
  lesson: GeneratedLesson,
  content: string,
) {
  const checksum = await hash(content);
  await env.DB
    .prepare(
      `INSERT INTO lesson_versions
         (concept_id, version, engine, spec_json, source, validation_status, checksum)
       SELECT id,
              COALESCE((SELECT MAX(version) + 1 FROM lesson_versions WHERE concept_id = concepts.id), 1),
              ?, ?, 'ai', 'schema-valid', ?
       FROM concepts WHERE normalized_name = ?`,
    )
    .bind(`generated.${lesson.visualization.engine}`, content, checksum, key)
    .run();
}

async function startGenerationRecord(env: Env, key: string) {
  try {
    return await env.DB
      .prepare(
        "INSERT INTO generation_requests (normalized_query, model, status) VALUES (?, ?, 'started') RETURNING id",
      )
      .bind(key, "@cf/meta/llama-3.1-8b-instruct-fast")
      .first<{ id: number }>();
  } catch (error) {
    console.error("D1 generation record start failed.", error);
    return null;
  }
}

async function finishGenerationRecord(
  env: Env,
  id: number | undefined,
  status: "completed" | "failed",
  errorCode: string | null,
) {
  if (!id) return;
  await env.DB
    .prepare(
      "UPDATE generation_requests SET status = ?, error_code = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(status, errorCode, id)
    .run();
}

async function generateConcept(request: Request, env: Env, ctx: WorkerContext) {
  let concept = "";
  try {
    const body = (await request.json()) as { concept?: unknown };
    concept = typeof body.concept === "string" ? body.concept.trim() : "";
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  if (concept.length < 2 || concept.length > 120) {
    return json({ error: "Enter a concept between 2 and 120 characters." }, 400);
  }
  const key = normalize(concept);
  if (key.length < 2) {
    return json({ error: "Enter a valid programming or computer-science concept." }, 400);
  }

  let existing: StoredConcept | null;
  try {
    existing = await findStoredConcept(env, key);
  } catch (error) {
    console.error("D1 lookup failed.", error);
    return json(
      {
        error: "The concept database is not connected correctly. Check the D1 database ID and migrations.",
        code: "D1_LOOKUP_FAILED",
      },
      503,
    );
  }

  if (existing) {
    ctx.waitUntil(
      env.DB
        .prepare(
          "UPDATE concepts SET hit_count = hit_count + 1, last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(existing.id)
        .run(),
    );
    try {
      return json({
        ...JSON.parse(existing.content_json),
        _meta: {
          source: "database",
          cached: true,
          quality:
            existing.source === "curated" && existing.status === "published"
              ? "verified"
              : "generated-draft",
        },
      });
    } catch {
      return json({ error: "This saved lesson needs to be regenerated." }, 500);
    }
  }

  try {
    if (!(await consumeGenerationAllowance(request, env))) {
      return json(
        {
          error: "You reached today's new-lesson limit. Saved lessons remain available.",
        },
        429,
      );
    }
  } catch (error) {
    console.error("D1 generation limit failed.", error);
    return json({ error: "The lesson service is temporarily unavailable." }, 503);
  }

  const prompt = `Create an accurate lesson about this computer-science or programming concept: "${concept}".
Write for a true beginner without removing important technical truth. If the term is ambiguous, interpret it in computing. If it is unrelated to computing, say so clearly.
Describe a causal mechanism, not a decorative diagram. Choose exactly one visualization engine:
- protocol: packets, protocol layers, endpoints, headers, routing, delivery or loss
- request: ordered web, DNS, API, database or processing pipelines
- memory: arrays, linked structures, hashes, queues, buffers, allocation or pointers
- tree: trees, graphs, traversal, indexes or hierarchical relationships
- execution: functions, recursion, call stacks, instructions, compilers or runtimes
- concurrency: processes, threads, scheduling, locks, races, ordering or shared resources
- distributed: services, brokers, replicas, caches, consensus or multi-service messages
- state-machine: lifecycles, cycles, comparisons and transitions between named states
Actors must be real components such as machines, protocol layers, processes, data structures, variables, services, or memory regions. Links describe stable structural relationships. Events must form a chronological trace of movement or state change. Actor indexes in every link and event must be valid. For an internal state change, from and to may be the same actor. Every event must name the visible action, explain why it occurs, give the resulting state, and provide a short payload label suitable for the visual token. Do not generate drawing coordinates, CSS, SVG, HTML or executable code. The application owns layout and animation.`;
  const generationRecord = await startGenerationRecord(env, key);

  try {
    const lesson = await generateLesson(env, prompt);
    const content = JSON.stringify(lesson);
    try {
      await env.DB
        .prepare(
          `INSERT INTO concepts
             (normalized_name, display_name, category, content_json, source, status, hit_count, last_accessed_at)
           VALUES (?, ?, ?, ?, 'ai', 'draft', 1, CURRENT_TIMESTAMP)
           ON CONFLICT(normalized_name) DO UPDATE SET
             content_json = excluded.content_json,
             display_name = excluded.display_name,
             category = excluded.category,
             source = excluded.source,
             status = 'draft',
             updated_at = CURRENT_TIMESTAMP,
             last_accessed_at = CURRENT_TIMESTAMP`,
        )
        .bind(key, lesson.title, lesson.category, content)
        .run();
      ctx.waitUntil(
        saveLessonVersion(env, key, lesson, content).catch((error) => {
          console.error("D1 lesson version save failed.", error);
        }),
      );
      ctx.waitUntil(
        finishGenerationRecord(env, generationRecord?.id, "completed", null).catch(
          (error) => console.error("D1 generation record completion failed.", error),
        ),
      );
    } catch (saveError) {
      console.error("D1 save failed.", saveError);
      return json(
        {
          error: "The lesson was generated but could not be saved in D1.",
          code: "D1_SAVE_FAILED",
        },
        503,
      );
    }
    return json({
      ...lesson,
      _meta: {
        source: "workers-ai",
        cached: false,
        quality: "generated-draft",
      },
    });
  } catch (error) {
    console.error("Workers AI generation failed.", error);
    ctx.waitUntil(
      finishGenerationRecord(
        env,
        generationRecord?.id,
        "failed",
        "AI_GENERATION_FAILED",
      ).catch((recordError) =>
        console.error("D1 generation record failure save failed.", recordError),
      ),
    );
    return json(
      {
        error: "Cloudflare AI could not format this lesson. Please try the search once more.",
        code: "AI_GENERATION_FAILED",
      },
      502,
    );
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: WorkerContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/concepts" && request.method === "GET") {
      return listConcepts(request, env);
    }
    if (url.pathname.startsWith("/api/lessons/") && request.method === "GET") {
      return readConcept(request, env);
    }
    if (url.pathname === "/api/concept") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      return generateConcept(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
