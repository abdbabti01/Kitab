import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, FlaskConical, KeyRound, SquareTerminal } from "lucide-react";
import { linkProps } from "../../app/router.ts";
import { safeStorage } from "../../learning/progress.ts";
import { locate } from "../../learning/tracks.ts";
import { cyclesFor } from "../../learning/cycle-catalog.ts";
import { unitLabs } from "../../lab/links.ts";
import { LessonOutline, LessonProgress } from "../../ui/LessonShell.tsx";
import { ConceptCard, DecisionCard } from "../../architecture/ui/ConceptUnitPage.tsx";
import { unitCheckIds, type ConceptUnit } from "../../architecture/concepts/types.ts";
import { findIdentityUnit } from "../content/index.ts";
import type { IdentityUnit } from "../content/types.ts";
import { loadIdentityProgress, recordUnitCheck } from "../progress.ts";
import { runScenario } from "../model.ts";
import { findScenario } from "../flows/index.ts";
import { identityChallengeCatalog, identityChallengePath } from "../catalog.ts";
import { Sequence } from "./Trace.tsx";
// The C#, Java and Python examples are large; they load when the lesson does, without holding up its first paint.
const CodeExamples = lazy(() => import("./CodeExamples.tsx").then((m) => ({ default: m.CodeExamples })));
import "./identity.css";

export function IdentityUnitRoute({ id, notFound }: { id: string; notFound: ReactNode }) {
  const unit = findIdentityUnit(id);
  return unit ? <IdentityUnitPage unit={unit} /> : <>{notFound}</>;
}

/** A compact, read-only summary of the unit's flow, computed by the Playground's engine, with one way into it. */
function Walkthrough({ unit }: { unit: IdentityUnit }) {
  const w = unit.walkthrough!;
  const scenario = findScenario(w.scenario)!;
  const run = useMemo(() => runScenario(scenario, w.config ?? {}), [unit.id]);
  const query = new URLSearchParams({ scenario: scenario.id, ...(w.config ?? {}), from: `/learn/identity/${unit.id}` });
  return (
    <section className="lesson-section id-walkthrough" aria-labelledby="walkthrough-title">
      <h2 id="walkthrough-title">Message by message: {scenario.title}</h2>
      <p>{scenario.summary} Each row is one message: who sends it, to whom, and what it is. Computed by the same engine as the Playground.</p>
      <Sequence run={run} at={run.events.length - 1} revealAll label={`${scenario.title}: every message`} />
      <p><a className="button" {...linkProps(`/practice/identity?${query}`)}><KeyRound aria-hidden="true" /> {w.label}: open it in the Playground</a></p>
    </section>
  );
}

export function IdentityUnitPage({ unit }: { unit: IdentityUnit }) {
  const storage = useMemo(safeStorage, []);
  const [record, setRecord] = useState(() => loadIdentityProgress(storage).units[unit.id]);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    document.title = `${unit.title} · Identity & security · Kitab`;
  }, [unit]);
  const asUnit = unit as unknown as ConceptUnit;
  const ids = unitCheckIds(asUnit);
  const answer = (check: string, correct: boolean) => {
    const saved = recordUnitCheck(storage, unit.id, check, correct, ids);
    setSaveFailed(!saved.saved);
    setRecord(saved.units[unit.id]);
  };
  const right = ids.filter((id) => record?.answers[id]?.correct).length;
  const next = locate(`id:${unit.id}`)?.next;
  const experiments = cyclesFor("identity", unit.id);
  const labs = unitLabs[`identity/${unit.id}`] ?? [];
  const challenges = identityChallengeCatalog.filter((c) => c.unit === unit.id);
  return (
    <main id="main" className="page arch-lesson identity-lesson">
      <header className="learn-head">
        <p className="eyebrow">Identity &amp; security lesson</p>
        <h1>{unit.title}</h1>
        <p className="section-lead">{unit.summary}</p>
      </header>
      <div className="lesson-where unit-where">
        <LessonProgress label={`${right} of ${ids.length} checks answered right`} value={right} max={ids.length} />
        <LessonOutline
          label="Concepts in this lesson"
          doneLabel="answered right"
          summary={<><b>{unit.concepts.length} concepts</b>{unit.decisions?.length ? ` and ${unit.decisions.length} decision${unit.decisions.length > 1 ? "s" : ""}` : ""}, each with a check</>}
          items={[
            ...unit.concepts.map((c) => ({ id: c.id, title: c.title, href: `#${c.id}`, state: record?.answers[c.id]?.correct ? ("done" as const) : ("todo" as const) })),
            ...(unit.decisions ?? []).map((d) => ({ id: `decision-${d.id}`, title: `Decision: ${d.title}`, href: `#decision-${d.id}`, state: record?.answers[`decision:${d.id}`]?.correct ? ("done" as const) : ("todo" as const) })),
          ]}
        />
      </div>
      <p className="unit-progress" role="status">{record?.completedAt ? `Lesson complete: all ${ids.length} checks answered right.` : `Answer every check${unit.decisions?.length ? " and decision" : ""} to complete the lesson.`}</p>
      {saveFailed && <p className="inline-issue is-warning">This browser didn't save your answer (storage full or blocked).</p>}
      <section className="lesson-goals" aria-labelledby="goals-title">
        <h2 id="goals-title">You'll be able to</h2>
        <ul>{unit.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
      </section>
      <section className="lesson-section">{unit.intro.map((p) => <p key={p}>{p}</p>)}</section>
      {unit.walkthrough && <Walkthrough unit={unit} />}
      {unit.concepts.map((c) => <ConceptCard key={c.id} unit={asUnit} concept={c} right={record?.answers[c.id]?.correct} onAnswer={(ok) => answer(c.id, ok)} />)}
      {unit.decisions?.map((d) => <DecisionCard key={d.id} decision={d} right={record?.answers[`decision:${d.id}`]?.correct} onAnswer={(ok) => answer(`decision:${d.id}`, ok)} />)}
      {experiments.length > 0 && (
        <section className="lesson-section" aria-labelledby="experiments-title">
          <h2 id="experiments-title">Predict, then test</h2>
          <p>Guided experiments: commit a prediction, run the real model, and explain what it recorded.</p>
          <ul className="unit-labs">{experiments.map((x) => <li key={x.id}><a {...linkProps(x.path)}><b><FlaskConical aria-hidden="true" className="inline-icon" /> {x.title}</b></a></li>)}</ul>
        </section>
      )}
      {unit.examples.length > 0 && <Suspense fallback={<p className="muted" role="status">Loading code examples…</p>}><CodeExamples topics={unit.examples} /></Suspense>}
      {(challenges.length > 0 || labs.length > 0) && (
        <section className="lesson-section" aria-labelledby="practise-title">
          <h2 id="practise-title">Practise</h2>
          <ul className="unit-labs">
            {challenges.map((c) => <li key={c.id}><a {...linkProps(identityChallengePath(c.id))}><b>Challenge: {c.title}</b></a></li>)}
            {labs.map((l) => <li key={l.path}><a {...linkProps(l.path)}><b><SquareTerminal aria-hidden="true" className="inline-icon" /> Engineering Lab: {l.title}</b><small>Real execution in your browser</small></a></li>)}
          </ul>
        </section>
      )}
      <section className="lesson-section">
        <h2>Remember</h2>
        <ul>{unit.takeaways.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
      <section className="lesson-section" aria-labelledby="related-title">
        <h2 id="related-title">Connections and sources</h2>
        <ul>{unit.related.map((r) => <li key={r.path + r.label}><a {...linkProps(r.path)}>{r.label}</a></li>)}</ul>
        <p className="muted"><b>Follows:</b> {unit.sources.join("; ")}.</p>
      </section>
      {next && (
        <section className="lesson-next" aria-labelledby="next-title">
          <p className="eyebrow">Next</p>
          <h2 id="next-title">{next.title}</h2>
          <p>{next.detail}</p>
          <a className="button primary" {...linkProps(next.path)}>Continue <ArrowRight aria-hidden="true" /></a>
        </section>
      )}
    </main>
  );
}
