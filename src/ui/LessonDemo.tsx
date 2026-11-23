import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import "../learning/engines/eager.ts";
import { buildTrace } from "../learning/registry.ts";
import { sceneFor } from "../mission/scenes/index.ts";
import { engineParams, type Setup } from "../structures/experiments.ts";
import { ExploreLink } from "./ExploreLink.tsx";
import type { ConceptLearn } from "../learning/concept-learn.ts";

/**
 * A lesson's one demonstration: a fixed setup run by the same engine and drawn by the same scene as the Playground,
 * stepped with Previous and Next only. Changing inputs, playback, memory tables and costs live in the Playground,
 * which the Explore link opens on this exact setup.
 */
export function LessonDemo({ setup, explore }: { setup: Setup; explore?: ConceptLearn["explore"] }) {
  const trace = useMemo(() => {
    const { engine, params } = engineParams(setup);
    return buildTrace(engine, params);
  }, [setup]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const frame = trace.frames[index];
  const last = trace.frames.length - 1;
  const Scene = sceneFor(trace.engine.id)!.Scene;
  return (
    <div className="lesson-demo card">
      <p className="demo-kind">Deterministic simulation · computed by Kitab's engine</p>
      <div className="demo-step" aria-live="polite">
        <p className="demo-count">Step {index + 1} of {trace.frames.length}</p>
        <h3>{frame.title}</h3>
        <p>{frame.narration}</p>
      </div>
      <div className="demo-scene scene-body">
        <Scene frame={frame} trace={trace} selected={selected} attention={null} onSelect={(id) => setSelected((current) => (current === id ? null : id))} />
      </div>
      <div className="demo-controls" role="group" aria-label="Demonstration steps">
        <button type="button" className="button" onClick={() => setIndex(index - 1)} disabled={index === 0}><ChevronLeft aria-hidden="true" /> Previous</button>
        {index < last
          ? <button type="button" className="button primary" onClick={() => setIndex(index + 1)}>Next <ChevronRight aria-hidden="true" /></button>
          : <button type="button" className="button" onClick={() => setIndex(0)}><RotateCcw aria-hidden="true" /> Watch again</button>}
      </div>
      {explore && <ExploreLink explore={explore} />}
    </div>
  );
}
