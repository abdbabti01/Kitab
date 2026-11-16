import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen, CircleCheck, CircleX, Eye, FlaskConical, Lightbulb, ListChecks, Pause, Play, RotateCcw, SkipBack, SkipForward, StepBack, StepForward, Trophy, Wrench } from "lucide-react";
import { safeStorage } from "../../learning/progress.ts";
import { PathNext } from "../../app/NetworkingPath.tsx";
import { linkProps } from "../../app/router.ts";
import { activityState, type Evidence } from "../../learning/networking-path.ts";
import { findConceptUnitTitle } from "../catalog.ts";
import { practiceLabels } from "../../learning/practice-state.ts";
import { findTrack } from "../../learning/tracks.ts";
import { labPath, lessonPath } from "../catalog.ts";
import { findLab } from "../labs/index.ts";
import { evaluateLab, parseConfig, predictionAnswer, predictionOptions, predictionVariant, questionFor, runLab, type Control, type Lab, type LabConfig, type LabEvaluation, type LabEvent, type LabScenario } from "../labs/kernel.ts";
import { currentAttempt, labRecordFor, loadLabProgress, recordAnswer, recordLabCheck, recordPrediction, saveLabConfig, startAttempt, type LabRecord } from "../labs/progress.ts";
import "./architecture.css";
import "./labs.css";

const ms = (t: number) => (t >= 10_000 ? `${(t / 1000).toFixed(1)} s` : `${Math.round(t).toLocaleString("en")} ms`);

/** Playback over one run's events: everything shown reads the fold up to the cursor. */
function useCursor(events: LabEvent[]) {
  const [cursor, setCursor] = useState(events.length - 1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setCursor(events.length - 1);
    setPlaying(false);
  }, [events]);
  useEffect(() => {
    if (!playing) return;
    if (cursor >= events.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setCursor((c) => Math.min(events.length - 1, c + 1)), 450);
    return () => window.clearTimeout(timer);
  }, [playing, cursor, events.length]);
  const play = () => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (cursor >= events.length - 1) setCursor(0);
    if (reduced) setCursor(events.length - 1);
    else setPlaying(true);
  };
  return { cursor, setCursor: (c: number) => { setPlaying(false); setCursor(Math.max(0, Math.min(events.length - 1, c))); }, playing, play, pause: () => setPlaying(false) };
}

function SequenceView({ lanes, events, cursor, onPick }: { lanes: { id: string; label: string }[]; events: LabEvent[]; cursor: number; onPick: (i: number) => void }) {
  const col = (id: string) => Math.max(0, lanes.findIndex((l) => l.id === id));
  const label = (id: string) => lanes.find((l) => l.id === id)?.label ?? id;
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView?.({ block: "nearest" });
  }, [cursor]);
  return (
    <div className="seq" style={{ "--lanes": lanes.length } as CSSProperties}>
      <div className="seq-head" aria-hidden="true">
        <span />
        <span className="seq-lanes">{lanes.map((l) => <b key={l.id}>{l.label}</b>)}</span>
        <span />
      </div>
      <ol className="seq-rows" aria-label="What happened, in order">
        {events.map((e) => {
          const from = col(e.actor);
          const to = e.to ? col(e.to) : from;
          const [a, b] = [Math.min(from, to), Math.max(from, to)];
          return (
            <li key={e.i} className={`seq-row tone-${e.tone}${e.i > cursor ? " is-future" : ""}${e.i === cursor ? " is-current" : ""}`}>
              <button type="button" ref={e.i === cursor ? current : undefined} aria-current={e.i === cursor ? "step" : undefined} onClick={() => onPick(e.i)}>
                <time>{ms(e.t)}</time>
                <span className="seq-lanes" aria-hidden="true">
                  {e.kind === "message" ? (
                    <i className={`seq-arrow${to < from ? " is-left" : ""}${e.lost ? " is-lost" : ""}`} style={{ gridColumn: `${a + 1} / ${b + 2}`, "--span": b - a + 1 } as CSSProperties} />
                  ) : (
                    <i className={`seq-dot kind-${e.kind}`} style={{ gridColumn: `${from + 1}` }} />
                  )}
                </span>
                <span className="seq-text">
                  <small>{e.kind === "message" ? `${label(e.actor)} → ${label(e.to!)}` : label(e.actor)}{e.lost ? " · lost" : ""}</small>
                  {e.text}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SeriesView({ lab, events, cursor }: { lab: Lab; events: LabEvent[]; cursor: number }) {
  const [table, setTable] = useState(false);
  if (lab.view.kind !== "series") return null;
  const { lines, limit } = lab.view;
  const ticks = events.filter((e) => e.kind === "tick");
  const w = 640;
  const h = 180;
  const maxT = Math.max(1, ...ticks.map((e) => e.t));
  const maxY = Math.max(1, ...ticks.flatMap((e) => [...lines.map((l) => e.data?.[l.key] ?? 0), limit ? e.data?.[limit.key] ?? 0 : 0]));
  const x = (t: number) => (t / maxT) * w;
  const y = (v: number) => h - (v / maxY) * (h - 8);
  const cursorT = events[cursor]?.t ?? 0;
  const shown = ticks.filter((e) => e.i <= cursor);
  const path = (key: string) => shown.map((e, i) => `${i ? "L" : "M"}${x(e.t).toFixed(1)},${y(e.data?.[key] ?? 0).toFixed(1)}`).join(" ");
  const last = shown.at(-1);
  return (
    <figure className="series">
      <figcaption>
        <span className="legend">
          {lines.map((l, i) => <span key={l.key}><i className={`swatch line-${i}`} /> {l.label}</span>)}
          {limit && <span><i className="swatch limit" /> {limit.label}</span>}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h + 18}`} role="img" aria-label={`Chart up to ${ms(cursorT)}${last ? `: ${lines.map((l) => `${l.label} ${last.data?.[l.key] ?? 0}`).join(", ")}` : ""}.`}>
        <line className="axis" x1={0} x2={w} y1={h} y2={h} />
        {limit && <path className="limit-line" d={ticks.map((e, i) => `${i ? "L" : "M"}${x(e.t).toFixed(1)},${y(e.data?.[limit.key] ?? 0).toFixed(1)}`).join(" ")} />}
        {lines.map((l, i) => <path key={l.key} className={`series-line line-${i}`} d={path(l.key)} />)}
        <line className="cursor" x1={x(cursorT)} x2={x(cursorT)} y1={0} y2={h} />
        <text className="tick" x={0} y={h + 14}>0 s</text>
        <text className="tick" x={w} y={h + 14} textAnchor="end">{ms(maxT)}</text>
        <text className="tick" x={4} y={12}>{Math.round(maxY).toLocaleString("en")}</text>
      </svg>
      <details className="chart-table" onToggle={(event) => setTable(event.currentTarget.open)}>
        <summary>Show as a table</summary>
        {table && (
          <table>
            <thead><tr><th scope="col">Time</th>{lines.map((l) => <th key={l.key} scope="col">{l.label}</th>)}{limit && <th scope="col">{limit.label}</th>}</tr></thead>
            <tbody>{shown.map((e) => <tr key={e.i}><td>{ms(e.t)}</td>{lines.map((l) => <td key={l.key}>{e.data?.[l.key] ?? 0}</td>)}{limit && <td>{e.data?.[limit.key] ?? 0}</td>}</tr>)}</tbody>
          </table>
        )}
      </details>
    </figure>
  );
}

/** One run of the lab, played back: the sequence or chart, the numbers so far, and what it means. */
function RunViewer({ lab, config, scenario, title }: { lab: Lab; config: LabConfig; scenario: LabScenario; title: string }) {
  const run = useMemo(() => runLab(lab, config, scenario), [lab, config, scenario]);
  const { cursor, setCursor, playing, play, pause } = useCursor(run.events);
  const facts = useMemo(() => lab.facts(run.events.slice(0, cursor + 1)), [lab, run, cursor]);
  const atEnd = cursor >= run.events.length - 1;
  const event = run.events[cursor];
  return (
    <section className="lab-run" aria-label={title}>
      <h3>{title}</h3>
      <div className="playback">
        <button type="button" className="icon-button" onClick={() => setCursor(0)} aria-label="First event"><SkipBack aria-hidden="true" /></button>
        <button type="button" className="icon-button" onClick={() => setCursor(cursor - 1)} aria-label="Previous event" disabled={cursor <= 0}><StepBack aria-hidden="true" /></button>
        {playing ? <button type="button" className="button" onClick={pause}><Pause aria-hidden="true" /> Pause</button> : <button type="button" className="button" onClick={play}><Play aria-hidden="true" /> Replay</button>}
        <button type="button" className="icon-button" onClick={() => setCursor(cursor + 1)} aria-label="Next event" disabled={atEnd}><StepForward aria-hidden="true" /></button>
        <button type="button" className="icon-button" onClick={() => setCursor(run.events.length - 1)} aria-label="Last event"><SkipForward aria-hidden="true" /></button>
        <span className="clock">Event {cursor + 1} of {run.events.length} · {ms(event?.t ?? 0)}</span>
      </div>
      {event && <p className={`current-event tone-${event.tone}`} aria-live="polite">{event.text}</p>}
      <dl className="run-stats">
        {lab.shown.map((s) => (
          <div key={s.key}>
            <dt>{s.label}</dt>
            <dd className={s.bad === "above-zero" && facts[s.key] > 0 ? "is-bad" : undefined}>{(facts[s.key] ?? 0).toLocaleString("en")}</dd>
          </div>
        ))}
      </dl>
      {lab.view.kind === "sequence" ? <SequenceView lanes={lab.view.lanes} events={run.events} cursor={cursor} onPick={setCursor} /> : <SeriesView lab={lab} events={run.events} cursor={cursor} />}
      {run.cutShort && <p className="run-stale">This run hit the event limit and was cut short; its numbers cover only what happened before.</p>}
      {atEnd ? <p className="notice"><b>What happened:</b> {lab.explain(run.facts, config)}</p> : <p className="muted">Step to the end to see what the whole run means.</p>}
    </section>
  );
}

function ControlField({ control, value, locked, onChange }: { control: Control; value: LabConfig[string]; locked: boolean; onChange: (v: LabConfig[string]) => void }) {
  const id = `ctl-${control.id}`;
  if (control.type === "toggle") {
    return (
      <div className="arch-field is-check">
        <label htmlFor={id}><input id={id} type="checkbox" checked={value === true} disabled={locked} onChange={(e) => onChange(e.target.checked)} /> {control.label}</label>
        <small>{control.help}{locked ? " Fixed in this lab." : ""}</small>
      </div>
    );
  }
  return (
    <div className="arch-field">
      <label htmlFor={id}>{control.label}{control.type === "number" && control.unit ? <span className="unit"> ({control.unit})</span> : null}</label>
      {control.type === "select" ? (
        <select id={id} value={String(value)} disabled={locked} onChange={(e) => onChange(e.target.value)}>
          {control.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input id={id} type="number" inputMode="numeric" min={control.min} max={control.max} step={control.step} value={Number(value)} disabled={locked}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(control.max, Math.max(control.min, Math.round((n - control.min) / control.step) * control.step + control.min)));
          }} />
      )}
      <small>{control.help}{locked ? " Fixed in this lab." : ""}</small>
    </div>
  );
}

function Results({ lab, result }: { lab: Lab; result: LabEvaluation }) {
  const title = (id: string) => lab.scenarios.find((s) => s.id === id)!.title;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [result]);
  return (
    <section className={`check-results ${result.passed ? "is-passed" : "is-failed"}`} aria-labelledby="lab-results-title">
      <h3 id="lab-results-title" tabIndex={-1} ref={heading}>{result.passed ? "Every requirement is met in every scenario" : `${result.checks.filter((c) => c.passed).length} of ${result.checks.length} requirements met`}</h3>
      {lab.scenarios.filter((s) => result.checks.some((c) => c.scenario === s.id)).map((s) => (
        <div key={s.id} className="result-group">
          <h4>{title(s.id)}</h4>
          <ul>
            {result.checks.filter((c) => c.scenario === s.id).map((check) => (
              <li key={check.id} className={check.passed ? "is-pass" : "is-fail"}>
                {check.passed ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
                <span><span className="sr-only">{check.passed ? "Met: " : "Not met: "}</span><b>{check.requirement}</b><small>{check.observed}</small></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="muted">Judged only from runs of your configuration in each scenario. Any configuration that meets every requirement passes.</p>
    </section>
  );
}

function Choice({ name, legend, options, onSubmit, disabled, submitLabel, numeric }: { name: string; legend: string; options: { label: ReactNode; value: number }[]; onSubmit: (value: number) => void; disabled?: boolean; submitLabel: string; numeric?: boolean }) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <form className={`lab-choice${numeric ? " is-numeric" : ""}`} onSubmit={(e) => { e.preventDefault(); if (picked !== null) onSubmit(picked); }}>
      <fieldset disabled={disabled}>
        <legend>{legend}</legend>
        {options.map((o) => (
          <label key={o.value} className={picked === o.value ? "is-picked" : undefined}>
            <input type="radio" name={name} value={o.value} checked={picked === o.value} onChange={() => setPicked(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
      <button type="submit" className="button primary" disabled={disabled || picked === null}>{submitLabel}</button>
    </form>
  );
}

const steps = [
  { id: "understand", label: "Understand", icon: BookOpen },
  { id: "observe", label: "Observe", icon: Eye },
  { id: "fix", label: "Fix", icon: Wrench },
  { id: "master", label: "Master", icon: Trophy },
] as const;

/** /practice/architecture/labs/:id: one lab, from the broken system to a fix you can explain. */
export function LabPage({ lab }: { lab: Lab }) {
  const storage = safeStorage();
  const [record, setRecord] = useState<LabRecord | undefined>(() => labRecordFor(loadLabProgress(storage), lab.id, lab.version));
  const attempt = currentAttempt(record);
  const index = record && attempt ? record.attempts.length - 1 : 0;
  const variant = lab.prediction.variants.find((v) => v.id === attempt?.variant) ?? predictionVariant(lab, index);
  const question = lab.questions.find((q) => q.id === attempt?.question) ?? questionFor(lab, index);
  const answer = useMemo(() => predictionAnswer(lab, variant), [lab, variant]);
  const observeConfig = useMemo(() => ({ ...lab.starter, ...variant.config }), [lab, variant]);
  const [config, setConfig] = useState<LabConfig>(() => parseConfig(lab, record?.config) ?? { ...lab.starter });
  const [scenarioId, setScenarioId] = useState(lab.scenarios[0].id);
  const [tried, setTried] = useState<{ config: LabConfig; scenario: LabScenario } | null>(null);
  const [result, setResult] = useState<LabEvaluation | null>(null);
  const [hints, setHints] = useState(0);
  const unitTitle = findConceptUnitTitle(lab.unit);
  const unitDone = Boolean(loadLabProgress(storage).units[lab.unit]?.completedAt);
  const predicted = attempt?.predicted;
  const passed = Boolean(attempt?.passedAt);
  const answered = attempt?.answered;

  useEffect(() => {
    document.title = `${lab.title} · Architecture lab · Kitab`;
  }, [lab]);
  // The working configuration is kept a moment after the last change.
  useEffect(() => {
    if (!record) return;
    const timer = window.setTimeout(() => setRecord((r) => labRecordFor(saveLabConfig(storage, lab.id, lab.version, config), lab.id, lab.version) ?? r), 400);
    return () => window.clearTimeout(timer);
  }, [config]);

  const refresh = (progress: ReturnType<typeof loadLabProgress>) => setRecord(labRecordFor(progress, lab.id, lab.version));
  const predict = (value: number) => {
    if (!attempt) startAttempt(storage, lab.id, lab.version, variant.id, question.id);
    refresh(recordPrediction(storage, lab.id, lab.version, value, value === answer));
  };
  const check = () => {
    const evaluation = evaluateLab(lab, config);
    setResult(evaluation);
    refresh(recordLabCheck(storage, lab.id, lab.version, evaluation.passed));
  };
  const respond = (choice: number) => refresh(recordAnswer(storage, lab.id, lab.version, choice, question.options[choice]?.correct === true));
  const another = () => {
    const next = (record?.attempts.length ?? 0);
    refresh(startAttempt(storage, lab.id, lab.version, predictionVariant(lab, next).id, questionFor(lab, next).id));
    setConfig({ ...lab.starter });
    setResult(null);
    setTried(null);
    setHints(0);
    window.scrollTo?.({ top: 0 });
  };
  const change = (id: string, value: LabConfig[string]) => {
    setConfig((c) => ({ ...c, [id]: value }));
    setResult(null);
  };

  const status = record?.masteredAt ? "mastered" : record?.passedAt ? "completed" : predicted ? "in-progress" : "not-started";
  const reached = { understand: unitDone, observe: Boolean(predicted), fix: passed, master: Boolean(attempt?.masteredAt) };

  return (
    <main id="main" className="page lab-page arch-playground arch-lab lab-theme">
      <header className="playground-heading">
        <div>
          <p className="eyebrow"><FlaskConical aria-hidden="true" /> Architecture lab · {practiceLabels[status]}</p>
          <h1>{lab.title}</h1>
          <p>{lab.summary}</p>
        </div>
        <p className="heading-links"><a {...linkProps("/practice/architecture/labs")}>All labs</a></p>
      </header>

      <ol className="lab-steps" aria-label="Lab steps">
        {steps.map((s) => (
          <li key={s.id} className={reached[s.id] ? "is-done" : undefined}>
            <s.icon aria-hidden="true" /> <span>{s.label}</span>{reached[s.id] && <span className="sr-only"> (done)</span>}
          </li>
        ))}
      </ol>

      <div className="lab-grid">
        <section className="lab-card" aria-labelledby="problem-title">
          <h2 id="problem-title">The problem</h2>
          {lab.story.map((p) => <p key={p}>{p}</p>)}
          {unitTitle && <p><a {...linkProps(lessonPath(lab.unit))}><BookOpen aria-hidden="true" className="inline-icon" /> {unitDone ? "Review" : "Learn first"}: {unitTitle}</a></p>}
        </section>
        <section className="lab-card" aria-labelledby="model-title">
          <h2 id="model-title">What this lab models</h2>
          <ul>{lab.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          <details className="modelled">
            <summary>What it leaves out</summary>
            <ul>{lab.notModelled.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
        </section>
      </div>

      <section className="lab-stage" aria-labelledby="observe-title">
        <h2 id="observe-title"><Eye aria-hidden="true" /> Observe: predict, then watch</h2>
        <p className="lab-given">Today's system:</p>
        <Settings lab={lab} config={observeConfig} />
        <p className="lab-given">Scenario: <b>{variant.scenario.title}</b>. {variant.scenario.description}</p>
        {!predicted ? (
          <Choice key={variant.id} name="prediction" legend={variant.question} options={predictionOptions(answer).map((n) => ({ value: n, label: n.toLocaleString("en") }))} onSubmit={predict} submitLabel="Lock in my prediction" numeric />
        ) : (
          <>
            <p className={`lab-feedback ${predicted.correct ? "is-right" : "is-wrong"}`} role="status">
              {predicted.correct ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
              {predicted.correct ? `Right: ${answer}.` : `You said ${predicted.value}; the run shows ${answer}.`} {variant.question}
            </p>
            <RunViewer lab={lab} config={observeConfig} scenario={variant.scenario} title="The run: today's system" />
          </>
        )}
      </section>

      {predicted && (
        <section className="lab-stage" aria-labelledby="fix-title">
          <h2 id="fix-title"><Wrench aria-hidden="true" /> Fix it</h2>
          <p>Change the system so that every requirement holds in every scenario. Try a scenario to watch your design, then check them all.</p>
          <div className="lab-fix">
            <fieldset className="arch-settings lab-controls">
              <legend>Your system</legend>
              {lab.controls.map((c) => <ControlField key={c.id} control={c} value={config[c.id]} locked={lab.locked?.includes(c.id) ?? false} onChange={(v) => change(c.id, v)} />)}
              <button type="button" className="text-button" onClick={() => { setConfig({ ...lab.starter }); setResult(null); }}><RotateCcw aria-hidden="true" className="inline-icon" /> Back to today's system</button>
            </fieldset>
            <div className="lab-fix-run">
              <section className="lab-card" aria-labelledby="requirements-title">
                <h3 id="requirements-title"><ListChecks aria-hidden="true" className="inline-icon" /> Requirements</h3>
                <ul className="check-list">{[...new Set(lab.checks.map((c) => c.requirement))].map((r) => <li key={r}>{r}</li>)}</ul>
                <p className="muted">In each scenario: {lab.scenarios.map((s) => s.title).join(" · ")}.</p>
                <button type="button" className="button primary" onClick={check}><ListChecks aria-hidden="true" /> Check every scenario</button>
              </section>
              {result && <Results lab={lab} result={result} />}
              <div className="experiment-controls">
                <div className="arch-field">
                  <label htmlFor="lab-scenario">Try one scenario</label>
                  <select id="lab-scenario" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                    {lab.scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </div>
                <button type="button" className="button" onClick={() => setTried({ config: { ...config }, scenario: lab.scenarios.find((s) => s.id === scenarioId)! })}><Play aria-hidden="true" /> Run it</button>
              </div>
              {tried && (JSON.stringify(tried.config) !== JSON.stringify(config) || tried.scenario.id !== scenarioId) && <p className="run-stale" role="status">You changed the system or the scenario. Run it again to see it.</p>}
              {tried && <RunViewer key={`${tried.scenario.id}:${JSON.stringify(tried.config)}`} lab={lab} config={tried.config} scenario={tried.scenario} title={`Your system: ${tried.scenario.title}`} />}
              <div className="lab-hints">
                {lab.hints.slice(0, hints).map((h, i) => <p key={h} className="coach-reply"><Lightbulb aria-hidden="true" className="inline-icon" /> Hint {i + 1}: {h}</p>)}
                {hints < lab.hints.length && <button type="button" className="text-button" onClick={() => setHints(hints + 1)}>{hints ? "Another hint" : "Show a hint"}</button>}
              </div>
            </div>
          </div>
        </section>
      )}

      {passed && (
        <section className="lab-stage" aria-labelledby="master-title">
          <h2 id="master-title"><Trophy aria-hidden="true" /> Explain it</h2>
          {!answered ? (
            <Choice key={question.id} name="reasoning" legend={question.prompt} options={question.options.map((o, i) => ({ value: i, label: o.text }))} onSubmit={respond} submitLabel="Answer" />
          ) : (
            <>
              <p className="lab-question">{question.prompt}</p>
              <p className={`lab-feedback ${answered.correct ? "is-right" : "is-wrong"}`} role="status">
                {answered.correct ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
                <span><b>{question.options[answered.choice]?.text}</b> {question.options[answered.choice]?.why}</span>
              </p>
              {!answered.correct && <p className="muted">The answer: {question.options.find((o) => o.correct)?.text} {question.options.find((o) => o.correct)?.why}</p>}
            </>
          )}
          {answered && (
            <div className={`lab-outcome ${attempt?.masteredAt ? "is-mastered" : ""}`}>
              {attempt?.masteredAt ? (
                <p><Trophy aria-hidden="true" className="inline-icon" /> <b>Mastered.</b> You predicted the failure, fixed it for every scenario, and explained the mechanism.</p>
              ) : (
                <p><b>Completed, not mastered yet.</b> Mastery needs one attempt with a right prediction, a passing fix and a right explanation{predicted && !predicted.correct ? "; this attempt's prediction was off" : ""}{!answered.correct ? "; this attempt's explanation was off" : ""}.</p>
              )}
              <button type="button" className="button" onClick={another}><RotateCcw aria-hidden="true" /> Try another variant</button>
            </div>
          )}
        </section>
      )}
      <PathNext id={`lab:${lab.id}`} />
    </main>
  );
}

/** The given system: each setting and its value. */
function Settings({ lab, config }: { lab: Lab; config: LabConfig }) {
  const value = (c: Control) => {
    const v = config[c.id];
    if (c.type === "select") return c.options.find((o) => o.value === v)?.label;
    if (c.type === "toggle") return v ? "yes" : "no";
    return `${Number(v).toLocaleString("en")}${c.unit ? ` ${c.unit}` : ""}`;
  };
  return <ul className="lab-settings">{lab.controls.map((c) => <li key={c.id}>{c.label}: <b>{value(c)}</b></li>)}</ul>;
}

export function LabRoute({ id, notFound }: { id: string; notFound: ReactNode }) {
  const lab = findLab(id);
  return lab ? <LabPage key={lab.id} lab={lab} /> : <>{notFound}</>;
}

/** /practice/architecture/labs: every lab, in track order, with its state. */
export function LabsIndex({ evidence }: { evidence: Evidence }) {
  useEffect(() => {
    document.title = "Architecture labs · Kitab";
  }, []);
  const track = findTrack("system-design")!;
  const units = track.stages.filter((s) => s.practise.some((a) => a.track === "architecture-lab"));
  return (
    <main id="main" className="page lab-page arch-playground arch-lab lab-theme">
      <header className="playground-heading">
        <div>
          <p className="eyebrow"><FlaskConical aria-hidden="true" /> System Design</p>
          <h1>Architecture labs</h1>
          <p>Each lab reproduces one failure that real systems have (a double charge, a lost update, a retry storm), deterministically. Predict it, watch it happen, fix it for every scenario, then explain why the fix works.</p>
        </div>
        <p className="heading-links"><a {...linkProps("/practice/architecture")}>Architecture Playground</a> · <a {...linkProps(track.path)}>Roadmap</a></p>
      </header>
      {units.map((stage) => (
        <section key={stage.id} className="lab-unit" aria-labelledby={`labs-${stage.id}`}>
          <h2 id={`labs-${stage.id}`}>{stage.title}</h2>
          <ul className="template-grid">
            {stage.practise.filter((a) => a.track === "architecture-lab").map((a) => {
              const state = activityState(a, evidence);
              return (
                <li key={a.id}>
                  <a className="lab-tile" {...linkProps(labPath(a.id.slice(4)))}>
                    <b>{a.title}</b>
                    <span>{a.detail}</span>
                    <span className={`status-chip status-${state}`}>{practiceLabels[state]}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
