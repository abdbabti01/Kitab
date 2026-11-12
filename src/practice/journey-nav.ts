// Pure parts of Follow the Journey: where Previous/Next go, and where the card is placed.
import { stageAt, type Stage } from "./network/stages.ts";

/** Exchange moves by stage like Summary and adds the sequence diagram under the controls. */
export type JourneyMode = "summary" | "events" | "exchange";
export const MODE_KEY = "kitab.network.journeyMode";
export type Point = { x: number; y: number };

/** Where Previous and Next go: by event in Every event, otherwise by stage. */
export function neighbours(mode: JourneyMode, stages: Stage[], index: number, last: number) {
  if (mode === "events" || !stages.length) return { prev: Math.max(0, index - 1), next: Math.min(last, index + 1) };
  const k = stageAt(stages, index);
  return {
    // Back to the end of the previous stage; from the first stage, back to the start.
    prev: index > stages[k].end ? stages[k].end : k > 0 ? stages[k - 1].end : 0,
    // Finish the current stage first if it is in progress.
    next: index < stages[k].end ? stages[k].end : (stages[k + 1]?.end ?? last),
  };
}

export type Rect = { x: number; y: number; w: number; h: number };
/**
 * Picks where the card goes: beside the anchor device if that is clear, otherwise the nearest spot
 * on a coarse grid that covers none of the stage's devices and none of the canvas controls.
 */
export function place(
  anchor: Point,
  box: { w: number; h: number },
  area: { w: number; h: number },
  avoid: Point[],
  controls: Rect[],
  /** Devices outside the stage: covering them is allowed, but they must stay clickable when possible. */
  others: Point[] = [],
  /** Pixels per diagram unit: device tiles shrink and grow with the canvas. */
  scale = 1,
  /** The drawing's band inside the area: the canvas's own bars above and below it are not places for the card. */
  band = { top: 0, bottom: 0 },
): Point & { score: number } {
  // Clear of the tile, which reaches 70 units to each side.
  const gap = 76;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const top = band.top + 8,
    right = area.w - box.w - 8,
    bottom = Math.max(top, area.h - band.bottom - box.h - 8);
  const grid = [0, 0.25, 0.5, 0.75, 1].flatMap((fx) => [0, 0.5, 1].map((fy) => ({ x: 8 + fx * (right - 8), y: top + fy * (bottom - top) })));
  const candidates = [
    { x: anchor.x + gap, y: anchor.y - box.h / 2 },
    { x: anchor.x - gap - box.w, y: anchor.y - box.h / 2 },
    { x: anchor.x - box.w / 2, y: anchor.y + gap + 30 },
    { x: anchor.x - box.w / 2, y: anchor.y - gap - box.h },
    ...grid,
  ].map((c) => ({ x: clamp(c.x, 8, right), y: clamp(c.y, top, bottom) }));
  // A device tile spans 60 units either side of its centre, 50 above it and 97 below (its name and address).
  // (Drawn 15% larger since the diagram redesign: 70 either side, 58 above and 120 below.)
  const covers = (c: Point, p: Point) =>
    p.x + 70 * scale > c.x && p.x - 70 * scale < c.x + box.w && p.y + 120 * scale > c.y && p.y - 58 * scale < c.y + box.h;
  const overlaps = (c: Point, r: Rect) => c.x < r.x + r.w && c.x + box.w > r.x && c.y < r.y + r.h && c.y + box.h > r.y;
  // Beside the device wins whenever it is clear; grid spots are fallbacks, nearest first.
  const score = (c: Point, i: number) =>
    avoid.filter((p) => covers(c, p)).length * 10 +
    others.filter((p) => covers(c, p)).length * 2 +
    controls.filter((r) => overlaps(c, r)).length * 20 +
    (covers(c, anchor) ? 50 : 0) +
    (i >= 4 ? 1 : 0) +
    Math.hypot(c.x - anchor.x, c.y - anchor.y) / 1000;
  let best = 0;
  candidates.forEach((c, i) => {
    if (score(c, i) < score(candidates[best], best)) best = i;
  });
  return { ...candidates[best], score: score(candidates[best], best) };
}
