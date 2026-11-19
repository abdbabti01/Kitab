// Saved Engineering Lab work, kitab.engineering-labs.v1, through the shared keyed store (record by record; damaged
// records kept aside; another tab's records never overwritten). Per lab: the learner's code or request drafts,
// which tasks passed, hints shown, whether a Check was attempted, and completion. Run output and HTTP responses
// are never saved, so an old result can't come back looking current. Completion and passed tasks only ever grow:
// a save from another tab, or a reset, never takes them away.
import { z } from "zod";
import { readStore, updateStore, type StorageLike } from "../learning/keyed-store.ts";
import { METHODS } from "./model.ts";

export const LAB_PROGRESS_KEY = "kitab.engineering-labs.v1";
const VERSION = 1;

const draftSchema = z.object({
  method: z.enum(METHODS as [string, ...string[]]),
  path: z.string().max(500),
  headers: z.array(z.object({ name: z.string().max(200), value: z.string().max(2000) })).max(20),
  body: z.string().max(8192),
  timeoutMs: z.number().min(0).max(60_000),
  cache: z.enum(["no-store", "default"]),
});

const record = z.looseObject({
  labVersion: z.number().int().min(1),
  code: z.string().max(50_000).optional(),
  drafts: z.record(z.string(), draftSchema).optional(),
  task: z.string().max(100).optional(),
  tasksDone: z.array(z.string().max(100)).max(50),
  hints: z.number().int().min(0).max(50),
  attempted: z.boolean(),
  completedAt: z.number().optional(),
  updatedAt: z.number(),
});
const meta = z.looseObject({ labId: z.string().max(100), at: z.number() });
const collections = { labs: record, meta };

export type LabRecord = z.infer<typeof record>;
export type LabState = "not-started" | "in-progress" | "completed";
export const labStateLabel: Record<LabState, string> = { "not-started": "Not started", "in-progress": "In progress", completed: "Completed" };

export function readLabs(storage: StorageLike) {
  return readStore(storage, LAB_PROGRESS_KEY, VERSION, collections);
}

export const stateOf = (r: LabRecord | undefined): LabState => (!r ? "not-started" : r.completedAt ? "completed" : "in-progress");

export const emptyRecord = (labVersion: number): LabRecord => ({ labVersion, tasksDone: [], hints: 0, attempted: false, updatedAt: Date.now() });

/**
 * Apply `change` to one lab's latest saved record and save it, also remembering it as the last lab opened.
 * Completion and passed tasks recorded by another tab are kept. saved: false when storage refused.
 */
export function saveLab(storage: StorageLike, labId: string, labVersion: number, change: (current: LabRecord) => LabRecord) {
  let next: LabRecord | undefined;
  const { saved } = updateStore(storage, LAB_PROGRESS_KEY, VERSION, collections, (records) => {
    const current = records.labs[labId] ?? emptyRecord(labVersion);
    const changed = change({ ...current, tasksDone: [...current.tasksDone] });
    next = {
      ...changed,
      tasksDone: [...new Set([...current.tasksDone, ...changed.tasksDone])],
      completedAt: current.completedAt ?? changed.completedAt,
      updatedAt: Date.now(),
    };
    records.labs[labId] = next;
    records.meta.last = { labId, at: Date.now() };
  });
  return { saved, record: next! };
}

/** Remember the lab as the last one opened, without starting a record for it. */
export function rememberOpened(storage: StorageLike, labId: string) {
  return updateStore(storage, LAB_PROGRESS_KEY, VERSION, collections, (records) => {
    records.meta.last = { labId, at: Date.now() };
  }).saved;
}

/** The last lab opened that still exists, for "Continue". */
export function lastLab(storage: StorageLike, exists: (id: string) => boolean) {
  const { records } = readLabs(storage);
  const last = records.meta.last;
  return last && exists(last.labId) ? last.labId : undefined;
}
