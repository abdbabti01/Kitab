import { ChevronLeft, ChevronRight } from "lucide-react";
import type { VisualizationSpec } from "../visual-engine/core/visualization-spec.ts";
import { EngineCanvas } from "../visual-engine/engines/EngineCanvas.tsx";

export function ReadingWalkthrough({ spec, index, onChange }: { spec: VisualizationSpec; index: number; onChange: (index: number) => void }) {
  const last = spec.events.length - 1;
  return (
    <div className="card walkthrough">
      <p className="scene-step">Step {index + 1} of {spec.events.length}</p>
      <EngineCanvas spec={spec} eventIndex={index} />
      <div className="playback-row">
        <button type="button" className="icon-button" onClick={() => onChange(index - 1)} disabled={index === 0} aria-label="Previous step"><ChevronLeft aria-hidden="true" /></button>
        <label className="scrubber">
          <span className="sr-only">Walkthrough step</span>
          <input type="range" min={0} max={last} value={index} aria-valuetext={`Step ${index + 1}: ${spec.events[index].label}`} onChange={(event) => onChange(Number(event.target.value))} />
        </label>
        <button type="button" className="icon-button" onClick={() => onChange(index + 1)} disabled={index === last} aria-label="Next step"><ChevronRight aria-hidden="true" /></button>
      </div>
    </div>
  );
}
