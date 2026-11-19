import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CircleCheck, CircleX, Eye, Lightbulb, ListChecks, Play, RotateCcw, Square } from "lucide-react";
import type { CodeLab } from "../model.ts";
import type { LabRecord } from "../progress.ts";
import { startRun, supportsSandbox } from "../run.ts";
import { allPassed, type RunOutcome } from "../sandbox.ts";
import type { Save } from "./LabPage.tsx";

const SAVE_DELAY_MS = 400;

/** What a failure means, in plain words, and whose problem it is: the learner's code, the browser, or Kitab. */
export function explainFailure(outcome: RunOutcome): { title: string; detail: string } | null {
  const seconds = `${outcome.timeoutMs / 1000} s`;
  if (outcome.status === "timeout") {
    return {
      title: `Stopped after ${seconds}: the program didn't finish`,
      detail: `${outcome.pendingTest ? `It was running the test “${outcome.pendingTest}”. ` : ""}The usual cause is a loop whose condition never becomes false, or a recursion or retry with no end. Add console.log inside the loop to watch its state, then Run again.`,
    };
  }
  if (outcome.status === "stopped") return { title: "You stopped this run", detail: "Nothing from it counts. Your code is unchanged." };
  if (outcome.status === "unsupported") return { title: "This browser can't run the sandbox", detail: `${outcome.error?.message ?? ""} This is a limit of the browser, not a problem with your code. Try a current version of Chrome, Edge, Firefox or Safari.` };
  const error = outcome.error;
  if (!error) return null;
  const line = error.line ? ` (line ${error.line})` : "";
  if (error.kind === "internal") return { title: "Kitab couldn't run this lab's tests", detail: `${error.message}. This is a problem in Kitab, not in your code.` };
  if (error.kind === "flood") return { title: "Too much output too fast", detail: error.message };
  if (error.kind === "syntax") return { title: `SyntaxError: ${error.message}`, detail: "The engine couldn't read your code as JavaScript, so nothing ran. Look for a missing bracket, quote, comma or parenthesis near the code you changed last." };
  const what: Record<string, string> = {
    ReferenceError: "Your code used a name that doesn't exist here: a typo, or a variable used before it was declared.",
    TypeError: "A value was used in a way its type doesn't allow: calling something that isn't a function, or reading a property of undefined or null.",
    RangeError: /call stack/i.test(error.message) ? "The call stack filled up: a function kept calling itself without reaching a base case." : "A value was outside the range allowed. If you threw this RangeError yourself, your check worked.",
    InternalError: /recursion/i.test(error.message) ? "The call stack filled up: a function kept calling itself without reaching a base case." : "The engine hit an internal limit.",
    "Early return": "",
  };
  return { title: `${error.name ?? "Error"}: ${error.message}${line}`, detail: what[error.name ?? ""] ?? "Your program threw this error and stopped. Read the message and the line it names." };
}

function Editor({ value, onChange, label, file }: { value: string; onChange: (v: string) => void; label: string; file: string }) {
  const gutter = useRef<HTMLDivElement>(null);
  const escaped = useRef(false);
  const lines = value.split("\n").length;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") return void (escaped.current = true);
    if (event.key !== "Tab" || event.shiftKey || escaped.current || event.ctrlKey || event.metaKey || event.altKey) {
      escaped.current = false;
      return;
    }
    event.preventDefault();
    const el = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    const next = `${value.slice(0, start)}  ${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
  };
  return (
    <div className="eng-editor">
      <div className="eng-file" aria-hidden="true">{file}</div>
      <div className="eng-editor-body">
        <div className="eng-gutter" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
        <textarea
          aria-label={label}
          aria-describedby="eng-editor-help"
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
        />
      </div>
      <p id="eng-editor-help" className="eng-help">Tab inserts two spaces. To leave the editor with the keyboard, press Esc, then Tab.</p>
    </div>
  );
}

export function CodeWorkspace({ lab, record, save }: { lab: CodeLab; record: LabRecord | undefined; save: Save }) {
  const [code, setCode] = useState(() => record?.code ?? lab.starter);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [live, setLive] = useState<RunOutcome | null>(null);
  const [ranCode, setRanCode] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const run = useRef<{ id: number; stop: () => void } | null>(null);
  const seq = useRef(0);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopButton = useRef<HTMLButtonElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const hints = record?.hints ?? 0;
  const running = live !== null;
  const canRun = supportsSandbox();

  // Unsaved edits are written after a pause, before a run, and when the page is left or hidden.
  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const value = pending.current;
    pending.current = null;
    save((r) => ({ ...r, code: value }));
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
      run.current?.stop();
    };
  }, []);

  const edit = (value: string) => {
    setCode(value);
    pending.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
  };

  const execute = (mode: "run" | "check") => {
    if (running) return;
    pending.current = code;
    flush(); // saved before it runs: a crash can't lose it
    const id = ++seq.current;
    setOutcome(null);
    setRanCode(code);
    const started = startRun({ mode, code, exports: lab.exports, tests: mode === "check" ? lab.tests : "", timeoutMs: lab.timeoutMs }, (o) => {
      if (seq.current === id) setLive(o);
    });
    run.current = { id, stop: started.stop };
    setLive({ mode, status: "finished", logs: [], tests: [], timeoutMs: lab.timeoutMs });
    requestAnimationFrame(() => stopButton.current?.focus());
    void started.result.then((final) => {
      if (seq.current !== id) return; // a newer run, or a reset, replaced this one
      run.current = null;
      setLive(null);
      setOutcome(final);
      if (mode === "check") {
        const passed = allPassed(final);
        // Never the code from when it ran: edits made during the run are newer and are saved on their own.
        save((r) => ({ ...r, attempted: true, ...(passed ? { completedAt: Date.now() } : {}) }));
      }
      requestAnimationFrame(() => resultHeading.current?.focus());
    });
  };

  const reset = () => {
    seq.current += 1;
    run.current?.stop();
    run.current = null;
    setLive(null);
    setOutcome(null);
    setRanCode(null);
    setCode(lab.starter);
    pending.current = null;
    clearTimeout(timer.current);
    save((r) => ({ ...r, code: lab.starter, labVersion: lab.version }));
    setConfirmReset(false);
  };

  const shown = live ?? outcome;
  const failure = outcome ? explainFailure(outcome) : null;
  const passedCount = shown?.tests.filter((t) => t.passed).length ?? 0;
  const status = live
    ? `${live.mode === "check" ? "Checking" : "Running"}… ${live.tests.length ? `${live.tests.length} tests done` : ""}`
    : !outcome
      ? "Nothing has run yet."
      : outcome.status === "finished" && outcome.mode === "check"
        ? allPassed(outcome) ? `All ${outcome.tests.length} tests passed.` : `${passedCount} of ${outcome.tests.length} tests passed.`
        : outcome.status === "finished"
          ? `Finished${outcome.ms !== undefined ? ` in ${Math.max(1, Math.round(outcome.ms))} ms` : ""}.`
          : failure?.title ?? "Stopped.";
  const solutionAvailable = record?.attempted || record?.completedAt;

  return (
    <>
      <section className="eng-panel eng-work" aria-labelledby="eng-work-title">
        <h2 id="eng-work-title">Your code</h2>
        <Editor value={code} onChange={edit} label={`Code editor: ${lab.file}`} file={lab.file} />
        <div className="eng-actions">
          {running ? (
            <button ref={stopButton} type="button" className="button" onClick={() => run.current?.stop()}><Square aria-hidden="true" />Stop</button>
          ) : (
            <>
              <button type="button" className="button primary" onClick={() => execute("check")} disabled={!canRun}><ListChecks aria-hidden="true" />Check solution</button>
              <button type="button" className="button" onClick={() => execute("run")} disabled={!canRun}><Play aria-hidden="true" />Run</button>
            </>
          )}
          {confirmReset ? (
            <span className="eng-confirm" role="group" aria-label="Confirm reset">
              <span>Replace your code with the starting code?</span>
              <button type="button" className="button" onClick={reset}>Reset code</button>
              <button type="button" className="text-button" onClick={() => setConfirmReset(false)}>Keep my code</button>
            </span>
          ) : (
            <button type="button" className="text-button" onClick={() => setConfirmReset(true)}><RotateCcw aria-hidden="true" />Reset</button>
          )}
        </div>
        {!canRun && <p className="notice warning">This browser can't run code in an isolated sandbox (it needs sandboxed iframes and Web Workers), so Run and Check are off. Your code is still saved.</p>}
        <div className="eng-hints">
          {lab.hints.slice(0, hints).map((hint, i) => (
            <p key={i} className="eng-hint"><Lightbulb aria-hidden="true" /><span><b>Hint {i + 1}.</b> {hint}</span></p>
          ))}
          <div className="eng-hint-actions">
            {hints < lab.hints.length && (
              <button type="button" className="text-button" onClick={() => save((r) => ({ ...r, hints: Math.min(lab.hints.length, (r.hints ?? 0) + 1) }))}>
                <Lightbulb aria-hidden="true" />{hints === 0 ? "Show a hint" : `Next hint (${hints + 1} of ${lab.hints.length})`}
              </button>
            )}
            {solutionAvailable ? (
              <button type="button" className="text-button" aria-expanded={showSolution} onClick={() => setShowSolution((s) => !s)}><Eye aria-hidden="true" />{showSolution ? "Hide the worked solution" : "Show a worked solution"}</button>
            ) : (
              <span className="eng-muted">A worked solution appears after your first Check.</span>
            )}
          </div>
          {showSolution && solutionAvailable && (
            <figure className="eng-solution">
              <figcaption>One correct solution. Compare it with yours rather than pasting it: the comments say why each part is there.</figcaption>
              <pre><code>{lab.solution}</code></pre>
            </figure>
          )}
        </div>
      </section>
      <section className="eng-panel eng-results" aria-labelledby="eng-results-title" aria-busy={running}>
        <h2 id="eng-results-title" ref={resultHeading} tabIndex={-1}>Result</h2>
        <p className={`eng-status${outcome && !live ? (allPassed(outcome) ? " is-pass" : outcome.status === "finished" && (outcome.mode === "run" || passedCount === outcome.tests.length) ? "" : " is-fail") : ""}`} role="status" aria-live="polite">{status}</p>
        {outcome && ranCode !== null && ranCode !== code && <p className="eng-muted">You've edited the code since this run. Run it again to see the effect.</p>}
        {failure && (
          <div className="eng-failure" role="alert">
            <b>{failure.title}</b>
            {failure.detail && <p>{failure.detail}</p>}
          </div>
        )}
        {shown && shown.tests.length > 0 && (
          <ol className="eng-tests" aria-label="Test results">
            {shown.tests.map((t) => (
              <li key={t.name} className={t.passed ? "is-pass" : "is-fail"}>
                {t.passed ? <CircleCheck aria-label="Passed" /> : <CircleX aria-label="Failed" />}
                <div>
                  <span>{t.name}</span>
                  {t.message && <pre>{t.message}</pre>}
                </div>
              </li>
            ))}
          </ol>
        )}
        <h3 className="eng-console-title">Console output</h3>
        <pre className="eng-console" tabIndex={0} aria-label="Console output">
          {shown?.logs.length ? shown.logs.map((l, i) => <span key={i} className={`is-${l.level}`}>{l.text}{"\n"}</span>) : <span className="eng-muted">{shown ? "(nothing printed)" : "Output from Run and Check appears here."}</span>}
        </pre>
        {outcome?.value !== undefined && <p className="eng-return"><b>Program returned:</b> <code>{outcome.value}</code></p>}
        <p className="eng-fine">Runs in an isolated sandbox with no network or access to Kitab, stopped after {lab.timeoutMs / 1000} s. Checking happens in your browser: it's feedback for learning, not a secure exam.</p>
      </section>
    </>
  );
}
