import { useMemo, useState } from "react";
import { CircleCheck, Info, Pause, Play, Plus, RotateCcw, StepBack, StepForward, Trash2, TriangleAlert, X } from "lucide-react";
import type { Design } from "../model.ts";
import { BUCKET_MS, percentile, type Fold, type Summary } from "../metrics.ts";
import { describeEvent, isNotable, ms, pct, seconds, type Finding } from "../explain.ts";
import type { SimEvent, SimRun } from "../simulate.ts";
import type { Dispatch } from "../editor.ts";
import { workloadFields } from "../fields.ts";
import { SettingField } from "./Inspector.tsx";
import { SPEEDS, type Cursor } from "./useRun.ts";

type Playback = {
  cursor: Cursor;
  playing: boolean;
  speed: number;
  controls: { play: () => void; pause: () => void; step: () => void; stepBack: () => void; reset: () => void; seek: (t: number) => void; seekEvent: (i: number) => void; toEnd: () => void; setSpeed: (s: number) => void };
};

export type TimelineFocus = { kind: "event"; index: number } | { kind: "request"; req: number } | { kind: "message"; msg: number } | null;

/** The workload and planned failures: what a run will send and break. */
export function RunSettings({ design, dispatch, workloadLocked }: { design: Design; dispatch?: Dispatch; workloadLocked?: boolean }) {
  const name = (id: string) => design.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <details className="run-settings">
      <summary>Traffic and failures</summary>
      {workloadLocked ? (
        <p className="muted">This challenge sets the traffic. Its scenarios decide the failures.</p>
      ) : (
        <>
          <fieldset className="arch-settings is-grid">
            <legend>Traffic</legend>
            {workloadFields.map((field) => (
              <SettingField key={field.field} field={field} value={(design.workload as Record<string, unknown>)[field.field]} disabled={!dispatch} onChange={(value) => dispatch?.({ type: "set-workload", field: field.field as keyof Design["workload"], value: value as number | string })} onDone={() => dispatch?.({ type: "settle" })} />
            ))}
          </fieldset>
          <p className="muted">Each client's request rate and mix are set on the client itself.</p>
          <fieldset className="arch-settings">
            <legend>Planned failures</legend>
            {!design.faults.length && <p className="muted">None. Select a component and choose “Plan a failure”, or add one here.</p>}
            <ul className="fault-list">
              {design.faults.map((fault, index) => (
                <li key={index}>
                  <b>{name(fault.node)}</b> down from
                  <input type="number" aria-label={`${name(fault.node)} fails at (seconds)`} min={0} max={60} step={0.5} value={fault.fromS} disabled={!dispatch} onChange={(event) => dispatch?.({ type: "set-fault", index, fault: { ...fault, fromS: Number(event.target.value) } })} /> s to
                  <input type="number" aria-label={`${name(fault.node)} recovers at (seconds)`} min={0} max={120} step={0.5} value={fault.toS} disabled={!dispatch} onChange={(event) => dispatch?.({ type: "set-fault", index, fault: { ...fault, toS: Number(event.target.value) } })} /> s
                  {dispatch && <button type="button" className="icon-button" aria-label={`Remove the failure of ${name(fault.node)}`} onClick={() => dispatch({ type: "remove-fault", index })}><Trash2 aria-hidden="true" /></button>}
                </li>
              ))}
            </ul>
            {dispatch && design.nodes.some((n) => n.kind !== "client") && (
              <button type="button" className="button" onClick={() => dispatch({ type: "add-fault", node: design.nodes.find((n) => n.kind !== "client")!.id })}>
                <Plus aria-hidden="true" /> Add a failure
              </button>
            )}
          </fieldset>
        </>
      )}
    </details>
  );
}

/** Succeeded and failed requests per half second, up to the cursor; a table carries the same numbers. */
function ThroughputChart({ fold, run }: { fold: Fold; run: SimRun }) {
  const buckets = Math.max(1, Math.ceil(run.endMs / BUCKET_MS));
  const series = fold.series;
  const total = useMemo(() => Math.max(1, ...peakOf(run)), [run]);
  const w = 600;
  const h = 120;
  const bw = w / buckets;
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const shown = hover !== null ? series[hover] : undefined;
  return (
    <figure className="throughput">
      <figcaption>
        Finished requests per half second <span className="legend"><i className="swatch ok" /> succeeded <i className="swatch failed" /> failed</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h + 16}`} role="img" aria-label={`Requests finished per half second up to ${seconds(fold.t)}: ${fold.totals.ok} succeeded and ${fold.totals.failed} failed so far.`} onPointerLeave={() => setHover(null)}>
        <line className="axis" x1={0} x2={w} y1={h} y2={h} />
        {series.map((b, i) => {
          const okH = (b.ok / total) * (h - 4);
          const failH = (b.failed / total) * (h - 4);
          return (
            <g key={i} onPointerEnter={() => setHover(i)}>
              <rect className="hit" x={i * bw} y={0} width={bw} height={h} />
              {b.ok > 0 && <rect className="bar ok" x={i * bw + 1} y={h - okH} width={Math.max(1, bw - 2)} height={okH} rx={Math.min(2, bw / 4)} />}
              {b.failed > 0 && <rect className="bar failed" x={i * bw + 1} y={h - okH - failH - (b.ok ? 2 : 0)} width={Math.max(1, bw - 2)} height={failH} rx={Math.min(2, bw / 4)} />}
            </g>
          );
        })}
        <line className="cursor" x1={(fold.t / (buckets * BUCKET_MS)) * w} x2={(fold.t / (buckets * BUCKET_MS)) * w} y1={0} y2={h} />
        <text className="tick" x={0} y={h + 13}>0 s</text>
        <text className="tick" x={w} y={h + 13} textAnchor="end">{(buckets * BUCKET_MS / 1000).toFixed(1)} s</text>
      </svg>
      <p className="chart-tip" aria-live="off">
        {shown && hover !== null ? `${(hover * BUCKET_MS / 1000).toFixed(1)}–${((hover + 1) * BUCKET_MS / 1000).toFixed(1)} s: ${shown.ok} succeeded, ${shown.failed} failed, 95% within ${ms(percentile(shown.latencies, 95))}` : "Point at a bar for its numbers."}
      </p>
      <details className="chart-table" onToggle={(event) => setTable(event.currentTarget.open)}>
        <summary>Show as a table</summary>
        {table && <table>
          <thead><tr><th scope="col">Time</th><th scope="col">Succeeded</th><th scope="col">Failed</th><th scope="col">95% within</th></tr></thead>
          <tbody>
            {series.map((b, i) => (b.ok || b.failed ? <tr key={i}><td>{(i * BUCKET_MS / 1000).toFixed(1)} s</td><td>{b.ok}</td><td>{b.failed}</td><td>{ms(percentile(b.latencies, 95))}</td></tr> : null))}
          </tbody>
        </table>}
      </details>
    </figure>
  );
}

/** The tallest bar of the whole run, so the scale doesn't jump while it plays. */
function peakOf(run: SimRun) {
  const counts = new Map<number, number>();
  for (const e of run.events) if (e.type === "complete") counts.set(Math.floor(e.t / BUCKET_MS), (counts.get(Math.floor(e.t / BUCKET_MS)) ?? 0) + 1);
  return [...counts.values()];
}

const findingIcon = { problem: TriangleAlert, warning: TriangleAlert, good: CircleCheck, info: Info };

export function Findings({ findings, onShow }: { findings: Finding[]; onShow?: (nodes: string[]) => void }) {
  return (
    <ul className="findings">
      {findings.map((f) => {
        const Icon = findingIcon[f.tone];
        return (
          <li key={f.id} className={`finding is-${f.tone}`}>
            <Icon aria-hidden="true" />
            <div>
              <b>{f.title}</b>
              <p>{f.detail}</p>
              {f.nodes.length > 0 && onShow && <button type="button" className="text-button" onClick={() => onShow(f.nodes)}>Show on the diagram</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type PanelProps = {
  design: Design;
  run: SimRun | null;
  fold: Fold | null;
  playback: Playback;
  summary: Summary | null;
  findings: Finding[];
  focus: TimelineFocus;
  onFocus: (focus: TimelineFocus) => void;
  selectedNode: string | null;
  onShowNodes: (nodes: string[]) => void;
};

/** Playback controls, the metrics at the cursor, the event timeline and the run's findings. */
export function RunView({ design, run, fold, playback, summary, findings, focus, onFocus, selectedNode, onShowNodes }: PanelProps) {
  const [filter, setFilter] = useState<"notable" | "all" | "component">("notable");
  const { cursor, playing, speed, controls } = playback;
  const timeline = useMemo(() => {
    if (!run) return [];
    if (focus?.kind === "request") return run.events.filter((e) => e.req === focus.req);
    if (focus?.kind === "message") return run.events.filter((e) => e.msg === focus.msg);
    const keep = filter === "notable" ? isNotable : filter === "component" && selectedNode ? (e: SimEvent) => e.node === selectedNode || e.to === selectedNode : () => true;
    // The latest 50 matches before the cursor, newest first, without copying the whole stream on every frame.
    const list: SimEvent[] = [];
    for (let i = cursor.count - 1; i >= 0 && list.length < 50; i--) if (keep(run.events[i])) list.push(run.events[i]);
    return list;
  }, [run, cursor.count, filter, focus, selectedNode]);
  // Percentiles sort every latency so far: recompute only when a request finishes, not on every frame.
  const finished = fold?.totals.latencies.length ?? 0;
  const latency = useMemo(() => ({ p50: percentile(fold?.totals.latencies ?? [], 50), p95: percentile(fold?.totals.latencies ?? [], 95) }), [fold, finished]);
  if (!run || !fold) return null;
  const current = cursor.count ? run.events[cursor.count - 1] : null;

  return (
    <div className="run-view">
      <div className="playback" role="group" aria-label="Playback">
        <button type="button" className="button primary" onClick={playing ? controls.pause : controls.play} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="icon-button" onClick={controls.stepBack} aria-label="Step back one event" disabled={!cursor.count}><StepBack aria-hidden="true" /></button>
        <button type="button" className="icon-button" onClick={controls.step} aria-label="Step forward one event" disabled={cursor.count >= run.events.length}><StepForward aria-hidden="true" /></button>
        <button type="button" className="icon-button" onClick={controls.reset} aria-label="Back to the start"><RotateCcw aria-hidden="true" /></button>
        <label className="speed">
          Speed
          <select value={speed} onChange={(event) => controls.setSpeed(Number(event.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <input
          className="scrubber"
          type="range"
          min={0}
          max={run.endMs}
          step={1}
          value={cursor.t}
          onChange={(event) => controls.seek(Number(event.target.value))}
          aria-label="Simulated time"
          aria-valuetext={`${seconds(cursor.t)} of ${seconds(run.endMs)}`}
        />
        <span className="clock">{seconds(cursor.t)} · event {cursor.count.toLocaleString("en")} of {run.events.length.toLocaleString("en")}</span>
        <button type="button" className="text-button" onClick={controls.toEnd}>Skip to the end</button>
      </div>
      {current && <p className="current-event" aria-live="polite">{describeEvent(current, design)}</p>}

      <dl className="run-stats" aria-label="So far">
        <div><dt>Requests sent</dt><dd>{fold.totals.requests.toLocaleString("en")}</dd></div>
        <div><dt>Succeeded</dt><dd>{fold.totals.ok.toLocaleString("en")}{fold.totals.requests ? <small> {pct(fold.totals.ok / Math.max(1, fold.totals.ok + fold.totals.failed))} of finished</small> : null}</dd></div>
        <div><dt>Failed</dt><dd className={fold.totals.failed ? "is-bad" : undefined}>{fold.totals.failed.toLocaleString("en")}</dd></div>
        <div><dt>Half within</dt><dd>{ms(latency.p50)}</dd></div>
        <div><dt>95% within</dt><dd>{ms(latency.p95)}</dd></div>
        <div><dt>Retries · timeouts</dt><dd>{fold.totals.retries} · {fold.totals.timeouts}</dd></div>
      </dl>
      <ThroughputChart fold={fold} run={run} />

      <section className="timeline" aria-labelledby="timeline-title">
        <div className="timeline-head">
          <h3 id="timeline-title">{focus?.kind === "request" ? `Request #${focus.req}, every step` : focus?.kind === "message" ? `Message #${focus.msg}, every step` : "Events"}</h3>
          {focus?.kind === "request" || focus?.kind === "message" ? (
            <button type="button" className="button" onClick={() => onFocus(null)}><X aria-hidden="true" /> Stop following</button>
          ) : (
            <div role="group" aria-label="Show events" className="segmented">
              <button type="button" aria-pressed={filter === "notable"} onClick={() => setFilter("notable")}>Important</button>
              <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
              <button type="button" aria-pressed={filter === "component"} onClick={() => setFilter("component")} disabled={!selectedNode}>Selected component</button>
            </div>
          )}
        </div>
        {!timeline.length && <p className="muted">{filter === "notable" && !focus ? "Nothing unusual yet: no failures, retries or timeouts so far." : "No events yet."}</p>}
        <ol className="event-list">
          {timeline.map((e) => (
            <li key={e.i} className={`${e.i >= cursor.count ? "is-future" : ""}${focus?.kind === "event" && focus.index === e.i ? " is-focused" : ""}${isNotable(e) ? " is-notable" : ""}`}>
              <button type="button" onClick={() => (controls.seekEvent(e.i), onFocus(focus?.kind === "request" || focus?.kind === "message" ? focus : { kind: "event", index: e.i }))}>
                <time>{(e.t / 1000).toFixed(3)} s</time> <span>{describeEvent(e, design)}</span>
              </button>
              {e.req !== undefined && focus?.kind !== "request" && <button type="button" className="text-button follow" onClick={() => onFocus({ kind: "request", req: e.req! })}>Follow #{e.req}</button>}
              {e.msg !== undefined && e.req === undefined && focus?.kind !== "message" && <button type="button" className="text-button follow" onClick={() => onFocus({ kind: "message", msg: e.msg! })}>Follow message</button>}
            </li>
          ))}
        </ol>
      </section>

      {summary && (
        <section className="run-findings" aria-labelledby="findings-title">
          <h3 id="findings-title">What the whole run shows</h3>
          <Findings findings={findings} onShow={onShowNodes} />
        </section>
      )}
    </div>
  );
}
