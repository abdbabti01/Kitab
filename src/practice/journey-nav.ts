// Pure parts of Follow the Journey: where Previous/Next go, and where the card is placed.
import { stageAt, type Stage } from "./network/stages.ts";

export type JourneyMode = "summary" | "events";
export const MODE_KEY = "kitab.network.journeyMode";
export type Point = { x: number; y: number };

/** Where Previous and Next go: by stage in Summary, by event in Every event. */
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
export function place(anchor: Point, box: { w: number; h: number }, area: { w: number; h: number }, avoid: Point[], controls: Rect[]) {
  const gap = 66;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const right = area.w - box.w - 8,
    bottom = area.h - box.h - 8;
  const grid = [0, 0.25, 0.5, 0.75, 1].flatMap((fx) => [0, 0.5, 1].map((fy) => ({ x: 8 + fx * (right - 8), y: 8 + fy * (bottom - 8) })));
  const candidates = [
    { x: anchor.x + gap, y: anchor.y - box.h / 2 },
    { x: anchor.x - gap - box.w, y: anchor.y - box.h / 2 },
    { x: anchor.x - box.w / 2, y: anchor.y + gap + 30 },
    { x: anchor.x - box.w / 2, y: anchor.y - gap - box.h },
    ...grid,
  ].map((c) => ({ x: clamp(c.x, 8, right), y: clamp(c.y, 8, bottom) }));
  // A device tile is about 110 × 140 px around its centre, including its name.
  const covers = (c: Point, p: Point) => p.x > c.x - 55 && p.x < c.x + box.w + 55 && p.y > c.y - 50 && p.y < c.y + box.h + 90;
  const overlaps = (c: Point, r: Rect) => c.x < r.x + r.w && c.x + box.w > r.x && c.y < r.y + r.h && c.y + box.h > r.y;
  // Beside the device wins whenever it is clear; grid spots are fallbacks, nearest first.
  const score = (c: Point, i: number) =>
    avoid.filter((p) => covers(c, p)).length * 10 +
    controls.filter((r) => overlaps(c, r)).length * 20 +
    (covers(c, anchor) ? 50 : 0) +
    (i >= 4 ? 1 : 0) +
    Math.hypot(c.x - anchor.x, c.y - anchor.y) / 1000;
  let best = 0;
  candidates.forEach((c, i) => {
    if (score(c, i) < score(candidates[best], best)) best = i;
  });
  return candidates[best];
}
