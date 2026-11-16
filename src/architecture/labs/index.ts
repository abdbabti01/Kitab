// Every architecture lab. Loaded with the lab and lesson pages only; the track uses catalog.ts.
import type { Lab } from "./kernel.ts";
import { idempotencyLab } from "./idempotency.ts";
import { retryStormLab } from "./retry-storm.ts";
import { deadlineLab } from "./deadline.ts";
import { circuitBreakerLab } from "./circuit-breaker.ts";

export const labs: Lab[] = [idempotencyLab, retryStormLab, deadlineLab, circuitBreakerLab];

export const findLab = (id: string) => labs.find((lab) => lab.id === id);
