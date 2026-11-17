// Shared terms for Practice and the Playgrounds, in the same shape as a lesson's glossary (so the same TermChips
// show them): what it is, why it matters, a concrete example, and where the full explanation lives. Short on
// purpose: each links to the concept unit or track that teaches it, rather than repeating it. Pure data; a test
// checks every link points at a real concept or page.

export type GlossaryTerm = {
  id: string;
  term: string;
  definition: string;
  purpose: string;
  example: string;
  /** The deeper explanation: a System Design concept (unit#concept) or a track page. */
  more?: { href: string; label: string };
};

const concept = (unit: string, id: string, label: string) => ({ href: `/learn/system-design/${unit}#${id}`, label });

export const glossary = {
  slot: {
    id: "slot", term: "Processing slot",
    definition: "Kitab's unit of concurrency: one operation a component can work on at a time. A component with 8 slots works on up to 8 things at once; the rest wait.",
    purpose: "Every real component has some limit like this (worker threads, processes, connections), and when all are busy, requests queue.",
    example: "An API server with 8 slots and 25 ms of work per request can finish at most 8 × 1000 ÷ 25 = 320 requests a second.",
    more: concept("performance", "littles-law", "Throughput, latency and Little's law"),
  },
  rps: {
    id: "rps", term: "Request rate (req/s)",
    definition: "How many new requests arrive each second. It is load offered by users, not something a server chooses.",
    purpose: "Comparing it with what each component can finish shows where a design will fall behind.",
    example: "30 req/s for 10 s is 300 requests; if the server can finish only 20 a second, 10 a second pile up.",
    more: concept("performance", "capacity-planning", "Capacity planning"),
  },
  throughput: {
    id: "throughput", term: "Throughput",
    definition: "How many requests finish per second. It can't exceed the request rate, and it stops rising once the busiest component is full.",
    purpose: "When throughput stays below the request rate, work is piling up or being refused somewhere.",
    example: "300 requests arrive per second and 250 finish: a queue grows by about 50 every second.",
    more: concept("performance", "littles-law", "Throughput, latency and Little's law"),
  },
  latency: {
    id: "latency", term: "Latency and p95",
    definition: "How long one request takes, from sending to answer. p95 is the time 95% of requests finish within; the slowest 5% take longer.",
    purpose: "Averages hide the slow requests users notice; percentiles show them.",
    example: "p50 80 ms and p95 900 ms: half are fast, but one in twenty takes almost a second.",
    more: concept("performance", "tail-latency", "Tail latency"),
  },
  queue: {
    id: "queue", term: "Queue depth",
    definition: "How many requests or messages are waiting for a free slot right now.",
    purpose: "A queue that keeps growing means work arrives faster than it finishes; a short, steady one is normal.",
    example: "Waiting 0, 3, 1, 0 is a busy but healthy server; 10, 40, 90, 160 is one falling behind.",
    more: concept("overload", "backpressure", "Backpressure"),
  },
  pool: {
    id: "pool", term: "Connection pool",
    definition: "A set of open database connections an application reuses instead of opening one per request.",
    purpose: "Opening connections is slow, and databases allow only so many; the pool's size caps how many queries one application sends at once.",
    example: "20 API servers × a pool of 10 = up to 200 connections the database must accept.",
    more: concept("performance", "connection-pooling", "Connection pools"),
  },
  worker: {
    id: "worker", term: "Worker",
    definition: "A background process that takes messages from a queue and does the work, so the request that created the job doesn't wait for it.",
    purpose: "Slow work (emails, image resizing, payments) moves out of the request, and bursts wait in the queue instead of failing.",
    example: "An order request puts \"send receipt\" on a queue and answers at once; a worker sends the email a moment later.",
    more: concept("messaging", "queues-and-logs", "Queues and logs"),
  },
  lb: {
    id: "lb", term: "Load balancer",
    definition: "Spreads incoming requests over several servers and, with health checks, stops using servers that are down.",
    purpose: "Lets you add servers for capacity and survive one failing.",
    example: "600 req/s over three API servers is about 200 each; with one down, the other two take 300 each.",
  },
  cacheHit: {
    id: "cache-hit", term: "Cache hit and miss",
    definition: "A hit finds the item in the cache; a miss doesn't, so the item is read from the database (and usually stored).",
    purpose: "Every hit is a database read avoided; the hit rate decides how much load the cache takes off.",
    example: "A 90% hit rate on 1,000 reads/s leaves 100 reads/s for the database.",
    more: concept("performance", "caching-strategies", "Caching strategies"),
  },
  retry: {
    id: "retry", term: "Retry and timeout",
    definition: "A timeout is how long a caller waits before giving up on an attempt; a retry sends the request again after a failure or timeout.",
    purpose: "Retries hide brief failures but add load when a service is already struggling.",
    example: "A client with 2 retries can send 3 requests for one user action.",
    more: concept("resilience", "timeouts-deadlines", "Timeouts and deadlines"),
  },
  idempotency: {
    id: "idempotency", term: "Idempotency",
    definition: "Doing an operation twice has the same effect as doing it once.",
    purpose: "Retries and redelivered messages are only safe for idempotent operations.",
    example: "\"Set the balance to 50\" is idempotent; \"add 10 to the balance\" is not.",
    more: concept("idempotency", "idempotency-keys", "Idempotency keys"),
  },
  transaction: {
    id: "transaction", term: "Transaction",
    definition: "A group of database changes that all happen or none do.",
    purpose: "It keeps data consistent when a step fails half-way.",
    example: "Moving money takes from one account and adds to another in one transaction, never just one half.",
    more: concept("transactions", "acid", "ACID transactions"),
  },
  partition: {
    id: "partition", term: "Partition",
    definition: "One slice of a database or topic; each key always belongs to the same slice.",
    purpose: "Partitions let data and load spread over machines, but one very popular key still lands on one partition.",
    example: "With 4 partitions, user 42's items are always on the same one, whichever server asks.",
    more: concept("performance", "sharding", "Sharding"),
  },
  replication: {
    id: "replication", term: "Replication",
    definition: "Keeping copies of data on several machines: a primary takes writes and replicas copy them.",
    purpose: "Replicas share reads and keep data available if a machine fails, at the price of copies that can lag behind.",
    example: "A read from a replica a moment after a write may not see the write yet.",
    more: concept("consistency", "replication", "Replication"),
  },
  event: {
    id: "event", term: "Event",
    definition: "A record that something happened (\"order placed\"), published so other parts of a system can react.",
    purpose: "Services can react without the sender knowing or waiting for them.",
    example: "Billing, email and analytics each react to one \"order placed\" event.",
    more: concept("messaging", "eda-tradeoffs", "Event-driven trade-offs"),
  },
  offset: {
    id: "offset", term: "Offset and consumer group",
    definition: "In a log such as Kafka, an offset is a message's position in its partition. A consumer group is a set of consumers sharing the partitions, each remembering the offset it has reached.",
    purpose: "Messages stay in the log; each group reads at its own pace and can replay from an earlier offset.",
    example: "Analytics is at offset 1,200 while billing is at 1,450 in the same partition.",
    more: concept("messaging", "kafka-model", "Kafka's model"),
  },
  breaker: {
    id: "breaker", term: "Circuit breaker",
    definition: "Stops calling a dependency that keeps failing, fails fast for a while, then lets a few calls through to test it.",
    purpose: "Callers stop wasting time and threads on a dependency that is down, and it gets room to recover.",
    example: "After 20 failures in 10 s, calls to recommendations fail at once for 30 s instead of waiting 2 s each.",
    more: concept("resilience", "circuit-breakers", "Circuit breakers"),
  },
  backpressure: {
    id: "backpressure", term: "Backpressure",
    definition: "Telling senders to slow down, or refusing work, when a component can't keep up.",
    purpose: "Bounded queues and refusals keep a system responsive instead of piling up work it will never finish.",
    example: "A full message queue refuses new messages, so the sender shows \"try again later\".",
    more: concept("overload", "backpressure", "Backpressure"),
  },
  port: {
    id: "port", term: "Port and TCP socket",
    definition: "A port number picks which program on a device a packet is for (a web server usually listens on 80 or 443). A socket is one end of a connection: an address and a port.",
    purpose: "One IP address serves many programs; ports keep their conversations apart.",
    example: "192.168.1.10:80 is the web server; the browser's end might be 192.168.1.20:51734.",
    more: { href: "/learn/hello-tcp", label: "The TCP walkthrough" },
  },
  ip: {
    id: "ip", term: "IP address and subnet",
    definition: "An IP address names a device's network interface. The prefix length (such as /24) says which leading part names the subnet, the devices that can reach each other directly.",
    purpose: "Whether two devices share a subnet decides whether a packet goes straight to the other device or to a gateway.",
    example: "192.168.1.20/24 and 192.168.1.10/24 share subnet 192.168.1.0; 10.0.0.5 is elsewhere.",
    more: { href: "/learn", label: "The Networking track" },
  },
  gateway: {
    id: "gateway", term: "Default gateway",
    definition: "The router a device sends packets to when the destination is outside its own subnet.",
    purpose: "Without a correct gateway, a device can reach its neighbours but nothing beyond them.",
    example: "A laptop on 192.168.1.0/24 sends internet traffic to its gateway 192.168.1.1.",
    more: { href: "/learn", label: "The Networking track" },
  },
  dns: {
    id: "dns", term: "DNS and DHCP",
    definition: "DNS turns names into IP addresses. DHCP lends a joining device an IP address, gateway and DNS server automatically.",
    purpose: "They are why you type names, not numbers, and why devices work without manual settings.",
    example: "A phone joins Wi-Fi, gets 192.168.1.23 from DHCP, then asks DNS for example.com's address.",
    more: { href: "/learn", label: "The Networking track" },
  },
  reference: {
    id: "reference", term: "Memory reference",
    definition: "A value that says where another value is stored, like a pointer or an object reference, rather than the value itself.",
    purpose: "Linked lists and trees are built from references, so changing one reference can relink a whole structure.",
    example: "A list node holds 7 and a reference to the node holding 9.",
    more: { href: "/learn/data-structures", label: "The Data Structures track" },
  },
  frame: {
    id: "frame", term: "Stack frame",
    definition: "The memory one function call uses for its arguments, local variables and where to return to. Each call adds a frame; returning removes it.",
    purpose: "Recursion adds a frame per call, so recursion with no base case runs out of stack.",
    example: "factorial(3) calls factorial(2) calls factorial(1): three frames, removed in reverse order.",
    more: { href: "/learn/data-structures", label: "The Data Structures track" },
  },
  complexity: {
    id: "complexity", term: "Time complexity",
    definition: "How the number of steps grows with the input size n, written in big-O: O(1) stays the same, O(n) grows in step with n.",
    purpose: "It predicts which structure stays fast as data grows.",
    example: "Inserting at the front of an array shifts every element, O(n); on a linked list it relinks one reference, O(1).",
    more: { href: "/learn/data-structures", label: "The Data Structures track" },
  },
} satisfies Record<string, GlossaryTerm>;

export type TermId = keyof typeof glossary;
export const terms = (...ids: TermId[]): GlossaryTerm[] => ids.map((id) => glossary[id]);
