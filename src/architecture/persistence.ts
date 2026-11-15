// Saved designs and System Design progress, in this browser only (localStorage). Two additive stores; no other
// Kitab store is read or written here. Entries that can't be read (damaged, or saved by a newer Kitab) are left
// exactly as they are, never overwritten or silently dropped.
import { z } from "zod";
import { DESIGN_FORMAT, MAX_NODES, type Design } from "./model.ts";
import { DesignFormatError, parseDesign } from "./validate.ts";

export const DESIGNS_KEY = "kitab.architecture.designs.v1";
export const PROGRESS_KEY = "kitab.architecture.progress.v1";
export const MAX_DESIGNS = 50;
/** An imported file larger than this is refused before it is parsed. */
export const MAX_IMPORT_BYTES = 200_000;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function newDesignId(random = Math.random, now = Date.now()) {
  return `d-${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}`;
}

/** The raw list: whatever is stored, item by item, so unreadable items survive a save untouched. */
function readRaw(storage: StorageLike): unknown[] {
  try {
    const raw = JSON.parse(storage.getItem(DESIGNS_KEY) ?? "null");
    if (raw && raw.version === 1 && Array.isArray(raw.designs)) return raw.designs;
    if (raw !== null) storage.setItem(`${DESIGNS_KEY}.corrupt`, JSON.stringify(raw).slice(0, 500_000));
  } catch {
    try {
      const text = storage.getItem(DESIGNS_KEY);
      if (text) storage.setItem(`${DESIGNS_KEY}.corrupt`, text.slice(0, 500_000));
    } catch {
      // storage unavailable
    }
  }
  return [];
}

function writeRaw(storage: StorageLike, designs: unknown[]) {
  storage.setItem(DESIGNS_KEY, JSON.stringify({ version: 1, designs }));
}

const idOf = (raw: unknown) => (raw && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : null);

export type SavedDesigns = { designs: Design[]; unreadable: { id: string | null; reason: string }[] };

/** Every saved design, most recently changed first, and what couldn't be read (and why). */
export function loadDesigns(storage: StorageLike): SavedDesigns {
  const designs: Design[] = [];
  const unreadable: SavedDesigns["unreadable"] = [];
  for (const raw of readRaw(storage)) {
    try {
      designs.push(parseDesign(raw));
    } catch (error) {
      unreadable.push({ id: idOf(raw), reason: error instanceof DesignFormatError ? error.message : "Unreadable." });
    }
  }
  designs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { designs, unreadable };
}

/** Insert or replace by id. Returns false (and changes nothing) when storage refuses or the list is full. */
export function saveDesign(storage: StorageLike, design: Design, now = new Date().toISOString()): boolean {
  const saved = { ...design, updatedAt: now };
  parseDesign(saved);
  const raw = readRaw(storage);
  const index = raw.findIndex((item) => idOf(item) === design.id);
  if (index === -1 && raw.length >= MAX_DESIGNS) return false;
  if (index === -1) raw.push(saved);
  else raw[index] = saved;
  try {
    writeRaw(storage, raw);
    return true;
  } catch {
    return false;
  }
}

export function deleteDesign(storage: StorageLike, id: string) {
  try {
    writeRaw(storage, readRaw(storage).filter((item) => idOf(item) !== id));
    return true;
  } catch {
    return false;
  }
}

export function duplicateDesign(storage: StorageLike, design: Design, id = newDesignId(), now = new Date().toISOString()): Design | null {
  const copy: Design = { ...structuredClone(design), id, name: `${design.name} (copy)`.slice(0, 80), createdAt: now, updatedAt: now };
  return saveDesign(storage, copy, now) ? copy : null;
}

export function exportDesign(design: Design) {
  return JSON.stringify(design, null, 2);
}

/** An imported file → a new design (new id), or DesignFormatError explaining why it was refused. */
export function importDesign(text: string, id = newDesignId(), now = new Date().toISOString()): Design {
  if (text.length > MAX_IMPORT_BYTES) throw new DesignFormatError("This file is too large to be a Kitab design.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DesignFormatError("This file isn't valid JSON.");
  }
  if (!raw || typeof raw !== "object" || (raw as { format?: unknown }).format !== DESIGN_FORMAT) throw new DesignFormatError("This file isn't a Kitab architecture design.");
  const nodes = (raw as { nodes?: unknown }).nodes;
  if (Array.isArray(nodes) && nodes.length > MAX_NODES) throw new DesignFormatError(`A design can have at most ${MAX_NODES} components.`);
  const design = parseDesign({ ...raw, id, createdAt: now, updatedAt: now });
  return design;
}

// ---- Progress: challenges passed, and lesson experiments run ----

const challengeRecord = z.object({
  /** The challenge version the record was made against; a new version starts a fresh record. */
  version: z.string().max(20),
  attempts: z.number().int().min(0),
  lastAt: z.string().max(40),
  passedAt: z.string().max(40).optional(),
  /** The learner's working design for this challenge (parsed when used). */
  design: z.unknown().optional(),
  /** The cheapest passing design's cost and p95, for comparing solutions. */
  best: z.object({ cost: z.number(), p95: z.number().nullable() }).strict().optional(),
}).strict();
const progressSchema = z.object({
  version: z.literal(1),
  challenges: z.record(z.string().max(80), challengeRecord),
  lessons: z.record(z.string().max(80), z.object({ experimentAt: z.string().max(40) }).strict()),
}).strict();
export type ArchitectureProgress = z.infer<typeof progressSchema>;
export type ChallengeRecord = z.infer<typeof challengeRecord>;

export const emptyProgress = (): ArchitectureProgress => ({ version: 1, challenges: {}, lessons: {} });

/** Damaged data reads as no progress and is kept aside. */
export function loadArchitectureProgress(storage: StorageLike): ArchitectureProgress {
  let raw: string | null = null;
  try {
    raw = storage.getItem(PROGRESS_KEY);
    if (!raw) return emptyProgress();
    return progressSchema.parse(JSON.parse(raw));
  } catch {
    try {
      if (raw) storage.setItem(`${PROGRESS_KEY}.corrupt`, raw.slice(0, 500_000));
    } catch {
      // storage unavailable
    }
    return emptyProgress();
  }
}

function updateProgress(storage: StorageLike, change: (progress: ArchitectureProgress) => void) {
  const progress = loadArchitectureProgress(storage);
  change(progress);
  try {
    storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // storage full or unavailable: progress is not remembered
  }
  return progress;
}

export function recordExperiment(storage: StorageLike, lessonId: string, now = new Date().toISOString()) {
  return updateProgress(storage, (p) => {
    p.lessons[lessonId] = { experimentAt: now };
  });
}

/** The challenge's record for this version, or a fresh one (an older version's record is not carried over). */
export function challengeRecordFor(progress: ArchitectureProgress, id: string, version: string): ChallengeRecord | undefined {
  const record = progress.challenges[id];
  return record && record.version === version ? record : undefined;
}

export function saveChallengeDesign(storage: StorageLike, id: string, version: string, design: Design, now = new Date().toISOString()) {
  return updateProgress(storage, (p) => {
    const record = challengeRecordFor(p, id, version) ?? { version, attempts: 0, lastAt: now };
    p.challenges[id] = { ...record, lastAt: now, design };
  });
}

export function recordChallengeCheck(storage: StorageLike, id: string, version: string, result: { passed: boolean; cost: number; p95: number | null }, now = new Date().toISOString()) {
  return updateProgress(storage, (p) => {
    const record = challengeRecordFor(p, id, version) ?? { version, attempts: 0, lastAt: now };
    const next: ChallengeRecord = { ...record, attempts: record.attempts + 1, lastAt: now };
    if (result.passed) {
      next.passedAt = record.passedAt ?? now;
      if (!record.best || result.cost < record.best.cost) next.best = { cost: result.cost, p95: result.p95 };
    }
    p.challenges[id] = next;
  });
}
