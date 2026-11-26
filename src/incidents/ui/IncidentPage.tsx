import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertOctagon, BookOpen, CheckCircle2, CircleHelp, Download, FlaskConical, Lightbulb, Printer, RotateCcw, Trash2, Undo2, Wrench, XCircle } from "lucide-react";
import { linkProps } from "../../app/router.ts";
import { safeStorage } from "../../learning/progress.ts";
import { glossary } from "../../learning/glossary.ts";
import { TermChips } from "../../ui/Terms.tsx";
import { assess, clock, combine, detection, incidentWindow, postmortem, postmortemMarkdown, recoveryWindow, SOURCE_LABELS, stateAfter, stepError, summarize, type Evidence, type Step, type Verification } from "../assess.ts";
import { getPath, type Run } from "../engine.ts";
import { findScenario, INCIDENTS_PATH, truthOf, variantFor, type Scenario } from "../scenarios.ts";
import { requestFacts, type Context, type Finding } from "../telemetry.ts";
import { finish, loadIncidents, newAttempt, resetAttempt, saveAttempt, startAttempt, type StoredAttempt } from "../progress.ts";
import { ChangesView, DiagnoseView, LogsView, MetricsView, TopologyView, TracesView } from "./views.tsx";
import { useSim } from "./useSim.ts";
import "./incidents.css";

type Tab = "overview" | "metrics" | "logs" | "traces" | "topology" | "changes" | "diagnose" | "fix" | "postmortem";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "metrics", label: "Metrics" }, { id: "logs", label: "Logs" }, { id: "traces", label: "Traces" }, { id: "topology", label: "Topology" },
  { id: "changes", label: "Changes" }, { id: "diagnose", label: "Diagnose" }, { id: "fix", label: "Fix & verify" }, { id: "postmortem", label: "Postmortem" },
];
type Viewed = "incident" | "target" | "stress";

export function IncidentRoute({ id, notFound }: { id: string; notFound: ReactNode }) {
  const scenario = findScenario(id);
  return scenario ? <IncidentPage scenario={scenario} /> : <>{notFound}</>;
}

function initialAttempt(s: Scenario): { attempt: StoredAttempt; started: boolean; attempts: number; saveProblem: boolean } {
  const { records, status } = loadIncidents(safeStorage());
  const r = records[s.id];
  const current = r && r.version === s.version ? r.current : null;
  if (current && s.variants.some((v) => v.id === current.variant)) return { attempt: current, started: true, attempts: r!.attempts, saveProblem: status === "newer" || status === "unavailable" };
  return { attempt: newAttempt(variantFor(s, r?.attempts ?? 0).id, "guided"), started: false, attempts: r?.attempts ?? 0, saveProblem: status === "newer" || status === "unavailable" };
}

function IncidentPage({ scenario: s }: { scenario: Scenario }) {
  const init = useMemo(() => initialAttempt(s), [s]);
  const [attempt, setAttempt] = useState(init.attempt);
  const [started, setStarted] = useState(init.started);
  const [saveFailed, setSaveFailed] = useState(init.saveProblem);
  const variant = s.variants.find((v) => v.id === attempt.variant) ?? s.variants[0];
  const sim = useSim();
  const [incident, setIncident] = useState<Run | null>(null);
  const [verification, setVerification] = useState<{ steps: Step[]; result: Verification } | null>(null);
  const [busy, setBusy] = useState(false);
  const [simError, setSimError] = useState("");
  const [viewed, setViewed] = useState<Viewed>("incident");
  const [at, setAt] = useState(s.timing.fixAtMs);
  const [tab, setTab] = useState<Tab>("overview");
  const [traceFilter, setTraceFilter] = useState("");
  const [trace, setTrace] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const guided = attempt.mode === "guided";

  useEffect(() => {
    document.title = `${s.title} · Incidents · Kitab`;
  }, [s]);
  useEffect(() => {
    let live = true;
    setIncident(null);
    sim.incident(s.id, variant.id).then((run) => live && setIncident(run), (e: Error) => live && setSimError(e.message));
    return () => {
      live = false;
    };
  }, [s.id, variant.id]);
  // A saved attempt that was verified gets its last verification back (recomputed: runs are never stored).
  const restored = useRef(false);
  useEffect(() => {
    const last = attempt.verifications.at(-1);
    if (restored.current || !last) return;
    restored.current = true;
    sim.verify(s.id, variant.id, last.steps).then((result) => setVerification({ steps: last.steps, result }), () => {});
  }, []);

  const save = (next: StoredAttempt) => {
    setAttempt(next);
    const storage = safeStorage();
    const result = started ? saveAttempt(storage, s.id, s.version, next) : startAttempt(storage, s.id, s.version, next);
    setStarted(true);
    setSaveFailed(!result.saved);
  };
  const update = (change: (a: StoredAttempt) => StoredAttempt) => save(change(attempt));

  const run: Run | null = viewed === "incident" ? incident : viewed === "target" ? verification?.result.target ?? null : verification?.result.stress ?? null;
  const endMs = run?.endMs ?? s.timing.fixAtMs;
  const cursor = Math.min(at, endMs);
  const markers = useMemo(() => (run ? run.events.filter((e) => e.type === "change" && run.input.changes.some((c) => c.visible && c.label === e.label)).map((e) => ({ t: e.t, label: e.label! })) : []), [run]);
  const ctx: Context | null = run ? {
    run,
    before: { from: 0, to: s.timing.faultAtMs },
    during: viewed === "incident" || cursor <= s.timing.fixAtMs ? { from: s.timing.faultAtMs, to: Math.max(s.timing.faultAtMs + 1000, cursor) } : { from: s.timing.fixAtMs, to: cursor },
    state: viewed === "incident" || cursor <= s.timing.fixAtMs ? stateAfter(s, variant, []) : stateAfter(s, variant, verification!.steps),
  } : null;

  const pinned = new Set(attempt.evidence.map((e) => e.id));
  const pin = (f: Finding, source: string) => {
    if (pinned.has(f.id)) return setAnnounce(`${f.title} is already in your evidence.`);
    update((a) => ({ ...a, evidence: [...a.evidence, { ...f, title: f.title.slice(0, 200), detail: f.detail.slice(0, 600), source: `${viewed === "incident" ? "Incident run" : viewed === "target" ? "Verification run" : "Stress run"}: ${source}`.slice(0, 120) }].slice(-40) }));
    setAnnounce(`Added to evidence: ${f.title}.`);
  };
  const ranDiagnostic = (id: string) => !attempt.diagnostics.includes(id) && update((a) => ({ ...a, diagnostics: [...a.diagnostics, id].slice(-40) }));

  async function runVerification() {
    setBusy(true);
    setSimError("");
    try {
      const steps = attempt.steps;
      const result = await sim.verify(s.id, variant.id, steps);
      setVerification({ steps, result });
      const next = { ...attempt, verifications: [...attempt.verifications, summarize(steps, result)].slice(-20) };
      save(next);
      setViewed("target");
      setAt(result.target.endMs);
      setAnnounce(`Verification finished: ${result.outcome.label}.`);
      const assessment = assess(s, variant, next);
      if (assessment.completed) finish(safeStorage(), s.id, s.version, next, assessment.assisted);
    } catch (e) {
      setSimError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const assessment = assess(s, variant, attempt);
  const facts = incident ? requestFacts(incident, incidentWindow(s)) : null;
  const det = incident ? detection(incident, s.timing.faultAtMs) : null;
  const last = attempt.verifications.at(-1);
  const status = assessment.completed ? "Resolved" : last?.fully ? "Recovered: confirm the cause" : last?.recovered ? "Mitigated" : "Investigating";

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (n === null) return;
    e.preventDefault();
    const j = (n + TABS.length) % TABS.length;
    setTab(TABS[j].id);
    tabRefs.current[j]?.focus();
  };
  const go = (t: Tab) => {
    setTab(t);
    document.getElementById("inc-workspace")?.scrollIntoView?.({ block: "start" });
  };

  function newRun() {
    const { records } = loadIncidents(safeStorage());
    const attempts = records[s.id]?.attempts ?? 0;
    const next = newAttempt(variantFor(s, attempts).id, attempt.mode);
    const result = startAttempt(safeStorage(), s.id, s.version, next);
    setSaveFailed(!result.saved);
    setStarted(true);
    setAttempt(next);
    setVerification(null);
    setViewed("incident");
    setAt(s.timing.fixAtMs);
    setTab("overview");
  }

  return (
    <main id="main" className="page lab-page lab-theme inc-page">
      <p className="eyebrow"><a {...linkProps(INCIDENTS_PATH)}>Production incidents</a> · Incident {s.number} of 12 · {s.difficulty}</p>
      <header className="inc-header">
        <div>
          <p className="inc-alert"><AlertOctagon aria-hidden="true" /> Production incident · {s.severity}</p>
          <h1>{s.title}</h1>
          <p className="inc-report">{s.report}</p>
        </div>
        <dl className="inc-status">
          <div><dt>Status</dt><dd>{status}</dd></div>
          <div><dt>Affected</dt><dd>{s.affected.map((a) => a.replace(/-/g, " ")).join(", ")}</dd></div>
          <div><dt>Detected</dt><dd>{det ? `${clock(det.atMs)} (${det.why})` : incident ? "No alert" : "…"}</dd></div>
          <div><dt>Customer impact</dt><dd>{facts ? `${facts.errorRate.toFixed(1)}% of requests failing, p95 ${Math.round(facts.p95).toLocaleString("en")} ms` : "…"}</dd></div>
        </dl>
        <div className="inc-mode" role="group" aria-label="Mode">
          {(["guided", "independent"] as const).map((m) => <button key={m} type="button" className="filter-chip" aria-pressed={attempt.mode === m} onClick={() => update((a) => ({ ...a, mode: m }))}>{m === "guided" ? "Guided" : "Independent"}</button>)}
        </div>
      </header>
      <p className="inc-sim-note"><b>SIMULATED</b> A deterministic model of a small online store: every number, log line and trace comes from one simulated run, not from real servers. {saveFailed && <span className="is-bad"> This browser isn't saving your progress (storage blocked, full, or written by a newer Kitab).</span>}</p>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      <div className="inc-runbar">
        <label>Viewing
          <select value={viewed} onChange={(e) => { setViewed(e.target.value as Viewed); setAt(e.target.value === "incident" ? s.timing.fixAtMs : s.timing.endMs); }}>
            <option value="incident">Incident run, 0:00–{clock(s.timing.fixAtMs)} (now)</option>
            <option value="target" disabled={!verification}>Verification run: your changes at {clock(s.timing.fixAtMs)}</option>
            <option value="stress" disabled={!verification}>Stress run: {(variant.stress ?? s.stress).label}</option>
          </select>
        </label>
        <label className="grow">Up to {clock(cursor)}
          <input type="range" min={1000} max={endMs} step={500} value={cursor} onChange={(e) => setAt(Number(e.target.value))} aria-valuetext={clock(cursor)} />
        </label>
        <button type="button" className="text-button" onClick={() => setAt(endMs)}>Latest</button>
      </div>
      {viewed !== "incident" && <p className="inc-note">Separate executions: the verification and stress runs replay the same requests (same seed) with your changes applied at {clock(s.timing.fixAtMs)}; the stress run also {(variant.stress ?? s.stress).label.toLowerCase()}.</p>}
      {simError && <p className="notice is-bad" role="alert">The simulation failed: {simError}</p>}

      <div className="inc-layout">
        <div className="inc-main" id="inc-workspace">
          <div className="inc-tabs" role="tablist" aria-label="Incident workspace">
            {TABS.map((t, i) => (
              <button key={t.id} ref={(el) => { tabRefs.current[i] = el; }} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="inc-panel" tabIndex={tab === t.id ? 0 : -1} onKeyDown={(e) => onTabKey(e, i)} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <div className="inc-panel" role="tabpanel" id="inc-panel" aria-labelledby={`tab-${tab}`}>
            {!run ? <p role="status" aria-busy="true">Simulating the store…</p> : (
              <>
                {tab === "overview" && <Overview s={s} run={run} at={cursor} guided={guided} go={go} facts={facts} />}
                {tab === "metrics" && <MetricsView scenario={s} run={run} at={cursor} markers={markers} guided={guided} />}
                {tab === "logs" && <LogsView run={run} at={cursor} trace={traceFilter} setTrace={setTraceFilter} pin={pin} openTrace={(t) => { setTrace(t); setTab("traces"); }} />}
                {tab === "traces" && <TracesView run={run} at={cursor} selected={trace} select={setTrace} pin={pin} showLogs={(t) => { setTraceFilter(t); setTab("logs"); }} />}
                {tab === "topology" && <TopologyView scenario={s} run={run} at={cursor} />}
                {tab === "changes" && <ChangesView scenario={s} run={run} at={cursor} />}
                {tab === "diagnose" && ctx && <DiagnoseView scenario={s} ctx={ctx} ran={attempt.diagnostics} run={ranDiagnostic} pin={pin} pinned={pinned} />}
                {tab === "fix" && <FixPanel s={s} attempt={attempt} update={update} busy={busy} verify={runVerification} verification={verification} assessmentDone={assessment.completed} view={(v) => { setViewed(v); setAt(s.timing.endMs); setTab("metrics"); }} />}
                {tab === "postmortem" && incident && <Postmortem s={s} attempt={attempt} update={update} incident={incident} verification={verification?.result ?? null} resolved={assessment.completed} />}
              </>
            )}
          </div>
        </div>
        <Notebook s={s} attempt={attempt} update={update} guided={guided} go={go} assessment={assessment} newRun={newRun} reset={() => {
          if (!window.confirm("Reset this incident? Your evidence, hypotheses, changes and notes for this attempt are removed. Completed incidents stay completed.")) return;
          const result = resetAttempt(safeStorage(), s.id, s.version);
          setSaveFailed(!result.saved);
          setStarted(false);
          setAttempt(newAttempt(attempt.variant, attempt.mode));
          setVerification(null);
          setViewed("incident");
        }} />
      </div>
    </main>
  );
}

// ---- Overview ----

function Overview({ s, run, at, guided, go, facts }: { s: Scenario; run: Run; at: number; guided: boolean; go: (t: Tab) => void; facts: ReturnType<typeof requestFacts> | null }) {
  const per = s.endpoints.map((e) => [e, requestFacts(run, { from: s.timing.faultAtMs, to: at }, e)] as const).filter(([, f]) => f.requests);
  const before = requestFacts(run, { from: 0, to: s.timing.faultAtMs });
  const changes = run.events.filter((e) => e.type === "change" && e.t <= at && run.input.changes.some((c) => c.visible && c.label === e.label));
  void facts;
  return (
    <section aria-labelledby="overview-title">
      <h2 id="overview-title" className="inc-tab-title">Overview</h2>
      <p>{s.impact}</p>
      <div className="table-scroll">
        <table className="inc-table">
          <caption>Service level symptoms, from the start of the incident to {clock(at)} (before it: {before.errorRate.toFixed(1)}% errors, p95 {Math.round(before.p95)} ms)</caption>
          <thead><tr><th scope="col">Endpoint</th><th scope="col">Requests</th><th scope="col">Failed</th><th scope="col">p50</th><th scope="col">p95</th></tr></thead>
          <tbody>{per.map(([e, f]) => <tr key={e}><th scope="row">{e}</th><td>{f.requests}</td><td>{f.failures} ({f.errorRate.toFixed(1)}%)</td><td>{Math.round(f.p50)} ms</td><td>{Math.round(f.p95)} ms</td></tr>)}</tbody>
        </table>
      </div>
      <h3>Recent changes</h3>
      {changes.length ? <ul>{changes.map((c) => <li key={c.i}>{clock(c.t)} {c.label}</li>)}</ul> : <p>None recorded.</p>}
      {guided && (
        <div className="inc-guide">
          <h3>The system</h3>
          <p>{s.architecture}</p>
          <TermChips label="Terms used in this incident" lead="Terms:" terms={s.terms.map((t) => glossary[t])} />
          <h3>How to investigate</h3>
          <ol>
            <li>Find the symptom: who fails, with what (<button type="button" className="text-button" onClick={() => go("metrics")}>Metrics</button>, <button type="button" className="text-button" onClick={() => go("diagnose")}>Diagnose</button>).</li>
            <li>Follow one bad request to where its time goes (<button type="button" className="text-button" onClick={() => go("traces")}>Traces</button>, <button type="button" className="text-button" onClick={() => go("logs")}>Logs</button>).</li>
            <li>Write hypotheses in your notebook and attach the findings that support or refute them.</li>
            <li>Change the system, then verify it recovered, including under stress (<button type="button" className="text-button" onClick={() => go("fix")}>Fix & verify</button>).</li>
            <li>Write the postmortem.</li>
          </ol>
        </div>
      )}
      <p className="muted">Severity {s.severity}: in this store, SEV-1 is a full outage of a customer journey, SEV-2 a partial one, SEV-3 a degradation customers notice later. You are the incident commander: decide what to look at, what to change and when it is resolved.</p>
    </section>
  );
}

// ---- Notebook: guide, evidence, hypotheses, hints, assessment ----

function Notebook({ s, attempt, update, guided, go, assessment, newRun, reset }: { s: Scenario; attempt: StoredAttempt; update: (f: (a: StoredAttempt) => StoredAttempt) => void; guided: boolean; go: (t: Tab) => void; assessment: ReturnType<typeof assess>; newRun: () => void; reset: () => void }) {
  const status = (id: string) => attempt.hypotheses.find((h) => h.id === id) ?? { id, status: "unresolved" as const, evidence: [] };
  const setH = (id: string, change: Partial<StoredAttempt["hypotheses"][number]>) => update((a) => ({ ...a, hypotheses: [...a.hypotheses.filter((h) => h.id !== id), { ...status(id), ...change }] }));
  const variant = s.variants.find((v) => v.id === attempt.variant)!;
  return (
    <aside className="inc-notebook" aria-label="Investigation notebook">
      {guided && s.guide.length > 0 && (
        <section className="inc-card">
          <h2><CircleHelp aria-hidden="true" /> Questions to ask</h2>
          <ol className="inc-guide-steps">
            {s.guide.map((g) => {
              const done = !!g.diagnostic && attempt.diagnostics.includes(g.diagnostic);
              return <li key={g.question} className={done ? "is-done" : ""}>{done ? <CheckCircle2 aria-label="Done" /> : null} <button type="button" className="text-button" onClick={() => go(g.where === "diagnose" ? "diagnose" : g.where)}>{g.question}</button></li>;
            })}
          </ol>
        </section>
      )}
      <section className="inc-card">
        <h2>Evidence ({attempt.evidence.length})</h2>
        {attempt.evidence.length ? (
          <ul className="inc-evidence">
            {attempt.evidence.map((e) => (
              <li key={e.id} className={e.abnormal ? "is-abnormal" : ""}>
                <b>{e.title}</b> <span>{e.detail}</span> <small>{e.source}</small>
                <button type="button" className="icon-button" aria-label={`Remove ${e.title}`} onClick={() => update((a) => ({ ...a, evidence: a.evidence.filter((x) => x.id !== e.id), hypotheses: a.hypotheses.map((h) => ({ ...h, evidence: h.evidence.filter((x) => x !== e.id) })) }))}><Trash2 aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Nothing yet. Run checks in Diagnose, or add a trace or a log line.</p>}
      </section>
      <section className="inc-card">
        <h2>Hypotheses</h2>
        <p className="muted">Mark each one confirmed, rejected or unresolved, and attach the evidence that decides it. Change your mind whenever the evidence does.</p>
        <ul className="inc-hypotheses">
          {s.hypotheses.map((h) => {
            const st = status(h.id);
            return (
              <li key={h.id} className={`h-${st.status}`}>
                <fieldset>
                  <legend>{h.text}</legend>
                  <div className="inc-chips">
                    {(["unresolved", "confirmed", "rejected"] as const).map((x) => (
                      <label key={x} className="inc-radio"><input type="radio" name={`h-${h.id}`} checked={st.status === x} onChange={() => setH(h.id, { status: x })} /> {x[0].toUpperCase() + x.slice(1)}</label>
                    ))}
                  </div>
                  {attempt.evidence.length > 0 && st.status !== "unresolved" && (
                    <details>
                      <summary>Evidence for this decision ({st.evidence.length})</summary>
                      {attempt.evidence.map((e) => (
                        <label key={e.id} className="inc-check"><input type="checkbox" checked={st.evidence.includes(e.id)} onChange={(ev) => setH(h.id, { evidence: ev.target.checked ? [...st.evidence, e.id].slice(-12) : st.evidence.filter((x) => x !== e.id) })} /> {e.title}</label>
                      ))}
                    </details>
                  )}
                </fieldset>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="inc-card">
        <h2><Lightbulb aria-hidden="true" /> Hints</h2>
        {s.hints.slice(0, attempt.hints).map((h, i) => <p key={i} className="inc-hint"><b>Hint {i + 1}.</b> {h}</p>)}
        {attempt.hints < s.hints.length ? (
          <button type="button" className="button" onClick={() => update((a) => ({ ...a, hints: a.hints + 1 }))}>Show hint {attempt.hints + 1} of {s.hints.length}</button>
        ) : <p className="muted">That was the last hint: completing this attempt now counts as assisted.</p>}
        {!guided && attempt.hints === 0 && <p className="muted">Hints are recorded as assistance in the assessment.</p>}
      </section>
      <section className="inc-card">
        <h2>Assessment</h2>
        <p className="muted">From what you established and did in this attempt, never from wording. It shows which observable parts of a good investigation happened; it can't measure judgement.</p>
        <ul className="inc-rubric">
          {assessment.dimensions.map((d) => (
            <li key={d.id} className={`mark-${d.mark}`}>
              {d.mark === "met" ? <CheckCircle2 aria-hidden="true" /> : d.mark === "partly" ? <CircleHelp aria-hidden="true" /> : <XCircle aria-hidden="true" />}
              <span><b>{d.label}</b> <span className="sr-only">: {d.mark === "met" ? "met" : d.mark === "partly" ? "partly met" : "not met"}</span><small>{d.detail}</small></span>
            </li>
          ))}
        </ul>
        {assessment.completed ? (
          <div className="notice is-good" role="status">
            <p><b>Incident resolved{assessment.assisted ? " (with every hint)" : ""}.</b> {variant.conclusion}</p>
            <button type="button" className="button primary" onClick={newRun}>Try another version of this incident</button>
          </div>
        ) : <p className="muted">Complete: the service fully recovered (verified after your last change, including under stress), and every root cause confirmed with supporting evidence, without confirming what the evidence contradicts.</p>}
        <button type="button" className="text-button" onClick={reset}><RotateCcw aria-hidden="true" /> Reset this attempt</button>
      </section>
      <section className="inc-card">
        <h2><BookOpen aria-hidden="true" /> Learn more</h2>
        <ul className="inc-links">{s.learn.map((l) => <li key={l.href}><span className="practice-kind">{l.kind}</span> <a {...linkProps(l.href)}>{l.label}</a>{l.kind === "Lab" ? <small> ACTUAL: real code or HTTP, not this simulation</small> : null}</li>)}</ul>
      </section>
    </aside>
  );
}

// ---- Fix & verify ----

function FixPanel({ s, attempt, update, busy, verify, verification, assessmentDone, view }: { s: Scenario; attempt: StoredAttempt; update: (f: (a: StoredAttempt) => StoredAttempt) => void; busy: boolean; verify: () => void; verification: { steps: Step[]; result: Verification } | null; assessmentDone: boolean; view: (v: Viewed) => void }) {
  const variant = s.variants.find((v) => v.id === attempt.variant)!;
  const current = stateAfter(s, variant, attempt.steps);
  const [error, setError] = useState("");
  const add = (step: Step) => {
    const problem = stepError(s, step);
    if (problem) return setError(problem);
    setError("");
    update((a) => ({ ...a, steps: [...a.steps.filter((x) => !(step.kind === "set" && x.kind === "set" && x.path === step.path)), step].slice(-30) }));
  };
  const { labels } = combine(s, attempt.steps);
  const groups = [...new Set(s.controls.map((c) => c.component))];
  const r = verification?.result;
  const stale = verification && JSON.stringify(verification.steps) !== JSON.stringify(attempt.steps);
  return (
    <section aria-labelledby="fix-title">
      <h2 id="fix-title" className="inc-tab-title">Fix & verify</h2>
      <p className="muted">Your changes are applied to the running store at {clock(s.timing.fixAtMs)}; the simulation then continues with the same requests until {clock(s.timing.endMs)}. Recovery is judged from {clock(recoveryWindow(s).from)}. Everything stays inside the simulator.</p>
      {s.actions.length > 0 && (
        <div className="inc-actions">
          <h3>Actions</h3>
          {s.actions.map((a) => (
            <div key={a.id} className="inc-action">
              <button type="button" className="button" onClick={() => add({ kind: "action", id: a.id })}><Wrench aria-hidden="true" /> {a.label}</button>
              <small>{a.help}</small>
            </div>
          ))}
        </div>
      )}
      <h3>Settings</h3>
      {groups.map((g) => (
        <fieldset key={g} className="inc-fieldset">
          <legend>{g.replace(/-/g, " ")}</legend>
          {s.controls.filter((c) => c.component === g).map((c) => {
            const value = getPath(current, c.id);
            const id = `fix-${c.id}`;
            return (
              <div key={c.id} className={`arch-field${c.type === "toggle" ? " is-check" : ""}`}>
                {c.type === "toggle" ? (
                  <label htmlFor={id}><input id={id} type="checkbox" checked={value === true} onChange={(e) => add({ kind: "set", path: c.id, value: e.target.checked })} /> {c.label}</label>
                ) : <label htmlFor={id}>{c.label}{c.type === "number" && c.unit ? ` (${c.unit})` : ""}</label>}
                {c.type === "select" && <select id={id} value={String(value)} onChange={(e) => add({ kind: "set", path: c.id, value: e.target.value })}>{c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
                {c.type === "number" && <input id={id} type="number" min={c.min} max={c.max} step={c.step} value={Number(value)} onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= c.min && n <= c.max) add({ kind: "set", path: c.id, value: Math.round((n - c.min) / c.step) * c.step + c.min });
                }} />}
                <small>{c.help}{c.tradeoff ? ` Trade-off: ${c.tradeoff}` : ""}</small>
              </div>
            );
          })}
        </fieldset>
      ))}
      {error && <p className="notice is-bad" role="alert">{error}</p>}
      <div className="inc-pending">
        <h3>Your changes ({attempt.steps.length})</h3>
        {labels.length ? <ol>{labels.map((l, i) => <li key={i}>{l}</li>)}</ol> : <p className="muted">None yet. Verifying with no change shows what happens if you only wait.</p>}
        <div className="inc-row-actions">
          <button type="button" className="button primary" disabled={busy} onClick={verify}><FlaskConical aria-hidden="true" /> {busy ? "Verifying…" : "Apply and verify"}</button>
          <button type="button" className="button" disabled={!attempt.steps.length} onClick={() => update((a) => ({ ...a, steps: a.steps.slice(0, -1) }))}><Undo2 aria-hidden="true" /> Undo last</button>
          <button type="button" className="text-button" disabled={!attempt.steps.length} onClick={() => update((a) => ({ ...a, steps: [] }))}>Back to the incident's configuration</button>
        </div>
      </div>
      {r && (
        <div className={`inc-result${r.outcome.fullyRecovered ? " is-good" : !r.outcome.safe || r.outcome.worse ? " is-bad" : ""}`} aria-live="polite">
          <h3>{r.outcome.label}{stale ? " (for your previous changes)" : ""}</h3>
          <p>{r.outcome.explanation}</p>
          <ul className="inc-outcome">
            <li>{r.outcome.symptomReduced ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />} Symptom reduced</li>
            <li>{r.outcome.rootCauseFixed ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />} Root cause fixed</li>
            <li>{r.outcome.serviceRecovered && r.outcome.stressPassed ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />} Service fully recovered</li>
          </ul>
          <div className="table-scroll">
            <table className="inc-table">
              <caption>Before and after: the incident window ({clock(incidentWindow(s).from)}–{clock(incidentWindow(s).to)}, incident run) against the recovery window ({clock(recoveryWindow(s).from)}–{clock(recoveryWindow(s).to)}, verification run)</caption>
              <thead><tr><th scope="col">Measure</th><th scope="col">During the incident</th><th scope="col">After your changes</th></tr></thead>
              <tbody>
                <tr><th scope="row">Error rate</th><td>{r.incident.errorRate.toFixed(1)}%</td><td>{r.after.errorRate.toFixed(1)}%</td></tr>
                <tr><th scope="row">p95 latency</th><td>{Math.round(r.incident.p95).toLocaleString("en")} ms</td><td>{Math.round(r.after.p95).toLocaleString("en")} ms</td></tr>
                <tr><th scope="row">Throughput</th><td>{r.incident.throughput.toFixed(1)} req/s</td><td>{r.after.throughput.toFixed(1)} req/s</td></tr>
                <tr><th scope="row">Time to recover</th><td>–</td><td>{r.recoveryMs === null ? "not within the run" : `${(r.recoveryMs / 1000).toFixed(0)} s after the change`}</td></tr>
              </tbody>
            </table>
          </div>
          <h4>Recovery criteria</h4>
          <ul className="inc-criteria">
            {r.criteria.map((c) => (
              <li key={c.id} className={c.passed ? "is-pass" : "is-fail"}>
                {c.passed ? <CheckCircle2 aria-label="Passed" /> : <XCircle aria-label="Failed" />} <b>{c.label}</b> measured {Number.isInteger(c.value) ? c.value : c.value.toFixed(1)} {c.unit}{c.run === "stress" ? " (stress run)" : ""}
                <small>{c.why}</small>
              </li>
            ))}
            {r.invariants.map((x) => <li key={x.label} className={x.ok ? "is-pass" : "is-fail"}>{x.ok ? <CheckCircle2 aria-label="Held" /> : <XCircle aria-label="Broken" />} <b>{x.label}</b> {x.observed}</li>)}
            <li className={r.outcome.rootCauseFixed ? "is-pass" : "is-fail"}>{r.outcome.rootCauseFixed ? <CheckCircle2 aria-label="Yes" /> : <XCircle aria-label="No" />} <b>Root cause</b> {r.outcome.rootCauseFixed || assessmentDone ? r.rootCause.map((x) => `${x.fixed ? "Fixed" : "Still present"}: ${x.label}`).join(". ") : "Still present (the simulator names it once the incident is resolved)."}</li>
          </ul>
          <div className="inc-row-actions">
            <button type="button" className="button" onClick={() => view("target")}>See the verification run</button>
            <button type="button" className="button" onClick={() => view("stress")}>See the stress run</button>
          </div>
        </div>
      )}
      {attempt.verifications.length > 0 && (
        <details className="inc-history">
          <summary>Verification history ({attempt.verifications.length})</summary>
          <ol>{attempt.verifications.map((v, i) => <li key={i}>{v.steps.length ? combine(s, v.steps).labels.join("; ") : "No change"} → <b>{v.label}</b></li>)}</ol>
        </details>
      )}
    </section>
  );
}

// ---- Postmortem ----

function Postmortem({ s, attempt, update, incident, verification, resolved }: { s: Scenario; attempt: StoredAttempt; update: (f: (a: StoredAttempt) => StoredAttempt) => void; incident: Run; verification: Verification | null; resolved: boolean }) {
  const variant = s.variants.find((v) => v.id === attempt.variant)!;
  const sections = postmortem(s, variant, attempt, incident, verification, resolved);
  const [drafts, setDrafts] = useState<Record<string, string>>(attempt.notes);
  const commit = (id: string) => drafts[id] !== (attempt.notes[id] ?? "") && update((a) => ({ ...a, notes: { ...a.notes, [id]: (drafts[id] ?? "").slice(0, 2000) } }));
  const download = () => {
    const blob = new Blob([postmortemMarkdown(s, postmortem(s, variant, { ...attempt, notes: drafts }, incident, verification, resolved))], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `postmortem-${s.id}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section aria-labelledby="pm-title" className="inc-postmortem">
      <h2 id="pm-title" className="inc-tab-title">Postmortem</h2>
      <p className="muted">Facts come from the runs; your hypotheses and notes are labelled as yours; the simulator's conclusion appears once the incident is resolved. Blameless: describe what happened and why the system allowed it.</p>
      <p className="inc-legend">{(Object.keys(SOURCE_LABELS) as (keyof typeof SOURCE_LABELS)[]).map((k) => <span key={k} className={`src src-${k}`}>{SOURCE_LABELS[k]}</span>)}</p>
      {sections.map((sec) => (
        <div key={sec.id} className="inc-pm-section">
          <h3>{sec.title}</h3>
          <ul>{sec.entries.filter((e) => e.source !== "learner").map((e, i) => <li key={i}><span className={`src src-${e.source}`}>{SOURCE_LABELS[e.source]}</span> {e.text}</li>)}</ul>
          {sec.editable && (
            <label className="inc-pm-note">Your analysis
              <textarea rows={3} maxLength={2000} value={drafts[sec.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [sec.id]: e.target.value })} onBlur={() => commit(sec.id)} />
            </label>
          )}
        </div>
      ))}
      <div className="inc-row-actions">
        <button type="button" className="button" onClick={download}><Download aria-hidden="true" /> Download as Markdown</button>
        <button type="button" className="button" onClick={() => window.print()}><Printer aria-hidden="true" /> Print</button>
      </div>
    </section>
  );
}

