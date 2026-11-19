import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX, Eye, Lightbulb, Plus, RotateCcw, Send, Trash2, Circle } from "lucide-react";
import { curlCommand, MAX_TIMEOUT_MS, requestText, sendRequest } from "../http.ts";
import { METHODS, type HttpLab, type HttpMethod, type HttpTask, type Observation, type RequestDraft } from "../model.ts";
import type { LabRecord } from "../progress.ts";
import type { Save } from "./LabPage.tsx";

const SAVE_DELAY_MS = 400;
const HISTORY = 12;

const reason = (o: Observation) =>
  o.outcome === "response" ? `${o.response!.status} ${o.response!.statusText}`.trim() : o.outcome === "timeout" ? "Timed out" : o.outcome === "refused" ? "Refused by the browser" : "No response";

function prettyBody(o: Observation) {
  const r = o.response!;
  if (r.json !== undefined) return JSON.stringify(r.json, null, 2);
  return r.body;
}

function Builder({ task, value, onChange, disabled }: { task: HttpTask; value: RequestDraft; onChange: (d: RequestDraft) => void; disabled: boolean }) {
  const set = (patch: Partial<RequestDraft>) => onChange({ ...value, ...patch });
  const setHeader = (i: number, patch: Partial<RequestDraft["headers"][number]>) => set({ headers: value.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const noBody = value.method === "GET" || value.method === "HEAD";
  return (
    <fieldset className="eng-builder" disabled={disabled}>
      <legend className="sr-only">Request</legend>
      <div className="eng-line">
        <label className="eng-field eng-method">
          <span>Method</span>
          <select value={value.method} onChange={(e) => set({ method: e.target.value as HttpMethod })}>
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="eng-field eng-path">
          <span>Path</span>
          <input value={value.path} onChange={(e) => set({ path: e.target.value })} spellCheck={false} autoCapitalize="off" autoCorrect="off" inputMode="url" />
        </label>
      </div>
      <div className="eng-headers" role="group" aria-labelledby={`h-${task.id}`}>
        <span id={`h-${task.id}`} className="eng-field-label">Headers</span>
        {value.headers.length === 0 && <span className="eng-muted">None. Your browser still adds its own.</span>}
        {value.headers.map((h, i) => (
          <div className="eng-header-row" key={i}>
            <input aria-label={`Header ${i + 1} name`} placeholder="Name" value={h.name} onChange={(e) => setHeader(i, { name: e.target.value })} spellCheck={false} autoCapitalize="off" />
            <input aria-label={`Header ${i + 1} value`} placeholder="Value" value={h.value} onChange={(e) => setHeader(i, { value: e.target.value })} spellCheck={false} autoCapitalize="off" />
            <button type="button" className="icon-button" aria-label={`Remove header ${i + 1}`} onClick={() => set({ headers: value.headers.filter((_, j) => j !== i) })}><Trash2 aria-hidden="true" /></button>
          </div>
        ))}
        {value.headers.length < 20 && <button type="button" className="text-button" onClick={() => set({ headers: [...value.headers, { name: "", value: "" }] })}><Plus aria-hidden="true" />Add header</button>}
      </div>
      <label className="eng-field">
        <span>Body{noBody ? ` (a ${value.method} request has none)` : ""}</span>
        <textarea rows={4} value={value.body} onChange={(e) => set({ body: e.target.value })} spellCheck={false} aria-invalid={noBody && value.body !== "" ? true : undefined} />
      </label>
      <div className="eng-line">
        <label className="eng-field eng-small">
          <span>Timeout (ms)</span>
          <input type="number" min={100} max={MAX_TIMEOUT_MS} step={100} value={value.timeoutMs} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} />
        </label>
        {task.cacheControl && (
          <label className="eng-field eng-small">
            <span>Browser cache</span>
            <select value={value.cache} onChange={(e) => set({ cache: e.target.value as RequestDraft["cache"] })}>
              <option value="no-store">Bypassed</option>
              <option value="default">Allowed</option>
            </select>
          </label>
        )}
      </div>
    </fieldset>
  );
}

function Inspector({ o, origin }: { o: Observation; origin: string }) {
  const host = new URL(origin).host;
  const draftOf = (): RequestDraft => ({ method: o.request.method, path: o.request.path, headers: o.request.headers.map(([name, value]) => ({ name, value })), body: o.request.body, timeoutMs: o.request.timeoutMs, cache: o.request.cache });
  return (
    <div className="eng-inspector">
      {o.outcome === "response" ? (
        <>
          <p className={`eng-status-line is-${Math.floor(o.response!.status / 100)}xx`}>
            <b>{o.response!.status}</b> {o.response!.statusText} <span className="eng-muted">· {o.elapsedMs} ms{o.response!.redirected ? " · followed a redirect" : ""}</span>
          </p>
          <details open>
            <summary>Body</summary>
            {o.response!.body ? <pre className="eng-code" tabIndex={0}>{prettyBody(o)}</pre> : <p className="eng-muted">No body.</p>}
            {o.response!.truncated && <p className="eng-muted">Shortened to the first 64,000 characters.</p>}
          </details>
          <details>
            <summary>Response headers ({o.response!.headers.length})</summary>
            <table className="eng-table"><tbody>{o.response!.headers.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody></table>
            <p className="eng-fine">Only the headers your browser lets a page read. A few (like Set-Cookie) are always hidden.</p>
          </details>
          <details>
            <summary>Timing (reported by your browser)</summary>
            {o.timing ? (
              <table className="eng-table"><tbody>
                <tr><th scope="row">Protocol</th><td>{o.timing.protocol}</td></tr>
                <tr><th scope="row">DNS lookup</th><td>{o.timing.dnsMs} ms</td></tr>
                <tr><th scope="row">Connection setup (TCP{o.timing.tlsMs ? " + TLS" : ""})</th><td>{o.timing.connectMs} ms {o.timing.reused ? "— none: an open connection was reused" : ""}</td></tr>
                <tr><th scope="row">Waiting for the first byte</th><td>{o.timing.waitMs} ms</td></tr>
                <tr><th scope="row">Total</th><td>{o.timing.totalMs} ms</td></tr>
                <tr><th scope="row">Bytes transferred</th><td>{o.timing.transferSize}{o.timing.transferSize === 0 ? " — served from the browser's cache, or not reported" : ""}</td></tr>
              </tbody></table>
            ) : <p className="eng-muted">Your browser didn't report timing for this request.</p>}
            <p className="eng-fine">From the Resource Timing API. Browsers report these numbers; they never show TCP segments or packets to a web page.</p>
          </details>
        </>
      ) : (
        <div className="eng-failure" role="alert">
          <b>{reason(o)}</b>
          <p>{o.error}</p>
          {o.outcome === "refused" && <p>Nothing was sent: your browser (or Kitab's lab rules) stopped it first. No server saw this request.</p>}
          {o.outcome === "timeout" && <p>There is no status code because no response arrived. The server may still have done the work.</p>}
        </div>
      )}
      {o.outcome !== "refused" && (
        <details>
          <summary>The request as sent</summary>
          <p className="eng-fine">Written as an HTTP/1.1 message for reading. It's a representation, not captured bytes; your browser also added headers of its own (see the echo endpoint).</p>
          <pre className="eng-code" tabIndex={0}>{requestText(draftOf(), host)}</pre>
          <p className="eng-field-label">Try it from your own terminal</p>
          <pre className="eng-code" tabIndex={0}>{curlCommand(draftOf(), origin)}</pre>
          <p className="eng-fine">curl opens its own real connection and prints the raw response. Kitab can't see your terminal, so this part isn't checked.</p>
        </details>
      )}
    </div>
  );
}

export function HttpWorkspace({ lab, record, save }: { lab: HttpLab; record: LabRecord | undefined; save: Save }) {
  const origin = window.location.origin;
  const done = new Set(record?.tasksDone ?? []);
  const firstOpen = lab.tasks.find((t) => !done.has(t.id))?.id ?? lab.tasks[0].id;
  const [taskId, setTaskId] = useState(() => (record?.task && lab.tasks.some((t) => t.id === record.task) ? record.task : firstOpen));
  const task = lab.tasks.find((t) => t.id === taskId)!;
  const [drafts, setDrafts] = useState<Record<string, RequestDraft>>(() => ({ ...(record?.drafts ?? {}) }));
  const [history, setHistory] = useState<Record<string, Observation[]>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [hintsShown, setHintsShown] = useState<Record<string, number>>({});
  const [showSolution, setShowSolution] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const inFlight = useRef<{ seq: number; controller: AbortController } | null>(null);
  const seq = useRef(0);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const value = drafts[task.id] ?? task.starter;
  const list = history[task.id] ?? [];
  const latest = list.at(-1);

  const flush = () => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    pending.current = false;
    save((r) => ({ ...r, drafts: { ...(r.drafts ?? {}), ...draftsRef.current } }));
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => flushRef.current();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flushRef.current();
      inFlight.current?.controller.abort();
    };
  }, []);

  const change = (d: RequestDraft) => {
    setDrafts((all) => ({ ...all, [task.id]: d }));
    pending.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
  };

  const choose = (id: string) => {
    flush();
    inFlight.current?.controller.abort();
    inFlight.current = null;
    setSending(false);
    setShowSolution(false);
    setConfirmReset(false);
    setTaskId(id);
    save((r) => ({ ...r, task: id }));
  };

  const checksPass = (o: Observation | undefined, all: Observation[]) => !!o && task.checks.every((c) => c.test(o, all));
  const expected = task.question?.answer(list) ?? null;
  const answered = answers[task.id];
  const questionOk = !task.question || (answered !== undefined && expected !== null && answered === expected);

  const send = async () => {
    flush();
    inFlight.current?.controller.abort();
    const id = ++seq.current;
    const controller = new AbortController();
    inFlight.current = { seq: id, controller };
    setSending(true);
    const forTask = task;
    const observation = await sendRequest(value, origin, controller.signal);
    if (seq.current !== id) return; // another send, a task switch or leaving the page replaced it
    inFlight.current = null;
    setSending(false);
    const all = [...(history[forTask.id] ?? []), observation].slice(-HISTORY);
    setHistory((h) => ({ ...h, [forTask.id]: all }));
    const passed = checksPass(observation, all);
    const q = !forTask.question || (answers[forTask.id] !== undefined && answers[forTask.id] === forTask.question.answer(all));
    complete(forTask, passed && q, !passed);
    requestAnimationFrame(() => resultHeading.current?.focus());
  };

  /** Records the task as passed (and the lab as completed when every task is), or that an attempt was made. */
  const complete = (t: HttpTask, passed: boolean, attempted: boolean) => {
    if (!passed && !attempted) return;
    save((r) => {
      const tasksDone = passed ? [...new Set([...r.tasksDone, t.id])] : r.tasksDone;
      const all = lab.tasks.every((x) => tasksDone.includes(x.id));
      return { ...r, task: t.id, tasksDone, attempted: r.attempted || attempted, ...(all && !r.completedAt ? { completedAt: Date.now() } : {}) };
    });
  };

  const answer = (option: string) => {
    setAnswers((a) => ({ ...a, [task.id]: option }));
    const right = expected !== null && option === expected;
    if (right && checksPass(latest, list)) complete(task, true, false);
  };

  const resetRequest = () => {
    change(task.starter);
    setConfirmReset(false);
  };

  const hints = hintsShown[task.id] ?? 0;
  const taskDone = done.has(task.id);
  const index = lab.tasks.indexOf(task);
  const next = lab.tasks.slice(index + 1).find((t) => !done.has(t.id)) ?? lab.tasks.find((t) => !done.has(t.id));
  const solutionAvailable = list.length > 0 || taskDone;

  return (
    <>
      <section className="eng-panel eng-work" aria-labelledby="eng-work-title">
        <h2 id="eng-work-title">Tasks</h2>
        <ol className="eng-tasks">
          {lab.tasks.map((t, i) => (
            <li key={t.id}>
              <button type="button" aria-current={t.id === task.id ? "step" : undefined} onClick={() => choose(t.id)}>
                {done.has(t.id) ? <CircleCheck aria-hidden="true" className="is-done" /> : <Circle aria-hidden="true" />}
                <span>{i + 1}. {t.title}</span>
                <span className="sr-only">{done.has(t.id) ? " (done)" : ""}</span>
              </button>
            </li>
          ))}
        </ol>
        <h3 className="eng-task-title">{index + 1}. {task.title}{taskDone && <span className="eng-state is-completed">Done</span>}</h3>
        <p className="eng-goal">{task.goal}</p>
        <Builder task={task} value={value} onChange={change} disabled={sending} />
        <div className="eng-actions">
          <button type="button" className="button primary" onClick={send} disabled={sending}><Send aria-hidden="true" />{sending ? "Sending…" : "Send request"}</button>
          {sending && <button type="button" className="button" onClick={() => { seq.current += 1; inFlight.current?.controller.abort(); inFlight.current = null; setSending(false); }}>Cancel</button>}
          {confirmReset ? (
            <span className="eng-confirm" role="group" aria-label="Confirm reset">
              <span>Put this request back as it started?</span>
              <button type="button" className="button" onClick={resetRequest}>Reset request</button>
              <button type="button" className="text-button" onClick={() => setConfirmReset(false)}>Keep it</button>
            </span>
          ) : (
            <button type="button" className="text-button" onClick={() => setConfirmReset(true)}><RotateCcw aria-hidden="true" />Reset</button>
          )}
        </div>
        <div className="eng-hints">
          {task.hints.slice(0, hints).map((hint, i) => <p key={i} className="eng-hint"><Lightbulb aria-hidden="true" /><span><b>Hint {i + 1}.</b> {hint}</span></p>)}
          <div className="eng-hint-actions">
            {hints < task.hints.length && (
              <button type="button" className="text-button" onClick={() => { setHintsShown((h) => ({ ...h, [task.id]: hints + 1 })); save((r) => ({ ...r, hints: Math.min(50, r.hints + 1) })); }}>
                <Lightbulb aria-hidden="true" />{hints === 0 ? "Show a hint" : `Next hint (${hints + 1} of ${task.hints.length})`}
              </button>
            )}
            {solutionAvailable ? (
              <button type="button" className="text-button" aria-expanded={showSolution} onClick={() => setShowSolution((s) => !s)}><Eye aria-hidden="true" />{showSolution ? "Hide the worked request" : "Show a worked request"}</button>
            ) : <span className="eng-muted">A worked request appears after your first send.</span>}
          </div>
          {showSolution && solutionAvailable && (
            <figure className="eng-solution">
              <figcaption>One request that passes. Try reading why before copying it.</figcaption>
              <pre><code>{requestText(task.solution, new URL(origin).host)}{task.solution.timeoutMs !== 8000 ? `\n(timeout: ${task.solution.timeoutMs} ms)` : ""}{task.solution.cache === "default" ? "\n(browser cache: allowed — send it twice)" : ""}</code></pre>
            </figure>
          )}
        </div>
      </section>
      <section className="eng-panel eng-results" aria-labelledby="eng-results-title" aria-busy={sending}>
        <h2 id="eng-results-title" ref={resultHeading} tabIndex={-1}>Response</h2>
        <p className="eng-status" role="status" aria-live="polite">
          {sending ? "Waiting for the response…" : latest ? `${reason(latest)}${checksPass(latest, list) && questionOk ? " · task passed" : ""}` : "Send the request to see what really comes back."}
        </p>
        <h3 className="eng-checks-title">Checks</h3>
        <ul className="eng-checks" aria-label="Checks for this task">
          {task.checks.map((c) => {
            const ok = latest ? c.test(latest, list) : null;
            return (
              <li key={c.label} className={ok === null ? "" : ok ? "is-pass" : "is-fail"}>
                {ok === null ? <Circle aria-label="Not checked yet" /> : ok ? <CircleCheck aria-label="Passed" /> : <CircleX aria-label="Not yet" />}
                <span>{c.label}</span>
              </li>
            );
          })}
        </ul>
        {task.question && (
          <fieldset className="eng-question" disabled={!latest}>
            <legend>{task.question.prompt}</legend>
            {!latest && <p className="eng-muted">Send first: the answer comes from what your browser reports.</p>}
            {task.question.options.map((opt) => (
              <label key={opt.id} className="eng-option">
                <input type="radio" name={`q-${task.id}`} value={opt.id} checked={answered === opt.id} onChange={() => answer(opt.id)} />
                <span>{opt.label}</span>
              </label>
            ))}
            {answered !== undefined && latest && (
              <p className={`eng-feedback ${questionOk ? "is-pass" : "is-fail"}`} role="status">
                {questionOk ? <><b>Right, from your evidence.</b> {task.question.explain}</> : <><b>Not what your browser reported.</b> Look at the response and its Timing again.</>}
              </p>
            )}
          </fieldset>
        )}
        {taskDone && next && next.id !== task.id && (
          <p className="eng-next"><button type="button" className="button primary" onClick={() => choose(next.id)}>Next task: {next.title}</button></p>
        )}
        {latest && <Inspector o={latest} origin={origin} />}
        {list.length > 1 && (
          <details className="eng-history">
            <summary>Your attempts on this task ({list.length})</summary>
            <ol>{list.map((o, i) => <li key={i}><code>{o.request.method} {o.request.path}</code> → {reason(o)}</li>)}</ol>
          </details>
        )}
        <p className="eng-fine">Requests go only to Kitab's own /api/lab/ endpoints, without cookies. Responses aren't saved; your requests are, in this browser.</p>
      </section>
    </>
  );
}
