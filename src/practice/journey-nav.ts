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
