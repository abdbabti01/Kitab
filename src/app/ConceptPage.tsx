import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Info } from "lucide-react";
import type { Chapter } from "../content/chapters.ts";
import { missions } from "../learning/missions/catalog.ts";
import { EngineCanvas } from "../visual-engine/engines/EngineCanvas.tsx";
import { visualizationForChapter } from "../visual-engine/lessons/curated-visualizations.ts";
import { linkProps } from "./router.ts";

/** Curated concept walkthrough. Honest label: it is illustrative unless a mission computes it. */
export function ConceptPage({ chapter }: { chapter: Chapter }) {
  const spec = useMemo(() => visualizationForChapter(chapter), [chapter]);
  const [index, setIndex] = useState(0);
  const related = missions.filter((mission) => mission.concept === chapter.slug);
  const step = chapter.steps[index];
  useEffect(() => { document.title = `${chapter.title} · Kitab`; }, [chapter]);

  return (
    <div className="concept-page">
      <header className="topbar">
        <a className="back" {...linkProps("/")}><ArrowLeft aria-hidden="true" /> <span>Kitab</span></a>
        <p className="crumb">{chapter.family} · Concept</p>
      </header>
      <main id="main" className="page">
        <h1>{chapter.title}</h1>
        <p className="lead">{chapter.summary}</p>
        <p className="analogy"><b>Mental model.</b> {chapter.analogy}</p>

        {related.length > 0 && (
          <section className="section" aria-labelledby="practice">
            <h2 id="practice">Practice with a mission</h2>
            <ul className="mission-grid">
              {related.map((mission) => (
                <li key={mission.id}>
                  <a className="mission-card" {...linkProps(`/missions/${mission.id}`)}>
                    <b>{mission.title}</b>
                    <span>{mission.summary}</span>
                    <small>Computed by Kitab · reviewed <ArrowRight aria-hidden="true" className="inline-icon" /></small>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="section" aria-labelledby="walkthrough">
          <h2 id="walkthrough">Walkthrough</h2>
          <p className="notice"><Info aria-hidden="true" /> Illustrative walkthrough: reviewed explanations arranged as steps. It is not a computed simulation{related.length ? " — the missions above are." : "."}</p>
          <div className="card walkthrough">
            <p className="scene-step">Step {index + 1} of {chapter.steps.length}</p>
            <h3 className="scene-title">{step.title}</h3>
            <p>{step.detail}</p>
            <EngineCanvas spec={spec} eventIndex={index} />
            <div className="playback-row">
              <button type="button" className="icon-button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} aria-label="Previous step"><ChevronLeft aria-hidden="true" /></button>
              <label className="scrubber">
                <span className="sr-only">Walkthrough step</span>
                <input type="range" min={0} max={chapter.steps.length - 1} value={index} aria-valuetext={`Step ${index + 1}: ${step.title}`} onChange={(event) => setIndex(Number(event.target.value))} />
              </label>
              <button type="button" className="icon-button" onClick={() => setIndex((value) => Math.min(chapter.steps.length - 1, value + 1))} disabled={index === chapter.steps.length - 1} aria-label="Next step"><ChevronRight aria-hidden="true" /></button>
            </div>
          </div>
          <aside className="what-if">
            <h3>What if: {chapter.experiment.toLowerCase()}?</h3>
            <p>{chapter.changed}</p>
            <p className="muted small">Described, not simulated.</p>
          </aside>
        </section>
      </main>
    </div>
  );
}
