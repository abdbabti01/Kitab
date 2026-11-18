// The guided experiment's panel, the same in every subject: understand, predict, test, observe, explain, change
// one thing. The host page shows its own simulator view of `run` (the real engine run the panel judged), so the
// learner sees the same run the feedback is about.
import { useEffect, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";
import { canFinish, reduceCycle, trialOf, type Cycle, type CycleAction, type CycleState, type Evidence } from "../learning/cycle.ts";
import { loadCycleRecords, recordKey, resumeState, saveCycleState } from "../learning/cycle-progress.ts";
import { safeStorage } from "../learning/progress.ts";
import { terms } from "../learning/glossary.ts";
import { TermChips } from "./Terms.tsx";
import "./cycle.css";

/** The cycle's state, its saving, and the real runs it judged. Key the host by cycle id. */
export function useCycle<S, R>(cycle: Cycle<S, R>) {
  const [storage] = useState(safeStorage);
  const persistent = (() => {
    try {
      return storage === globalThis.localStorage;
    } catch {
      return false;
    }
  })();
  const [state, setState] = useState<CycleState>(() => resumeState(cycle, loadCycleRecords(storage)[recordKey(cycle)]));
  const [resumed] = useState(() => state.phase !== "ready" || state.attempt > 1);
  const [saveFailed, setSaveFailed] = useState(false);
  const dispatch = (action: CycleAction) => setState((s) => reduceCycle(cycle, s, action));
  // Runs are deterministic, so one run per trial is exact for every attempt.
  const runs = useRef(new Map<string, R>());
  const runOf = (trialId: string): R => {
    const cached = runs.current.get(trialId);
    if (cached) return cached;
    const t = trialOf(cycle, trialId)!;
    const run = cycle.run(t.setup, trialId === "base" ? null : runOf("base"));
    runs.current.set(trialId, run);
    return run;
  };
  useEffect(() => {
    if (state.phase !== "running") return;
    const { attempt, trial: trialId } = state;
    // After the "Running" state has painted; a result for an attempt or trial that has moved on is refused.
    const timer = setTimeout(() => {
      const t = trialOf(cycle, trialId)!;
      const run = runOf(trialId);
      const base = trialId === "base" ? null : runOf("base");
      dispatch({ type: "observed", attempt, trial: trialId, outcome: t.outcome(run, base), supported: t.reason(run, base) });
    }, 0);
    return () => clearTimeout(timer);
  }, [state.phase, state.attempt, state.trial]);
  const loaded = useRef(state);
  useEffect(() => {
    if (state === loaded.current) return;
    setSaveFailed(!saveCycleState(storage, cycle, state).saved);
  }, [state]);
  const trial = trialOf(cycle, state.trial)!;
  const shown = state.phase === "observed" || state.phase === "explained" || state.phase === "completed";
  return {
    cycle,
    state,
    dispatch,
    trial,
    /** The run being judged, once observed; null before (nothing about the result exists on screen). */
    run: shown ? runOf(state.trial) : null,
    /** The first run, when the trial is a variation compared with it. */
    base: shown && state.trial !== "base" ? runOf("base") : null,
    /** The first run once it has been explained in this attempt: what a variation is predicted against. */
    first: state.done.some((r) => r.trial === "base") ? runOf("base") : null,
    /** True until the learner has committed a prediction for the trial on screen. */
    locked: !shown,
    resumed,
    saveFailed,
    persistent,
  };
}
export type CycleHandle<S, R> = ReturnType<typeof useCycle<S, R>>;

const textOf = (choices: { id: string; text: string }[], id: string | null) => choices.find((c) => c.id === id)?.text ?? "";

function EvidenceList({ items, onShow }: { items: Evidence[]; onShow?: (at: number) => void }) {
  const first = items.slice(0, 4);
  const rest = items.slice(4);
  const row = (e: Evidence) => (
    <div key={e.label}>
      <dt>{e.label}</dt>
      <dd>
        {e.value}
        {onShow && e.at !== undefined && <> <button type="button" className="text-button" onClick={() => onShow(e.at!)}>Show in the run</button></>}
      </dd>
    </div>
  );
  return (
    <>
      <dl className="cycle-evidence">{first.map(row)}</dl>
      {rest.length > 0 && (
        <details className="cycle-more">
          <summary>All recorded values ({items.length})</summary>
          <dl className="cycle-evidence">{rest.map(row)}</dl>
        </details>
      )}
    </>
  );
}

const STEPS = ["Understand", "Predict", "Test", "Observe", "Explain"] as const;
const stepOf = (phase: CycleState["phase"]) => ({ ready: 1, running: 2, observed: 3, explained: 4, completed: 4 })[phase];

/** One guided experiment. `onShow` moves the host's run view to a recorded step or event. */
export function CyclePanel<S, R>({ c, onShow, lead }: { c: CycleHandle<S, R>; onShow?: (at: number) => void; lead?: string }) {
  const { cycle, state, dispatch, trial, run, base } = c;
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  const [words, setWords] = useState("");
  const [variation, setVariation] = useState(cycle.variations[0]?.id ?? "");
  const heading = useRef<HTMLHeadingElement>(null);
  const stage = `${state.attempt}:${state.trial}:${state.phase}`;
  const first = useRef(stage);
  useEffect(() => {
    // A new stage takes the focus (not on arrival), so keyboard and screen reader users land on it.
    if (stage === first.current) return;
    if (state.phase === "ready") setChoice("");
    if (state.phase === "observed") (setReason(""), setWords(""));
    if (state.phase !== "running") heading.current?.focus();
  }, [stage]);
  const variant = state.trial !== "base";
  const right = state.prediction === state.outcome;
  const reasonRight = state.reason === state.supported;
  const announce = {
    ready: variant ? `Predict: ${trial.question}` : "",
    running: "Running the simulation.",
    observed: right ? "Your prediction matched the run." : "The run showed something different from your prediction.",
    explained: reasonRight ? "Your reason matches the evidence." : "The evidence supports a different reason.",
    completed: "Experiment complete.",
  }[state.phase];
  const step = stepOf(state.phase);
  const go = (action: CycleAction) => dispatch(action);

  return (
    <section className="cycle" aria-labelledby={`cycle-${cycle.id}`}>
      <header className="cycle-head">
        <p className="eyebrow"><FlaskConical aria-hidden="true" /> Guided experiment · predict, test, explain</p>
        <h2 id={`cycle-${cycle.id}`}>{cycle.title}</h2>
        <ol className="cycle-steps" aria-label="Experiment steps">
          {STEPS.map((name, i) => (
            <li key={name} className={i < step ? "is-done" : i === step ? "is-current" : undefined} aria-current={i === step ? "step" : undefined}>{name}</li>
          ))}
        </ol>
      </header>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {c.resumed && state.phase !== "ready" && stage === first.current && <p className="cycle-note">Welcome back: this is where you left this experiment.</p>}
      {lead && <p className="cycle-note">{lead}</p>}

      <div className="cycle-understand">
        <p><b>{cycle.concept}</b> {cycle.scenario}</p>
        <p className="cycle-question"><b>Investigate:</b> {cycle.question}</p>
        <TermChips label="Terms in this experiment" lead="Terms:" terms={terms(...cycle.terms)} />
        <h3 className="cycle-sub">{variant ? "This run" : "Starting configuration"}</h3>
        {variant && <p className="cycle-change"><b>Changed:</b> {trial.change}</p>}
        <dl className="cycle-evidence is-setup">
          {cycle.start(trial.setup).map((e) => <div key={e.label}><dt>{e.label}</dt><dd>{e.value}</dd></div>)}
        </dl>
        <p className="cycle-watch"><b>Watch for:</b> {cycle.watch}</p>
        {variant && state.phase === "ready" && c.first !== null && (
          <>
            <h3 className="cycle-sub">What the first run recorded</h3>
            <EvidenceList items={cycle.evidence(c.first, null).slice(0, 4)} />
          </>
        )}
      </div>

      {state.phase === "ready" && (
        <form className="cycle-step" onSubmit={(e) => { e.preventDefault(); if (choice) go({ type: "predict", choice }); }}>
          <fieldset>
            <legend><h3 ref={heading} tabIndex={-1}>{variant ? "Predict the change: " : "Predict: "}{trial.question}</h3></legend>
            {trial.choices.map((o) => (
              <label key={o.id} className={`cycle-option${choice === o.id ? " is-chosen" : ""}`}>
                <input type="radio" name={`cycle-${cycle.id}-predict`} value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} />
                <span>{o.text}</span>
              </label>
            ))}
          </fieldset>
          <p className="cycle-help">Commit to an answer first: the run and its results appear only after you test it.</p>
          <div className="cycle-actions">
            <button type="submit" className="button primary" disabled={!choice}>Test my prediction</button>
          </div>
        </form>
      )}

      {state.phase === "running" && <p className="cycle-running" aria-busy="true">Running the simulation…</p>}

      {run !== null && state.outcome && (
        <div className={`cycle-step cycle-result ${right ? "is-right" : "is-different"}`}>
          {state.phase === "observed" && <h3 ref={heading} tabIndex={-1}>{right ? "Your prediction matched the run." : "The run showed something different."}</h3>}
          {state.phase !== "observed" && <h3>{right ? "Your prediction matched the run." : "The run showed something different."}</h3>}
          <p><b>You predicted:</b> {textOf(trial.choices, state.prediction)}</p>
          <p><b>What happened:</b> {textOf(trial.choices, state.outcome)}</p>
          {!right && trial.choices.find((o) => o.id === state.prediction)?.miss && <p className="cycle-miss">{trial.choices.find((o) => o.id === state.prediction)!.miss}</p>}
          <h4 className="cycle-sub">What the run recorded</h4>
          <EvidenceList items={cycle.evidence(run, base)} onShow={onShow} />
          {base !== null && cycle.readings.length > 0 && (
            <div className="cycle-table" role="region" aria-label="First run compared with this change" tabIndex={0}>
              <table>
                <caption>First run compared with: {trial.label}</caption>
                <thead><tr><th scope="col">Value</th><th scope="col">First run</th><th scope="col">With the change</th></tr></thead>
                <tbody>
                  {cycle.readings.map((r) => {
                    const [a, b] = [r.read(base), r.read(run)];
                    return <tr key={r.label}><th scope="row">{r.label}</th><td>{a === null ? "–" : r.format(a)}</td><td>{b === null ? "–" : r.format(b)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {state.phase === "observed" && (
        <form className="cycle-step" onSubmit={(e) => { e.preventDefault(); if (reason) go({ type: "explain", reason }); }}>
          <label className="cycle-words">
            <span>In your own words, why did this happen? <small>(optional, not graded or saved)</small></span>
            <textarea rows={2} value={words} onChange={(e) => setWords(e.target.value)} maxLength={600} />
          </label>
          <fieldset>
            <legend><h4 className="cycle-sub">Which reason does the evidence support?</h4></legend>
            {trial.reasons.map((o) => (
              <label key={o.id} className={`cycle-option${reason === o.id ? " is-chosen" : ""}`}>
                <input type="radio" name={`cycle-${cycle.id}-reason`} value={o.id} checked={reason === o.id} onChange={() => setReason(o.id)} />
                <span>{o.text}</span>
              </label>
            ))}
          </fieldset>
          <div className="cycle-actions">
            <button type="submit" className="button primary" disabled={!reason}>Check my reasoning</button>
          </div>
        </form>
      )}

      {run !== null && (state.phase === "explained" || state.phase === "completed") && (
        <div className={`cycle-step cycle-explain ${reasonRight ? "is-right" : "is-different"}`}>
          {state.phase === "explained" ? <h3 ref={heading} tabIndex={-1}>{reasonRight ? "That is the reason the evidence supports." : "The evidence points to a different reason."}</h3> : <h3>{reasonRight ? "That is the reason the evidence supports." : "The evidence points to a different reason."}</h3>}
          {!reasonRight && <p><b>Supported:</b> {textOf(trial.reasons, state.supported)}</p>}
          {!reasonRight && trial.reasons.find((o) => o.id === state.reason)?.miss && <p className="cycle-miss">{trial.reasons.find((o) => o.id === state.reason)!.miss}</p>}
          <p><b>Why:</b> {trial.explain(run, base)}</p>
          {!reasonRight && <p className="cycle-hint"><b>Hint for next time:</b> {cycle.hint}</p>}
          <p className="cycle-limits"><b>What this model doesn't show:</b> {cycle.limits}</p>
        </div>
      )}

      {state.phase === "completed" && (
        <div className="cycle-step">
          <h3 ref={heading} tabIndex={-1}>Experiment complete</h3>
          <ul className="cycle-summary">
            {state.done.map((r) => {
              const t = trialOf(cycle, r.trial)!;
              return <li key={r.trial}><b>{t.label}:</b> you predicted “{textOf(t.choices, r.prediction)}”; the run showed “{textOf(t.choices, r.outcome)}”.{r.reason === r.supported ? " Reason matched the evidence." : " The evidence supported another reason."}</li>;
            })}
          </ul>
        </div>
      )}

      {(state.phase === "explained" || state.phase === "completed") && (
        <div className="cycle-step cycle-next">
          {cycle.variations.length > 0 && (
            <form onSubmit={(e) => { e.preventDefault(); if (variation) go({ type: "vary", trial: variation }); }}>
              <fieldset>
                <legend><h4 className="cycle-sub">Change one thing, then predict again</h4></legend>
                {cycle.variations.map((v) => (
                  <label key={v.id} className={`cycle-option${variation === v.id ? " is-chosen" : ""}`}>
                    <input type="radio" name={`cycle-${cycle.id}-vary`} value={v.id} checked={variation === v.id} onChange={() => setVariation(v.id)} />
                    <span><b>{v.label}</b>{state.done.some((r) => r.trial === v.id) && " (tried)"}<br /><small>{v.change}</small></span>
                  </label>
                ))}
              </fieldset>
              <div className="cycle-actions"><button type="submit" className="button">Set up this change</button></div>
            </form>
          )}
          <div className="cycle-actions">
            {state.phase === "explained" && canFinish(cycle, state) && <button type="button" className="button primary" onClick={() => go({ type: "finish" })}>Finish the experiment</button>}
            <button type="button" className="text-button" onClick={() => go({ type: "again" })}>Start again with a new prediction</button>
          </div>
        </div>
      )}
      {(c.saveFailed || !c.persistent) && <p className="cycle-note is-warning" role="note">{c.saveFailed ? "This browser didn't save your progress here (storage is full or blocked). It lasts until you leave this page." : "This browser isn't keeping saved data, so your progress here lasts only while this page is open."}</p>}
    </section>
  );
}
