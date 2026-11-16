// The System Design concept units, in no particular order (the track decides the order).
import type { ConceptUnit } from "./types.ts";
import { idempotencyUnit } from "./idempotency.ts";

export const conceptUnits: ConceptUnit[] = [idempotencyUnit];

export const findConceptUnit = (id: string) => conceptUnits.find((unit) => unit.id === id);
