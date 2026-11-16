// Every architecture lab. Loaded with the lab and lesson pages only; the track uses catalog.ts.
import type { Lab } from "./kernel.ts";
import { idempotencyLab } from "./idempotency.ts";
import { retryStormLab } from "./retry-storm.ts";
import { deadlineLab } from "./deadline.ts";
import { circuitBreakerLab } from "./circuit-breaker.ts";
import { lostUpdateLab } from "./lost-update.ts";
import { duplicateDeliveryLab } from "./duplicate-delivery.ts";
import { hotPartitionLab } from "./hot-partition.ts";
import { outboxLab } from "./outbox.ts";
import { sagaLab } from "./saga.ts";
import { replicationLagLab } from "./replication-lag.ts";

export const labs: Lab[] = [idempotencyLab, retryStormLab, deadlineLab, circuitBreakerLab, lostUpdateLab, duplicateDeliveryLab, hotPartitionLab, outboxLab, sagaLab, replicationLagLab];

export const findLab = (id: string) => labs.find((lab) => lab.id === id);
