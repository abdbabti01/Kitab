import { useEffect, useMemo, useReducer } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { createPlaybackState, playbackReducer } from "../core/simulation.ts";
import {
  normalizeVisualization,
  type EngineKind,
  type RawVisualization,
} from "../core/visualization-spec.ts";
import { EngineCanvas } from "../engines/EngineCanvas.tsx";
import "./generated-lesson.css";

export type GeneratedLessonData = {
  title: string;
  category: string;
  level?: string;
  summary: string;
  analogy: string;
  sections: { heading: string; body: string }[];
  terms: { term: string; definition: string }[];
  tryIt: string[];
  visualization: RawVisualization & { engine?: EngineKind };
  _meta?: { source?: string; cached?: boolean; quality?: string };
};

const engineNames: Record<EngineKind, string> = {
  protocol: "Protocol laboratory",
  request: "Request pipeline",
  memory: "Memory laboratory",
  tree: "Tree and graph explorer",
  execution: "Execution trace",
  concurrency: "Concurrency timeline",
  distributed: "Distributed-system map",
  "state-machine": "State-machine explorer",
};

export function GeneratedLesson({ data, close }: { data: GeneratedLessonData; close: () => void }) {
  const spec = useMemo(
    () => normalizeVisualization(data.visualization, { title: data.title, category: data.category }),
    [data],
  );
  const [player, dispatch] = useReducer(playbackReducer, spec.events.length, createPlaybackState);
  const event = spec.events[player.index];

  useEffect(() => {
    if (player.status !== "playing") return;
    const timeout = window.setTimeout(() => dispatch({ type: "NEXT" }), 1350 / player.speed);
    return () => window.clearTimeout(timeout);
  }, [player.index, player.speed, player.status]);

  return (
    <main className="generated-lesson">
      <header className="generated-topbar">
        <button type="button" onClick={close}><ArrowLeft aria-hidden="true" /><span>Library</span></button>
        <div><span>{data.category} · GENERATED DRAFT</span><h1>{data.title}</h1></div>
        <div className="generated-draft-label"><Sparkles aria-hidden="true" /><span>AI assisted</span></div>
      </header>

      <section className="generated-intro">
        <div><span>BEGINNER SUMMARY</span><p>{data.summary}</p></div>
        <div><BookOpen aria-hidden="true" /><span><b>Mental model</b><p>{data.analogy}</p></span></div>
      </section>

      <section className="generated-workbench">
        <header>
          <div><span>EVENT {player.index + 1} / {spec.events.length}</span><h2>{event.label}</h2><p>{event.detail}</p></div>
          <aside><span>SELECTED VISUAL ENGINE</span><b>{engineNames[spec.engine]}</b><small>Chosen from the lesson mechanism, not from drawing coordinates.</small></aside>
        </header>

        <div className="generated-engine-host">
          <EngineCanvas spec={spec} eventIndex={player.index} />
        </div>

        <nav className="generated-event-rail" aria-label="Simulation events">
          {spec.events.map((item, index) => (
            <button
              type="button"
              className={index === player.index ? "active" : index < player.index ? "complete" : ""}
              onClick={() => dispatch({ type: "SEEK", index })}
              key={item.id}
            >
              <span>{index + 1}</span><b>{item.label}</b><small>{item.state}</small>
            </button>
          ))}
        </nav>

        <div className="generated-controls" aria-label="Lesson playback">
          <button type="button" onClick={() => dispatch({ type: "RESET" })}><RotateCcw aria-hidden="true" />Reset</button>
          <button type="button" onClick={() => dispatch({ type: "PREVIOUS" })} disabled={player.index === 0}><ChevronLeft aria-hidden="true" />Previous</button>
          <button type="button" className="primary" onClick={() => dispatch({ type: "TOGGLE" })}>
            {player.status === "playing" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {player.status === "playing" ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => dispatch({ type: "NEXT" })} disabled={player.index === spec.events.length - 1}>Next<ChevronRight aria-hidden="true" /></button>
          <label><span className="sr-only">Walkthrough position</span><input type="range" min="0" max={spec.events.length - 1} value={player.index} onChange={(change) => dispatch({ type: "SEEK", index: Number(change.target.value) })} /></label>
          <label className="generated-speed"><Gauge aria-hidden="true" /><span>Speed</span><select value={player.speed} onChange={(change) => dispatch({ type: "SET_SPEED", speed: Number(change.target.value) as 0.75 | 1 | 1.5 | 2 })}><option value="0.75">Slow</option><option value="1">Normal</option><option value="1.5">Fast</option><option value="2">2×</option></select></label>
        </div>
      </section>

      <section className="generated-reading">
        <article>
          {data.sections.map((section, index) => (
            <section key={section.heading}><span>{String(index + 1).padStart(2, "0")}</span><div><h2>{section.heading}</h2><p>{section.body}</p></div></section>
          ))}
        </article>
        <aside>
          <h2>Key terms</h2>
          {data.terms.map((term) => <dl key={term.term}><dt>{term.term}</dt><dd>{term.definition}</dd></dl>)}
          <h2>Try it yourself</h2>
          {data.tryIt.map((prompt, index) => <p key={prompt}><b>{index + 1}</b>{prompt}</p>)}
        </aside>
      </section>
    </main>
  );
}
