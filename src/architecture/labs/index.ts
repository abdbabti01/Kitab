// Every architecture lab. Loaded with the lab and lesson pages only; the track uses catalog.ts.
import type { Lab } from "./kernel.ts";
import { idempotencyLab } from "./idempotency.ts";

export const labs: Lab[] = [idempotencyLab];

export const findLab = (id: string) => labs.find((lab) => lab.id === id);
