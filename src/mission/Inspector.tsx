import { useId, useState, type ComponentType } from "react";
import type { Mission } from "../learning/mission-schema.ts";
import type { Fact, LearningFrame, Trace } from "../learning/types.ts";
import { FeedbackForm } from "./FeedbackForm.tsx";

type Tab = "state" | "selected" | "changes" | "notes";

function format(value: Fact["value"]) {
  return typeof value === "boolean" ? (value ? "yes" : "no") : typeof value === "number" ? value.toLocaleString("en-US", { useGrouping: value >= 10_000 }) : value;
}

function FactList({ facts, changed, onSelect }: { facts: Fact[]; changed: Set<string>; onSelect: (id: string) => void }) {
  if (!facts.length) return <p className="muted">Nothing to show for this step.</p>;
  return (
    <dl className="facts">
      {facts.map((fact) => (
        <div className={changed.has(fact.label) ? "is-changed" : ""} key={fact.id}>
          <dt>{fact.entityId ? <button type="button" className="text-button" onClick={() => onSelect(fact.entityId!)}>{fact.label}</button> : fact.label}</dt>
          <dd>{format(fact.value)}{changed.has(fact.label) && <span className="sr-only"> (changed)</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Inspector({
  mission,
  trace,
  frame,
  selected,
  selectedLabel,
  onSelect,
  Reference,
}: {
  mission: Mission;
  trace: Trace;
  frame: LearningFrame;
  selected: string | null;
  selectedLabel: string | null;
  onSelect: (id: string) => void;
  Reference?: ComponentType<{ trace: Trace<any> }>;
}) {
  const [tab, setTab] = useState<Tab>("state");
  const base = useId();
  const changed = new Set(frame.delta.map((line) => line.split(":")[0]));
  const selectedFacts = selected ? frame.facts.filter((fact) => fact.entityId === selected) : [];
  const tabs: { id: Tab; label: string }[] = [
    { id: "state", label: "State" },
    { id: "selected", label: "Selected" },
    { id: "changes", label: "Changes" },
    { id: "notes", label: "Notes" },
  ];
  const onKey = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.id);
    document.getElementById(`${base}-${next.id}`)?.focus();
  };
  return (
    <section className="inspector card" aria-labelledby={`${base}-title`}>
      <h2 id={`${base}-title`} className="card-title">Inspector</h2>
      <div role="tablist" aria-label="Inspector views" className="tabs">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`${base}-${item.id}`}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            aria-controls={`${base}-${item.id}-panel`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-${tab}-panel`} aria-labelledby={`${base}-${tab}`} className="tab-panel" tabIndex={0}>
        {tab === "state" && <FactList facts={frame.facts.filter((fact) => !fact.id.startsWith("segment-") && !fact.id.startsWith("slot-") && !fact.id.startsWith("node-") && !fact.id.startsWith("frame-"))} changed={changed} onSelect={onSelect} />}
        {tab === "selected" && (selected ? (
          <>
            <p className="inspector-heading">{selectedLabel ?? selected}</p>
            {selectedLabel === null && <p className="muted">This object is not present in the current step.</p>}
            <FactList facts={selectedFacts} changed={changed} onSelect={onSelect} />
          </>
        ) : <p className="muted">Select any object in the scene to see its exact values here.</p>)}
        {tab === "changes" && (
          <>
            {frame.delta.length ? <ul className="delta">{frame.delta.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="muted">No tracked value changed in this step.</p>}
            {frame.technical && <p className="technical"><code>{frame.technical}</code></p>}
            {frame.invariant && <p className="invariant"><b>Invariant.</b> {frame.invariant}</p>}
          </>
        )}
        {tab === "notes" && (
          <>
            {mission.sources.map((source) => <p className="source" key={source.id}>{source.text}</p>)}
            {Reference && <Reference trace={trace} />}
            <p className="muted small">Engine {trace.engine.id} v{trace.engine.version} · mission v{mission.version}</p>
          </>
        )}
      </div>
      <FeedbackForm target={{ kind: "mission", missionId: mission.id, missionVersion: mission.version, engineVersion: trace.engine.version, scenarioKey: trace.scenarioKey, frameId: frame.id }} frameTitle={frame.title} />
    </section>
  );
}
