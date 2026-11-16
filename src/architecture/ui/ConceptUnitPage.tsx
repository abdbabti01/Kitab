import { useEffect, useState, type ReactNode } from "react";
import { findConceptUnit } from "../concepts/index.ts";
import { ArrowRight, CircleCheck, CircleX, FlaskConical } from "lucide-react";
import { safeStorage } from "../../learning/progress.ts";
import { linkProps } from "../../app/router.ts";
import { findTrackActivity, locate } from "../../learning/tracks.ts";
import { labCatalog, labPath } from "../catalog.ts";
import { loadLabProgress, recordConceptCheck } from "../labs/progress.ts";
import { judgeDecision, unitCheckIds, type Concept, type ConceptUnit, type Decision } from "../concepts/types.ts";
import "./architecture.css";
import "./labs.css";

function Check({ unit, concept, right, onAnswer }: { unit: ConceptUnit; concept: Concept; right: boolean | undefined; onAnswer: (correct: boolean) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const name = `check-${concept.id}`;
  const answer = shown === null ? undefined : concept.check.options[shown];
  return (
    <form className="concept-check" onSubmit={(e) => {
      e.preventDefault();
      if (picked === null) return;
      setShown(picked);
      onAnswer(concept.check.options[picked].correct === true);
    }}>
      <fieldset>
        <legend>Check: {concept.check.prompt}</legend>
        {concept.check.options.map((o, i) => (
          <label key={o.text}>
            <input type="radio" name={name} checked={picked === i} onChange={() => { setPicked(i); setShown(null); }} />
            <span>{o.text}</span>
          </label>
        ))}
      </fieldset>
      <button type="submit" className="button primary" disabled={picked === null}>Check my answer</button>
      {answer ? (
        <p className={`lab-feedback ${answer.correct ? "is-right" : "is-wrong"}`} role="status">
          {answer.correct ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
          <span>{answer.why}{answer.correct ? "" : " Try another answer."}</span>
        </p>
      ) : right !== undefined && (
        <p className="muted">{right ? `You answered this right before.` : `Your last answer wasn't right; try again.`}</p>
      )}
      <span className="sr-only">{unit.title}</span>
    </form>
  );
}

function ConceptCard({ unit, concept, right, onAnswer }: { unit: ConceptUnit; concept: Concept; right: boolean | undefined; onAnswer: (correct: boolean) => void }) {
  const lab = concept.lab ? labCatalog.find((l) => l.id === concept.lab) : undefined;
  return (
    <article id={concept.id} className="concept" aria-labelledby={`${concept.id}-title`}>
      <h2 id={`${concept.id}-title`}>{concept.title}</h2>
      <p className="lead">{concept.plain}</p>
      <h3>Why it happens</h3>
      <p>{concept.why}</p>
      <div className="concept-callout is-example"><b>In a real application</b><p>{concept.example}</p></div>
      <h3>How it works</h3>
      {concept.mechanism.map((p) => <p key={p}>{p}</p>)}
      <div className="concept-callout is-failure"><b>What goes wrong</b><p>{concept.failure}</p></div>
      <div className="concept-callout is-fix"><b>What to do</b><p>{concept.solution}</p></div>
      <details>
        <summary>Trade-offs and when not to use it</summary>
        <h3>Trade-offs</h3>
        <ul>{concept.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul>
        <h3>When not to</h3>
        <ul>{concept.avoid.map((t) => <li key={t}>{t}</li>)}</ul>
        {concept.pitfalls && (
          <>
            <h3>Common confusions</h3>
            <ul>{concept.pitfalls.map((t) => <li key={t}>{t}</li>)}</ul>
          </>
        )}
      </details>
      <Check unit={unit} concept={concept} right={right} onAnswer={onAnswer} />
      {lab && <p><a {...linkProps(labPath(lab.id))}><FlaskConical aria-hidden="true" className="inline-icon" /> Practise it: {lab.title}</a></p>}
    </article>
  );
}

/** A stable, text-derived order, so the authored order (right answers first) never shows. */
function shuffled<T extends { text: string }>(items: T[]) {
  const hash = (s: string) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
  return items.map((item, index) => ({ item, index })).sort((a, b) => hash(a.item.text) - hash(b.item.text));
}

function DecisionCard({ decision, right, onAnswer }: { decision: Decision; right: boolean | undefined; onAnswer: (correct: boolean) => void }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [reasons, setReasons] = useState<number[]>([]);
  const [result, setResult] = useState<ReturnType<typeof judgeDecision> | null>(null);
  const name = `decision-${decision.id}`;
  return (
    <article id={`decision-${decision.id}`} className="concept decision" aria-labelledby={`${name}-title`}>
      <p className="eyebrow">Decision</p>
      <h2 id={`${name}-title`}>{decision.title}</h2>
      <ul>{decision.context.map((c) => <li key={c}>{c}</li>)}</ul>
      <form className="concept-check" onSubmit={(e) => {
        e.preventDefault();
        if (choice === null) return;
        const judged = judgeDecision(decision, choice, reasons);
        setResult(judged);
        onAnswer(judged.correct);
      }}>
        <fieldset>
          <legend>{decision.question}</legend>
          {shuffled(decision.choices).map(({ item: o, index: i }) => (
            <label key={o.text}><input type="radio" name={name} checked={choice === i} onChange={() => { setChoice(i); setResult(null); }} /><span>{o.text}</span></label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Which reasons support your choice? Pick at least {decision.minReasons}, and only ones that do.</legend>
          {shuffled(decision.reasons).map(({ item: r, index: i }) => (
            <label key={r.text}><input type="checkbox" checked={reasons.includes(i)} onChange={(e) => { setReasons(e.target.checked ? [...reasons, i].sort() : reasons.filter((x) => x !== i)); setResult(null); }} /><span>{r.text}</span></label>
          ))}
        </fieldset>
        <button type="submit" className="button primary" disabled={choice === null}>Check my decision</button>
        {result && choice !== null ? (
          <div className={`lab-feedback ${result.correct ? "is-right" : "is-wrong"}`} role="status">
            {result.correct ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
            <span>
              {decision.choices[choice].why}
              {result.wrongReasons.length > 0 && ` These reasons don't hold or don't support it: ${result.wrongReasons.map((r) => `“${decision.reasons[r].text}”`).join(" ")}`}
              {!result.enough && ` Give at least ${decision.minReasons} reasons that support the choice.`}
            </span>
          </div>
        ) : right !== undefined && <p className="muted">{right ? "You made a sound decision here before." : "Your last decision didn't hold up; try again."}</p>}
      </form>
    </article>
  );
}

/** /learn/system-design/:id for a concept unit: every concept, its check, then the unit's labs. */
export function ConceptUnitRoute({ id, notFound }: { id: string; notFound: ReactNode }) {
  const unit = findConceptUnit(id);
  return unit ? <ConceptUnitPage key={unit.id} unit={unit} /> : <>{notFound}</>;
}

export function ConceptUnitPage({ unit }: { unit: ConceptUnit }) {
  const storage = safeStorage();
  const [record, setRecord] = useState(() => loadLabProgress(storage).units[unit.id]);
  useEffect(() => {
    document.title = `${unit.title} · System Design · Kitab`;
  }, [unit]);
  const ids = unitCheckIds(unit);
  const answer = (concept: string, correct: boolean) => setRecord(recordConceptCheck(storage, unit.id, concept, correct, ids).units[unit.id]);
  const right = ids.filter((id) => record?.answers[id]?.correct).length;
  const next = locate(`sd:${unit.id}`)?.next;
  return (
    <main id="main" className="page arch-lesson">
      <header className="learn-head">
        <p className="eyebrow">System Design lesson</p>
        <h1>{unit.title}</h1>
        <p className="section-lead">{unit.summary}</p>
      </header>
      <section className="lesson-goals" aria-labelledby="goals-title">
        <h2 id="goals-title">You'll be able to</h2>
        <ul>{unit.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
      </section>
      <section className="lesson-section">{unit.intro.map((p) => <p key={p}>{p}</p>)}</section>
      <nav aria-label="Concepts in this lesson">
        <p className="unit-progress" role="status">{record?.completedAt ? `Lesson complete: all ${ids.length} checks answered right.` : `${right} of ${ids.length} checks${unit.decisions?.length ? " and decisions" : ""} answered right. Answer them all to complete the lesson.`}</p>
        <ul className="concept-nav">
          {unit.concepts.map((c) => (
            <li key={c.id}><a href={`#${c.id}`} className={record?.answers[c.id]?.correct ? "is-right" : undefined}>{record?.answers[c.id]?.correct && <CircleCheck aria-hidden="true" className="inline-icon" />}{c.title}</a></li>
          ))}
          {unit.decisions?.map((d) => (
            <li key={d.id}><a href={`#decision-${d.id}`} className={record?.answers[`decision:${d.id}`]?.correct ? "is-right" : undefined}>{record?.answers[`decision:${d.id}`]?.correct && <CircleCheck aria-hidden="true" className="inline-icon" />}Decision: {d.title}</a></li>
          ))}
        </ul>
      </nav>
      {unit.concepts.map((c) => <ConceptCard key={c.id} unit={unit} concept={c} right={record?.answers[c.id]?.correct} onAnswer={(ok) => answer(c.id, ok)} />)}
      {unit.decisions?.map((d) => <DecisionCard key={d.id} decision={d} right={record?.answers[`decision:${d.id}`]?.correct} onAnswer={(ok) => answer(`decision:${d.id}`, ok)} />)}
      {unit.labs.length > 0 && (
        <section className="lesson-section" aria-labelledby="labs-title">
          <h2 id="labs-title">Practise in a lab</h2>
          <p>Reading completes the lesson; mastery comes from the lab: predict the failure, fix it for every scenario, and explain why the fix works.</p>
          <ul className="unit-labs">
            {unit.labs.map((id) => {
              const lab = findTrackActivity(`lab:${id}`)!;
              return <li key={id}><a {...linkProps(labPath(id))}><b><FlaskConical aria-hidden="true" className="inline-icon" /> {lab.title}</b><small>{lab.detail}</small></a></li>;
            })}
          </ul>
        </section>
      )}
      <section className="lesson-section">
        <h2>Remember</h2>
        <ul>{unit.takeaways.map((t) => <li key={t}>{t}</li>)}</ul>
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
