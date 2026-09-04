export const engineKinds = [
  "protocol",
  "request",
  "memory",
  "tree",
  "execution",
  "concurrency",
  "distributed",
  "state-machine",
] as const;

export type EngineKind = (typeof engineKinds)[number];

export type VisualActor = {
  id: string;
  label: string;
  role: string;
  group?: string;
};

export type VisualLink = {
  from: string;
  to: string;
  label?: string;
};

export type VisualEvent = {
  id: string;
  from: string;
  to: string;
  label: string;
  detail: string;
  state: string;
  payload?: string;
};

export type VisualizationSpec = {
  engine: EngineKind;
  title: string;
  actors: VisualActor[];
  links: VisualLink[];
  events: VisualEvent[];
};

export type RawVisualization = {
  engine?: string;
  type?: string;
  title?: string;
  nodes?: { label?: string; detail?: string }[];
  steps?: string[];
  actors?: { label?: string; role?: string }[];
  links?: { from?: number; to?: number; label?: string }[];
  events?: {
    from?: number;
    to?: number;
    label?: string;
    detail?: string;
    state?: string;
    payload?: string;
  }[];
};

const engineSet = new Set<string>(engineKinds);

const engineEvidencePatterns: Record<EngineKind, RegExp[]> = {
  "state-machine": [
    /\bstate machines?\b/,
    /\bfinite state\b/,
    /\btransition(?:s|ed|ing)?\b/,
    /\bguard(?:s|ed)?\b/,
    /\bterminal state\b/,
    /\blifecycles?\b/,
    /\bcycles?\b/,
  ],
  request: [
    /\brequests?\b/,
    /\bresponses?\b/,
    /\bhttps?\b/,
    /\burls?\b/,
    /\bbrowsers?\b/,
    /\bdns\b/,
    /\bapi(?:s)?\b/,
    /\brequest pipeline\b/,
    /\bweb lifecycle\b/,
  ],
  protocol: [
    /\bprotocols?\b/,
    /\btcp\b/,
    /\budp\b/,
    /\bquic\b/,
    /\bpackets?\b/,
    /\bsegments?\b/,
    /\bdatagrams?\b/,
    /\bethernet\b/,
    /\bip routing\b/,
    /\bports?\b/,
    /\b(?:syn|ack|fin)\b/,
  ],
  tree: [
    /\btrees?\b/,
    /\bgraphs?\b/,
    /\bb-?trees?\b/,
    /\bbinary search\b/,
    /\btravers(?:al|e|ed|ing)\b/,
    /\bvertices\b/,
    /\bedges?\b/,
    /\bsubtrees?\b/,
  ],
  concurrency: [
    /\bthreads?\b/,
    /\bprocesses\b/,
    /\bschedulers?\b/,
    /\bmutex(?:es)?\b/,
    /\bsemaphores?\b/,
    /\bdeadlocks?\b/,
    /\brace conditions?\b/,
    /\bconcurr(?:ency|ent)\b/,
    /\bshared resources?\b/,
  ],
  execution: [
    /\bcall stacks?\b/,
    /\bstack frames?\b/,
    /\brecurs(?:ion|ive)\b/,
    /\bfunctions?\b/,
    /\bruntimes?\b/,
    /\binstructions?\b/,
    /\bcompilers?\b/,
    /\bexecution\b/,
    /\breturn values?\b/,
  ],
  memory: [
    /\bdata structures?\b/,
    /\barrays?\b/,
    /\blinked lists?\b/,
    /\bhash(?: tables?| maps?)\b/,
    /\bpointers?\b/,
    /\bmemory\b/,
    /\bheaps?\b/,
    /\bqueues?\b/,
    /\bbuffers?\b/,
    /\ballocat(?:e|ed|ion|ions)\b/,
    /\bbuckets?\b/,
    /\bindexes?\b/,
    /\bcontiguous\b/,
    /\bnodes?\b/,
    /\bstacks?\b/,
  ],
  distributed: [
    /\bdistributed systems?\b/,
    /\bmessage (?:queues?|brokers?)\b/,
    /\bkafka\b/,
    /\breplicas?\b/,
    /\bconsensus\b/,
    /\bmicroservices?\b/,
    /\bload balancers?\b/,
    /\bevent[- ]driven\b/,
    /\bkubernetes\b/,
    /\bservice mesh\b/,
  ],
};

const enginePriority: EngineKind[] = [
  "request",
  "state-machine",
  "protocol",
  "tree",
  "concurrency",
  "execution",
  "memory",
  "distributed",
];

function evidenceCount(engine: EngineKind, text: string) {
  const normalized = text.toLowerCase();
  return engineEvidencePatterns[engine].reduce(
    (total, pattern) => total + (pattern.test(normalized) ? 1 : 0),
    0,
  );
}

export function hasEngineEvidence(
  engine: EngineKind,
  text: string,
  minimum = 1,
) {
  return evidenceCount(engine, text) >= minimum;
}

function compact(value: unknown, fallback: string, max = 180) {
  if (typeof value !== "string") return fallback;
  const result = value.replace(/\s+/g, " ").trim();
  return result ? result.slice(0, max) : fallback;
}

export function selectEngineKind(input: {
  engine?: string;
  type?: string;
  title?: string;
  category?: string;
}): EngineKind {
  const text = `${input.type ?? ""} ${input.title ?? ""} ${input.category ?? ""}`.toLowerCase();
  if (/\b(?:finite )?state machines?\b/.test(text)) return "state-machine";
  const scores = enginePriority.map((engine) => ({
    engine,
    score: evidenceCount(engine, text),
  }));
  const best = scores.reduce((winner, candidate) =>
    candidate.score > winner.score ? candidate : winner,
  );
  if (best.score > 0) return best.engine;

  // A generated engine is only a hint. Semantic evidence always wins.
  if (input.engine && engineSet.has(input.engine)) return input.engine as EngineKind;
  return "distributed";
}

export function normalizeVisualization(
  raw: RawVisualization,
  context: { title: string; category?: string },
): VisualizationSpec {
  const sourceActors = raw.actors?.length
    ? raw.actors
    : raw.nodes?.length
      ? raw.nodes.map((node) => ({ label: node.label, role: node.detail }))
      : [{ label: "Input", role: "Starts the mechanism" }, { label: "Result", role: "Receives the outcome" }];

  const actors = sourceActors.slice(0, 8).map((actor, index) => ({
    id: `actor-${index}`,
    label: compact(actor.label, `Component ${index + 1}`, 60),
    role: compact(actor.role, "Participates in this mechanism", 150),
  }));
  if (actors.length === 1) {
    actors.push({ id: "actor-1", label: "Result", role: "Shows the resulting state" });
  }

  const lastActor = actors.length - 1;
  const sourceEvents = raw.events?.length
    ? raw.events
    : (raw.steps?.length ? raw.steps : ["Start", "Complete"]).map((detail, index) => ({
        from: Math.min(index, lastActor),
        to: Math.min(index + 1, lastActor),
        label: `Step ${index + 1}`,
        detail,
        state: index === 0 ? "Started" : "Updated",
        payload: "",
      }));

  const events = sourceEvents.slice(0, 12).map((event, index) => {
    const fromIndex = Number.isInteger(event.from)
      ? Math.max(0, Math.min(lastActor, Number(event.from)))
      : Math.min(index, lastActor);
    const toIndex = Number.isInteger(event.to)
      ? Math.max(0, Math.min(lastActor, Number(event.to)))
      : Math.min(fromIndex + 1, lastActor);
    return {
      id: `event-${index}`,
      from: actors[fromIndex].id,
      to: actors[toIndex].id,
      label: compact(event.label, `Step ${index + 1}`, 80),
      detail: compact(event.detail, raw.steps?.[index] ?? "The system changes state.", 420),
      state: compact(event.state, "State updated", 140),
      payload: compact(event.payload, "", 70) || undefined,
    };
  });

  const eventPairs = events.map((event) => ({ from: event.from, to: event.to }));
  const suppliedLinks = (raw.links ?? []).flatMap((link) => {
    const from = Number(link.from);
    const to = Number(link.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || !actors[from] || !actors[to]) return [];
    return [{ from: actors[from].id, to: actors[to].id, label: compact(link.label, "", 40) || undefined }];
  });
  const links = [...suppliedLinks, ...eventPairs].filter(
    (link, index, all) =>
      index === all.findIndex((candidate) => candidate.from === link.from && candidate.to === link.to),
  );

  return {
    engine: selectEngineKind({
      engine: raw.engine,
      type: raw.type,
      title: `${context.title} ${raw.title ?? ""}`,
      category: context.category,
    }),
    title: compact(raw.title, `${context.title} mechanism`, 100),
    actors,
    links,
    events,
  };
}

export function assertVisualizationSpec(spec: VisualizationSpec) {
  if (!engineSet.has(spec.engine)) throw new Error(`Unknown visualization engine: ${spec.engine}`);
  if (spec.actors.length < 2) throw new Error("A visualization requires at least two actors.");
  if (spec.events.length < 1) throw new Error("A visualization requires at least one event.");
  const actorIds = new Set(spec.actors.map((actor) => actor.id));
  if (actorIds.size !== spec.actors.length) throw new Error("Actor ids must be unique.");
  spec.events.forEach((event) => {
    if (!actorIds.has(event.from) || !actorIds.has(event.to)) {
      throw new Error(`Event ${event.id} references an unknown actor.`);
    }
  });
}

export function buildGraphLevels(spec: VisualizationSpec): string[][] {
  const targetIds = new Set(
    spec.links.filter((link) => link.from !== link.to).map((link) => link.to),
  );
  const roots = spec.actors
    .filter((actor) => !targetIds.has(actor.id))
    .map((actor) => actor.id);
  const queue = (roots.length ? roots : [spec.actors[0].id]).map((id) => ({
    id,
    level: 0,
  }));
  const visited = new Set<string>();
  const levels: string[][] = [];
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    (levels[current.level] ??= []).push(current.id);
    spec.links
      .filter((link) => link.from === current.id && link.to !== current.id)
      .forEach((link) => queue.push({ id: link.to, level: current.level + 1 }));
  }
  const remainder = spec.actors
    .filter((actor) => !visited.has(actor.id))
    .map((actor) => actor.id);
  if (remainder.length) levels.push(remainder);
  return levels;
}
