import { useEffect, useMemo, useState } from "react";
import { ExploreGuide } from "../ui/ExploreGuide.tsx";
import { TermChips } from "../ui/Terms.tsx";
import { terms } from "../learning/glossary.ts";
import { ArrowLeft, Binary, RotateCcw, Save } from "lucide-react";
import "../learning/engines/eager.ts";
import { buildTrace } from "../learning/registry.ts";
import type { Fact, Trace } from "../learning/types.ts";
import { linkProps } from "../app/router.ts";
import { PlaybackBar, usePlayback } from "../mission/Playback.tsx";
import { sceneFor } from "../mission/scenes/index.ts";
import { MAX_VALUES, structureInfo, type StructureKind, type StructureSnapshot } from "../visual-engine/data-structures/model.ts";
import type { DataStructureFrameData } from "../learning/engines/data-structures.ts";
import {
  defaultSetup,
  engineParams,
  experiments,
  fixtureFor,
  inputsFor,
  isRecursion,
  parseSetup,
  safeReturn,
  setupPath,
  structureChoices,
  type Setup,
  type StructureSetup,
} from "./experiments.ts";
import "../mission/mission.css";
import "./structures.css";

/** What the model leaves out, per structure. Shown with every run so no step is mistaken for real memory. */
const limits: Record<StructureKind | "recursion", string> = {
  array: "A dynamic array with a spare slot after the last element; growing into a new, larger block is not shown. Addresses are illustrative (base 0x1000, 4-byte integers). In a real program the language runtime's allocator (or garbage collector) gets memory from the operating system and picks the addresses; the program never chooses them.",
  "linked-list": "A singly linked list. Addresses are illustrative, and memory reclamation (garbage collection or free) is not simulated. In a real program the language runtime's allocator (or garbage collector) gets memory from the operating system and picks the addresses; the program never chooses them.",
  stack: "Backed by an array with a TOP marker; capacity growth is not shown.",
  queue: "Backed by an array with FRONT and REAR markers; capacity growth and wrap-around are not shown.",
  "hash-table": "Seven buckets, bucket = key mod 7, separate chaining. It stores keys only and never resizes.",
  "binary-tree": "An unbalanced binary search tree: it never rebalances, and delete is not modelled.",
  graph: "One fixed undirected graph with a cycle and an isolated vertex; breadth-first search always starts at vertex 1.",
  recursion: "A teaching model of the call stack: one frame per call and a small, configurable stack limit. It does not run JavaScript or measure real memory.",
};

const unitOf: Record<StructureKind | "recursion", string> = {
  array: "arrays", "linked-list": "linked-lists", stack: "choose-structure", queue: "choose-structure",
  "hash-table": "hash-tables", "binary-tree": "trees", graph: "trees", recursion: "recursion",
};

/** The structure's live contents after the run, in an order that rebuilds the same structure. */
function resultValues(snapshot: StructureSnapshot) {
  if (snapshot.buckets) return snapshot.buckets.flatMap((bucket) => bucket.items).sort((a, b) => parseInt(a.address, 16) - parseInt(b.address, 16)).map((item) => item.value);
  return snapshot.items.filter((item) => !item.detached).map((item) => item.value);
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="sp-field">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={min} max={max} step={1} value={value} onChange={(event) => {
        const next = Number(event.target.value);
        if (event.target.value !== "" && Number.isInteger(next)) onChange(Math.max(min, Math.min(max, next)));
      }} />
    </label>
  );
}

function StartingValues({ setup, onChange }: { setup: StructureSetup; onChange: (values: number[] | undefined) => void }) {
  const current = (setup.values ?? fixtureFor(setup.structure)).join(", ");
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);
  const tokens = draft.split(/[\s,]+/).filter(Boolean);
  const invalid = tokens.filter((token) => !/^-?\d+$/.test(token) || Math.abs(Number(token)) > 99);
  const problem = invalid.length ? `Use whole numbers from −99 to 99 (not ${invalid.slice(0, 2).join(", ")}).` : tokens.length > MAX_VALUES ? `At most ${MAX_VALUES} values.` : "";
  const unique = setup.structure === "hash-table" || setup.structure === "binary-tree";
  return (
    <form className="sp-values" onSubmit={(event) => { event.preventDefault(); if (!problem) onChange(tokens.map(Number)); }}>
      <label className="sp-field">
        <span>Starting values</span>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-invalid={problem ? true : undefined} aria-describedby="values-help" spellCheck={false} />
      </label>
      <p id="values-help" className={problem ? "sp-help is-error" : "sp-help"}>
        {problem || `Up to ${MAX_VALUES}, separated by commas. Leave empty for an empty ${structureInfo[setup.structure].label.toLowerCase()}.${unique ? " Repeats are dropped: keys are unique." : ""}`}
      </p>
      <div className="sp-row">
        <button type="submit" className="button" disabled={!!problem || draft === current}>Apply</button>
        {setup.values && <button type="button" className="text-button" onClick={() => onChange(undefined)}>Use the example values</button>}
      </div>
    </form>
  );
}

function SetupPanel({ setup, onChange }: { setup: Setup; onChange: (setup: Setup) => void }) {
  return (
    <section className="sp-panel sp-setup" aria-labelledby="setup-title">
      <h2 id="setup-title">Experiment</h2>
      <fieldset className="sp-structures">
        <legend>Structure</legend>
        {structureChoices.map((choice) => (
          <button key={choice.id} type="button" aria-pressed={setup.structure === choice.id} onClick={() => setup.structure !== choice.id && onChange(defaultSetup(choice.id))}>{choice.label}</button>
        ))}
      </fieldset>
      {isRecursion(setup) ? (
        <>
          <label className="sp-field">
            <span>Function</span>
            <select value={setup.fn} onChange={(event) => onChange({ ...setup, fn: event.target.value === "sum" ? "sum" : "factorial" })}>
              <option value="factorial">factorial(n) = n × factorial(n − 1)</option>
              <option value="sum">sum(n) = n + sum(n − 1)</option>
            </select>
          </label>
          <div className="sp-row">
            <NumberField label="n" value={setup.n} min={1} max={6} onChange={(n) => onChange({ ...setup, n })} />
            <NumberField label="Stack limit (frames)" value={setup.stackLimit} min={4} max={12} onChange={(stackLimit) => onChange({ ...setup, stackLimit })} />
          </div>
          <label className="sp-check">
            <input type="checkbox" checked={setup.baseCase} onChange={(event) => onChange({ ...setup, baseCase: event.target.checked })} />
            <span>Base case <code>if (n &lt;= 1) return 1;</code></span>
          </label>
        </>
      ) : (
        <>
          <label className="sp-field">
            <span>Operation</span>
            <select value={setup.operation} onChange={(event) => onChange({ ...setup, operation: event.target.value as StructureSetup["operation"] })}>
              {structureInfo[setup.structure].operations.map((operation) => <option key={operation.id} value={operation.id}>{operation.label}</option>)}
            </select>
          </label>
          <div className="sp-row">
            {inputsFor(setup).value && <NumberField label={setup.structure === "hash-table" ? "Key" : setup.structure === "graph" ? "Target vertex" : "Value"} value={setup.value} min={-99} max={99} onChange={(value) => onChange({ ...setup, value })} />}
            {inputsFor(setup).index && <NumberField label={setup.structure === "linked-list" ? "Position" : "Index"} value={setup.index} min={0} max={10} onChange={(index) => onChange({ ...setup, index })} />}
          </div>
          {setup.structure !== "graph" && <StartingValues setup={setup} onChange={(values) => onChange({ ...setup, values })} />}
        </>
      )}
      <button type="button" className="text-button sp-reset" onClick={() => onChange(defaultSetup(setup.structure))}><RotateCcw aria-hidden="true" /> Reset this structure</button>
    </section>
  );
}

function Guided({ setup, onPick }: { setup: Setup; onPick: (setup: Setup) => void }) {
  const unit = unitOf[setup.structure];
  const list = [...experiments.filter((e) => e.unit === unit), ...experiments.filter((e) => e.unit !== unit)];
  return (
    <section className="sp-panel sp-guided" aria-labelledby="guided-title">
      <h2 id="guided-title">Guided experiments</h2>
      <p className="sp-help">Each sets up one question. Choose it, step through, and check that you see what it describes; then change one input and predict what changes.</p>
      <ul>
        {list.map((experiment) => {
          const active = setupPath(experiment.setup) === setupPath(setup);
          return (
            <li key={experiment.id}>
              <button type="button" aria-pressed={active} onClick={() => onPick(experiment.setup)}>
                <b>{experiment.title}</b>
                <small>{experiment.detail}</small>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StepFacts({ facts, selected }: { facts: Fact[]; selected: string | null }) {
  const shown = selected ? facts.filter((fact) => fact.entityId === selected) : facts;
  return (
    <dl className="facts">
      {shown.map((fact) => <div key={fact.id}><dt>{fact.label}</dt><dd>{String(fact.value)}</dd></div>)}
    </dl>
  );
}

function Explanation({ trace, index, setup, selected, onKeep }: { trace: Trace; index: number; setup: Setup; selected: string | null; onKeep?: () => void }) {
  const frame = trace.frames[index];
  const last = index === trace.frames.length - 1;
  const ds = !isRecursion(setup) ? (frame.data as DataStructureFrameData).frame : null;
  const Reference = sceneFor(trace.engine.id)?.Reference;
  return (
    <section className="sp-panel sp-explain" aria-labelledby="step-title">
      <p className="sp-step-kind"><span>Step {index + 1} of {trace.frames.length}</span>{frame.chapter && <code>{frame.chapter}</code>}</p>
      <h2 id="step-title">{frame.title}</h2>
      <p className="sp-narration">{frame.narration}</p>
      <dl className="sp-what">
        {ds && <div><dt>State</dt><dd>{ds.state}</dd></div>}
        {ds && <div><dt>Change</dt><dd>{ds.delta}</dd></div>}
        {frame.technical && <div><dt>Code</dt><dd><code>{frame.technical}</code></dd></div>}
      </dl>
      {last && (
        <div className="sp-result">
          <p><b>Result:</b> {String(trace.outcome.result)}</p>
          {"complexity" in trace.outcome && <p><b>Cost:</b> {String(trace.outcome.complexity)}</p>}
          {onKeep && <button type="button" className="button" onClick={onKeep}><Save aria-hidden="true" /> Start the next operation from this result</button>}
        </div>
      )}
      <details className="sp-details">
        <summary>Technical detail{selected ? " for the selected item" : ""}</summary>
        <StepFacts facts={frame.facts} selected={selected} />
        {frame.delta.length > 0 && <p className="sp-help">Changed since the previous step: {frame.delta.join("; ")}</p>}
        {frame.invariant && <p className="sp-help">Rule that always holds: {frame.invariant}</p>}
      </details>
      {Reference && (
        <details className="sp-details">
          <summary>Complexity of each structure</summary>
          <Reference trace={trace} />
        </details>
      )}
      <p className="sp-limits"><b>Model:</b> {limits[setup.structure]}</p>
    </section>
  );
}

/** The Data Structures & Recursion Playground: any structure and operation, step by step. Records nothing. */
export function StructuresPlayground() {
  const [setup, setSetup] = useState<Setup>(() => parseSetup(window.location.search));
  const from = useMemo(() => safeReturn(new URLSearchParams(window.location.search).get("from")), []);
  const [selected, setSelected] = useState<string | null>(null);
  const { engine, params } = engineParams(setup);
  const key = JSON.stringify(params);
  const trace = useMemo(() => buildTrace(engine, params), [engine, key]);
  const playback = usePlayback(trace, true);
  const frame = trace.frames[playback.index];
  const Scene = sceneFor(engine)!.Scene;

  useEffect(() => {
    document.title = "Data Structures & Recursion Playground — Kitab";
  }, []);
  // The address always describes the experiment on screen, so it can be shared or reopened.
  useEffect(() => {
    window.history.replaceState(null, "", setupPath(setup, from));
    setSelected(null);
  }, [key, engine]);

  const ds = !isRecursion(setup) ? setup : null;
  const changed = ["inserted", "removed", "added"].includes(String(trace.outcome.status));
  const keep = ds && ds.structure !== "graph" && changed
    ? () => setSetup({ ...ds, values: resultValues((trace.frames.at(-1)!.data as DataStructureFrameData).frame.snapshot) })
    : undefined;

  return (
    <main id="main" className="page lab-page structures-playground lab-theme">
      <header className="playground-heading">
        <div className="playground-title">
          <Binary className="playground-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Data structures · Playground</p>
            <h1>Data Structures &amp; Recursion Playground</h1>
            <p>Choose a structure and an operation, then step through every read, write, pointer change and stack frame. Each step is computed by Kitab's deterministic model.</p>
          </div>
        </div>
        <p className="heading-links">
          {from && <><a {...linkProps(from)}><ArrowLeft aria-hidden="true" /> Back to your lesson</a> · </>}
          <a {...linkProps("/learn/data-structures")}>Data structures track</a> · <a {...linkProps("/practice?track=data-structures")}>Missions</a> · <a {...linkProps("/playground")}>All Playgrounds</a>
        </p>
      </header>
      <ExploreGuide
        build="Pick any structure and operation, set the inputs and starting values, then step through every read, write, pointer change and stack frame. Nothing is graded or saved."
        tryThis={[
          "Insert at index 0 of an array, then at the head of a linked list: count the steps each takes.",
          "Insert values in sorted order into a binary search tree, then search for the largest one.",
          "Turn off the base case in recursion and watch the stack fill to its limit.",
        ]}
        controls={[
          { name: "Structure, Operation and inputs", does: "Choose what to run. Every change builds a new run from the start." },
          { name: "Starting values and Apply", does: "Set what the structure holds before the operation. Apply builds the run." },
          { name: "Restart run, Previous step, Play, Next step", does: "Move through the run one step at a time or play it; the explanation follows each step." },
          { name: "Start the next operation from this result", does: "Keeps the result as the starting values, so you can chain operations." },
          { name: "Reset this structure", does: "Back to the example values and the default operation." },
        ]}
        guided={<>The guided experiments below each set up one question; for a graded prediction, try a <a {...linkProps("/practice?track=data-structures")}>data structures mission</a>.</>}
      />
      <TermChips label="Terms used here" lead="Terms used here:" terms={terms("reference", "frame", "complexity")} />
      <div className="sp-layout">
        <div className="sp-side">
          <SetupPanel setup={setup} onChange={setSetup} />
          <Guided setup={setup} onPick={setSetup} />
        </div>
        <div className="sp-main">
        <section className="sp-stage" aria-label="Visualization">
          <p className="sp-op">
            {isRecursion(setup)
              ? <>{setup.fn}({setup.n}) · {setup.baseCase ? "with" : "without"} a base case · limit {setup.stackLimit} frames</>
              : <>{structureInfo[setup.structure].label} · {structureInfo[setup.structure].operations.find((o) => o.id === setup.operation)!.label}{inputsFor(setup).value && <> · {setup.structure === "hash-table" ? "key" : "value"} {setup.value}</>}{inputsFor(setup).index && <> · {setup.structure === "linked-list" ? "position" : "index"} {setup.index}</>}</>}
          </p>
          <div className="sp-scene scene-body">
            <Scene frame={frame} trace={trace} selected={selected} attention={null} onSelect={(id) => setSelected((current) => (current === id ? null : id))} />
          </div>
          <PlaybackBar playback={playback} trace={trace} enabled disabledReason="" />
          <p className="sr-only" role="status" aria-live="polite">Step {playback.index + 1} of {trace.frames.length}: {frame.title}</p>
        </section>
        <Explanation trace={trace} index={playback.index} setup={setup} selected={selected} onKeep={keep} />
        </div>
      </div>
    </main>
  );
}
