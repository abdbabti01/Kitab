import { Fragment, useEffect, useId, useState } from "react";
import { AlertTriangle, Link2, Trash2, Zap } from "lucide-react";
import { components, connectionRules, type Design } from "../model.ts";
import { connectableTargets, type Validation } from "../validate.ts";
import { nominalCapacity, slotLimits, utilisation, type Fold } from "../metrics.ts";
import { fieldsFor, type Field } from "../fields.ts";
import { pct } from "../explain.ts";
import type { Dispatch } from "../editor.ts";
import type { Selection } from "./DesignCanvas.tsx";
import { connectionNames, kindIcon } from "./kinds.tsx";

/** A number input that keeps what is typed until it is a valid value, then commits it. */
export function NumberField({ field, value, onChange, onDone, disabled }: { field: Extract<Field, { type: "number" }>; value: number; onChange: (value: number) => void; onDone?: () => void; disabled?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(parsed * (field.step && field.step < 1 ? 10 : 1)) && parsed >= field.min && parsed <= field.max;
  return (
    <div className="arch-field">
      <label htmlFor={id}>{field.label}{field.unit ? <span className="unit"> ({field.unit})</span> : null}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={field.min}
        max={field.max}
        step={field.step ?? 1}
        value={draft}
        disabled={disabled}
        aria-invalid={!valid}
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value.trim() !== "" && Number.isFinite(next) && next >= field.min && next <= field.max) onChange(Math.round(next));
        }}
        onBlur={() => {
          setDraft(String(value));
          onDone?.();
        }}
      />
      <small id={`${id}-help`}>{valid ? field.help : `Enter a whole number from ${field.min.toLocaleString("en")} to ${field.max.toLocaleString("en")}.`}</small>
    </div>
  );
}

export function SettingField({ field, value, onChange, onDone, disabled }: { field: Field; value: unknown; onChange: (value: number | string | boolean) => void; onDone?: () => void; disabled?: boolean }) {
  const id = useId();
  if (field.type === "number") return <NumberField field={field} value={value as number} onChange={onChange} onDone={onDone} disabled={disabled} />;
  if (field.type === "boolean") {
    return (
      <div className="arch-field is-check">
        <label htmlFor={id}>
          <input id={id} type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} aria-describedby={`${id}-help`} />
          {field.label}
        </label>
        <small id={`${id}-help`}>{field.help}</small>
      </div>
    );
  }
  return (
    <div className="arch-field">
      <label htmlFor={id}>{field.label}</label>
      <select id={id} value={String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-describedby={`${id}-help`}>
        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <small id={`${id}-help`}>{field.help}</small>
    </div>
  );
}

type Props = {
  design: Design;
  dispatch?: Dispatch;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  validation: Validation;
  fold: Fold | null;
  locked?: string[];
  isFixed?: (kind: Design["nodes"][number]["kind"], field: string) => boolean;
};

/** What the selected component or connection is, its settings, its connections and, during a run, its state. */
export function Inspector({ design, dispatch, selection, onSelect, validation, fold, locked = [], isFixed }: Props) {
  const connectId = useId();
  const [target, setTarget] = useState("");
  const node = selection?.kind === "node" ? design.nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection?.kind === "edge" ? design.edges.find((e) => e.id === selection.id) : undefined;
  const name = (id: string) => design.nodes.find((n) => n.id === id)?.label ?? id;
  useEffect(() => setTarget(""), [selection?.id]);

  if (edge) {
    const rule = connectionRules.find((r) => r.from === design.nodes.find((n) => n.id === edge.from)?.kind && r.to === design.nodes.find((n) => n.id === edge.to)?.kind);
    return (
      <section className="arch-inspector" aria-labelledby="inspector-title">
        <p className="eyebrow">Connection</p>
        <h2 id="inspector-title">{name(edge.from)} → {name(edge.to)}</h2>
        <p className={`connection-kind is-${edge.kind}`}>{connectionNames[edge.kind]}</p>
        {rule && <p>{rule.meaning}</p>}
        {fold && <p className="live-line">{fold.transit.filter((t) => t.edge === edge.id).length} in transit now</p>}
        {dispatch && (
          <button type="button" className="button danger" onClick={() => (dispatch({ type: "disconnect", id: edge.id }), onSelect(null))}>
            <Trash2 aria-hidden="true" /> Remove connection
          </button>
        )}
      </section>
    );
  }

  if (!node) {
    const issues = [...validation.errors, ...validation.warnings];
    return (
      <section className="arch-inspector" aria-labelledby="inspector-title">
        <p className="eyebrow">Inspector</p>
        <h2 id="inspector-title">{issues.length ? "Before you run" : "Select a component"}</h2>
        {!issues.length && <p>Select a component on the diagram to see what it does, change its settings and connect it. During a run, it shows what the component is doing at that moment.</p>}
        {issues.length > 0 && (
          <ul className="issue-list">
            {issues.map((issue, index) => (
              <li key={index} className={`is-${issue.severity}`}>
                <AlertTriangle aria-hidden="true" />
                <span>
                  <b>{issue.severity === "error" ? "Must fix" : "Note"}:</b> {issue.message}
                  {issue.nodes[0] && <> <button type="button" className="text-button" onClick={() => onSelect({ kind: "node", id: issue.nodes[0] })}>Show {name(issue.nodes[0])}</button></>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const definition = components[node.kind];
  const Icon = kindIcon[node.kind];
  const outgoing = design.edges.filter((e) => e.from === node.id);
  const incoming = design.edges.filter((e) => e.to === node.id);
  const targets = connectableTargets(design, node.id);
  const capacity = nominalCapacity(design, node.id);
  const state = fold?.nodes[node.id];
  const limits = slotLimits(design, node.id);
  const used = fold ? utilisation(design, fold, node.id) : null;
  const nodeIssues = [...validation.errors, ...validation.warnings].filter((i) => i.nodes.includes(node.id));
  const isLocked = locked.includes(node.id);

  return (
    <section className="arch-inspector" aria-labelledby="inspector-title">
      <p className="eyebrow"><Icon aria-hidden="true" /> {definition.name}{isLocked ? " · fixed by the challenge" : ""}</p>
      <h2 id="inspector-title">{node.label}</h2>
      {dispatch && (
        <div className="arch-field">
          <label htmlFor={`${connectId}-name`}>Name</label>
          <input id={`${connectId}-name`} value={node.label} maxLength={40} onChange={(event) => dispatch({ type: "rename-node", id: node.id, label: event.target.value })} onBlur={() => dispatch({ type: "settle" })} />
        </div>
      )}
      <p>{definition.role}</p>
      <details className="modelled">
        <summary>What the simulator models</summary>
        <p>{definition.modelled}</p>
      </details>

      {nodeIssues.map((issue, index) => <p key={index} className={`inline-issue is-${issue.severity}`}><AlertTriangle aria-hidden="true" /> {issue.message}</p>)}

      {state && (
        <div className="live-state" aria-live="off">
          <h3>Now ({(fold!.t / 1000).toFixed(2)} s)</h3>
          <dl>
            {state.down && <><dt>Status</dt><dd className="is-down">Down</dd></>}
            {limits.length > 0 && <><dt>In progress</dt><dd>{state.busy.reduce((a, b) => a + b, 0)} of {limits.reduce((a, b) => a + b, 0)}</dd></>}
            {limits.length > 0 && <><dt>Waiting</dt><dd>{state.waiting.reduce((a, b) => a + b, 0)} (most so far {state.maxWaiting})</dd></>}
            {used && <><dt>Busy so far</dt><dd>{used.length > 1 ? `busiest partition ${pct(Math.max(...used))}, ${used.map(pct).join(" · ")}` : pct(used[0])}</dd></>}
            <dt>{node.kind === "worker" ? "Messages taken" : "Started"}</dt><dd>{state.started.toLocaleString("en")}</dd>
            {Object.entries(state.rejected).map(([code, count]) => <Fragment key={code}><dt>Refused ({code.replace("-", " ")})</dt><dd>{count}</dd></Fragment>)}
            {state.hits + state.misses > 0 && <><dt>Hits</dt><dd>{state.hits.toLocaleString("en")} of {(state.hits + state.misses).toLocaleString("en")} ({pct(state.hits / (state.hits + state.misses))})</dd></>}
            {node.kind === "queue" && <><dt>Messages waiting</dt><dd>{state.depth} (most {state.maxDepth})</dd><dt>Stored</dt><dd>{state.published}</dd><dt>Dead letters</dt><dd>{state.deadLetters}</dd></>}
            {node.kind === "worker" && <><dt>Finished</dt><dd>{state.acked}</dd><dt>Given back</dt><dd>{state.redelivered}</dd></>}
            {node.kind === "load-balancer" && state.unhealthy.length > 0 && <><dt>Not using</dt><dd>{state.unhealthy.map(name).join(", ")}</dd></>}
          </dl>
        </div>
      )}

      {capacity.length > 0 && (
        <p className="capacity">
          <Zap aria-hidden="true" />
          <span>From its settings it can finish {capacity.map((c) => `about ${c.perSecond.toLocaleString("en")} ${c.what} per second`).join("; ")}. This is the model's arithmetic (slots ÷ time per operation), not a real-world figure.</span>
        </p>
      )}

      {fieldsFor[node.kind].length > 0 && (
        <fieldset className="arch-settings">
          <legend>Settings</legend>
          {fieldsFor[node.kind].map((field) => {
            const fixed = isFixed?.(node.kind, field.field) ?? false;
            return (
              <div key={field.field} className={fixed ? "is-fixed" : undefined}>
                <SettingField
                  field={field}
                  value={(node.config as Record<string, unknown>)[field.field]}
                  disabled={!dispatch || fixed}
                  onChange={(value) => dispatch?.({ type: "set-config", id: node.id, field: field.field, value })}
                  onDone={() => dispatch?.({ type: "settle" })}
                />
                {fixed && <small className="fixed-note">Fixed by this challenge.</small>}
              </div>
            );
          })}
        </fieldset>
      )}

      <h3>Connections</h3>
      {outgoing.length + incoming.length === 0 && <p className="muted">Not connected yet.</p>}
      <ul className="connection-list">
        {outgoing.map((e) => (
          <li key={e.id}>
            <span className={`connection-kind is-${e.kind}`}>{e.kind === "request" ? "calls" : e.kind === "async" ? "sends messages to" : "replicates to"}</span> <b>{name(e.to)}</b>
            {dispatch && <button type="button" className="icon-button" aria-label={`Remove the connection to ${name(e.to)}`} onClick={() => dispatch({ type: "disconnect", id: e.id })}><Trash2 aria-hidden="true" /></button>}
          </li>
        ))}
        {incoming.map((e) => (
          <li key={e.id}>
            <span className={`connection-kind is-${e.kind}`}>{e.kind === "request" ? "called by" : e.kind === "async" ? "receives messages from" : "replica of"}</span> <b>{name(e.from)}</b>
            {dispatch && <button type="button" className="icon-button" aria-label={`Remove the connection from ${name(e.from)}`} onClick={() => dispatch({ type: "disconnect", id: e.id })}><Trash2 aria-hidden="true" /></button>}
          </li>
        ))}
      </ul>
      {dispatch && (
        <div className="connect-row">
          <label htmlFor={connectId}>Connect to</label>
          <select id={connectId} value={target} onChange={(event) => setTarget(event.target.value)} disabled={!targets.length}>
            <option value="">{targets.length ? "Choose a component…" : "No allowed connection left"}</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.label} ({components[t.kind].name})</option>)}
          </select>
          <button type="button" className="button" disabled={!target} onClick={() => (dispatch({ type: "connect", from: node.id, to: target }), setTarget(""))}>
            <Link2 aria-hidden="true" /> Connect
          </button>
        </div>
      )}
      {dispatch && !isLocked && (
        <div className="inspector-actions">
          {node.kind !== "client" && <button type="button" className="button" onClick={() => dispatch({ type: "add-fault", node: node.id })}>Plan a failure of {node.label}</button>}
          <button type="button" className="button danger" onClick={() => (dispatch({ type: "remove-node", id: node.id }), onSelect(null))}>
            <Trash2 aria-hidden="true" /> Remove
          </button>
        </div>
      )}
    </section>
  );
}
