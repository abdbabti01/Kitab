// The System Design concept units, in no particular order (the track decides the order).
import type { ConceptUnit } from "./types.ts";
import { idempotencyUnit } from "./idempotency.ts";
import { resilienceUnit } from "./resilience.ts";
import { transactionsUnit } from "./transactions.ts";
import { messagingUnit } from "./messaging.ts";

export const conceptUnits: ConceptUnit[] = [idempotencyUnit, resilienceUnit, transactionsUnit, messagingUnit];

export const findConceptUnit = (id: string) => conceptUnits.find((unit) => unit.id === id);
