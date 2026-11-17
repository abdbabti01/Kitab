import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ServerRoles } from "./RealWorld.tsx";
import { TermChips } from "../../ui/Terms.tsx";
import { terms } from "../../learning/glossary.ts";
import { LayoutList, Play, Redo2, Undo2, Workflow } from "lucide-react";
import { components, COMPONENT_KINDS, type ComponentKind, type Design } from "../model.ts";
import { validateDesign } from "../validate.ts";
import { designCost, summarize } from "../metrics.ts";
import { simulate, SimulationError, type SimRun } from "../simulate.ts";
import { findings as findingsOf } from "../explain.ts";
import type { Dispatch, EditorState } from "../editor.ts";
import { DesignCanvas, type Highlight, type Selection } from "./DesignCanvas.tsx";
import { Inspector } from "./Inspector.tsx";
import { RunSettings, RunView, type TimelineFocus } from "./SimulationPanel.tsx";
import { useRunPlayback } from "./useRun.ts";
import { connectionNames, kindIcon } from "./kinds.tsx";
import { ErrorBoundary } from "../../app/ErrorBoundary.tsx";

const categories = ["Clients & edge", "Compute", "Data", "Messaging"] as const;

export function Palette({ onAdd, disabled }: { onAdd: (kind: ComponentKind) => void; disabled?: boolean }) {
  return (
    <nav className="arch-palette" aria-label="Add a component">
      {categories.map((category) => (
        <div key={category} className="palette-group">
          <h3>{category}</h3>
          <ul>
            {COMPONENT_KINDS.filter((k) => components[k].category === category).map((kind) => {
              const Icon = kindIcon[kind];
              return (
                <li key={kind}>
                  <button type="button" onClick={() => onAdd(kind)} disabled={disabled} title={components[kind].role}>
                    <Icon aria-hidden="true" /> <span><span className="sr-only">Add </span>{components[kind].name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <ServerRoles />
    </nav>
  );
}

/** The diagram as a list: every component and its connections, operable without pointing. */
function DesignList({ design, selection, onSelect }: { design: Design; selection: Selection; onSelect: (s: Selection) => void }) {
  const name = (id: string) => design.nodes.find((n) => n.id === id)?.label ?? id;
  if (!design.nodes.length) return <p className="muted list-empty">No components yet. Add one from the list of components.</p>;
  return (
    <ul className="design-list">
      {design.nodes.map((node) => {
        const Icon = kindIcon[node.kind];
        const out = design.edges.filter((e) => e.from === node.id);
        return (
          <li key={node.id}>
            <button type="button" aria-pressed={selection?.kind === "node" && selection.id === node.id} onClick={() => onSelect({ kind: "node", id: node.id })}>
              <Icon aria-hidden="true" /> <b>{node.label}</b> <small>{components[node.kind].name}</small>
            </button>
            {out.length > 0 && (
              <ul>
                {out.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="text-button" onClick={() => onSelect({ kind: "edge", id: e.id })}>
                      {connectionNames[e.kind].split(" (")[0]} → {name(e.to)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Props = {
  state: EditorState;
  dispatch: Dispatch;
  /** Fits the diagram again when it changes (another design opened). */
  fitKey: string;
  /** How a run sees the design (a challenge applies its fixed settings and workload). */
  runDesign?: (design: Design) => Design;
  isFixed?: (kind: ComponentKind, field: string) => boolean;
  workloadLocked?: boolean;
  toolbar?: ReactNode;
  /** Shown beside the run controls, e.g. a challenge's checks. */
  aside?: ReactNode;
  onRun?: () => void;
};

const asIs = (design: Design) => design;

/** The architecture editor and simulator: palette, diagram, inspector, run controls and the run itself. */
export function Workspace({ state, dispatch, fitKey, runDesign = asIs, isFixed, workloadLocked, toolbar, aside, onRun }: Props) {
  const design = state.design;
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<"diagram" | "list">("diagram");
  // A run and the editor design it was made from are one piece of state, so they can never be paired wrongly.
  const [current, setCurrent] = useState<{ run: SimRun; source: Design; id: number } | null>(null);
  const run = current?.run ?? null;
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [focus, setFocus] = useState<TimelineFocus>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const playback = useRunPlayback(run);
  // The design as a run will see it (a challenge's fixed settings applied): what the diagram and inspector show.
  const effective = useMemo(() => runDesign(design), [design, runDesign]);
  const validation = useMemo(() => validateDesign(effective), [effective]);
  const issues = useMemo(() => new Set(validation.errors.flatMap((e) => e.nodes)), [validation]);
  const summary = useMemo(() => (run ? summarize(run) : null), [run]);
  const findings = useMemo(() => (run && summary ? findingsOf(run, summary) : []), [run, summary]);
  const stale = current !== null && current.source !== design;

  // Select a component as soon as it is added, and say where it went.
  useEffect(() => {
    if (!state.added) return;
    const node = design.nodes.find((n) => n.id === state.added);
    if (!node) return;
    setSelection({ kind: "node", id: node.id });
    setAnnouncement(`Added ${node.label}. Connect it from the inspector, or drag from its right edge to another component.`);
  }, [state.added]);
  useEffect(() => {
    if (selection && !design.nodes.some((n) => n.id === selection.id) && !design.edges.some((e) => e.id === selection.id)) setSelection(null);
  }, [design]);
  useEffect(() => {
    setCurrent(null);
    setSelection(null);
  }, [fitKey]);

  const add = (kind: ComponentKind) => {
    const right = design.nodes.length ? Math.max(...design.nodes.map((n) => n.x)) + 220 : 120;
    const y = design.nodes.length ? Math.round(design.nodes.reduce((sum, n) => sum + n.y, 0) / design.nodes.length) : 200;
    dispatch({ type: "add-node", kind, x: right, y });
  };

  const start = () => {
    setRunning(true);
    setRunError("");
    // Let "Running…" paint before the simulation blocks the main thread.
    setTimeout(() => {
      try {
        const next = simulate(runDesign(design));
        setCurrent((c) => ({ run: next, source: design, id: (c?.id ?? 0) + 1 }));
        setFocus(null);
        setShown([]);
        setAnnouncement(`Run ready: ${next.events.length.toLocaleString("en")} events over ${(next.endMs / 1000).toFixed(1)} simulated seconds. Press Play or step through it.`);
        onRun?.();
      } catch (error) {
        setRunError(error instanceof SimulationError ? error.message : "The simulation couldn't run.");
      } finally {
        setRunning(false);
      }
    }, 0);
  };

  const highlight = useMemo<Highlight | null>(() => {
    if (!run) return shown.length ? { nodes: shown, edges: [] } : null;
    if (focus?.kind === "event") {
      const e = run.events[focus.index];
      return { nodes: [e.node, e.to ?? ""], edges: e.edge ? [e.edge] : [] };
    }
    if (focus?.kind === "request" || focus?.kind === "message") {
      const steps = run.events.slice(0, playback.cursor.count).filter((e) => (focus.kind === "request" ? e.req === focus.req : e.msg === focus.msg));
      return { nodes: steps.flatMap((e) => [e.node, e.to ?? ""]), edges: steps.flatMap((e) => (e.edge ? [e.edge] : [])) };
    }
    return shown.length ? { nodes: shown, edges: [] } : null;
  }, [run, focus, shown, playback.cursor.count]);

  const fold = stale ? null : playback.fold;
  // A failure showing the run or the inspector is contained there: the design and the editor stay usable, and
  // clearing the run (and the selection) is a recovery that works. A new run also resets it.
  const contained = (what: string) => (reset: () => void) => (
    <div className="arch-contained" role="alert">
      <p><b>{what} hit an error.</b> Your design is unchanged and still saved.</p>
      <button type="button" className="button" onClick={() => (setCurrent(null), setSelection(null), reset())}>Clear the run and continue</button>
    </div>
  );
  const runKey = String(current?.id ?? 0);
  const fixed = isFixed ?? (() => false);

  return (
    <div className="arch-workspace">
      <div className="arch-toolbar" role="toolbar" aria-label="Design">
        <button type="button" className="icon-button" onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} aria-label="Undo" title="Undo"><Undo2 aria-hidden="true" /></button>
        <button type="button" className="icon-button" onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} aria-label="Redo" title="Redo"><Redo2 aria-hidden="true" /></button>
        <div className="segmented" role="group" aria-label="Show the design as">
          <button type="button" aria-pressed={view === "diagram"} onClick={() => setView("diagram")}><Workflow aria-hidden="true" /> Diagram</button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><LayoutList aria-hidden="true" /> List</button>
        </div>
        <span className="cost" title="Abstract units for comparing designs, not a price">Cost: {designCost(design)} units</span>
        {toolbar}
      </div>
      <div className="arch-grid">
        <Palette onAdd={add} disabled={design.nodes.length >= 40} />
        <div className="arch-stage">
          {view === "diagram" ? (
            <DesignCanvas design={effective} dispatch={dispatch} selection={selection} onSelect={setSelection} fold={fold} issues={issues} locked={state.locked} highlight={highlight} label={`Architecture diagram: ${design.nodes.length} components, ${design.edges.length} connections. Tab to a component; arrow keys move it, Delete removes it.`} fitKey={fitKey} />
          ) : (
            <DesignList design={effective} selection={selection} onSelect={setSelection} />
          )}
          <p className="legend-line">
            <span className="edge-key is-request">Request</span> <span className="edge-key is-async">Message</span> <span className="edge-key is-replication">Replication</span>
          </p>
        </div>
        <ErrorBoundary area="architecture-inspector" resetKey={runKey} fallback={contained("The inspector")}>
          <Inspector design={effective} dispatch={dispatch} selection={selection} onSelect={setSelection} validation={validation} fold={fold} locked={state.locked} isFixed={fixed} />
        </ErrorBoundary>
      </div>
      <p className="sr-only" role="status">{announcement}</p>

      <section className="arch-run" aria-labelledby="run-title">
        <div className="run-head">
          <h2 id="run-title">Simulation</h2>
          <button type="button" className="button primary" onClick={start} disabled={!validation.ok || running}>
            <Play aria-hidden="true" /> {running ? "Running…" : run ? "Run again" : "Run simulation"}
          </button>
          {!validation.ok && <p className="run-blocked">Fix {validation.errors.length === 1 ? "one problem" : `${validation.errors.length} problems`} first: {validation.errors[0].message}</p>}
          {runError && <p className="run-blocked" role="alert">{runError}</p>}
          {stale && <p className="run-stale" role="status">The design changed after this run. Run again to see the new design.</p>}
        </div>
        <TermChips label="Terms used in runs" lead="Terms used in runs:" terms={terms("slot", "rps", "throughput", "latency", "queue", "cacheHit", "lb", "pool", "worker", "retry")} />
        <RunSettings design={design} dispatch={dispatch} workloadLocked={workloadLocked} />
        {aside}
        {!run && <p className="muted run-intro">A run sends the clients' requests through your design for {effective.workload.durationS} simulated seconds. Then play it back, step through each event, follow one request, and read what the run shows. All numbers come from this simplified model, not from real cloud services.</p>}
        <ErrorBoundary area="architecture-run" resetKey={runKey} fallback={contained("Showing this run")}>
        {run && !stale && (
          <RunView
            design={run.design}
            run={run}
            fold={playback.fold}
            playback={playback}
            summary={summary}
            findings={findings}
            focus={focus}
            onFocus={setFocus}
            selectedNode={selection?.kind === "node" ? selection.id : null}
            onShowNodes={(nodes) => (setShown(nodes), setFocus(null), setSelection(nodes[0] ? { kind: "node", id: nodes[0] } : null))}
          />
        )}
        </ErrorBoundary>
      </section>
    </div>
  );
}
