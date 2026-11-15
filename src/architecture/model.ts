// The architecture design document and its component catalogue. Pure data and zod schemas: no React, no DOM.
// A design is a graph of typed components joined by typed connections, plus the workload and faults a simulation
// run uses. Every configurable number has bounds, so a design (saved, imported or edited) can never ask the
// simulator for unbounded work.
import { z } from "zod";

export const COMPONENT_KINDS = ["client", "cdn", "load-balancer", "api", "cache", "sql", "nosql", "queue", "worker", "object-storage"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** request: a synchronous call that waits for an answer. async: a message handed over without waiting. replication: a database copying its writes. */
export const CONNECTION_KINDS = ["request", "async", "replication"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

const int = (min: number, max: number, fallback: number) => z.number().int().min(min).max(max).default(fallback);

/** Each kind's settings. Missing fields take their default, so a design saved before a field existed still loads. */
export const configSchemas = {
  client: z.object({
    rps: int(1, 2000, 20),
    writePercent: int(0, 100, 20),
    assetPercent: int(0, 100, 0),
    timeoutMs: int(50, 10_000, 1000),
    retries: int(0, 3, 0),
    backoffMs: int(0, 5000, 100),
  }).strict(),
  cdn: z.object({ capacityKeys: int(0, 100_000, 500), ttlS: int(0, 3600, 300) }).strict(),
  "load-balancer": z.object({
    algorithm: z.enum(["round-robin", "least-outstanding"]).default("round-robin"),
    healthChecks: z.boolean().default(true),
    checkIntervalMs: int(500, 30_000, 2000),
  }).strict(),
  api: z.object({ concurrency: int(1, 64, 8), serviceMs: int(1, 2000, 20), queueLimit: int(0, 1000, 50) }).strict(),
  cache: z.object({ capacityKeys: int(0, 100_000, 1000), ttlS: int(0, 3600, 0) }).strict(),
  sql: z.object({ concurrency: int(1, 200, 10), readMs: int(1, 2000, 5), writeMs: int(1, 2000, 15), queueLimit: int(0, 5000, 100) }).strict(),
  nosql: z.object({ partitions: int(1, 16, 4), concurrencyPerPartition: int(1, 64, 4), opMs: int(1, 2000, 5), queueLimit: int(0, 5000, 100) }).strict(),
  queue: z.object({ maxDepth: int(1, 100_000, 10_000) }).strict(),
  worker: z.object({ concurrency: int(1, 64, 4), serviceMs: int(1, 5000, 50), maxReceives: int(1, 10, 3), retryDelayMs: int(0, 30_000, 1000) }).strict(),
  "object-storage": z.object({ latencyMs: int(5, 1000, 30) }).strict(),
} satisfies Record<ComponentKind, z.ZodType>;

export type ConfigOf<K extends ComponentKind> = z.infer<(typeof configSchemas)[K]>;
export type AnyConfig = { [K in ComponentKind]: ConfigOf<K> }[ComponentKind];

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const label = z.string().trim().min(1).max(40);

export const MAX_NODES = 40;
export const MAX_EDGES = 80;
/** Arrivals in one run, over every client. Bounds the event stream (and memory) of any run. */
export const MAX_ARRIVALS = 15_000;

const nodeSchema = z.object({
  id,
  kind: z.enum(COMPONENT_KINDS),
  label,
  x: z.number().finite().min(-5000).max(5000),
  y: z.number().finite().min(-5000).max(5000),
  config: z.record(z.string(), z.unknown()).default({}),
}).strict();

const edgeSchema = z.object({ id, from: id, to: id, kind: z.enum(CONNECTION_KINDS) }).strict();

export const workloadSchema = z.object({
  durationS: int(1, 60, 10),
  /** steady: evenly spaced arrivals. random: Poisson arrivals from the seed. */
  pattern: z.enum(["steady", "random"]).default("steady"),
  seed: int(0, 2 ** 31 - 1, 1),
  /** Distinct data items reads and writes choose from. */
  keys: int(1, 100_000, 1000),
  /** uniform: every item equally likely. popular: a few items get most traffic (Zipf, s = 1). */
  skew: z.enum(["uniform", "popular"]).default("popular"),
  /** Distinct static files asset requests choose from. */
  assets: int(1, 10_000, 200),
}).strict();
export type Workload = z.infer<typeof workloadSchema>;

export const faultSchema = z.object({ node: id, fromS: z.number().min(0).max(60), toS: z.number().min(0).max(120) }).strict();
export type Fault = z.infer<typeof faultSchema>;

export const DESIGN_FORMAT = "kitab.architecture";
export const DESIGN_VERSION = 1;

export const designSchema = z.object({
  format: z.literal(DESIGN_FORMAT),
  version: z.literal(DESIGN_VERSION),
  id,
  name: z.string().trim().min(1).max(80),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  nodes: z.array(nodeSchema).max(MAX_NODES),
  edges: z.array(edgeSchema).max(MAX_EDGES),
  workload: workloadSchema.default(workloadSchema.parse({})),
  faults: z.array(faultSchema).max(10).default([]),
}).strict();

export type DesignNode = { id: string; kind: ComponentKind; label: string; x: number; y: number; config: AnyConfig };
export type DesignEdge = z.infer<typeof edgeSchema>;
export type Design = Omit<z.infer<typeof designSchema>, "nodes"> & { nodes: DesignNode[] };

export type ComponentDefinition = {
  kind: ComponentKind;
  name: string;
  category: "Clients & edge" | "Compute" | "Data" | "Messaging";
  /** What it is for, in one sentence. */
  role: string;
  /** What the simulator models about it, in one sentence. Nothing else is modelled. */
  modelled: string;
  /** Abstract units for comparing designs. Not a price. */
  cost: number;
};

export const components: Record<ComponentKind, ComponentDefinition> = {
  client: { kind: "client", name: "Client", category: "Clients & edge", role: "The users' browsers or apps that send requests.", modelled: "Sends requests at a fixed rate with a mix of reads, writes and static files; waits up to a timeout and may retry.", cost: 0 },
  cdn: { kind: "cdn", name: "CDN", category: "Clients & edge", role: "Servers close to users that keep copies of static files.", modelled: "Keeps recently requested files (least recently used first out, optional expiry); a miss fetches the file from its origin. Passes reads and writes to the API.", cost: 2 },
  "load-balancer": { kind: "load-balancer", name: "Load balancer", category: "Compute", role: "Spreads incoming requests over several API servers.", modelled: "Round-robin or least-outstanding choice of API server; with health checks it stops using a failed server after it is detected.", cost: 2 },
  api: { kind: "api", name: "API server", category: "Compute", role: "Runs the application code that answers each request.", modelled: "A fixed number of requests in progress at once, each holding its slot while it waits on the cache or database; extra requests wait in a bounded queue.", cost: 2 },
  cache: { kind: "cache", name: "Cache", category: "Data", role: "Keeps recently read data in memory so the database is asked less often.", modelled: "Cache-aside: a read checks the cache first, a miss reads the database and stores the item; a write removes it. Bounded size, least recently used first out, optional expiry.", cost: 2 },
  sql: { kind: "sql", name: "SQL database", category: "Data", role: "Stores data in tables with transactions; the source of truth.", modelled: "A fixed number of queries at once with separate read and write times; a primary takes writes and read replicas share reads.", cost: 4 },
  nosql: { kind: "nosql", name: "NoSQL database", category: "Data", role: "Stores items by key, spread over partitions.", modelled: "Each key belongs to one partition; each partition has its own capacity and queue, so a popular key can overload one partition.", cost: 4 },
  queue: { kind: "queue", name: "Message queue", category: "Messaging", role: "Holds messages until a worker is ready, so the sender does not wait.", modelled: "A bounded, durable list of messages delivered to free workers; refuses new messages when full.", cost: 1 },
  worker: { kind: "worker", name: "Worker", category: "Compute", role: "Processes queued messages in the background.", modelled: "Takes messages when it has a free slot, writes the result to its database, and returns failed messages to the queue until a retry limit, then sets them aside (dead letters).", cost: 1 },
  "object-storage": { kind: "object-storage", name: "Object storage", category: "Data", role: "Stores files such as images and videos.", modelled: "A fixed response time and no capacity limit.", cost: 1 },
};

/** Every allowed connection. Anything else is refused by the editor and by validation. */
export const connectionRules: { from: ComponentKind; to: ComponentKind; kind: ConnectionKind; meaning: string }[] = [
  { from: "client", to: "cdn", kind: "request", meaning: "Clients fetch static files (and may send every request) through the CDN." },
  { from: "client", to: "load-balancer", kind: "request", meaning: "Clients send requests to the load balancer's public address." },
  { from: "client", to: "api", kind: "request", meaning: "Clients call the API server directly." },
  { from: "client", to: "object-storage", kind: "request", meaning: "Clients download files straight from storage (for example through signed links)." },
  { from: "cdn", to: "object-storage", kind: "request", meaning: "The CDN fetches missing files from storage, its origin." },
  { from: "cdn", to: "load-balancer", kind: "request", meaning: "The CDN passes reads and writes on to the load balancer." },
  { from: "cdn", to: "api", kind: "request", meaning: "The CDN passes reads and writes on to the API server." },
  { from: "load-balancer", to: "api", kind: "request", meaning: "The load balancer forwards each request to one API server." },
  { from: "api", to: "cache", kind: "request", meaning: "The API checks the cache before the database." },
  { from: "api", to: "sql", kind: "request", meaning: "The API queries the SQL database." },
  { from: "api", to: "nosql", kind: "request", meaning: "The API reads and writes items in the NoSQL database." },
  { from: "api", to: "object-storage", kind: "request", meaning: "The API reads files from storage." },
  { from: "api", to: "queue", kind: "async", meaning: "The API puts each write on the queue and answers at once." },
  { from: "queue", to: "worker", kind: "async", meaning: "The queue delivers messages to the worker." },
  { from: "worker", to: "sql", kind: "request", meaning: "The worker writes its results to the SQL database." },
  { from: "worker", to: "nosql", kind: "request", meaning: "The worker writes its results to the NoSQL database." },
  { from: "worker", to: "cache", kind: "request", meaning: "The worker removes changed items from the cache." },
  { from: "sql", to: "sql", kind: "replication", meaning: "The primary copies every write to this read replica." },
];

export const ruleFor = (from: ComponentKind, to: ComponentKind) => connectionRules.find((rule) => rule.from === from && rule.to === to);

/** A node's settings with every default filled in; invalid settings throw (call through validation). */
export function configFor<K extends ComponentKind>(kind: K, config: unknown = {}): ConfigOf<K> {
  return configSchemas[kind].parse(config) as ConfigOf<K>;
}

export function newDesign(name: string, id: string, now = new Date().toISOString()): Design {
  return { format: DESIGN_FORMAT, version: DESIGN_VERSION, id, name, createdAt: now, updatedAt: now, nodes: [], edges: [], workload: workloadSchema.parse({}), faults: [] };
}

/** The next free id for a kind ("api-2"), so ids stay readable in events and explanations. */
export function nextNodeId(design: Pick<Design, "nodes">, kind: ComponentKind) {
  const used = new Set(design.nodes.map((node) => node.id));
  for (let n = 1; ; n++) if (!used.has(`${kind}-${n}`)) return `${kind}-${n}`;
}

export function nextLabel(design: Pick<Design, "nodes">, kind: ComponentKind) {
  const base = components[kind].name;
  const used = new Set(design.nodes.map((node) => node.label));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}
