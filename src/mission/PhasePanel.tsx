import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, Eye, FlaskConical, RefreshCw, Sparkles, X } from "lucide-react";
import { fillTemplate, optionOrder, resolvePredictionOptions, type PredictionAnswer } from "../learning/assessment.ts";
import { REASONING_LIMIT, type MissionState, type ParamsExpectation } from "../learning/mission-controller.ts";
import type { Mission } from "../learning/mission-schema.ts";
import type { FactValue, Trace } from "../learning/types.ts";
import { linkProps } from "../app/router.ts";
import { ApiError, composeScenario } from "../app/api.ts";

const steps = [
  { id: "inspect", label: "Inspect" },
  { id: "predict", label: "Predict" },
  { id: "run", label: "Run" },
  { id: "explain", label: "Explain" },
] as const;

function Stepper({ phase }: { phase: MissionState["phase"] }) {
  const position = phase === "result" ? 4 : steps.findIndex((step) => step.id === phase);
  return (
    <ol className="stepper" aria-label="Mission progress">
      {steps.map((step, index) => (
        <li key={step.id} className={index < position ? "is-done" : index === position ? "is-current" : ""} aria-current={index === position ? "step" : undefined}>
          <span aria-hidden="true">{index < position ? <Check /> : index + 1}</span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

type ApplyParams = (params: Record<string, FactValue>, expect: ParamsExpectation) => boolean;

function DescribeScenario({ mission, expect, onApply }: { mission: Mission; expect: ParamsExpectation; onApply: ApplyParams }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ busy: boolean; message: string }>({ busy: false, message: "" });
  const pending = useRef<AbortController | null>(null);
  // A request belongs to the attempt and settings it started from: changing either (or leaving) cancels it.
  const contextKey = `${expect.attemptId}|${JSON.stringify(expect.params)}`;
  useEffect(() => () => {
    if (pending.current && !pending.current.signal.aborted) {
      pending.current.abort();
      setStatus({ busy: false, message: "Cancelled: the settings changed before Kitab answered." });
    }
  }, [contextKey]);
  async function apply() {
    if (text.trim().length < 3) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const basedOn = expect;
    setStatus({ busy: true, message: "" });
    try {
      const scenario = await composeScenario(mission.id, mission.version, text.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setStatus({ busy: false, message: onApply(scenario.params, basedOn) ? "Applied. The engine checked this scenario; review the controls above." : "Not applied: the attempt changed while Kitab was checking." });
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus({ busy: false, message: error instanceof ApiError ? error.message : "That description couldn't be applied." });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }
  return (
    <div className="describe">
      <label className="field">
        <span>Or describe it <em className="muted">(AI maps it onto these controls; the engine validates it)</em></span>
        <input type="text" maxLength={300} value={text} placeholder="e.g. a small 1,500-byte transfer where a segment is lost" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void apply(); } }} />
      </label>
      <button type="button" className="button" onClick={() => void apply()} disabled={status.busy || text.trim().length < 3}>{status.busy ? "Checking…" : "Apply description"}</button>
      <p role="status" className="small muted">{status.message}</p>
    </div>
  );
}

function LearnerParams({ mission, params, expect, onChange, onApply }: { mission: Mission; params: Record<string, FactValue>; expect: ParamsExpectation; onChange: (key: string, value: FactValue) => void; onApply: ApplyParams }) {
  const id = useId();
  if (!mission.learnerParams.length) return null;
  return (
    <fieldset className="params">
      <legend><FlaskConical aria-hidden="true" /> Set up the experiment</legend>
      {mission.learnerParams.map((param) => {
        const value = params[param.key];
        if (param.control === "choice") {
          const options = param.options.filter((option) => !option.onlyWhen || option.onlyWhen.values.includes(params[option.onlyWhen.key]));
          return (
            <label className="field" key={param.key}>
              <span>{param.label}</span>
              <select value={String(value)} onChange={(event) => onChange(param.key, options.find((option) => String(option.value) === event.target.value)!.value)}>
                {options.map((option) => <option value={String(option.value)} key={String(option.value)}>{option.label}</option>)}
              </select>
            </label>
          );
        }
        return (
          <label className="field" key={param.key} htmlFor={`${id}-${param.key}`}>
            <span>{param.label} <output>{String(value)}{param.unit ? ` ${param.unit}` : ""}</output></span>
            <input id={`${id}-${param.key}`} type="range" min={param.min} max={param.max} step={param.step} value={Number(value)} onChange={(event) => onChange(param.key, Number(event.target.value))} />
          </label>
        );
      })}
      <p className="muted small">Changing a setting rebuilds the engine trace. Your prediction is collected afterwards.</p>
      <DescribeScenario mission={mission} expect={expect} onApply={onApply} />
    </fieldset>
  );
}

export function PhasePanel({
  mission,
  trace,
  state,
  onBegin,
  onPredict,
  onSkip,
  onExplain,
  onReflection,
  onRetry,
  onShowEvidence,
  onParam,
  onParams,
  nextMissionId,
}: {
  mission: Mission;
  trace: Trace;
  state: MissionState;
  onBegin: () => void;
  onPredict: (answer: PredictionAnswer, reasoning: string) => void;
  onSkip: () => void;
  onExplain: (choiceId: string) => void;
  onReflection: (text: string) => void;
  onRetry: () => void;
  onShowEvidence: () => void;
  onParam: (key: string, value: FactValue) => void;
  onParams: ApplyParams;
  nextMissionId?: string;
}) {
  const { phase, attempt } = state;
  const ids = useId();
  const [choice, setChoice] = useState<string>("");
  const [number, setNumber] = useState("");
  const [reasoning, setReasoning] = useState(attempt.prediction?.reasoning ?? "");
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  // Reset local form state for a new attempt; move focus to the phase heading on phase change.
  useEffect(() => {
    setChoice("");
    setNumber("");
    setReasoning("");
    setExplanation("");
    setError("");
  }, [attempt.id]);
  // Move focus only on a real phase transition (not on mount, not on StrictMode re-runs).
  const previousPhase = useRef(phase);
  useEffect(() => {
    if (previousPhase.current === phase) return;
    previousPhase.current = phase;
    // inspect → predict happens when the learner focuses an answer; moving focus then would steal it.
    if (phase !== "predict") heading.current?.focus();
  }, [phase]);

  const options = resolvePredictionOptions(mission, trace);
  const ordered = attempt.optionOrder.map((id) => options.find((option) => option.id === id)).filter((option) => option !== undefined);
  const prompt = fillTemplate(mission.prediction.prompt, trace);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mission.prediction.kind === "choice") {
      if (!choice) return setError("Choose an answer first.");
      onPredict({ optionId: choice }, reasoning);
    } else {
      const value = Number(number);
      if (number.trim() === "" || !Number.isFinite(value) || value < mission.prediction.min || value > mission.prediction.max) {
        return setError(`Enter a whole number from ${mission.prediction.min} to ${mission.prediction.max}.`);
      }
      onPredict({ number: Math.trunc(value) }, reasoning);
    }
  }

  const predictedText = attempt.prediction
    ? "optionId" in attempt.prediction.answer
      ? options.find((option) => option.id === (attempt.prediction!.answer as { optionId: string }).optionId)?.text
      : `${(attempt.prediction.answer as { number: number }).number}${mission.prediction.kind === "numeric" && mission.prediction.unit ? ` ${mission.prediction.unit}` : ""}`
    : null;
  const expectedKey = mission.prediction.answer.fact.split(".")[1];
  const expected = trace.outcome[expectedKey];
  const expectedText = mission.prediction.kind === "choice" ? options.find((option) => option.value === expected)?.text : `${expected}${mission.prediction.unit ? ` ${mission.prediction.unit}` : ""}`;
  const explanationOrder = optionOrder(`${mission.id}:${attempt.id}:explain`, mission.explanation.options.map((option) => option.id));

  return (
    <section className="phase card" aria-labelledby={`${ids}-heading`}>
      <Stepper phase={phase} />
      {(phase === "inspect" || phase === "predict") && (
        <form onSubmit={submit} noValidate>
          <h2 id={`${ids}-heading`} ref={heading} tabIndex={-1} className="phase-title">{phase === "inspect" ? "Inspect, then predict" : "Your prediction"}</h2>
          {phase === "inspect" && <LearnerParams mission={mission} params={trace.params} expect={{ attemptId: attempt.id, params: attempt.params }} onChange={onParam} onApply={onParams} />}
          <fieldset className="prediction" onFocus={phase === "inspect" ? onBegin : undefined}>
            <legend>{prompt}</legend>
            {mission.prediction.kind === "choice" ? (
              <div className="choices">
                {ordered.map((option, index) => (
                  <label className={`choice ${choice === option.id ? "is-chosen" : ""}`} key={option.id}>
                    <input type="radio" name={`${ids}-prediction`} value={option.id} checked={choice === option.id} onChange={() => { setChoice(option.id); setError(""); }} />
                    <span className="choice-key" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
                    <span>{option.text}</span>
                  </label>
                ))}
              </div>
            ) : (
              <label className="field numeric">
                <span>Your number{mission.prediction.unit ? ` (${mission.prediction.unit})` : ""}</span>
                <input type="number" inputMode="numeric" min={mission.prediction.min} max={mission.prediction.max} step={1} value={number} onChange={(event) => { setNumber(event.target.value); setError(""); }} />
              </label>
            )}
          </fieldset>
          <label className="field">
            <span>Why? <em className="muted">(optional, saved with your attempt)</em></span>
            <textarea rows={2} maxLength={REASONING_LIMIT} value={reasoning} onChange={(event) => setReasoning(event.target.value)} />
          </label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="actions">
            <button type="submit" className="button primary">Test prediction</button>
            <button type="button" className="text-button" onClick={onSkip}>Just watch (no credit)</button>
          </div>
        </form>
      )}

      {phase === "run" && (
        <div>
          <h2 id={`${ids}-heading`} ref={heading} tabIndex={-1} className="phase-title">Running the system</h2>
          {predictedText ? <p>You predicted <b>{predictedText}</b>. Watch the highlighted state; the run ends on the last step.</p> : <p>You're watching without a prediction, so this attempt won't count toward mastery.</p>}
          {attempt.prediction?.reasoning && <p className="quote">“{attempt.prediction.reasoning}”</p>}
        </div>
      )}

      {phase === "explain" && (
        <form onSubmit={(event) => { event.preventDefault(); if (explanation) onExplain(explanation); else setError("Choose the evidence first."); }} noValidate>
          <h2 id={`${ids}-heading`} ref={heading} tabIndex={-1} className="phase-title">Explain what happened</h2>
          {attempt.prediction ? (
            <div className={`verdict ${attempt.prediction.correct ? "is-right" : "is-wrong"}`} role="status">
              {attempt.prediction.correct ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
              <p>
                {attempt.prediction.correct ? <>Your prediction matched: <b>{expectedText}</b>.</> : <>You predicted <b>{predictedText}</b>. The engine computed <b>{expectedText}</b>.</>}
              </p>
            </div>
          ) : <p>The engine computed <b>{expectedText}</b>.</p>}
          <button type="button" className="button" onClick={onShowEvidence}><Eye aria-hidden="true" /> Show me the evidence</button>
          <fieldset className="prediction">
            <legend>{mission.explanation.prompt}</legend>
            <div className="choices">
              {explanationOrder.map((id, index) => {
                const option = mission.explanation.options.find((item) => item.id === id)!;
                return (
                  <label className={`choice ${explanation === id ? "is-chosen" : ""}`} key={id}>
                    <input type="radio" name={`${ids}-explain`} value={id} checked={explanation === id} onChange={() => { setExplanation(id); setError(""); }} />
                    <span className="choice-key" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
                    <span>{fillTemplate(option.text, trace)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="actions"><button type="submit" className="button primary">Check explanation</button></div>
        </form>
      )}

      {phase === "result" && (
        <div>
          <h2 id={`${ids}-heading`} ref={heading} tabIndex={-1} className="phase-title">{attempt.mastered ? "Mission mastered" : "Not mastered yet"}</h2>
          <ul className="result-list">
            <li className={attempt.prediction?.correct ? "is-right" : "is-wrong"}>{attempt.skippedPrediction ? "No prediction (watched only)" : attempt.prediction?.correct ? "Prediction correct" : "Prediction missed"}</li>
            <li className={attempt.explanation?.correct ? "is-right" : "is-wrong"}>{attempt.explanation?.correct ? "Evidence identified" : "Evidence missed"}</li>
          </ul>
          {attempt.mastered ? (
            <p><Sparkles aria-hidden="true" className="inline-icon" /> You predicted the outcome and explained it from the evidence.</p>
          ) : (
            <p>Mastery needs a correct prediction and the right evidence in the same attempt. The retry uses a new scenario, so reason from the mechanism rather than the last answer.</p>
          )}
          {!attempt.explanation?.correct && attempt.explanation && <p className="muted">The evidence you chose doesn't match the trace. The correct one: “{fillTemplate(mission.explanation.options.find((option) => option.correct)!.text, trace)}”</p>}
          <label className="field">
            <span>Reflection <em className="muted">(optional, not graded)</em></span>
            <textarea rows={2} maxLength={REASONING_LIMIT} defaultValue={attempt.reflection} onBlur={(event) => onReflection(event.target.value)} />
          </label>
          <div className="actions">
            <button type="button" className={`button ${attempt.mastered ? "" : "primary"}`} onClick={onRetry}><RefreshCw aria-hidden="true" /> {attempt.mastered ? "Try another scenario" : "Retry with a new scenario"}</button>
            {nextMissionId && <a className={`button ${attempt.mastered ? "primary" : ""}`} {...linkProps(`/missions/${nextMissionId}`)}>Next mission</a>}
          </div>
        </div>
      )}
    </section>
  );
}
