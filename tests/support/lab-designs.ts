// For every lab: designs that must pass every check, and plausible wrong designs with the exact checks they must
// fail (so each fails for the right reason). Values are applied over the lab's starter.
import type { LabConfig } from "../../src/architecture/labs/kernel.ts";

type Expectation = { pass: LabConfig[]; fail: { why: string; config: LabConfig; failing: string[] }[] };

const everyScenario = (ids: string[], check: string) => ids.map((id) => `${id}:${check}`);

export const labExpectations: Record<string, Expectation> = {
  "idempotent-payments": {
    pass: [
      { keyMode: "per-order", store: "atomic", forwardKey: true, retries: 3, retryDelayMs: 500, leaseMs: 2000 },
      { keyMode: "per-order", store: "atomic", forwardKey: true, retries: 3, timeoutMs: 2000, retryDelayMs: 1000, leaseMs: 2500 },
      { keyMode: "per-order", store: "atomic", forwardKey: true, retries: 2, timeoutMs: 1000, retryDelayMs: 300, leaseMs: 1600 },
    ],
    fail: [
      { why: "no retries: nothing is duplicated, but a lost answer leaves the customer unsure", config: { keyMode: "per-order", store: "atomic", forwardKey: true, retries: 0, leaseMs: 2000 }, failing: ["lost-response:confirmed", "slow-provider:confirmed", "crash:receipt", "crash:confirmed"] },
      { why: "a new key per attempt makes every retry a new payment", config: { keyMode: "per-attempt", store: "atomic", forwardKey: true, retries: 3, retryDelayMs: 500, leaseMs: 2000 }, failing: [...everyScenario(["lost-response", "slow-provider", "double-click", "crash"], "once"), ...everyScenario(["lost-response", "slow-provider", "double-click"], "receipt")] },
      { why: "a key per click survives retries but not a double click", config: { keyMode: "per-click", store: "atomic", forwardKey: true, retries: 3, retryDelayMs: 500, leaseMs: 2000 }, failing: ["double-click:once", "double-click:receipt"] },
      { why: "keys in each server's memory: the retry reaches the other server", config: { keyMode: "per-order", store: "memory", retries: 3, retryDelayMs: 500 }, failing: [...everyScenario(["lost-response", "slow-provider", "double-click", "crash"], "once"), ...everyScenario(["lost-response", "slow-provider", "double-click"], "receipt")] },
      { why: "check-then-insert races with a slow first request and a double click", config: { keyMode: "per-order", store: "check-then-insert", retries: 3, retryDelayMs: 500 }, failing: ["slow-provider:once", "slow-provider:receipt", "double-click:once", "double-click:receipt", "crash:once"] },
      { why: "only the provider dedupes: the charge is once, the API's receipt is not", config: { keyMode: "per-order", forwardKey: true, retries: 3, retryDelayMs: 500 }, failing: ["lost-response:receipt", "slow-provider:receipt", "double-click:receipt"] },
      { why: "an atomic store without forwarding the key can't recover the crash", config: { keyMode: "per-order", store: "atomic", retries: 3, retryDelayMs: 500, leaseMs: 2000 }, failing: ["crash:once"] },
      { why: "a lease that never expires in time leaves the crashed payment stuck", config: { keyMode: "per-order", store: "atomic", forwardKey: true, retries: 2, leaseMs: 30000 }, failing: ["crash:receipt", "crash:confirmed"] },
      { why: "a lease shorter than the slow request lets a second server take over (the provider saves the charge)", config: { keyMode: "per-order", store: "atomic", forwardKey: true, retries: 3, retryDelayMs: 500, leaseMs: 1000 }, failing: ["slow-provider:receipt"] },
    ],
  },
  "retry-storm": {
    pass: [
      { policy: "exponential-jitter", timeoutMs: 2000 },
      { policy: "exponential-jitter", baseMs: 500, timeoutMs: 2000, attempts: 6 },
      { policy: "exponential-jitter", baseMs: 2000, timeoutMs: 2000 },
    ],
    fail: [
      { why: "no retries: every request that meets an outage fails", config: { policy: "none" }, failing: ["outage:served", "long-outage:served", "restart:served"] },
      { why: "immediate retries are spent during the outage", config: { policy: "immediate", attempts: 8, timeoutMs: 2000 }, failing: ["outage:served", "long-outage:served", "restart:served"] },
      { why: "jitter alone: the queue's wait outlives the 1 s timeout, so the server works for clients that left", config: { policy: "exponential-jitter" }, failing: ["long-outage:served", "long-outage:recovers", "long-outage:wasted", "restart:served", "restart:recovers", "restart:wasted"] },
      { why: "backoff without jitter: the reconnecting clients return as one wave", config: { timeoutMs: 2000 }, failing: ["restart:spread"] },
      { why: "a fixed wait keeps the herd together and retries too often", config: { policy: "fixed", baseMs: 1000, timeoutMs: 2000, attempts: 8 }, failing: ["long-outage:recovers", "restart:spread", "restart:recovers"] },
      { why: "a retry budget protects the server but gives up on requests a short outage could have saved", config: { policy: "exponential-jitter", timeoutMs: 2000, budget: true }, failing: ["outage:served", "long-outage:served", "restart:served"] },
    ],
  },
  "deadline-budget": {
    pass: [
      { propagate: true },
      { gatewayRetries: 0, serviceRetries: 2, propagate: true },
      { gatewayRetries: 1, serviceRetries: 1, propagate: true },
      { gatewayRetries: 0, serviceRetries: 2, serviceTimeoutMs: 800, propagate: true },
    ],
    fail: [
      { why: "no retries: a flaky database fails one request in five", config: { gatewayRetries: 0, serviceRetries: 0, propagate: true }, failing: ["flaky:served"] },
      { why: "retries at one layer, but without a deadline the database serves calls for users who left", config: { gatewayRetries: 0, serviceRetries: 2 }, failing: ["slow:wasted"] },
      { why: "short timeouts retry on every slow call and multiply the load, even with deadlines", config: { gatewayRetries: 0, serviceRetries: 2, serviceTimeoutMs: 300, propagate: true }, failing: ["slow:amplification", "slow:wasted", "slow:recovers"] },
      { why: "gateway retries on short timeouts, no deadline", config: { gatewayRetries: 2, gatewayTimeoutMs: 900, serviceRetries: 0, serviceTimeoutMs: 800 }, failing: ["slow:amplification", "slow:wasted", "slow:recovers"] },
    ],
  },
  "circuit-breaker": {
    pass: [
      { timeoutMs: 200, fallback: true, breaker: true, openMs: 1000 },
      { timeoutMs: 500, fallback: true, breaker: true, openMs: 1000 },
      { recSlots: 10, timeoutMs: 1000, fallback: true, breaker: true, openMs: 1000 },
    ],
    fail: [
      { why: "a short timeout protects the pool, but panels show errors and the failing service still gets every call", config: { timeoutMs: 200 }, failing: ["hang:panels", "hang:relief", "errors:panels", "errors:relief", "slow:panels", "slow:relief"] },
      { why: "timeout and fallback, but no breaker: the failing service still gets every call", config: { timeoutMs: 200, fallback: true }, failing: ["hang:relief", "errors:relief", "slow:relief"] },
      { why: "a bulkhead caps waiting calls, but fast errors still flood the service", config: { recSlots: 10, fallback: true }, failing: ["errors:relief"] },
      { why: "a bulkhead without a short timeout stays full of hung calls after the service recovers", config: { recSlots: 10, fallback: true, breaker: true, openMs: 1000 }, failing: ["hang:resume"] },
      { why: "a long open period keeps refusing after the service has recovered", config: { timeoutMs: 200, fallback: true, breaker: true, openMs: 5000 }, failing: ["hang:resume", "errors:resume", "slow:resume"] },
    ],
  },
  "lost-update": {
    pass: [
      { strategy: "atomic" },
      { strategy: "pessimistic", slowFirst: true },
      { strategy: "optimistic", retries: 8, slowFirst: true },
      { isolation: "repeatable-read", retries: 8, slowFirst: true },
    ],
    fail: [
      { why: "read-then-write under READ COMMITTED loses decrements and oversells", config: {}, failing: ["flash-sale:consistent", "flash-sale:oversell", "busy-day:consistent", "slow-check:consistent"] },
      { why: "version checks without retries turn conflicts into errors", config: { strategy: "optimistic" }, failing: ["flash-sale:answered", "busy-day:answered", "slow-check:answered"] },
      { why: "a few retries aren't enough for a flash sale's contention", config: { strategy: "optimistic", retries: 3, slowFirst: true }, failing: ["flash-sale:answered"] },
      { why: "a lock held through the slow check queues everyone", config: { strategy: "pessimistic" }, failing: ["slow-check:answered", "slow-check:fast"] },
      { why: "optimistic control with the slow check inside the window conflicts almost every time", config: { strategy: "optimistic", retries: 8 }, failing: ["slow-check:answered", "slow-check:fast"] },
    ],
  },
  "duplicate-delivery": {
    pass: [
      { dedup: "same-tx", key: "event" },
      { effect: "upsert" },
      { dedup: "same-tx", key: "event", visibilityMs: 30000 },
    ],
    fail: [
      { why: "acknowledging first loses the crashed message and still double-counts a republished event", config: { ack: "before" }, failing: ["crash-before-commit:all", "republished:once"] },
      { why: "memory is lost in the crash and isn't shared between consumers", config: { dedup: "memory", key: "event" }, failing: ["crash-after-commit:once", "slow:once", "republished:once"] },
      { why: "recording in a second transaction leaves a gap", config: { dedup: "separate", key: "event" }, failing: ["crash-after-commit:once", "slow:once", "republished:once"] },
      { why: "the broker's id differs for a republished event", config: { dedup: "same-tx" }, failing: ["republished:once"] },
      { why: "a longer visibility timeout avoids one redelivery, not crashes or republishing", config: { visibilityMs: 30000 }, failing: ["crash-after-commit:once", "republished:once"] },
    ],
  },
  "hot-partition": {
    pass: [
      { key: "order" },
      { key: "merchant-bucket", buckets: 8 },
      { key: "order", partitions: 12, consumers: 12 },
    ],
    fail: [
      { why: "more consumers than partitions sit idle; the hot partition stays hot", config: { consumers: 16 }, failing: ["normal:lag", "normal:cost", "sale:lag", "sale:cost"] },
      { why: "more partitions don't split one key", config: { partitions: 32, consumers: 12 }, failing: ["normal:lag", "sale:lag"] },
      { why: "a random salt balances but scatters an order's events", config: { key: "merchant-salt" }, failing: ["normal:order", "sale:lag", "sale:order"] },
      { why: "no key at all: fine until the load rises, then events overtake each other", config: { key: "random" }, failing: ["sale:order"] },
      { why: "four buckets still leave the merchant's sale on too few partitions", config: { key: "merchant-bucket", buckets: 4 }, failing: ["sale:lag"] },
    ],
  },
  outbox: {
    pass: [
      { strategy: "outbox", pollMs: 500, dedup: true },
      { strategy: "outbox", pollMs: 1500, dedup: true },
      { strategy: "cdc", dedup: true },
    ],
    fail: [
      { why: "publishing first ships a rolled-back order and refuses orders while the broker is down", config: { strategy: "before-commit" }, failing: ["commit-fails:ghost", "broker-down:accepted"] },
      { why: "an inbox doesn't help events that were never published", config: { dedup: true }, failing: ["crash:shipped", "broker-down:shipped"] },
      { why: "the relay publishes at least once: shipping must deduplicate", config: { strategy: "cdc" }, failing: ["relay-crash:once"] },
      { why: "a slow poll delays every event", config: { strategy: "outbox", pollMs: 2500, dedup: true }, failing: ["crash:prompt", "commit-fails:prompt", "broker-down:prompt", "relay-crash:prompt"] },
    ],
  },
  saga: {
    pass: [
      { compensation: "retry", state: "log", stepKeys: true },
      { compensation: "retry", state: "events", stepKeys: true },
    ],
    fail: [
      { why: "compensations that give up leave the refund undone", config: { compensation: "once", state: "log", stepKeys: true }, failing: ["refund-glitch:consistent", "refund-glitch:final"] },
      { why: "progress in memory is lost in the crash", config: { compensation: "retry", stepKeys: true }, failing: ["crash:consistent", "crash:final"] },
      { why: "resuming without step keys charges again", config: { compensation: "retry", state: "log" }, failing: ["crash:consistent", "crash:charged-once"] },
      { why: "no compensations at all", config: { state: "log", stepKeys: true }, failing: ["declined:consistent", "declined:final", "no-courier:consistent", "no-courier:final", "refund-glitch:consistent", "refund-glitch:final"] },
    ],
  },
  "replication-lag": {
    pass: [
      { afterWrite: "lsn" },
      { routing: "sticky", afterWrite: "lsn" },
      { afterWrite: "window", windowMs: 1500 },
      { routing: "sticky", afterWrite: "window", windowMs: 1500 },
    ],
    fail: [
      { why: "all reads on the primary: consistent, but the replicas do nothing", config: { routing: "primary" }, failing: ["normal:offload", "lagging:offload", "replica-down:offload"] },
      { why: "pinned to one replica: never back in time, but behind her own writes", config: { routing: "sticky" }, failing: ["normal:ryw", "lagging:ryw", "replica-down:ryw"] },
      { why: "a primary window shorter than the lag", config: { afterWrite: "window", windowMs: 1000 }, failing: ["lagging:monotonic"] },
      { why: "synchronous replication waits for the slowest replica and fails when one is down", config: { replication: "sync" }, failing: ["lagging:monotonic", "lagging:writes", "replica-down:writes"] },
    ],
  },
  "fencing-token": {
    pass: [
      { lock: "fencing" },
      { lock: "fencing", leaseMs: 1000 },
      { lock: "cas" },
      { lock: "cas", leaseMs: 500 },
    ],
    fail: [
      { why: "no lock: concurrent read-modify-writes lose an increment even on a normal night", config: { lock: "none" }, failing: ["normal:no-lost", "gc-pause:no-lost", "slow-network:no-lost", "slow-clock:no-lost"] },
      { why: "checking your own lease can't close the gap before the write lands", config: { lock: "lease-check" }, failing: ["gc-pause:no-lost", "slow-network:no-lost", "slow-clock:no-lost"] },
      { why: "a lease shorter than the job: fencing keeps rejecting, nothing finishes", config: { lock: "fencing", leaseMs: 500 }, failing: ["normal:finished", "crash:finished"] },
      { why: "a long lease hides the pauses but blocks everyone behind a crashed holder", config: { leaseMs: 10000 }, failing: ["crash:finished"] },
    ],
  },
  "cache-stampede": {
    pass: [
      { coalesce: "global", refresh: "stale", jitterPercent: 50 },
      { coalesce: "global", refresh: "stale", jitterPercent: 50, ttlS: 20 },
      { coalesce: "global", refresh: "ahead", jitterPercent: 50, ttlS: 20 },
    ],
    fail: [
      { why: "per-server coalescing: one query per server per key, and many keys expire together", config: { coalesce: "server" }, failing: ["mass-expiry:db", "mass-expiry:p99"] },
      { why: "coalesced and jittered, but users still wait for each refresh", config: { coalesce: "global", jitterPercent: 50 }, failing: ["hot-key:p99", "mass-expiry:p99"] },
      { why: "serving stale without coalescing: every request refreshes", config: { refresh: "stale", jitterPercent: 50 }, failing: ["hot-key:db", "mass-expiry:db", "mass-expiry:fresh"] },
      { why: "no jitter: 200 keys expire together", config: { coalesce: "global", refresh: "stale" }, failing: ["mass-expiry:db", "mass-expiry:fresh"] },
      { why: "too little jitter for 200 keys", config: { coalesce: "global", refresh: "stale", jitterPercent: 40 }, failing: ["mass-expiry:db"] },
    ],
  },
  "rate-limit": {
    pass: [
      { limiter: "sliding", shedMs: 200 },
      { limiter: "token", rate: 10, burst: 20, shedMs: 200 },
      { limiter: "fixed", rate: 15, shedMs: 200 },
    ],
    fail: [
      { why: "a fixed window lets the partner double its limit around each boundary", config: { limiter: "fixed", shedMs: 200 }, failing: ["boundary:partner"] },
      { why: "limits without shedding: genuine overload still makes everyone wait", config: { limiter: "sliding" }, failing: ["viral:fast", "viral:nobody-waits-in-vain"] },
      { why: "shedding alone: the scraper takes most of what's accepted", config: { shedMs: 200 }, failing: ["scraper:users", "scraper:share", "boundary:users", "boundary:partner"] },
      { why: "a bucket smaller than a page load rate-limits normal users", config: { limiter: "token", rate: 5, burst: 8, shedMs: 200 }, failing: ["scraper:users", "boundary:users"] },
      { why: "a queue allowed to hold 500 ms of work is too long for p99", config: { limiter: "token", rate: 10, burst: 20, shedMs: 500 }, failing: ["viral:fast"] },
    ],
  },
};
