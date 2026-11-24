import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, CircleCheck, CircleX, Lightbulb, RotateCcw } from "lucide-react";
import { linkProps } from "../../app/router.ts";
import { safeStorage } from "../../learning/progress.ts";
import { locate } from "../../learning/tracks.ts";
import { practiceLabels } from "../../learning/practice-state.ts";
import { DecisionCard } from "../../architecture/ui/ConceptUnitPage.tsx";
import { identityUnitPath } from "../catalog.ts";
import { audit, RULES, ruleInfo, type Rule } from "../authz.ts";
import { parseConfig, type Config } from "../model.ts";
import { findScenario } from "../flows/index.ts";
import { findIdentityChallenge, judge, policyStart, runOf, type Challenge, type Judgement, type Submission } from "../challenges.ts";
import { challengeRecordFor, challengeState, chooseVariant, loadIdentityProgress, recordAttempt } from "../progress.ts";
import { EventInspector, Sequence, Workbench, usePlayback } from "./Trace.tsx";
import "./identity.css";

export function IdentityChallengeRoute({ id, notFound }: { id: string; notFound: ReactNode }) {
  const challenge = findIdentityChallenge(id);
  return challenge ? <IdentityChallengePage challenge={challenge} /> : <>{notFound}</>;
}

function Result({ result }: { result: Judgement | null }) {
  if (!result) return null;
  return (
    <div className={`lab-feedback ${result.passed ? "is-right" : "is-wrong"}`} role="status">
      {result.passed ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
      <div>
        <b>{result.passed ? "Correct: the model agrees." : "Not yet."}</b>
        {result.feedback.length > 0 && <ul>{result.feedback.map((f) => <li key={f}>{f}</li>)}</ul>}
      </div>
    </div>
  );
}

function Classify({ challenge, variant, onSubmit }: { challenge: Extract<Challenge, { kind: "classify" }>; variant: string; onSubmit: (s: Submission) => void }) {
  const items = challenge.variants.find((v) => v.id === variant)!.items;
  const [answers, setAnswers] = useState<("authn" | "authz" | null)[]>(() => items.map(() => null));
  return (
    <form className="ch-form" onSubmit={(e) => { e.preventDefault(); onSubmit({ kind: "classify", answers }); }}>
      {items.map((item, i) => (
        <fieldset key={item.text} className="ch-item">
          <legend>{item.text}</legend>
          {(["authn", "authz"] as const).map((v) => (
            <label key={v}><input type="radio" name={`item-${i}`} checked={answers[i] === v} onChange={() => setAnswers(answers.map((a, j) => (j === i ? v : a)))} /> {v === "authn" ? "Authentication" : "Authorization"}</label>
          ))}
        </fieldset>
      ))}
      <button type="submit" className="button primary">Check my answers</button>
    </form>
  );
}

function Diagnose({ challenge, variant, onSubmit }: { challenge: Extract<Challenge, { kind: "diagnose" }>; variant: string; onSubmit: (s: Submission) => void }) {
  const v = challenge.variants.find((x) => x.id === variant)!;
  const run = useMemo(() => runOf(v.scenario, v.config), [variant]);
  const [step, setStep] = useState<number | null>(null);
  const [cause, setCause] = useState<string | null>(null);
  return (
    <div className="ch-diagnose">
      <div className="ch-trace">
        <h2>The trace</h2>
        <p className="muted">Select a step to read it. Pass and fail marks are hidden: read each step's checks.</p>
        <Sequence run={run} at={step ?? -1} revealAll plain onSelect={setStep} label="The incident trace" />
      </div>
      <div className="ch-inspect">
        {step !== null ? <EventInspector run={run} event={run.events[step]} /> : <p className="muted">No step selected yet.</p>}
        <form className="ch-form" onSubmit={(e) => { e.preventDefault(); onSubmit({ kind: "diagnose", step, cause }); }}>
          <p><b>Selected step:</b> {step === null ? "none" : `${step + 1}. ${run.events[step].title}`}</p>
          <fieldset>
            <legend>What went wrong?</legend>
            {challenge.causes.map((c) => <label key={c.id}><input type="radio" name="cause" checked={cause === c.id} onChange={() => setCause(c.id)} /> {c.text}</label>)}
          </fieldset>
          <button type="submit" className="button primary">Submit my diagnosis</button>
        </form>
      </div>
    </div>
  );
}

function Configure({ challenge, variant, onSubmit, result }: { challenge: Extract<Challenge, { kind: "configure" }>; variant: string; onSubmit: (s: Submission) => void; result: Judgement | null }) {
  const scenario = findScenario(challenge.scenario)!;
  const v = challenge.variants.find((x) => x.id === variant)!;
  const [config, setConfig] = useState<Config>(() => parseConfig(scenario, v.start));
  const key = JSON.stringify(config);
  const run = useMemo(() => runOf(challenge.scenario, config), [key]);
  const playback = usePlayback(run, key);
  return (
    <div className="ch-configure">
      <form className="ch-form id-controls" onSubmit={(e) => { e.preventDefault(); onSubmit({ kind: "configure", config }); }}>
        <h2>Settings you can change</h2>
        {scenario.controls.filter((c) => challenge.editable.includes(c.id)).map((control) => (
          <label key={control.id} className="id-field">
            <span>{control.label}</span>
            <select value={config[control.id]} onChange={(e) => setConfig(parseConfig(scenario, { ...config, [control.id]: e.target.value }))}>
              {control.options.map((o) => <option key={o.value} value={o.value} disabled={o.when ? !o.when(config) : false}>{o.label}</option>)}
            </select>
            <small>{control.help}</small>
          </label>
        ))}
        <h3>Requirements</h3>
        <ul className="ch-reqs">{v.requirements.map((r) => <li key={r.label}>{r.label}</li>)}</ul>
        <div className="actions">
          <button type="submit" className="button primary">Check my configuration</button>
          <button type="button" className="text-button" onClick={() => setConfig(parseConfig(scenario, v.start))}><RotateCcw aria-hidden="true" className="inline-icon" /> Back to the broken setup</button>
        </div>
        <Result result={result} />
      </form>
      <Workbench run={run} playback={playback} />
    </div>
  );
}

function Policy({ challenge, variant, onSubmit }: { challenge: Extract<Challenge, { kind: "policy" }>; variant: string; onSubmit: (s: Submission) => void }) {
  const [rules, setRules] = useState<Rule[]>(() => [...policyStart(challenge, variant)]);
  const table = useMemo(() => audit(rules), [rules]);
  return (
    <form className="ch-form" onSubmit={(e) => { e.preventDefault(); onSubmit({ kind: "policy", rules }); }}>
      <fieldset className="az-rules">
        <legend>Rules the API enforces (token signature, issuer and expiry are always checked)</legend>
        {RULES.map((rule) => (
          <label key={rule} className="id-check-toggle">
            <input type="checkbox" checked={rules.includes(rule)} onChange={(e) => setRules(e.target.checked ? RULES.filter((r) => rules.includes(r) || r === rule) : rules.filter((r) => r !== rule))} />
            <span><b>{ruleInfo[rule].label}</b><small>{ruleInfo[rule].help}</small></span>
          </label>
        ))}
      </fieldset>
      <p className="muted">Test requests: {table.rows.length - table.tooPermissive - table.tooStrict} decided as a secure policy would. Open the <a {...linkProps("/practice/identity/authorization")}>Authorization Playground</a> to step through any request.</p>
      <button type="submit" className="button primary">Check my policy</button>
    </form>
  );
}

function IdentityChallengePage({ challenge }: { challenge: Challenge }) {
  const storage = useMemo(safeStorage, []);
  const [record, setRecord] = useState(() => challengeRecordFor(loadIdentityProgress(storage), challenge.id, challenge.version));
  const ids = challenge.variants.map((v) => v.id);
  const [variant, setVariant] = useState(() => (record && ids.includes(record.variant) ? record.variant : ids[0]));
  const [result, setResult] = useState<Judgement | null>(null);
  const [hints, setHints] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    document.title = `${challenge.title} · Identity challenges · Kitab`;
  }, [challenge]);
  const state = challengeState(record);
  const submit = (s: Submission) => {
    const judged = judge(challenge, variant, s);
    setResult(judged);
    const saved = recordAttempt(storage, challenge.id, challenge.version, variant, judged.passed, ids.length);
    setSaveFailed(!saved.saved);
    setRecord(challengeRecordFor(saved, challenge.id, challenge.version));
  };
  const another = () => {
    const passed = record?.passed ?? [];
    const next = ids.find((id) => id !== variant && !passed.includes(id)) ?? ids[(ids.indexOf(variant) + 1) % ids.length];
    const saved = chooseVariant(storage, challenge.id, challenge.version, next);
    setRecord(challengeRecordFor(saved, challenge.id, challenge.version));
    setVariant(next);
    setResult(null);
    setHints(0);
    setAttempt((n) => n + 1);
  };
  const v = challenge.variants.find((x) => x.id === variant)!;
  const story = "story" in v ? v.story : null;
  const next = locate(`idc:${challenge.id}`)?.next;
  const body = (() => {
    const k = `${variant}:${attempt}`;
    if (challenge.kind === "classify") return <Classify key={k} challenge={challenge} variant={variant} onSubmit={submit} />;
    if (challenge.kind === "diagnose") return <Diagnose key={k} challenge={challenge} variant={variant} onSubmit={submit} />;
    if (challenge.kind === "configure") return <Configure key={k} challenge={challenge} variant={variant} onSubmit={submit} result={result} />;
    if (challenge.kind === "policy") return <Policy key={k} challenge={challenge} variant={variant} onSubmit={submit} />;
    const d = challenge.variants.find((x) => x.id === variant)!;
    return <DecisionCard key={k} decision={d} right={undefined} onAnswer={(correct) => {
      const saved = recordAttempt(storage, challenge.id, challenge.version, variant, correct, ids.length);
      setSaveFailed(!saved.saved);
      setRecord(challengeRecordFor(saved, challenge.id, challenge.version));
      setResult(correct ? { passed: true, feedback: [] } : null);
    }} />;
  })();

  return (
    <main id="main" className="page lab-page identity-challenge lab-theme">
      <header className="playground-heading">
        <div>
          <p className="eyebrow">Identity &amp; security · Challenge</p>
          <h1>{challenge.title}</h1>
          <p>{challenge.situation}</p>
        </div>
        <p className="heading-links"><a {...linkProps(identityUnitPath(challenge.unit))}>Learn first: the lesson</a> · <a {...linkProps("/practice?track=identity")}>All challenges</a></p>
      </header>
      <section className="ch-brief" aria-label="Your task">
        <p><span className={`status-chip status-${state}`}>{practiceLabels[state]}</span> {ids.length > 1 ? `Version ${ids.indexOf(variant) + 1} of ${ids.length}. ${state === "mastered" ? "Mastered." : "Pass two different versions to master it."}` : "One version."}</p>
        {story && <p className="ch-story"><b>The report:</b> {story}</p>}
        <p><b>Goal:</b> {challenge.objective}</p>
        <div className="ch-hints">
          {challenge.hints.slice(0, hints).map((h) => <p key={h}><Lightbulb aria-hidden="true" className="inline-icon" /> {h}</p>)}
          {hints < challenge.hints.length && <button type="button" className="text-button" onClick={() => setHints(hints + 1)}>{hints === 0 ? "Show a hint" : "Show another hint"}</button>}
        </div>
      </section>
      {saveFailed && <p className="inline-issue is-warning">This browser didn't save your progress (storage full or blocked).</p>}
      {body}
      {challenge.kind !== "configure" && challenge.kind !== "decision" && <Result result={result} />}
      {result?.passed && (
        <section className="lesson-next" aria-label="Next">
          {ids.length > 1 && state !== "mastered" && <button type="button" className="button" onClick={another}>Try another version</button>}
          {next && <a className="button primary" {...linkProps(next.path)}>Next: {next.title} <ArrowRight aria-hidden="true" /></a>}
        </section>
      )}
      {!result?.passed && ids.length > 1 && <p><button type="button" className="text-button" onClick={another}>Switch to another version</button></p>}
      <p className="muted">Judged by Kitab's deterministic models in this browser: formative feedback, not a secure exam.</p>
    </main>
  );
}
