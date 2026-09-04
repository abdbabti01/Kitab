import type { Chapter } from "./curated";
import { EngineCanvas } from "./visual-engine/engines/EngineCanvas";
import { visualizationForChapter } from "./visual-engine/lessons/curated-visualizations";

export function LessonEngine({
  chapter,
  step,
  changed,
}: {
  chapter: Chapter;
  step: number;
  changed: boolean;
}) {
  return (
    <EngineCanvas
      spec={visualizationForChapter(chapter)}
      eventIndex={step}
      changed={changed}
    />
  );
}
