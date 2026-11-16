// The editable settings of each component, as the inspector shows them. Bounds repeat the schema's (a test keeps
// them equal), so a field can say its range before a value is refused.
import type { ComponentKind, Workload } from "./model.ts";

export type Field =
  | { field: string; label: string; type: "number"; min: number; max: number; step?: number; unit?: string; help: string }
  | { field: string; label: string; type: "select"; options: { value: string; label: string }[]; help: string }
  | { field: string; label: string; type: "boolean"; help: string };

const n = (field: string, label: string, min: number, max: number, unit: string, help: string, step = 1): Field => ({ field, label, type: "number", min, max, unit, help, step });

export const fieldsFor: Record<ComponentKind, Field[]> = {
  client: [
    n("rps", "Requests per second", 1, 2000, "/s", "How many new requests the users send each second."),
    n("writePercent", "Writes", 0, 100, "%", "Share of requests that change data. The rest are reads (and static files)."),
    n("assetPercent", "Static files", 0, 100, "%", "Share of requests for images, scripts and other files."),
    n("timeoutMs", "Timeout", 50, 10_000, "ms", "How long a client waits for an answer before giving up on that attempt."),
    n("retries", "Retries", 0, 3, "", "How many more times a client tries after a failure or timeout."),
    n("backoffMs", "First retry after", 0, 5000, "ms", "The pause before the first retry; it doubles before each later one."),
  ],
  cdn: [
    n("capacityKeys", "Files it can hold", 0, 100_000, "", "When full, the least recently used file is dropped."),
    n("ttlS", "Keep files for", 0, 3600, "s", "After this a stored file counts as expired and is fetched again. 0: keep until dropped."),
  ],
  "load-balancer": [
    { field: "algorithm", label: "Choose a server by", type: "select", options: [{ value: "round-robin", label: "Round-robin (take turns)" }, { value: "least-outstanding", label: "Fewest requests in progress" }], help: "How the next server is picked." },
    { field: "healthChecks", label: "Health checks", type: "boolean", help: "Check each server regularly and stop sending to one that is down." },
    n("checkIntervalMs", "Check every", 500, 30_000, "ms", "A failure is noticed at the first check after it happens.", 100),
  ],
  api: [
    n("concurrency", "Requests at once", 1, 64, "", "Slots for requests in progress. A request keeps its slot while it waits for the cache or database."),
    n("serviceMs", "Own work per request", 1, 2000, "ms", "Time spent in the server's own code, before it calls anything."),
    n("queueLimit", "Waiting queue", 0, 1000, "", "Requests that may wait for a free slot. Beyond this, requests are refused at once."),
  ],
  cache: [
    n("capacityKeys", "Items it can hold", 0, 100_000, "", "When full, the least recently used item is dropped."),
    n("ttlS", "Keep items for", 0, 3600, "s", "After this an item counts as expired. 0: keep until dropped or changed."),
  ],
  sql: [
    n("concurrency", "Queries at once", 1, 200, "", "Queries the database works on at the same time."),
    n("readMs", "Time per read", 1, 2000, "ms", "How long one read query takes."),
    n("writeMs", "Time per write", 1, 2000, "ms", "How long one write takes. Replicas spend this too, applying each write."),
    n("queueLimit", "Waiting queue", 0, 5000, "", "Queries that may wait for a free slot before new ones are refused."),
  ],
  nosql: [
    n("partitions", "Partitions", 1, 16, "", "Each key always belongs to the same partition."),
    n("concurrencyPerPartition", "Operations at once per partition", 1, 64, "", "Each partition's own slots."),
    n("opMs", "Time per operation", 1, 2000, "ms", "How long one read or write takes."),
    n("queueLimit", "Waiting queue per partition", 0, 5000, "", "Operations that may wait on one partition before new ones are refused."),
  ],
  queue: [n("maxDepth", "Messages it can hold", 1, 100_000, "", "When full, new messages are refused: the sender gets an error.")],
  worker: [
    n("concurrency", "Messages at once", 1, 64, "", "Messages this worker processes at the same time."),
    n("serviceMs", "Work per message", 1, 5000, "ms", "Processing time before the result is written to the database."),
    n("maxReceives", "Tries per message", 1, 10, "", "After this many failed tries a message is set aside as a dead letter."),
    n("retryDelayMs", "Retry after", 0, 30_000, "ms", "How long a failed message waits before it returns to the queue.", 100),
  ],
  "object-storage": [n("latencyMs", "Response time", 5, 1000, "ms", "Time to return one file.")],
};

export const workloadFields: Field[] = [
  n("durationS", "Duration", 1, 60, "s", "How long clients keep sending. Work in progress may finish afterwards."),
  { field: "pattern", label: "Arrivals", type: "select", options: [{ value: "steady", label: "Steady (evenly spaced)" }, { value: "random", label: "Random (from the seed)" }], help: "Random arrivals bunch up sometimes, as real traffic does; the same seed gives the same run." },
  n("seed", "Seed", 0, 2 ** 31 - 1, "", "Any whole number. Random arrivals and item choices follow from it."),
  n("keys", "Data items", 1, 100_000, "", "How many different items reads and writes choose from."),
  { field: "skew", label: "Popularity", type: "select", options: [{ value: "popular", label: "A few items are popular" }, { value: "uniform", label: "Every item equally likely" }], help: "Popular: item 1 is twice as likely as item 2, three times item 3, and so on (Zipf)." },
  n("assets", "Static files", 1, 10_000, "", "How many different files file requests choose from."),
];

export type WorkloadField = keyof Workload;
