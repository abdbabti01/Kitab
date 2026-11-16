import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, FlaskConical, Play, Workflow } from "lucide-react";
import { safeStorage } from "../../learning/progress.ts";
import { linkProps, navigate } from "../../app/router.ts";
import { findArchitectureLesson, type ArchitectureLesson } from "../lessons.ts";
import { findChallenge } from "../challenges.ts";
import { challengePath } from "../catalog.ts";
import { simulate, type SimRun } from "../simulate.ts";
import { summarize } from "../metrics.ts";
import { findings as findingsOf } from "../explain.ts";
import { recordExperiment } from "../progress.ts";
import { newDesignId, saveDesign } from "../persistence.ts";
import { DesignCanvas, type Selection } from "./DesignCanvas.tsx";
import { Inspector } from "./Inspector.tsx";
import { RunView, type TimelineFocus } from "./SimulationPanel.tsx";
import { useRunPlayback } from "./useRun.ts";
import { validateDesign } from "../validate.ts";
import { findConceptUnit } from "../concepts/index.ts";
import { ConceptUnitPage } from "./ConceptUnitPage.tsx";
import "./architecture.css";

/** The lesson's experiment: pick a design and a rate, run it in the simulator, and play the run back. */
function Experiment({ lesson }: { lesson: ArchitectureLesson }) {
  const { experiment } = lesson;
  const [variantId, setVariantId] = useState(experiment.variants[0].id);
  const [rate, setRate] = useState(experiment.rates[0]);
  const [run, setRun] = useState<SimRun | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<TimelineFocus>(null);
  const design = useMemo(() => {
    const d = experiment.variants.find((v) => v.id === variantId)!.design();
    for (const node of d.nodes) if (node.kind === "client") (node.config as { rps: number }).rps = rate;
    return d;
  }, [variantId, rate, experiment]);
  const playback = useRunPlayback(run);
  const summary = useMemo(() => (run ? summarize(run) : null), [run]);
  const findings = useMemo(() => (run && summary ? findingsOf(run, summary) : []), [run, summary]);
  const current = run?.design === design;

  const start = () => {
    setRun(simulate(design));
    setFocus(null);
    recordExperiment(safeStorage(), lesson.id);
  };
  const openInPlayground = () => {
    const now = new Date().toISOString();
    const copy = { ...design, id: newDesignId(), name: `${lesson.title}: ${experiment.variants.find((v) => v.id === variantId)!.label}`.slice(0, 80), createdAt: now, updatedAt: now };
    if (saveDesign(safeStorage(), copy)) navigate(`/practice/architecture?design=${copy.id}`);
  };

  return (
    <section className="experiment lab-theme" aria-labelledby="experiment-title">
      <h2 id="experiment-title"><FlaskConical aria-hidden="true" /> Experiment</h2>
      <p>{experiment.intro}</p>
      <div className="experiment-controls">
        <div className="arch-field">
          <label htmlFor="variant">Design</label>
          <select id="variant" value={variantId} onChange={(event) => setVariantId(event.target.value)}>
            {experiment.variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <div className="arch-field">
          <label htmlFor="rate">Requests per second</label>
          <select id="rate" value={rate} onChange={(event) => setRate(Number(event.target.value))}>
            {experiment.rates.map((r) => <option key={r} value={r}>{r.toLocaleString("en")}</option>)}
          </select>
        </div>
        <button type="button" className="button primary" onClick={start}><Play aria-hidden="true" /> {run ? "Run again" : "Run"}</button>
        <button type="button" className="button" onClick={openInPlayground}><Workflow aria-hidden="true" /> Open in the Playground</button>
      </div>
      <ol className="experiment-steps">{experiment.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <div className="experiment-stage">
        <DesignCanvas design={design} selection={selection} onSelect={setSelection} fold={current ? playback.fold : null} label={`Experiment diagram: ${design.nodes.map((n) => n.label).join(", ")}`} fitKey={variantId} />
        <Inspector design={design} selection={selection} onSelect={setSelection} validation={validateDesign(design)} fold={current ? playback.fold : null} />
      </div>
      {run && !current && <p className="run-stale" role="status">You changed the design or rate. Run again to see it.</p>}
      {run && current && (
        <>
          <RunView design={run.design} run={run} fold={playback.fold} playback={playback} summary={summary} findings={findings} focus={focus} onFocus={setFocus} selectedNode={selection?.kind === "node" ? selection.id : null} onShowNodes={(nodes) => setSelection(nodes[0] ? { kind: "node", id: nodes[0] } : null)} />
          <p className="notice"><b>What to notice:</b> {experiment.notice}</p>
        </>
      )}
    </section>
  );
}

/** /learn/system-design/:id: one System Design lesson. */
export function ArchitectureLessonPage({ lesson }: { lesson: ArchitectureLesson }) {
  const challenge = findChallenge(lesson.challenge)!;
  useEffect(() => {
    document.title = `${lesson.title} · System Design · Kitab`;
  }, [lesson]);
  return (
    <main id="main" className="page arch-lesson">
      <header className="learn-head">
        <p className="eyebrow">System Design lesson</p>
        <h1>{lesson.title}</h1>
        <p className="section-lead">{lesson.summary}</p>
      </header>
      <section className="lesson-goals" aria-labelledby="goals-title">
        <h2 id="goals-title">You'll be able to</h2>
        <ul>{lesson.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
      </section>
      {lesson.sections.map((section) => (
        <section key={section.heading} className="lesson-section">
          <h2>{section.heading}</h2>
          {section.body.map((p) => <p key={p}>{p}</p>)}
          {section.points && <ul>{section.points.map((p) => <li key={p}>{p}</li>)}</ul>}
        </section>
      ))}
      <Experiment lesson={lesson} />
      <section className="lesson-section">
        <h2>What the simulator leaves out</h2>
        <p>{lesson.limits}</p>
        <h2>Remember</h2>
        <ul>{lesson.takeaways.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <section className="lesson-next" aria-labelledby="next-title">
        <p className="eyebrow">Next: practise it</p>
        <h2 id="next-title">{challenge.title}</h2>
        <p>{challenge.summary}</p>
        <a className="button primary" {...linkProps(challengePath(challenge.id))}>Start the challenge <ArrowRight aria-hidden="true" /></a>
      </section>
    </main>
  );
}

export function ArchitectureLessonRoute({ id, notFound }: { id: string; notFound: ReactNode }) {
  const lesson = findArchitectureLesson(id);
  if (lesson) return <ArchitectureLessonPage key={lesson.id} lesson={lesson} />;
  const unit = findConceptUnit(id);
  return unit ? <ConceptUnitPage key={unit.id} unit={unit} /> : <>{notFound}</>;
}
