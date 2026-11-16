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
};
