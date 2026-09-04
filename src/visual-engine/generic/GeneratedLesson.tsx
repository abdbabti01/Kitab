import { useEffect, useReducer } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  createPlaybackState,
  playbackReducer,
} from "../core/simulation.ts";
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
  visualization: {
    type: string;
    title: string;
    nodes: { label: string; detail: string }[];
    steps: string[];
    actors: { label: string; role: string }[];
    events: {
      from: number;
      to: number;
      label: string;
      detail: string;
      state: string;
    }[];
  };
  _meta?: { source?: string; cached?: boolean; quality?: string };
};

export function GeneratedLesson({
  data,
  close,
}: {
  data: GeneratedLessonData;
  close: () => void;
}) {
  const events = data.visualization.events;
  const [player, dispatch] = useReducer(
    playbackReducer,
    events.length,
    createPlaybackState,
  );
  const event = events[player.index];
  const from = data.visualization.actors[event.from];
  const to = data.visualization.actors[event.to];

  useEffect(() => {
    if (player.status !== "playing") return;
    const timeout = window.setTimeout(
      () => dispatch({ type: "NEXT" }),
      1350 / player.speed,
    );
    return () => window.clearTimeout(timeout);
  }, [player.index, player.speed, player.status]);

  return (
    <main className="generated-lesson">
      <header className="generated-topbar">
        <button type="button" onClick={close}>
          <ArrowLeft aria-hidden="true" />
          <span>Library</span>
        </button>
        <div>
          <span>{data.category} · GENERATED DRAFT</span>
          <h1>{data.title}</h1>
        </div>
        <div className="generated-draft-label">
          <Sparkles aria-hidden="true" />
          <span>AI assisted</span>
        </div>
      </header>

      <section className="generated-intro">
        <div>
          <span>BEGINNER SUMMARY</span>
          <p>{data.summary}</p>
        </div>
        <div>
          <BookOpen aria-hidden="true" />
          <span>
            <b>Mental model</b>
            <p>{data.analogy}</p>
          </span>
        </div>
      </section>

      <section className="generated-workbench">
        <header>
          <div>
            <span>
              EVENT {player.index + 1} / {events.length}
            </span>
            <h2>{event.label}</h2>
            <p>{event.detail}</p>
          </div>
          <aside>
            <span>RESULTING STATE</span>
            <b>{event.state}</b>
          </aside>
        </header>

        <div className="generated-stage" aria-label={data.visualization.title}>
          <div className="generated-actors">
            {data.visualization.actors.map((actor, index) => (
              <article
                className={`${index === event.from ? "source" : ""} ${index === event.to ? "target" : ""}`}
                key={`${actor.label}-${index}`}
              >
                <span>{index + 1}</span>
                <div>
                  <h3>{actor.label}</h3>
                  <p>{actor.role}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="generated-transfer" aria-live="polite">
            <div>
              <span>FROM</span>
              <b>{from.label}</b>
            </div>
            <ArrowRight aria-hidden="true" />
            <strong>{event.label}</strong>
            <ArrowRight aria-hidden="true" />
            <div>
              <span>TO</span>
              <b>{to.label}</b>
            </div>
          </div>
        </div>

        <div className="generated-controls">
          <button type="button" onClick={() => dispatch({ type: "RESET" })}>
            <RotateCcw aria-hidden="true" />
            Reset
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "PREVIOUS" })}
            disabled={player.index === 0}
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => dispatch({ type: "TOGGLE" })}
          >
            {player.status === "playing" ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            {player.status === "playing" ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "NEXT" })}
            disabled={player.index === events.length - 1}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </button>
          <label>
            <span className="sr-only">Walkthrough position</span>
            <input
              type="range"
              min="0"
              max={events.length - 1}
              value={player.index}
              onChange={(change) =>
                dispatch({ type: "SEEK", index: Number(change.target.value) })
              }
            />
          </label>
        </div>
      </section>

      <section className="generated-reading">
        <article>
          {data.sections.map((section, index) => (
            <section key={section.heading}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h2>{section.heading}</h2>
                <p>{section.body}</p>
              </div>
            </section>
          ))}
        </article>
        <aside>
          <h2>Key terms</h2>
          {data.terms.map((term) => (
            <dl key={term.term}>
              <dt>{term.term}</dt>
              <dd>{term.definition}</dd>
            </dl>
          ))}
          <h2>Try it yourself</h2>
          {data.tryIt.map((prompt, index) => (
            <p key={prompt}>
              <b>{index + 1}</b>
              {prompt}
            </p>
          ))}
        </aside>
      </section>
    </main>
  );
}

