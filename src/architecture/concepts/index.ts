// The System Design concept units, in no particular order (the track decides the order).
import type { ConceptUnit } from "./types.ts";
import { idempotencyUnit } from "./idempotency.ts";
import { resilienceUnit } from "./resilience.ts";
import { transactionsUnit } from "./transactions.ts";
import { messagingUnit } from "./messaging.ts";
import { dataAcrossServicesUnit } from "./data-across-services.ts";
import { consistencyUnit } from "./consistency.ts";
import { coordinationUnit } from "./coordination.ts";
import { performanceUnit } from "./performance.ts";
import { overloadUnit } from "./overload.ts";

export const conceptUnits: ConceptUnit[] = [idempotencyUnit, resilienceUnit, transactionsUnit, messagingUnit, dataAcrossServicesUnit, consistencyUnit, coordinationUnit, performanceUnit, overloadUnit];

export const findConceptUnit = (id: string) => conceptUnits.find((unit) => unit.id === id);
