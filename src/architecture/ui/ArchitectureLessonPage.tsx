import { lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { TermChips } from "../../ui/Terms.tsx";
import { terms } from "../../learning/glossary.ts";
import { ArrowRight, FlaskConical, Play, Workflow } from "lucide-react";
import { safeStorage } from "../../learning/progress.ts";
import { linkProps } from "../../app/router.ts";
import { findArchitectureLesson, lessonDesign, lessonPlaygroundPath, type ArchitectureLesson } from "../lessons.ts";
import { findChallenge } from "../challenges.ts";
import { challengePath } from "../catalog.ts";
import { simulate, type SimRun } from "../simulate.ts";
import { summarize } from "../metrics.ts";
import { findings as findingsOf } from "../explain.ts";
import { recordExperiment } from "../progress.ts";
import { DesignCanvas, type Selection } from "./DesignCanvas.tsx";
import { Inspector } from "./Inspector.tsx";
import { RunView, type TimelineFocus } from "./SimulationPanel.tsx";
import { useRunPlayback } from "./useRun.ts";
import { validateDesign } from "../validate.ts";
import { cycleForLesson, setupDesign, type SdRun, type SdSetup } from "../cycles.ts";
import type { Cycle } from "../../learning/cycle.ts";
import { CyclePanel, useCycle } from "../../ui/PredictCycle.tsx";
// Concept units are text-heavy: their page loads only when one is opened.
const ConceptUnitRoute = lazy(() => import("./ConceptUnitPage.tsx").then((m) => ({ default: m.ConceptUnitRoute })));
import "./architecture.css";

/**
 * The lesson's guided experiment: predict, then the cycle runs the lesson's design in the simulator and the run is
 * shown here, the same run the feedback is judged on. The canvas follows the trial's design until there is a run,
 * then the run's own design, so a fold is never paired with a design it wasn't built from.
 */
function GuidedRun({ lesson, cycle }: { lesson: ArchitectureLesson; cycle: Cycle<SdSetup, SdRun> }) {
  const c = useCycle(cycle);
  const run = c.run?.run ?? null;
  const design = useMemo(() => run?.design ?? setupDesign(c.trial.setup), [run, c.trial]);
  const playback = useRunPlayback(run);
  const summary = c.run?.summary ?? null;
  const findings = useMemo(() => (run && summary ? findingsOf(run, summary) : []), [run, summary]);
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<TimelineFocus>(null);
  // Running the lesson's experiment counts the lesson as done, as a free run always has.
  useEffect(() => {
    if (run) recordExperiment(safeStorage(), lesson.id);
  }, [run, lesson.id]);
  useEffect(() => setFocus(null), [run]);
  return (
    <>
      <CyclePanel c={c} />
      <div className="experiment-stage">
        <DesignCanvas design={design} selection={selection} onSelect={setSelection} fold={run ? playback.fold : null} label={`Experiment diagram: ${design.nodes.map((n) => n.label).join(", ")}`} fitKey={c.trial.id} />
        <Inspector design={design} selection={selection} onSelect={setSelection} validation={validateDesign(design)} fold={run ? playback.fold : null} />
      </div>
      {run && summary && <RunView design={run.design} run={run} fold={playback.fold} playback={playback} summary={summary} findings={findings} focus={focus} onFocus={setFocus} selectedNode={selection?.kind === "node" ? selection.id : null} onShowNodes={(nodes) => setSelection(nodes[0] ? { kind: "node", id: nodes[0] } : null)} />}
    </>
  );
}

/**
 * The lesson's experiment. A lesson with a guided prediction runs that, and leaves free exploration to the
 * Architecture Playground, opened on the lesson's own designs; a lesson without one keeps its free runs here, since
 * they are its experiment (and what completes it).
 */
function Experiment({ lesson }: { lesson: ArchitectureLesson }) {
  const cycle = cycleForLesson(lesson.id);
  return (
    <section className="experiment lab-theme" aria-labelledby="experiment-title">
      <h2 id="experiment-title"><FlaskConical aria-hidden="true" /> {cycle ? "Experiment" : "Guided experiment"}</h2>
      {cycle ? (
        <>
          <p className="section-lead">Commit to a prediction, run the simulator, then explain what it recorded.</p>
          <GuidedRun key={cycle.id} lesson={lesson} cycle={cycle} />
          <ExploreDesigns lesson={lesson} />
        </>
      ) : <FreeExperiment lesson={lesson} />}
    </section>
  );
}

/** Free exploration of the lesson's designs, in the Playground: each opens there as a design of the learner's own. */
function ExploreDesigns({ lesson }: { lesson: ArchitectureLesson }) {
  const { experiment } = lesson;
  const rates = experiment.rates.map((r) => r.toLocaleString("en")).join(", ");
  return (
    <div className="explore-designs">
      <h3><Workflow aria-hidden="true" /> Explore freely in the Architecture Playground</h3>
      <p>Open one of this lesson's designs, then change the request rate (this lesson uses {rates} per second), add servers or change any setting, and run it as often as you like. Nothing is judged.</p>
      <ul>
        {experiment.variants.map((v) => (
          <li key={v.id}><a {...linkProps(lessonPlaygroundPath(lesson.id, v.id, experiment.rates[0]))}>{v.label} <ArrowRight aria-hidden="true" /></a></li>
        ))}
      </ul>
    </div>
  );
}

/** Free runs: pick a design and a rate, run it in the simulator, and play the run back. */
function FreeExperiment({ lesson }: { lesson: ArchitectureLesson }) {
  const { experiment } = lesson;
  const [variantId, setVariantId] = useState(experiment.variants[0].id);
  const [rate, setRate] = useState(experiment.rates[0]);
  const [run, setRun] = useState<SimRun | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<TimelineFocus>(null);
  const design = useMemo(() => lessonDesign(lesson.id, variantId, rate)!, [variantId, rate, lesson.id]);
  const playback = useRunPlayback(run);
  const summary = useMemo(() => (run ? summarize(run) : null), [run]);
  const findings = useMemo(() => (run && summary ? findingsOf(run, summary) : []), [run, summary]);
  const current = run?.design === design;

  const start = () => {
    setRun(simulate(design));
    setFocus(null);
    recordExperiment(safeStorage(), lesson.id);
  };

  return (
    <>
      <p>{experiment.intro}</p>
      <TermChips label="Terms in this experiment" lead="Terms used here:" terms={terms("slot", "rps", "throughput", "latency", "queue")} />
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
        <a className="button" {...linkProps(lessonPlaygroundPath(lesson.id, variantId, rate))}><Workflow aria-hidden="true" /> Open in the Playground</a>
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
    </>
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
  return <ConceptUnitRoute id={id} notFound={notFound} />;
}
