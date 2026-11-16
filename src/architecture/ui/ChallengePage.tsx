import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, Lightbulb, RotateCcw, Target } from "lucide-react";
import { safeStorage } from "../../learning/progress.ts";
import { linkProps } from "../../app/router.ts";
import { challengeDesign, evaluate, findChallenge, isFixed, type Challenge, type Evaluation } from "../challenges.ts";
import { editorReducer, initEditor } from "../editor.ts";
import { challengeRecordFor, loadArchitectureProgress, recordChallengeCheck, saveChallengeDesign } from "../progress.ts";
import { parseDesign } from "../validate.ts";
import type { Design } from "../model.ts";
import { ms } from "../explain.ts";
import { Workspace } from "./Workspace.tsx";
import { Coach } from "./Coach.tsx";
import "./architecture.css";

function startingDesign(challenge: Challenge): Design {
  const record = challengeRecordFor(loadArchitectureProgress(safeStorage()), challenge.id, challenge.version);
  if (record?.design) {
    try {
      return parseDesign(record.design);
    } catch {
      // a damaged working design: start again from the starter
    }
  }
  return challenge.starter();
}

function Results({ challenge, result }: { challenge: Challenge; result: Evaluation }) {
  const scenario = (id: string) => challenge.scenarios.find((s) => s.id === id)!;
  return (
    <section className={`check-results ${result.passed ? "is-passed" : "is-failed"}`} aria-labelledby="results-title">
      <h3 id="results-title" tabIndex={-1}>{result.passed ? "Every requirement is met" : `${result.checks.filter((c) => c.passed).length} of ${result.checks.length} requirements met`}</h3>
      {!result.validation.ok && <p className="inline-issue is-error">The design isn't valid yet: {result.validation.errors[0].message}</p>}
      <ul>
        {result.checks.map((check) => (
          <li key={check.id} className={check.passed ? "is-pass" : "is-fail"}>
            {check.passed ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
            <span>
              <span className="sr-only">{check.passed ? "Met: " : "Not met: "}</span>
              <b>{check.requirement}</b>
              <small>{scenario(check.scenario).title}: {check.observed}.</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">Judged only from simulator runs of your design with the challenge's traffic and settings. {result.validation.ok ? `Cost: ${result.cost} units.` : ""}</p>
    </section>
  );
}

/** /practice/architecture/challenges/:id: a design challenge, judged by what simulator runs of the design show. */
export function ChallengePage({ challenge }: { challenge: Challenge }) {
  const storage = safeStorage();
  const [state, dispatch] = useReducer(editorReducer, challenge, (c) => initEditor(startingDesign(c), c.locked));
  const [result, setResult] = useState<Evaluation | null>(null);
  const [checking, setChecking] = useState(false);
  const [hints, setHints] = useState(0);
  const [scenarioId, setScenarioId] = useState(challenge.scenarios[0].id);
  const [record, setRecord] = useState(() => challengeRecordFor(loadArchitectureProgress(storage), challenge.id, challenge.version));
  const design = state.design;
  const opened = useRef(true);

  useEffect(() => {
    document.title = `${challenge.title} · Design challenge · Kitab`;
  }, [challenge]);
  // The working design is kept on this device, so the challenge reopens where it was left: shortly after the
  // last edit, and at once when the page is hidden or left (a debounced save alone loses the last edit).
  const unsaved = useRef<Design | null>(null);
  const keep = () => {
    if (!unsaved.current) return;
    const progress = saveChallengeDesign(storage, challenge.id, challenge.version, unsaved.current);
    unsaved.current = null;
    setRecord(challengeRecordFor(progress, challenge.id, challenge.version));
  };
  useEffect(() => {
    if (opened.current) return void (opened.current = false);
    unsaved.current = design;
    const timer = setTimeout(keep, 400);
    return () => clearTimeout(timer);
  }, [design]);
  useEffect(() => {
    window.addEventListener("pagehide", keep);
    return () => (window.removeEventListener("pagehide", keep), keep());
  }, []);
  useEffect(() => setResult(null), [design]);
  // Move to the results once they are shown, so they are read out.
  useEffect(() => {
    if (result) document.getElementById("results-title")?.focus();
  }, [result]);

  const scenario = challenge.scenarios.find((s) => s.id === scenarioId)!;
  const runDesign = useMemo(() => (d: Design) => {
    const base = challengeDesign(challenge, d);
    return { ...base, workload: { ...base.workload, ...scenario.workload }, faults: scenario.faults ? scenario.faults(base)[0] : [] };
  }, [challenge, scenario]);

  const check = () => {
    setChecking(true);
    keep();
    setTimeout(() => {
      const evaluation = evaluate(challenge, design);
      setResult(evaluation);
      setChecking(false);
      const progress = recordChallengeCheck(storage, challenge.id, challenge.version, { passed: evaluation.passed, cost: evaluation.cost, p95: evaluation.outcomes.normal?.[0]?.summary.p95 ?? null });
      setRecord(challengeRecordFor(progress, challenge.id, challenge.version));
    }, 0);
  };

  const passed = Boolean(record?.passedAt);
  const aside = (
    <div className="challenge-aside">
      <div className="arch-field scenario-pick">
        <label htmlFor="scenario">Run this scenario</label>
        <select id="scenario" value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
          {challenge.scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <small>The challenge's traffic and fixed settings apply.{scenario.faults ? " With several servers, this run fails the first; the check fails each in turn." : ""}</small>
      </div>
    </div>
  );

  return (
    <main id="main" className="page lab-page arch-playground arch-challenge lab-theme">
      <header className="playground-heading">
        <div className="playground-title">
          <Target className="playground-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Design challenge{passed ? " · Completed" : ""}</p>
            <h1>{challenge.title}</h1>
            <p>{challenge.story}</p>
          </div>
        </div>
      </header>

      <div className="challenge-brief">
        <section aria-labelledby="req-title">
          <h2 id="req-title">Requirements</h2>
          <ul>{challenge.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
          <h3>Constraints</h3>
          <ul>{challenge.constraints.map((c) => <li key={c}>{c}</li>)}</ul>
        </section>
        <section aria-labelledby="checks-title">
          <h2 id="checks-title">How it's checked</h2>
          <ul className="check-list">{challenge.checks.map((c) => <li key={c.id}>{c.requirement} <small>({challenge.scenarios.find((s) => s.id === c.scenario)!.title})</small></li>)}</ul>
          <p className="muted">Any design that meets every check passes. There's more than one.</p>
          <div className="actions">
            <button type="button" className="button primary" onClick={check} disabled={checking}>{checking ? "Checking…" : "Check my design"}</button>
            <button type="button" className="button" onClick={() => window.confirm("Replace your design with the starting design?") && dispatch({ type: "load", design: challenge.starter() })}><RotateCcw aria-hidden="true" /> Start again</button>
          </div>
          {record && <p className="muted">Checked {record.attempts} {record.attempts === 1 ? "time" : "times"}{record.best ? ` · cheapest passing design: ${record.best.cost} units, 95% within ${ms(record.best.p95)}` : ""}.</p>}
        </section>
      </div>
      {result && <Results challenge={challenge} result={result} />}

      <Workspace state={state} dispatch={dispatch} fitKey={challenge.id} runDesign={runDesign} isFixed={(kind, field) => isFixed(challenge, kind, field)} workloadLocked aside={aside} />

      <div className="challenge-help">
        <section aria-labelledby="hints-title">
          <h2 id="hints-title"><Lightbulb aria-hidden="true" /> Hints</h2>
          <ol>{challenge.hints.slice(0, hints).map((h) => <li key={h}>{h}</li>)}</ol>
          {hints < challenge.hints.length ? <button type="button" className="button" onClick={() => setHints(hints + 1)}>{hints ? "Another hint" : "Show a hint"}</button> : <p className="muted">That's every hint.</p>}
        </section>
        <Coach challenge={challenge} design={design} result={result} hintsSeen={hints} />
        {(passed || result?.passed) && (
          <section aria-labelledby="approaches-title" className="approaches">
            <h2 id="approaches-title">Other valid designs, and their trade-offs</h2>
            <ul>{challenge.approaches.map((a) => <li key={a.title}><b>{a.title}</b><p>{a.detail}</p></li>)}</ul>
            <p><a {...linkProps("/learn/system-design")}>Back to the System Design track</a></p>
          </section>
        )}
      </div>
    </main>
  );
}

export function ChallengeRoute({ id, notFound }: { id: string; notFound: ReactNode }) {
  const challenge = findChallenge(id);
  return challenge ? <ChallengePage key={challenge.id} challenge={challenge} /> : <>{notFound}</>;
}
