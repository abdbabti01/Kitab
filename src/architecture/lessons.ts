// The System Design track's lessons: short sections, one experiment run by the simulator, and the challenge
// that follows. Pure data. Every number a lesson quotes is either arithmetic shown in the text or something the
// learner produces by running the experiment.
import type { Design } from "./model.ts";
import { build } from "./templates.ts";

export type Section = { heading: string; body: string[]; points?: string[] };
export type Experiment = {
  intro: string;
  /** Designs to compare; the learner picks one, sets the request rate and runs it. */
  variants: { id: string; label: string; design: () => Design }[];
  rates: number[];
  /** What to try, in order. */
  steps: string[];
  /** What the learner should notice, revealed after a run. */
  notice: string;
};
export type ArchitectureLesson = {
  id: string;
  title: string;
  summary: string;
  objectives: string[];
  sections: Section[];
  experiment: Experiment;
  challenge: string;
  /** What the simulator does not show about this topic. */
  limits: string;
  takeaways: string[];
};

const steady = { durationS: 6, pattern: "random" as const };

export const architectureLessons: ArchitectureLesson[] = [
  {
    id: "fundamentals",
    title: "Clients, servers and databases",
    summary: "What each part of a web application does, where a request's time goes, and what limits how many requests it can serve.",
    objectives: ["Name the job of a client, an API server and a database.", "Add up a request's latency from its hops and its work.", "Estimate a server's capacity from its slots and its time per request, and recognise what happens beyond it."],
    sections: [
      {
        heading: "Three parts, three jobs",
        body: [
          "A client (a browser or an app) sends a request and waits for the answer. An API server runs the application's code: it checks the request, decides what to do, and asks the database for data. The database keeps that data safely, so it survives a server restart.",
          "Each arrow in a design is one of three kinds. A request waits for an answer. A message is handed over without waiting. Replication copies a database's writes to another database.",
        ],
      },
      {
        heading: "Where the time goes",
        body: [
          "A request's latency is the sum of everything on its path: network hops there and back, the work each component does, and any time spent waiting for a free slot.",
          "In this simulator a hop across the Internet takes 40 ms each way and a hop inside the data centre 1 ms. With an API server doing 20 ms of work and a database read taking 5 ms, one read takes 40 + 20 + 1 + 5 + 1 + 40 = 107 ms, and 80 ms of that is the Internet.",
        ],
      },
      {
        heading: "Capacity: slots and work time",
        body: [
          "A server works on a limited number of requests at once: its slots. If each request holds a slot for T milliseconds, n slots finish at most n × 1000 ÷ T requests per second. An API server with 4 slots and 20 ms of work finishes at most 200 per second, and fewer in practice, because a request keeps its slot while it waits for the database.",
          "Below capacity, requests rarely wait. Close to it, they often find every slot busy and queue, so latency climbs even though nothing is broken. Beyond it, the queue keeps growing until it is full: new requests are refused, or clients give up waiting.",
        ],
        points: ["Throughput: requests finished per second.", "Latency: how long one request takes.", "Utilisation: the share of time the slots are busy. Near 100%, small bursts cause long waits."],
      },
    ],
    experiment: {
      intro: "One API server with 4 slots in front of one database. Clients send random arrivals at the rate you choose.",
      variants: [{ id: "base", label: "API server (4 slots) + database", design: () => build("Client, API, database", [["client-1", "client", "Users", 80, 200, { rps: 20, writePercent: 10 }], ["api-1", "api", "API server", 340, 200, { concurrency: 4, serviceMs: 20, queueLimit: 50 }], ["sql-1", "sql", "Database", 600, 200]], [["client-1", "api-1"], ["api-1", "sql-1"]], steady) }],
      rates: [20, 100, 140, 180, 250],
      steps: ["Run at 20 requests per second and step through one request: count its hops.", "Run at 100, then 140: compare “95% within” with the 107 ms floor.", "Run at 250: read the findings. Where do requests wait, and what happens when the queue is full?"],
      notice: "Latency stays near its floor until the API server's slots are busy most of the time; then waiting time, not work, dominates. Past capacity, its bounded queue fills and requests are refused: the server protects itself, and clients see errors.",
    },
    challenge: "simple-web-app",
    limits: "Network delays here are fixed numbers. Real networks vary, lose packets and slow down under load; real servers also compete for CPU and memory, which the simulator doesn't model.",
    takeaways: ["Latency is the sum of hops, work and waiting.", "Capacity ≈ slots × 1000 ÷ milliseconds per request.", "Near full utilisation, waiting grows faster than load."],
  },
  {
    id: "storage-caching",
    title: "Databases and caches",
    summary: "SQL and NoSQL databases, how a cache in front of them changes the load, and why hit rate depends on what users ask for.",
    objectives: ["Compare SQL and NoSQL by how they store and find data.", "Follow cache-aside reads and writes.", "Explain hit rate from cache size, popularity and a cold start."],
    sections: [
      {
        heading: "SQL and NoSQL",
        body: [
          "A SQL database stores rows in tables with a fixed structure. It can join tables, run queries across many rows and group several changes into one transaction that succeeds or fails as a whole.",
          "A key-value or document (NoSQL) database stores items by key and spreads them over partitions. Finding one item by its key is fast, and adding partitions adds capacity, but queries across many items and transactions are limited. Each key always lives on one partition, so a very popular key can overload its partition.",
        ],
      },
      {
        heading: "Cache-aside",
        body: [
          "A cache keeps recently read items in memory. With cache-aside, the API asks the cache first. On a hit it answers at once; on a miss it reads the database and stores the item in the cache for next time. A write goes to the database and removes the item from the cache, so the next read fetches the new value.",
          "Caches are small compared with the data. When one is full, the least recently used item is dropped. An item can also expire after a set time.",
        ],
      },
      {
        heading: "What decides the hit rate",
        body: [
          "If a few items get most requests, a small cache holding them answers most reads. If every item is equally likely, a cache holding 10% of the items answers about 10% of reads. A cache that has just started is empty, so its first requests all miss.",
          "Every hit is a database read avoided. That is often the cheapest way to take load off a busy database, but it brings a risk: if the cache fails or restarts empty, all reads hit the database at once.",
        ],
      },
    ],
    experiment: {
      intro: "300 requests per second, 5% writes, over 1,000 items. Compare no cache, a small cache and a large one.",
      variants: [
        { id: "none", label: "No cache", design: () => cachedDesign(null, "popular") },
        { id: "small", label: "Cache: 50 items, popular items", design: () => cachedDesign(50, "popular") },
        { id: "large", label: "Cache: 500 items, popular items", design: () => cachedDesign(500, "popular") },
        { id: "uniform", label: "Cache: 500 items, every item equally likely", design: () => cachedDesign(500, "uniform") },
      ],
      rates: [300],
      steps: ["Run without a cache and note how busy the database is.", "Run with the small and the large cache: compare hit rates and database load.", "Run the large cache with equally likely items. Why does the hit rate fall?"],
      notice: "With popular items, a cache of 50 answers about as many reads as a cache of 500 when every item is equally likely. The misses at the start of each run are the cold start: the cache begins empty.",
    },
    challenge: "cache-read-heavy",
    limits: "The simulator tracks which items are cached, not their contents, so it can't show stale data. Real caches and databases also differ in memory, indexes and query plans that aren't modelled.",
    takeaways: ["Hit rate depends on popularity and cache size, not on the cache alone.", "A write removes the item; the next read misses.", "A cache takes load off the database, until it fails."],
  },
  {
    id: "scalability",
    title: "Scaling out and finding the bottleneck",
    summary: "Spread load over several servers with a load balancer, and follow the bottleneck as it moves.",
    objectives: ["Explain vertical and horizontal scaling.", "Describe how a load balancer chooses a server.", "Find the bottleneck in a run, and predict where it moves next."],
    sections: [
      {
        heading: "Up or out",
        body: [
          "Scaling up means a bigger machine. Scaling out means more machines sharing the work. Scaling out needs servers that keep no user state of their own, so any server can answer any request, and something in front to spread the requests: a load balancer.",
        ],
      },
      {
        heading: "Load balancing",
        body: [
          "Round-robin sends requests to each server in turn. Least-outstanding sends each request to the server with the fewest requests in progress, which helps when some requests or servers are slower than others.",
          "With three servers that each finish about 240 requests per second, the group finishes about 720 per second, as long as everything behind them keeps up.",
        ],
      },
      {
        heading: "The bottleneck moves",
        body: [
          "The bottleneck is the component that runs out of capacity first. Adding API servers helps only while they are the bottleneck; then the shared database becomes the limit. Read a run's findings: the busiest component is where the next change should go.",
        ],
        points: ["In-flight requests ≈ request rate × time each takes (Little's law): 600 requests per second at 0.03 s each means about 18 in progress at any moment."],
      },
    ],
    experiment: {
      intro: "One, two or three API servers (8 slots, 25 ms each) share a database. Try the request rates and find the bottleneck.",
      variants: [1, 2, 3].map((count) => ({ id: `apis-${count}`, label: count === 1 ? "One API server, no load balancer" : `${count} API servers behind a load balancer`, design: () => scaledDesign(count) })),
      rates: [150, 300, 500, 700],
      steps: ["With one server, find the rate where requests start to wait.", "Add servers and run again at 500 requests per second.", "Run three servers at 700: which component is the bottleneck now?"],
      notice: "Each server adds its capacity, until another component is the limit. The findings name the component whose slots were busy almost all the time.",
    },
    challenge: "scale-behind-lb",
    limits: "Servers here are identical and never slow down unequally, so round-robin and least-outstanding behave alike. Autoscaling (adding servers automatically) isn't modelled.",
    takeaways: ["Scale out with stateless servers behind a load balancer.", "Capacity adds up only until something shared runs out.", "Fix the bottleneck the run shows, then run again."],
  },
  {
    id: "distributed",
    title: "Queues, replicas and partitions",
    summary: "Hand work to a queue instead of waiting for it, copy data to share reads, and split data over partitions.",
    objectives: ["Decide when to answer now and process later.", "Explain backpressure, redelivery and dead letters.", "Describe what read replicas and partitions add, and what they cost."],
    sections: [
      {
        heading: "Answer now, process later",
        body: [
          "Some work doesn't need to finish before the user gets an answer: sending an email, processing a payment, resizing an image. The API can put a message on a queue and answer “accepted” (HTTP 202) at once. Workers take messages from the queue and do the work in the background.",
          "The queue absorbs bursts: if messages arrive faster than workers finish them, they wait in the queue instead of slowing every request. Workers must still keep up on average, or the queue only grows. A bounded queue that is full refuses new messages: that is backpressure, an honest “not now” instead of unbounded waiting.",
        ],
      },
      {
        heading: "When processing fails",
        body: [
          "If a worker fails to finish a message, the message returns to the queue and is tried again later. After a set number of tries it is set aside as a dead letter for someone to inspect. Because a message can be delivered more than once, processing it should be idempotent: doing it twice must have the same effect as doing it once.",
        ],
      },
      {
        heading: "Replicas and partitions",
        body: [
          "A read replica is a copy of a database that serves reads. The primary takes every write and sends it to its replicas, which also have to apply it: replicas add read capacity, not write capacity. In real systems a replica lags slightly behind, so a read just after a write may return the old value.",
          "Partitioning (sharding) splits data by key over several databases or partitions. Each key lives in one place, so writes scale too, but a popular key still lands on a single partition.",
        ],
      },
    ],
    experiment: {
      intro: "Shoppers place orders through an API that queues them; workers (8 slots, 200 ms per order) store them in the database.",
      variants: [1, 3, 6].map((count) => ({ id: `workers-${count}`, label: `${count} ${count === 1 ? "worker" : "workers"}`, design: () => queuedDesign(count) })),
      rates: [50, 100, 200],
      steps: ["Run one worker at 50 orders per second: compare how fast orders are accepted with how long they wait to be processed.", "Raise the rate to 200: the API still answers quickly. Where do orders wait?", "Add workers until the queue drains during the run."],
      notice: "The client's latency stays low whatever the workers do: the queue separates accepting work from doing it. Processing time is the queue's wait plus the work, and it grows when workers are slower than the arrival rate.",
    },
    challenge: "async-orders",
    limits: "The simulator doesn't model message contents, duplicates' effects, replication lag or stale reads, or ordering guarantees. Replicas apply each write after it's done on the primary, without lag effects on reads.",
    takeaways: ["Queue work that doesn't need to finish before the answer.", "Workers must keep up on average; queues only absorb bursts.", "Retries mean duplicates: make processing idempotent."],
  },
  {
    id: "reliability-security",
    title: "Failures, timeouts and retries",
    summary: "Design for components that fail: redundancy, health checks, timeouts and careful retries. And keep the inside private.",
    objectives: ["Find single points of failure.", "Explain how health checks, timeouts and retries change what users see during a failure.", "Recognise a retry storm, and the security boundary of a design."],
    sections: [
      {
        heading: "Every component fails sometimes",
        body: [
          "A single point of failure is a component whose failure stops the whole service. Redundancy (two or more of it) removes it, but only if the rest of the design stops using the failed copy. A load balancer's health checks do that: it checks each server regularly and stops sending requests to one that doesn't answer. Until the next check, requests sent to the failed server fail.",
          "Redundancy also needs spare capacity: when one of two busy servers fails, the other gets all the traffic. If it can't carry it, it queues and slows down, and the outage spreads.",
        ],
      },
      {
        heading: "Timeouts and retries",
        body: [
          "A timeout stops a client waiting forever. A retry tries again, which turns a brief failure into a success. But every retry is another request. When a service is overloaded, instant retries add load exactly where it hurts, and a partial outage can become a full one: a retry storm.",
          "Good retries are few, wait before trying again (backoff, doubling each time), and give up. A server that refuses work quickly when its queue is full is better than one that makes everyone wait until they time out.",
        ],
      },
      {
        heading: "Security: keep the inside private",
        body: [
          "Only the edge (the load balancer or CDN) should be reachable from the Internet, over TLS. API servers, databases, caches and queues sit in a private network, each with its own credentials and only the permissions it needs. Kitab's connection rules reflect part of this: clients can't connect to databases, caches or queues. The simulator doesn't model attacks, authentication or encryption.",
        ],
        points: ["Validate every request at the API; never trust input.", "Limit request rates per client at the edge.", "Give each component the least privilege it needs."],
      },
    ],
    experiment: {
      intro: "Two or three API servers behind a load balancer. The first server fails from 2 s to 5 s. Clients retry up to 3 times, instantly.",
      variants: [
        { id: "no-checks", label: "Two servers, no health checks", design: () => resilientDesign(2, false) },
        { id: "checks", label: "Two servers, health checks", design: () => resilientDesign(2, true) },
        { id: "spare", label: "Three servers, health checks", design: () => resilientDesign(3, true) },
      ],
      rates: [150, 300],
      steps: ["Run without health checks and filter the timeline to “Important”: what happens to requests sent to the failed server?", "Turn on health checks: when does the load balancer stop using the failed server?", "At 300 requests per second, compare two and three servers. Follow a request that was retried."],
      notice: "Health checks limit failures to the detection window, but only spare capacity keeps the surviving servers from queueing. Retries hide some errors and add load: count the retries in each run.",
    },
    challenge: "resilient-api",
    limits: "Failed components here refuse connections immediately; real failures can also be slow, partial or intermittent. Security is described, not simulated.",
    takeaways: ["Redundancy needs detection (health checks) and spare capacity.", "Retry a little, with backoff; fail fast when full.", "Only the edge is public."],
  },
  {
    id: "design-projects",
    title: "Designing from requirements",
    summary: "A method for real design problems: requirements, estimates, the simplest design, then evidence-driven changes.",
    objectives: ["Turn a problem statement into requirements and load estimates.", "Start simple and change one thing at a time, guided by runs.", "Compare valid designs by their trade-offs."],
    sections: [
      {
        heading: "A method",
        body: ["Most design problems can be worked through in the same order. The point isn't the diagram: it's being able to say why each part is there."],
        points: [
          "Requirements: what must it do (functional), and how fast, how available, at what scale (non-functional)?",
          "Estimates: requests per second, reads versus writes, how much data, how popular.",
          "Simplest design that could work: client, API, database.",
          "Run it, find the bottleneck, change one thing, run again.",
          "Break it: fail each component in turn. What do users see?",
          "Compare: cost, latency, complexity, and what each design does badly.",
        ],
      },
      {
        heading: "Worked estimate: a URL shortener",
        body: [
          "1,000 requests per second, 90% redirects: 900 reads and 100 writes per second. A redirect is a lookup by short code: a key. A few links go viral, so popularity is skewed: even a cache holding 1,000 of 50,000 links answers a real share of redirects.",
          "An API server with 16 slots and 10 ms of work finishes at most 1,600 requests per second, less while waiting on storage, so two behind a load balancer leave room. A database with 8 slots at 10 ms per read finishes at most 800 reads per second: not enough alone for 900. If a cache answers about half the redirects, the database still serves about 450 reads and all 100 writes (20 ms each), which keeps it busy most of the time. Run it to check, then ask what happens when the cache fails.",
        ],
      },
    ],
    experiment: {
      intro: "Three designs for the URL shortener at its real load. Run each, then fail the cache in the playground to test the third.",
      variants: [
        { id: "simple", label: "One API server and SQL", design: () => shortenerDesign("simple") },
        { id: "cache", label: "Load balancer, two servers, cache, SQL", design: () => shortenerDesign("cache") },
        { id: "nosql", label: "Load balancer, two servers, NoSQL", design: () => shortenerDesign("nosql") },
      ],
      rates: [500, 1000],
      steps: ["Run the simplest design at 500, then 1,000 requests per second. Which estimate was right?", "Run the cached design and the NoSQL design at 1,000. Compare latency, cost and where the load lands."],
      notice: "Estimates predict where the simplest design breaks; runs confirm it. Two quite different designs can both meet the load: then cost, failure behaviour and what the data needs decide.",
    },
    challenge: "url-shortener",
    limits: "Estimates and runs use the simulator's fixed per-operation times. Real systems need measurements from real hardware before decisions are final.",
    takeaways: ["Estimate before you draw.", "Change one thing at a time, guided by evidence.", "Several designs can be valid: compare trade-offs."],
  },
];

function cachedDesign(capacity: number | null, skew: "popular" | "uniform") {
  return build(
    "Cache experiment",
    [
      ["client-1", "client", "Users", 80, 200, { rps: 300, writePercent: 5 }],
      ["api-1", "api", "API server", 340, 200, { concurrency: 64, serviceMs: 10, queueLimit: 200 }],
      ...(capacity === null ? [] : [["cache-1", "cache", "Cache", 600, 80, { capacityKeys: capacity }] as const]),
      ["sql-1", "sql", "Database", 600, 320, { concurrency: 8, readMs: 20 }],
    ],
    [["client-1", "api-1"], ...(capacity === null ? [] : [["api-1", "cache-1"] as [string, string]]), ["api-1", "sql-1"]],
    { ...steady, keys: 1000, skew },
  );
}

function scaledDesign(count: number) {
  const apis = Array.from({ length: count }, (_, i) => [`api-${i + 1}`, "api", count === 1 ? "API server" : `API server ${i + 1}`, 520, 80 + i * 140 + (3 - count) * 70, { concurrency: 8, serviceMs: 25 }] as const);
  const balanced = count > 1;
  return build(
    "Scaling experiment",
    [["client-1", "client", "Users", 60, 220, { rps: 150, writePercent: 10 }], ...(balanced ? [["load-balancer-1", "load-balancer", "Load balancer", 290, 220] as const] : []), ...apis, ["sql-1", "sql", "Database", 760, 220, { concurrency: 20 }]],
    [...(balanced ? [["client-1", "load-balancer-1"] as [string, string], ...apis.map(([id]) => ["load-balancer-1", id] as [string, string])] : [["client-1", "api-1"] as [string, string]]), ...apis.map(([id]) => [id, "sql-1"] as [string, string])],
    steady,
  );
}

function queuedDesign(workers: number) {
  const list = Array.from({ length: workers }, (_, i) => [`worker-${i + 1}`, "worker", `Worker ${i + 1}`, 740, 220 + (i - (workers - 1) / 2) * 90, { concurrency: 8, serviceMs: 200 }] as const);
  return build(
    "Queue experiment",
    [["client-1", "client", "Shoppers", 60, 220, { rps: 50, writePercent: 100 }], ["api-1", "api", "Orders API", 290, 220, { concurrency: 32, serviceMs: 10 }], ["queue-1", "queue", "Order queue", 510, 220], ...list, ["sql-1", "sql", "Orders database", 960, 220, { concurrency: 20 }]],
    [["client-1", "api-1"], ["api-1", "queue-1"], ...list.flatMap(([id]) => [["queue-1", id], [id, "sql-1"]] as [string, string][])],
    steady,
  );
}

function resilientDesign(count: number, healthChecks: boolean) {
  const apis = Array.from({ length: count }, (_, i) => [`api-${i + 1}`, "api", `API server ${i + 1}`, 520, 220 + (i - (count - 1) / 2) * 140, { concurrency: 8, serviceMs: 30 }] as const);
  return build(
    "Failure experiment",
    [["client-1", "client", "Users", 60, 220, { rps: 150, writePercent: 10, retries: 3, backoffMs: 0 }], ["load-balancer-1", "load-balancer", "Load balancer", 290, 220, { healthChecks }], ...apis, ["sql-1", "sql", "Database", 760, 220, { concurrency: 40 }]],
    [["client-1", "load-balancer-1"], ...apis.flatMap(([id]) => [["load-balancer-1", id], [id, "sql-1"]] as [string, string][])],
    { ...steady, durationS: 8 },
    [{ node: "api-1", fromS: 2, toS: 5 }],
  );
}

function shortenerDesign(kind: "simple" | "cache" | "nosql") {
  const client = ["client-1", "client", "Visitors", 60, 220, { rps: 500, writePercent: 10 }] as const;
  const api = { concurrency: 16, serviceMs: 10 };
  const workload = { ...steady, keys: 50_000, skew: "popular" as const };
  if (kind === "simple") return build("URL shortener", [client, ["api-1", "api", "API server", 320, 220, api], ["sql-1", "sql", "Links (SQL)", 580, 220, { concurrency: 8, readMs: 10, writeMs: 20 }]], [["client-1", "api-1"], ["api-1", "sql-1"]], workload);
  const front = [client, ["load-balancer-1", "load-balancer", "Load balancer", 270, 220], ["api-1", "api", "API server 1", 480, 140, api], ["api-2", "api", "API server 2", 480, 300, api]] as const;
  const edges: [string, string][] = [["client-1", "load-balancer-1"], ["load-balancer-1", "api-1"], ["load-balancer-1", "api-2"]];
  if (kind === "nosql") return build("URL shortener", [...front, ["nosql-1", "nosql", "Links (NoSQL)", 720, 220, { partitions: 4, concurrencyPerPartition: 4, opMs: 5 }]], [...edges, ["api-1", "nosql-1"], ["api-2", "nosql-1"]], workload);
  return build("URL shortener", [...front, ["cache-1", "cache", "Cache", 720, 120], ["sql-1", "sql", "Links (SQL)", 720, 320, { concurrency: 8, readMs: 10, writeMs: 20 }]], [...edges, ["api-1", "cache-1"], ["api-2", "cache-1"], ["api-1", "sql-1"], ["api-2", "sql-1"]], workload);
}

export const findArchitectureLesson = (id: string) => architectureLessons.find((lesson) => lesson.id === id);
