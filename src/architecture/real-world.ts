// What each Architecture Playground setting and component corresponds to in real systems: where the value is set,
// who sets it, what changing it trades off, and how Kitab's model differs. Keyed exactly like fieldsFor and
// components (a test keeps them equal), so an explanation can't outlive or miss a setting. Pure data.
import type { ComponentKind } from "./model.ts";

/**
 * setting: something an engineer configures. workload: traffic arriving from outside (you don't set it on the
 * server; you can only measure it, or generate it in a load test). property: how fast something is, which real
 * systems measure rather than configure. simulation: exists only to make Kitab's runs repeatable.
 */
export type ValueKind = "setting" | "workload" | "property" | "simulation";
export const valueKindLabel: Record<ValueKind, string> = {
  setting: "A setting engineers configure",
  workload: "Traffic arriving from outside, not a server setting",
  property: "A measured property, not usually a setting",
  simulation: "Exists only in the simulator",
};

/** A representative snippet for one technology; others differ. Always shown with its label. */
export type Example = { label: string; code: string };

export type RealSetting = {
  kind: ValueKind;
  /** Where the value lives in real systems, and who controls it. Never "the one config file": implementations vary. */
  where: string;
  /** What changing it trades off, including why more is not always better. */
  tradeoff: string;
  /** How Kitab models it, and what the model leaves out. */
  model: string;
  example?: Example;
};

const poolExample: Example = {
  label: "Representative: a Java service's database connection pool (HikariCP, Spring Boot)",
  code: "spring.datasource.hikari.maximum-pool-size=10\nspring.datasource.hikari.connection-timeout=2000  # ms a request waits for a connection",
};

export const realSettings: Record<ComponentKind, Record<string, RealSetting>> = {
  client: {
    rps: {
      kind: "workload",
      where: "Set by the users, not by you: real request rates come from how many people use the product. Engineers measure it in monitoring, or generate it on purpose with a load-testing tool. A server's rate limit decides what is admitted, not how much arrives.",
      tradeoff: "Raising it is how you find where a design stops coping: watch which component fills up first.",
      model: "Kitab generates exactly this many new requests per second (steady or random arrivals). Retries are extra on top.",
      example: { label: "Representative: a constant-rate load test (k6)", code: "export const options = {\n  scenarios: { steady: { executor: 'constant-arrival-rate', rate: 30, timeUnit: '1s', duration: '10s', preAllocatedVUs: 50 } },\n};" },
    },
    writePercent: {
      kind: "workload",
      where: "A property of how people use the product (reading notes vs saving them), measured from traffic. Load tests copy the observed mix.",
      tradeoff: "Writes usually cost more (they reach the primary database and invalidate caches), so the mix changes where the bottleneck is.",
      model: "Each request is a write with this probability; the rest are reads or static files.",
    },
    assetPercent: {
      kind: "workload",
      where: "Decided by how pages are built (images, scripts, styles) and measured from traffic.",
      tradeoff: "Static files are cheap to serve from a CDN or object storage and expensive to send through API servers.",
      model: "This share of requests asks for a file instead of calling the API.",
    },
    timeoutMs: {
      kind: "setting",
      where: "In the client's code or HTTP library (browser fetch, mobile app, or a calling service), chosen by the team that writes that client. Proxies and load balancers have their own timeouts too.",
      tradeoff: "Too short gives up on requests that would have succeeded (and may retry them); too long ties users and connections up waiting.",
      model: "One timeout per attempt. A timed-out request may still finish on the server: Kitab counts that as late work.",
      example: { label: "Representative: a 2-second timeout in a browser or Node.js", code: "await fetch(url, { signal: AbortSignal.timeout(2000) });" },
    },
    retries: {
      kind: "setting",
      where: "In the client's code, an HTTP client library or a service mesh's retry policy, chosen by the team that owns the caller.",
      tradeoff: "Retries hide brief failures, but every retry is extra load arriving exactly when a service is struggling, and a retried write can happen twice unless it is idempotent.",
      model: "Retries after a failure or timeout, up to this many times.",
    },
    backoffMs: {
      kind: "setting",
      where: "Next to the retry count, in the client's retry policy.",
      tradeoff: "Longer pauses give a struggling service time to recover but make each retried request slower. Real policies add random jitter so clients don't retry in step.",
      model: "The first pause, doubling before each later retry. No jitter.",
    },
  },
  cdn: {
    capacityKeys: {
      kind: "property",
      where: "Managed by the CDN provider; you rarely set it. What you control is which files are cacheable and for how long.",
      tradeoff: "More room keeps more files at the edge (more hits), which providers price in.",
      model: "A number of files, least recently used dropped first. Real CDNs have many edge locations, each with its own copy.",
    },
    ttlS: {
      kind: "setting",
      where: "Usually sent by your origin in the Cache-Control header, and sometimes overridden in the CDN's rules by whoever runs the site.",
      tradeoff: "Longer keeps more hits but serves an old file for longer after it changes, so teams put a version in file names.",
      model: "After this many seconds a stored file is expired and fetched again.",
      example: { label: "Representative: an HTTP response header from the origin", code: "Cache-Control: public, max-age=3600" },
    },
  },
  "load-balancer": {
    algorithm: {
      kind: "setting",
      where: "In the load balancer's configuration: a managed cloud load balancer's settings, or a reverse proxy's config (nginx, HAProxy, Envoy), owned by the platform or operations team.",
      tradeoff: "Round-robin is simple and fair when requests cost the same; fewest-in-progress copes better when some requests or servers are slower.",
      model: "Round-robin or fewest requests in progress, over the API servers it is connected to.",
      example: { label: "Representative: nginx sending each request to the server with the fewest active connections", code: "upstream api {\n  least_conn;\n  server 10.0.0.11:8080;\n  server 10.0.0.12:8080;\n}" },
    },
    healthChecks: {
      kind: "setting",
      where: "In the load balancer's configuration, often with a health endpoint (such as /health) the application team provides.",
      tradeoff: "Without checks, requests keep going to a dead server; aggressive checks can remove servers that are only briefly slow.",
      model: "Checks every interval and stops sending to a server it finds down, until a later check finds it up.",
    },
    checkIntervalMs: {
      kind: "setting",
      where: "Beside the health check in the load balancer's configuration.",
      tradeoff: "Shorter notices failures sooner but sends more check traffic; most systems also need several failed checks in a row.",
      model: "A failure is noticed at the first check after it happens (one failed check is enough).",
      example: { label: "Representative: HAProxy checking each server every 2 seconds", code: "backend api\n  server s1 10.0.0.11:8080 check inter 2s\n  server s2 10.0.0.12:8080 check inter 2s" },
    },
  },
  api: {
    concurrency: {
      kind: "setting",
      where: "No single setting: the limit comes from the application server's worker processes and threads (gunicorn, Tomcat, Puma), a concurrency limit in code, or a downstream limit such as the connection pool. The service's team sets these, often per container.",
      tradeoff: "More slots finish more at once only while something else has spare capacity: more threads also use more memory and CPU, and can push more load onto a database that is already full.",
      model: "A processing slot is an abstract unit of concurrency, not a CPU core, thread or connection. A request keeps its slot while it waits for the cache or database.",
      example: { label: "Representative: a Python API served by gunicorn (about 4 × 8 requests at once)", code: "# gunicorn.conf.py\nworkers = 4\nthreads = 8" },
    },
    serviceMs: {
      kind: "property",
      where: "Not configured: it is how long your code takes, measured with profiling or tracing. You change it by changing the code, the hardware or the work done per request.",
      tradeoff: "Halving it doubles what each slot can finish per second, the same as doubling the slots.",
      model: "A fixed time per request, the same for every request. Real times vary, with a long tail.",
    },
    queueLimit: {
      kind: "setting",
      where: "Usually in the server or proxy that accepts connections (for example Tomcat's accept-count or the OS listen backlog), or a queue limit in the application.",
      tradeoff: "A longer queue refuses less, but requests wait longer and may time out anyway; a short one fails fast (load shedding).",
      model: "Requests beyond the free slots wait here in order; when it is full, new requests are refused at once.",
      example: { label: "Representative: Spring Boot on Tomcat", code: "server.tomcat.threads.max=200\nserver.tomcat.accept-count=100" },
    },
  },
  cache: {
    capacityKeys: {
      kind: "setting",
      where: "In the cache server's configuration (Redis maxmemory, Memcached -m), owned by whoever runs the cache. Real caches are sized in bytes of memory, not items.",
      tradeoff: "More memory keeps more items (more hits) and costs more; beyond the popular items, extra room helps little.",
      model: "A number of items, least recently used dropped first.",
      example: { label: "Representative: redis.conf", code: "maxmemory 256mb\nmaxmemory-policy allkeys-lru" },
    },
    ttlS: {
      kind: "setting",
      where: "Usually chosen in the application code when it stores each item, sometimes as a default in a caching library.",
      tradeoff: "Longer keeps more hits but can show stale data after the database changes; this design also removes an item on write.",
      model: "After this many seconds an item counts as expired, so the next read goes to the database.",
      example: { label: "Representative: storing an item for 5 minutes in Redis", code: "SET product:42 \"{...}\" EX 300" },
    },
  },
  sql: {
    concurrency: {
      kind: "setting",
      where: "Two places: each application's connection pool (client side, set by the service's team) and the database's own limit (for example PostgreSQL max_connections, set by its administrators). A connection is not always running a query.",
      tradeoff: "Past the point where CPU or disk is busy, more concurrent queries just wait for each other and slow every query down.",
      model: "How many queries the database works on at once; the rest wait. Kitab doesn't model locks, indexes or the pool separately.",
      example: poolExample,
    },
    readMs: {
      kind: "property",
      where: "Measured, not configured: it depends on the query, indexes, data size and hardware. Teams change it by adding indexes or rewriting queries.",
      tradeoff: "A missing index can make one read thousands of times slower; caching avoids the read altogether.",
      model: "A fixed time per read.",
    },
    writeMs: {
      kind: "property",
      where: "Measured, not configured: it depends on indexes to update, durability settings and disks.",
      tradeoff: "Every replica spends this too, applying each write.",
      model: "A fixed time per write, also spent by each replica.",
    },
    queueLimit: {
      kind: "setting",
      where: "Databases rarely have a query queue setting: requests usually wait in the application's connection pool, which gives up after a timeout rather than a count.",
      tradeoff: "Waiting longer refuses less but makes slow requests slower still.",
      model: "A count of waiting queries before new ones are refused.",
      example: poolExample,
    },
  },
  nosql: {
    partitions: {
      kind: "setting",
      where: "Depends on the database: managed services (DynamoDB) split partitions for you; others (Cassandra, sharded MongoDB) are sized by their operators. What the application team always chooses is the partition key.",
      tradeoff: "More partitions spread evenly-spread load further, but cannot help when one popular key gets most of the traffic: that key's partition is still one partition.",
      model: "Each key always maps to the same partition, each with its own slots and queue.",
    },
    concurrencyPerPartition: {
      kind: "property",
      where: "A limit of the database or service plan (managed databases publish per-partition throughput limits), not usually a setting.",
      tradeoff: "Raising capacity per partition costs money and still leaves a hot key bound to one partition.",
      model: "Each partition's own slots.",
    },
    opMs: {
      kind: "property",
      where: "Measured, not configured: depends on item size, consistency level and hardware.",
      tradeoff: "Strongly consistent reads usually cost more than eventually consistent ones.",
      model: "A fixed time per read or write.",
    },
    queueLimit: {
      kind: "setting",
      where: "Usually a throttling limit of the database or service plan; the client sees throttling errors and retries.",
      tradeoff: "Refusing early protects the partition; waiting longer makes requests slow instead of failed.",
      model: "Operations that may wait on one partition before new ones are refused.",
    },
  },
  queue: {
    maxDepth: {
      kind: "setting",
      where: "In the broker's queue settings (for example a RabbitMQ max-length policy), set by whoever runs the broker. Some managed queues (Amazon SQS) have no depth limit, only a retention time.",
      tradeoff: "A bigger queue absorbs longer bursts but can hide a backlog that is growing; when full, senders must slow down or fail (backpressure).",
      model: "When full, new messages are refused and the sender gets an error.",
      example: { label: "Representative: a RabbitMQ policy refusing publishes beyond 10,000 messages", code: "rabbitmqctl set_policy limit \"^orders$\" '{\"max-length\":10000,\"overflow\":\"reject-publish\"}' --apply-to queues" },
    },
  },
  worker: {
    concurrency: {
      kind: "setting",
      where: "In the worker process's own settings (Celery --concurrency, Sidekiq concurrency, a consumer's thread count), plus how many worker processes or containers run. Set by the team that owns the background jobs.",
      tradeoff: "More at once drains the queue faster until the database it writes to becomes the bottleneck.",
      model: "Messages a worker processes at the same time, each holding a slot until its database write finishes.",
      example: { label: "Representative: a Celery worker", code: "celery -A app worker --concurrency=4" },
    },
    serviceMs: {
      kind: "property",
      where: "Measured, not configured: how long the job's code takes.",
      tradeoff: "Halving it doubles what each slot finishes per second.",
      model: "A fixed time per message before the result is written.",
    },
    maxReceives: {
      kind: "setting",
      where: "In the queue's redrive or dead-letter settings (for example SQS maxReceiveCount), or in the worker framework's retry limit.",
      tradeoff: "More tries rescue messages that failed by chance; fewer stop a broken message (a poison message) from wasting work over and over.",
      model: "After this many failed tries a message is set aside as a dead letter.",
      example: { label: "Representative: an Amazon SQS redrive policy", code: "{ \"deadLetterTargetArn\": \"arn:aws:sqs:…:orders-dlq\", \"maxReceiveCount\": \"5\" }" },
    },
    retryDelayMs: {
      kind: "setting",
      where: "In the queue (SQS visibility timeout, delayed retry queues in RabbitMQ) or the worker framework's retry policy.",
      tradeoff: "Longer delays give a failing dependency time to recover but make the work later.",
      model: "A failed message waits this long, then returns to the queue.",
    },
  },
  "object-storage": {
    latencyMs: {
      kind: "property",
      where: "Measured, not configured: it depends on the provider, region, object size and distance.",
      tradeoff: "Putting a CDN in front avoids it for repeated files.",
      model: "A fixed time per file, with unlimited capacity.",
    },
  },
};

export const realWorkload: Record<string, RealSetting> = {
  durationS: { kind: "simulation", where: "In a load test, how long it runs. Real traffic never stops.", tradeoff: "Longer runs show whether a queue keeps growing.", model: "How long clients keep sending; work in progress may finish afterwards." },
  pattern: { kind: "workload", where: "Real arrivals are random and bunch up; load tests can send at an even rate or at random.", tradeoff: "Random arrivals cause waiting even below full capacity.", model: "Steady: evenly spaced. Random: from the seed." },
  seed: { kind: "simulation", where: "Nowhere: it only makes Kitab's random choices repeatable.", tradeoff: "Change it to see whether a result was luck.", model: "The same seed always gives the same run." },
  keys: { kind: "workload", where: "How much distinct data users touch, measured from usage.", tradeoff: "More distinct items means each is less likely to be in a cache.", model: "How many different items reads and writes choose from." },
  skew: { kind: "workload", where: "How popularity is spread, measured from usage: real traffic is usually skewed.", tradeoff: "Skew makes caches effective and makes one partition hot.", model: "Popular follows Zipf: item 1 twice as likely as item 2, and so on." },
  assets: { kind: "workload", where: "How many different static files pages use.", tradeoff: "Fewer distinct files fit in a CDN more easily.", model: "How many different files file requests choose from." },
};

export type RealComponent = {
  /** Software that typically plays this role. */
  software: string;
  /** Where it runs: separate machines, containers, processes, managed services. */
  runsOn: string;
  /** How it talks to its neighbours. */
  talks: string;
};

export const realComponents: Record<ComponentKind, RealComponent> = {
  client: { software: "Web browsers, mobile apps, or another service calling yours.", runsOn: "Users' devices, or another team's servers.", talks: "HTTPS requests over the internet, after DNS turns the name into an address." },
  cdn: { software: "A CDN provider such as Cloudflare, Amazon CloudFront or Fastly.", runsOn: "The provider's servers in many cities, close to users.", talks: "HTTPS from users; fetches missing files from your origin." },
  "load-balancer": { software: "A managed cloud load balancer, or a reverse proxy such as nginx, HAProxy or Envoy.", runsOn: "A managed service, or a process on its own machines or containers.", talks: "Accepts client connections and opens connections to the servers behind it." },
  api: { software: "Your application code in a framework (Express, Django, Spring) run by an application server (Node.js, gunicorn, Tomcat).", runsOn: "Containers or virtual machines, usually several copies.", talks: "HTTP from clients or a load balancer; a database driver, a cache client and a message client to the rest." },
  cache: { software: "Redis or Memcached, or a cache inside the application's own memory.", runsOn: "Its own process, often its own machine or a managed service.", talks: "A small network protocol (Redis's RESP) over TCP from the API servers." },
  sql: { software: "PostgreSQL, MySQL or SQL Server.", runsOn: "A dedicated machine, or a managed service (Amazon RDS, Cloud SQL) with replicas on other machines.", talks: "Its own protocol over TCP, through a connection pool in each application." },
  nosql: { software: "Amazon DynamoDB, Apache Cassandra or MongoDB.", runsOn: "A cluster of machines, or a fully managed service.", talks: "Its own protocol or HTTPS API, through a client library." },
  queue: { software: "RabbitMQ or Amazon SQS. Apache Kafka keeps a log instead of a queue (see Messaging and event streams).", runsOn: "A broker cluster, or a managed service.", talks: "Producers publish over TCP or HTTPS; consumers receive and acknowledge." },
  worker: { software: "A background job runner (Celery, Sidekiq) or a consumer process you write.", runsOn: "Containers or machines separate from the API servers, so slow jobs don't hold up requests.", talks: "Receives from the queue, then writes to a database." },
  "object-storage": { software: "Amazon S3, Google Cloud Storage or Azure Blob Storage.", runsOn: "A provider's managed service.", talks: "HTTPS: put and get files by name." },
};

/** Common server roles the simulator leaves out, so the mental model is complete. */
export const otherRoles: { name: string; role: string; software: string }[] = [
  { name: "Web server", role: "Serves static files and passes other requests on to application servers (as a reverse proxy).", software: "nginx, Apache httpd, Caddy" },
  { name: "Reverse proxy / API gateway", role: "One entrance for many services: TLS, routing, authentication checks and rate limits.", software: "nginx, Envoy, Kong, a cloud API gateway" },
  { name: "DNS server", role: "Turns names such as api.example.com into IP addresses.", software: "A DNS provider (Route 53, Cloudflare DNS), BIND" },
  { name: "Authentication service", role: "Checks who a user is and issues tokens other services trust.", software: "An identity provider (Auth0, Okta, Keycloak) or your own service" },
];
