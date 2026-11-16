// The System Design track's titles and versions, without their content or the simulator, so the course pages
// (loaded on every visit) stay small. A test keeps these in step with lessons.ts and challenges.ts.
export const lessonCatalog = [
  { id: "fundamentals", title: "Clients, servers and databases" },
  { id: "storage-caching", title: "Databases and caches" },
  { id: "scalability", title: "Scaling out and finding the bottleneck" },
  { id: "distributed", title: "Queues, replicas and partitions" },
  { id: "reliability-security", title: "Failures, timeouts and retries" },
  { id: "design-projects", title: "Designing from requirements" },
] as const;

export const challengeCatalog = [
  { id: "simple-web-app", title: "Design a simple web application", version: "1" },
  { id: "cache-read-heavy", title: "Add caching to a read-heavy API", version: "1" },
  { id: "scale-behind-lb", title: "Scale an API behind a load balancer", version: "1" },
  { id: "async-orders", title: "Design an asynchronous order system", version: "1" },
  { id: "resilient-api", title: "Survive a server failure without a retry storm", version: "1" },
  { id: "url-shortener", title: "Build a URL shortener", version: "1" },
] as const;

export const lessonPath = (id: string) => `/learn/system-design/${id}`;
export const challengePath = (id: string) => `/practice/architecture/challenges/${id}`;

/** Concept units (lessons without a playground experiment) and labs. A test keeps these in step with concepts/ and labs/. */
export const unitCatalog = [
  { id: "idempotency", title: "Idempotency and safe retries" },
  { id: "resilience", title: "Timeouts, backoff and circuit breakers" },
  { id: "transactions", title: "Transactions and concurrency" },
  { id: "messaging", title: "Messaging and event streams" },
  { id: "data-across-services", title: "Consistency across services" },
  { id: "consistency", title: "Replication and consistency" },
  { id: "coordination", title: "Consensus, leaders and locks" },
  { id: "performance", title: "Performance and caching at scale" },
  { id: "overload", title: "Rate limiting, backpressure and load shedding" },
  { id: "security", title: "Security architecture" },
  { id: "production", title: "Architecture in production" },
] as const;

export const labCatalog = [
  { id: "idempotent-payments", title: "Build an idempotent payment API", version: "1" },
  { id: "retry-storm", title: "Stop a retry storm", version: "1" },
  { id: "deadline-budget", title: "Retries at every layer", version: "1" },
  { id: "circuit-breaker", title: "Contain a failing dependency", version: "1" },
  { id: "lost-update", title: "Correct concurrent inventory updates", version: "1" },
  { id: "duplicate-delivery", title: "Prevent duplicate order processing", version: "1" },
  { id: "hot-partition", title: "Handle an overloaded Kafka partition", version: "1" },
  { id: "outbox", title: "Design a reliable event publication workflow", version: "1" },
  { id: "saga", title: "Design a resilient order-processing system", version: "1" },
  { id: "replication-lag", title: "Scale reads without stale surprises", version: "1" },
  { id: "fencing-token", title: "Make a distributed lock safe", version: "1" },
  { id: "cache-stampede", title: "Handle a cache stampede", version: "1" },
  { id: "rate-limit", title: "Protect an API from overload", version: "1" },
] as const;

export const labPath = (id: string) => `/practice/architecture/labs/${id}`;

/** A unit's title, whether it is a lesson with an experiment or a concept unit. */
export const findConceptUnitTitle = (id: string): string | undefined => [...lessonCatalog, ...unitCatalog].find((u) => u.id === id)?.title;
