// The observability workspace's views. Each reads the viewed run up to the cursor; nothing here computes an outcome.
import { useMemo, useState, type PointerEvent } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, CircleOff, Plus, XCircle } from "lucide-react";
import type { Run, Span } from "../engine.ts";
import { clock } from "../assess.ts";
import {
  BUCKET_MS, COMPONENT_LABELS, DIAGNOSTICS, METRICS, buckets, categoryOf, index, logFinding, logs, topology, traceFinding, traces, waterfall,
  type ComponentId, type Context, type DiagnosticResult, type Finding, type Health, type LogLine, type MetricDef, type MetricKey,
} from "../telemetry.ts";
import type { Scenario } from "../scenarios.ts";

export type Pin = (finding: Finding, source: string) => void;
const fmt = (v: number, unit: string) => (unit === "%" ? `${v.toFixed(1)}%` : unit === "ms" ? `${Math.round(v).toLocaleString("en")} ms` : `${Number.isInteger(v) ? v : v.toFixed(1)} ${unit}`);

// ---- Metrics ----

type Marker = { t: number; label: string };
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
}

/** One metric over the run: a single line (the title names it), an optional dashed limit, the cursor and change markers. */
export function MetricChart({ def, run, at, markers, limit }: { def: MetricDef; run: Run; at: number; markers: Marker[]; limit?: { key: MetricKey; label: string } }) {
  const data = buckets(run);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const w = 600, h = 150, pad = 4;
  const max = niceMax(Math.max(...data.map((b) => Math.max(b.values[def.key], limit ? b.values[limit.key] : 0))));
  const x = (t: number) => (t / run.endMs) * w;
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const shown = data.filter((b) => b.from <= at);
  const line = (key: MetricKey, list = shown) => list.map((b, i) => `${i ? "L" : "M"}${x(b.from + BUCKET_MS / 2).toFixed(1)},${y(b.values[key]).toFixed(1)}`).join(" ");
  const last = shown.at(-1);
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - box.left) / box.width) * run.endMs;
    const i = Math.max(0, Math.min(shown.length - 1, Math.floor(t / BUCKET_MS)));
    setHover(shown.length ? i : null);
  };
  const hovered = hover !== null ? shown[hover] : null;
  return (
    <figure className="inc-chart">
      <figcaption>
        <b>{def.label}</b> <span className="muted">({def.unit})</span>
        <span className="inc-chart-value">{hovered ? `${clock(hovered.from)}: ${fmt(hovered.values[def.key], def.unit)}` : last ? `${clock(last.from)}: ${fmt(last.values[def.key], def.unit)}` : ""}</span>
      </figcaption>
      {limit && <p className="inc-legend"><span><i className="swatch line" /> {def.label}</span><span><i className="swatch limit" /> {limit.label}</span></p>}
      <svg viewBox={`0 0 ${w} ${h + 16}`} role="img" aria-label={`${def.label} over the run${last ? `; at ${clock(last.from)} it was ${fmt(last.values[def.key], def.unit)}` : ""}. A table view follows.`} onPointerMove={pick} onPointerLeave={() => setHover(null)}>
        <line className="axis" x1={0} x2={w} y1={h - pad} y2={h - pad} />
        <line className="grid" x1={0} x2={w} y1={y(max / 2)} y2={y(max / 2)} />
        {markers.map((m) => <g key={`${m.t}${m.label}`}><line className="marker" x1={x(m.t)} x2={x(m.t)} y1={0} y2={h - pad} /><title>{`${clock(m.t)} ${m.label}`}</title></g>)}
        {limit && <path className="limit-line" d={line(limit.key, data)} />}
        <path className="series-line" d={line(def.key)} />
        <line className="cursor" x1={x(at)} x2={x(at)} y1={0} y2={h - pad} />
        {hovered && <circle className="hover-dot" cx={x(hovered.from + BUCKET_MS / 2)} cy={y(hovered.values[def.key])} r={4} />}
        <text className="tick" x={2} y={10}>{fmt(max, def.unit)}</text>
        <text className="tick" x={0} y={h + 14}>0:00</text>
        <text className="tick" x={w} y={h + 14} textAnchor="end">{clock(run.endMs)}</text>
      </svg>
      <details className="inc-how"><summary>How it's computed</summary><p>{def.how}</p></details>
      <details className="chart-table" onToggle={(e) => setTable(e.currentTarget.open)}>
        <summary>Show as a table</summary>
        {table && (
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">From</th><th scope="col">{def.label} ({def.unit})</th>{limit && <th scope="col">{limit.label}</th>}</tr></thead>
              <tbody>{shown.map((b) => <tr key={b.from}><td>{clock(b.from)}</td><td>{fmt(b.values[def.key], def.unit)}</td>{limit && <td>{fmt(b.values[limit.key], def.unit)}</td>}</tr>)}</tbody>
            </table>
          </div>
        )}
      </details>
    </figure>
  );
}

const LIMITS: Partial<Record<MetricKey, { key: MetricKey; label: string }>> = {
  poolInUse: { key: "poolSize", label: "Pool size" },
  threadsBusy: { key: "threadsLimit", label: "Threads available" },
  dbActive: { key: "dbCpuSlots", label: "CPU slots" },
};
const HIDDEN: MetricKey[] = ["poolSize", "threadsLimit", "dbCpuSlots"];

/** Which metrics have anything to say in this scenario: a metric that is zero for the whole run is left out. */
export function MetricsView({ scenario, run, at, markers, guided }: { scenario: Scenario; run: Run; at: number; markers: Marker[]; guided: boolean }) {
  const data = buckets(run);
  const available = METRICS.filter((m) => !HIDDEN.includes(m.key) && data.some((b) => b.values[m.key] > 0));
  const groups = [...new Set(available.map((m) => m.group))];
  const [group, setGroup] = useState(groups[0]);
  const [all, setAll] = useState(!guided);
  const inGroup = available.filter((m) => m.group === group);
  const list = all ? inGroup : inGroup.slice(0, 2);
  void scenario;
  return (
    <section aria-labelledby="metrics-title">
      <h2 id="metrics-title" className="inc-tab-title">Metrics</h2>
      <p className="muted">Computed from the simulated run in {BUCKET_MS / 1000}-second buckets. Vertical lines mark changes; the bright line is the cursor.</p>
      <div className="inc-chips" role="group" aria-label="Metric group">
        {groups.map((g) => <button key={g} type="button" className="filter-chip" aria-pressed={g === group} onClick={() => setGroup(g)}>{g}</button>)}
      </div>
      <div className="inc-charts">
        {list.map((m) => <MetricChart key={m.key} def={m} run={run} at={at} markers={markers} limit={LIMITS[m.key]} />)}
      </div>
      {!all && inGroup.length > 2 && <button type="button" className="button" onClick={() => setAll(true)}>Show {inGroup.length - 2} more {group.toLowerCase()} metrics</button>}
    </section>
  );
}

// ---- Logs ----

export function LogsView({ run, at, trace, setTrace, pin, openTrace }: { run: Run; at: number; trace: string; setTrace: (t: string) => void; pin: Pin; openTrace: (t: string) => void }) {
  const all = logs(run);
  const services = useMemo(() => [...new Set(all.map((l) => l.service))].sort(), [all]);
  const [service, setService] = useState("");
  const [level, setLevel] = useState<"" | "WARN" | "ERROR">("");
  const [text, setText] = useState("");
  const [from, setFrom] = useState(0);
  const [limit, setLimit] = useState(100);
  const q = text.trim().toLowerCase();
  const matches = all.filter((l) => l.t <= at && l.t >= from * 1000 && (!service || l.service === service) && (!level || (level === "WARN" ? l.level !== "INFO" : l.level === "ERROR")) && (!trace || l.trace === trace) && (!q || l.message.toLowerCase().includes(q) || l.code?.toLowerCase().includes(q)));
  const shown = matches.slice(-limit).reverse();
  return (
    <section aria-labelledby="logs-title">
      <h2 id="logs-title" className="inc-tab-title">Logs</h2>
      <p className="muted">Every line comes from one span or event of the simulated run. Tokens and card data are never logged.</p>
      <div className="inc-filters">
        <label>Service<select value={service} onChange={(e) => setService(e.target.value)}><option value="">All</option>{services.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Severity<select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}><option value="">All</option><option value="WARN">Warnings and errors</option><option value="ERROR">Errors</option></select></label>
        <label>From<select value={from} onChange={(e) => setFrom(Number(e.target.value))}>{Array.from({ length: Math.ceil(run.endMs / 10_000) }, (_, i) => i * 10).map((s) => <option key={s} value={s}>{clock(s * 1000)}</option>)}</select></label>
        <label>Trace ID<input value={trace} onChange={(e) => setTrace(e.target.value.trim())} placeholder="any" spellCheck={false} /></label>
        <label className="grow">Search<input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="text or error code" /></label>
      </div>
      <p role="status" className="muted">{matches.length.toLocaleString("en")} matching lines up to {clock(at)}{matches.length > shown.length ? `; newest ${shown.length} shown` : ""}</p>
      <ol className="inc-logs" aria-label="Log lines, newest first">
        {shown.map((l) => <LogRow key={l.id} line={l} pin={pin} openTrace={openTrace} setTrace={setTrace} />)}
      </ol>
      {matches.length > shown.length && <button type="button" className="button" onClick={() => setLimit(limit + 200)}>Show 200 older lines</button>}
    </section>
  );
}

function LogRow({ line, pin, openTrace, setTrace }: { line: LogLine; pin: Pin; openTrace: (t: string) => void; setTrace: (t: string) => void }) {
  const finding = logFinding(line);
  return (
    <li className={`inc-log level-${line.level.toLowerCase()}`}>
      <span className="inc-log-meta"><time>{clock(line.t)}.{String(Math.floor(line.t % 1000)).padStart(3, "0")}</time> <b>{line.level}</b> <span>{line.service}</span></span>
      <span className="inc-log-msg">{line.message}</span>
      <span className="inc-log-actions">
        {line.trace && <><button type="button" className="text-button" onClick={() => setTrace(line.trace!)}>Same trace</button><button type="button" className="text-button" onClick={() => openTrace(line.trace!)}>Open trace</button></>}
        {finding && <button type="button" className="text-button" onClick={() => pin(finding, `log line at ${clock(line.t)}`)}><Plus aria-hidden="true" /> Evidence</button>}
      </span>
    </li>
  );
}

// ---- Traces ----

export function TracesView({ run, at, selected, select, pin, showLogs }: { run: Run; at: number; selected: string | null; select: (t: string | null) => void; pin: Pin; showLogs: (t: string) => void }) {
  const list = traces(run);
  const endpoints = [...new Set(list.map((t) => t.endpoint))];
  const [endpoint, setEndpoint] = useState("");
  const [only, setOnly] = useState<"failed" | "slow" | "all">("failed");
  const filtered = list.filter((t) => t.end <= at && (!endpoint || t.endpoint === endpoint) && (only !== "failed" || t.failed));
  const shown = (only === "slow" ? [...filtered].sort((a, b) => b.end - b.start - (a.end - a.start)) : [...filtered].reverse()).slice(0, 60);
  return (
    <section aria-labelledby="traces-title">
      <h2 id="traces-title" className="inc-tab-title">Traces</h2>
      <p className="muted">One trace per customer request, built from the spans the simulation recorded while doing the work.</p>
      <div className="inc-filters">
        <label>Endpoint<select value={endpoint} onChange={(e) => setEndpoint(e.target.value)}><option value="">All</option>{endpoints.map((e) => <option key={e}>{e}</option>)}</select></label>
        <label>Show<select value={only} onChange={(e) => setOnly(e.target.value as typeof only)}><option value="failed">Failed, newest first</option><option value="slow">Slowest first</option><option value="all">All, newest first</option></select></label>
      </div>
      <p role="status" className="muted">{filtered.length.toLocaleString("en")} traces up to {clock(at)}{filtered.length > shown.length ? `; ${shown.length} listed` : ""}</p>
      <div className="inc-traces">
        <ul className="inc-trace-list" aria-label="Traces">
          {shown.map((t) => (
            <li key={t.trace}>
              <button type="button" aria-pressed={selected === t.trace} onClick={() => select(t.trace)}>
                <span className={t.failed ? "is-bad" : ""}>{t.status === 0 ? "no response" : t.status}</span>
                <b>{t.endpoint}</b>
                <span>{Math.round(t.end - t.start).toLocaleString("en")} ms</span>
                <small>{clock(t.start)} · {t.trace.slice(0, 8)}{t.attempts > 1 ? ` · ${t.attempts} attempts` : ""}</small>
              </button>
            </li>
          ))}
          {!shown.length && <li className="muted">No trace matches.</li>}
        </ul>
        {selected ? <Waterfall run={run} trace={selected} pin={pin} showLogs={showLogs} close={() => select(null)} /> : <p className="muted inc-trace-empty">Choose a trace to see its spans.</p>}
      </div>
    </section>
  );
}

function Waterfall({ run, trace, pin, showLogs, close }: { run: Run; trace: string; pin: Pin; showLogs: (t: string) => void; close: () => void }) {
  const rows = waterfall(run, trace);
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <p className="muted">That trace isn't in this run.</p>;
  const start = Math.min(...rows.map((r) => r.span.start));
  const end = Math.max(...rows.map((r) => r.span.end));
  const total = Math.max(1, end - start);
  const finding = traceFinding(run, trace);
  return (
    <div className="inc-waterfall" aria-label={`Trace ${trace}`}>
      <div className="inc-waterfall-head">
        <div><b>Trace {trace.slice(0, 16)}…</b> <span className="muted">{Math.round(total).toLocaleString("en")} ms, {rows.length} spans</span></div>
        <div className="inc-row-actions">
          <button type="button" className="button" onClick={() => pin(finding, `trace ${trace.slice(0, 8)}`)}><Plus aria-hidden="true" /> Add as evidence</button>
          <button type="button" className="text-button" onClick={() => showLogs(trace)}>Logs for this trace</button>
          <button type="button" className="text-button" onClick={close}>Close</button>
        </div>
      </div>
      <p className="inc-finding-line">{finding.title}: {finding.detail}</p>
      <ol className="inc-spans">
        {rows.map(({ span, depth }) => {
          const left = ((span.start - start) / total) * 100;
          const width = Math.max(0.6, ((span.end - span.start) / total) * 100);
          const cat = categoryOf(span);
          return (
            <li key={span.id} className={`${span.status === "error" ? "is-error" : ""}${span.attrs.async ? " is-async" : ""}`}>
              <button type="button" className="inc-span" aria-expanded={open === span.id} onClick={() => setOpen(open === span.id ? null : span.id)} style={{ "--depth": Math.min(depth, 8) } as React.CSSProperties}>
                <span className="inc-span-label"><small>{span.service}</small> {span.name}{span.attrs.async ? " (async)" : ""}</span>
                <span className="inc-span-track" aria-hidden="true"><i className={`cat-${(cat ?? "other").replace(/\W+/g, "-")}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} /></span>
                <span className="inc-span-dur">{Math.round(span.end - span.start).toLocaleString("en")} ms{span.status === "error" ? " · error" : ""}</span>
              </button>
              {open === span.id && <SpanDetails span={span} startMs={start} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SpanDetails({ span, startMs }: { span: Span; startMs: number }) {
  return (
    <dl className="inc-span-details">
      <div><dt>Span</dt><dd><code>{span.id}</code>{span.parent ? <> · parent <code>{span.parent}</code></> : null}</dd></div>
      <div><dt>Starts</dt><dd>+{Math.round(span.start - startMs)} ms ({span.kind})</dd></div>
      {span.error && <div><dt>Error</dt><dd><b>{span.error.code}</b>: {span.error.message}</dd></div>}
      {Object.entries(span.attrs).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}
    </dl>
  );
}

// ---- Topology ----

const HEALTH: Record<Health, { label: string; Icon: typeof CheckCircle2 }> = {
  healthy: { label: "Healthy", Icon: CheckCircle2 }, degraded: { label: "Degraded", Icon: AlertTriangle }, failing: { label: "Failing", Icon: XCircle }, idle: { label: "No traffic", Icon: CircleDashed }, "no-telemetry": { label: "No telemetry", Icon: CircleOff },
};
const LAYERS: ComponentId[][] = [["browser", "partner-app"], ["dns", "gateway", "finance-app"], ["store-api", "identity-provider"], ["redis", "postgres", "orders-queue", "payment-provider"], ["fulfilment-worker", "fraud-service"]];

export function TopologyView({ scenario, run, at }: { scenario: Scenario; run: Run; at: number }) {
  const health = topology(run, at, scenario.components);
  const by = new Map(health.map((h) => [h.id, h]));
  return (
    <section aria-labelledby="topology-title">
      <h2 id="topology-title" className="inc-tab-title">Topology at {clock(at)}</h2>
      <p className="muted">States come from the last 5 s of telemetry before the cursor: failing at 20% errors or more; degraded at 2% or more, at 90% saturation or with a growing backlog. Third parties are judged by the store's own calls to them.</p>
      <ol className="inc-topology" aria-label="Components, from the customer inwards">
        {LAYERS.map((layer, i) => {
          const present = layer.filter((id) => by.has(id));
          if (!present.length) return null;
          return (
            <li key={i} className="inc-layer">
              <ul>
                {present.map((id) => {
                  const h = by.get(id)!;
                  const { label, Icon } = HEALTH[h.health];
                  return (
                    <li key={id} className={`inc-node health-${h.health}`}>
                      <b>{COMPONENT_LABELS[id]}</b>
                      <span className="inc-node-state"><Icon aria-hidden="true" /> {label}</span>
                      <small>{h.detail}</small>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---- Changes ----

export function ChangesView({ run, at, scenario }: { run: Run; at: number; scenario: Scenario }) {
  const visible = new Set(run.input.changes.filter((c) => c.visible).map((c) => c.label));
  const list = run.events.filter((e) => e.type === "change" && e.t <= at && visible.has(e.label!));
  void scenario;
  return (
    <section aria-labelledby="changes-title">
      <h2 id="changes-title" className="inc-tab-title">Changes</h2>
      <p className="muted">Deployments, configuration changes and the status notes third parties published, in order. A change shortly before the symptoms is a lead, not proof: confirm it with evidence.</p>
      {list.length ? (
        <ol className="inc-changes">
          {list.map((e) => (
            <li key={e.i} className={`kind-${e.kind}`}>
              <time>{clock(e.t)}</time>
              <span className="practice-kind">{e.by === "learner" ? "your change" : e.kind}</span>
              <span>{e.label}</span>
            </li>
          ))}
        </ol>
      ) : <p>No change recorded up to {clock(at)}.</p>}
    </section>
  );
}

// ---- Diagnostics ----

export function DiagnoseView({ scenario, ctx, ran, run: record, pin, pinned }: { scenario: Scenario; ctx: Context; ran: string[]; run: (id: string) => void; pin: Pin; pinned: Set<string> }) {
  const list = DIAGNOSTICS.filter((d) => !d.needs || d.needs.every((n) => scenario.features[n]));
  const [results, setResults] = useState<Record<string, { at: number; result: DiagnosticResult }>>({});
  const runOne = (id: string) => {
    const d = list.find((x) => x.id === id)!;
    setResults((r) => ({ ...r, [id]: { at: ctx.during.to, result: d.run(ctx) } }));
    record(id);
  };
  return (
    <section aria-labelledby="diagnose-title">
      <h2 id="diagnose-title" className="inc-tab-title">Diagnose</h2>
      <p className="muted">Each check queries the viewed run from {clock(ctx.during.from)} to {clock(ctx.during.to)}, against {clock(ctx.before.from)}–{clock(ctx.before.to)} where it compares. Its findings are facts about the run; add the ones that matter to your evidence.</p>
      <ul className="inc-diagnostics">
        {list.map((d) => {
          const r = results[d.id];
          return (
            <li key={d.id} className="inc-card">
              <div className="inc-card-head">
                <div><b>{d.title}</b><small>{d.question}</small></div>
                <button type="button" className="button" onClick={() => runOne(d.id)}>{r ? "Run again" : "Run"}</button>
              </div>
              {r && (
                <>
                  <dl className="inc-rows">{r.result.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
                  <ul className="inc-findings">
                    {r.result.findings.map((f) => (
                      <li key={f.id} className={f.abnormal ? "is-abnormal" : ""}>
                        <span><b>{f.abnormal ? <AlertTriangle aria-label="Abnormal" /> : <CheckCircle2 aria-label="Normal" />} {f.title}</b> {f.detail}</span>
                        <button type="button" className="text-button" disabled={pinned.has(f.id)} onClick={() => pin(f, `${d.title} at ${clock(r.at)}`)}>{pinned.has(f.id) ? "In evidence" : <><Plus aria-hidden="true" /> Evidence</>}</button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!r && ran.includes(d.id) && <p className="muted">You ran this check earlier; run it again to see it for the current view.</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export { index };
