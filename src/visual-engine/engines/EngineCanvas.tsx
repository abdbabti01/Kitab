import {
  ArrowDown,
  ArrowRight,
  Box,
  Braces,
  Check,
  CircleDot,
  Clock3,
  Code2,
  Cpu,
  Database,
  Globe2,
  Layers3,
  Network,
  Radio,
  Server,
} from "lucide-react";
import type {
  VisualActor,
  VisualEvent,
  VisualizationSpec,
} from "../core/visualization-spec";
import { buildGraphLevels } from "../core/visualization-spec";
import "./engine-canvas.css";

export type EngineCanvasProps = {
  spec: VisualizationSpec;
  eventIndex: number;
  changed?: boolean;
};

function activeClass(actor: VisualActor, event: VisualEvent) {
  return [
    actor.id === event.from ? "is-source" : "",
    actor.id === event.to ? "is-target" : "",
    actor.id === event.from && actor.id === event.to ? "is-internal" : "",
  ].filter(Boolean).join(" ");
}

function actorById(spec: VisualizationSpec, id: string) {
  return spec.actors.find((actor) => actor.id === id) ?? spec.actors[0];
}

export function EngineCanvas({ spec, eventIndex, changed = false }: EngineCanvasProps) {
  const safeIndex = Math.max(0, Math.min(spec.events.length - 1, eventIndex));
  const event = spec.events[safeIndex];
  const common = { spec, event, eventIndex: safeIndex, changed };
  return (
    <section
      className={`engine-canvas engine-${spec.engine}`}
      aria-label={`${spec.title}. ${event.label}`}
      aria-live="polite"
    >
      <header className="engine-canvas-head">
        <div>
          <span>{spec.engine.replace("-", " ").toUpperCase()} ENGINE</span>
          <b>{spec.title}</b>
        </div>
        <div className="engine-state">
          <span>STATE AFTER EVENT</span>
          <b>{event.state}</b>
        </div>
      </header>
      {spec.engine === "protocol" && <ProtocolScene {...common} />}
      {spec.engine === "request" && <RequestScene {...common} />}
      {spec.engine === "memory" && <MemoryScene {...common} />}
      {spec.engine === "tree" && <TreeScene {...common} />}
      {spec.engine === "execution" && <ExecutionScene {...common} />}
      {spec.engine === "concurrency" && <ConcurrencyScene {...common} />}
      {spec.engine === "distributed" && <DistributedScene {...common} />}
      {spec.engine === "state-machine" && <StateMachineScene {...common} />}
      <footer className="engine-event-explanation">
        <span>{String(safeIndex + 1).padStart(2, "0")}</span>
        <div>
          <b>{event.label}</b>
          <p>{event.detail}</p>
        </div>
      </footer>
    </section>
  );
}

type SceneProps = {
  spec: VisualizationSpec;
  event: VisualEvent;
  eventIndex: number;
  changed: boolean;
};

const protocolLayers = [
  { name: "Application", unit: "Data", note: "Meaning for the application" },
  { name: "Transport", unit: "Segment", note: "Ports, ordering and delivery behavior" },
  { name: "Internet", unit: "Packet", note: "Source and destination IP addresses" },
  { name: "Link", unit: "Frame", note: "Next-hop delivery on the local link" },
];

function ProtocolEndpoint({ actor, side, active }: { actor: VisualActor; side: "sender" | "receiver"; active: boolean }) {
  const layers = side === "sender" ? protocolLayers : [...protocolLayers].reverse();
  return (
    <article className={`protocol-endpoint ${active ? "is-active" : ""}`}>
      <header><Server aria-hidden="true" /><div><b>{actor.label}</b><span>{actor.role}</span></div></header>
      <div className="protocol-stack">
        {layers.map((layer, index) => (
          <div className={active ? "layer-active" : ""} key={layer.name}>
            <span>L{side === "sender" ? 4 - index : index + 1}</span>
            <div><b>{layer.name}</b><small>{layer.note}</small></div>
            <em>{layer.unit}</em>
          </div>
        ))}
      </div>
    </article>
  );
}

function ProtocolScene({ spec, event, changed }: SceneProps) {
  const from = actorById(spec, event.from);
  const to = actorById(spec, event.to);
  const first = spec.actors[0];
  const last = spec.actors.at(-1)!;
  return (
    <div className="protocol-scene">
      <ProtocolEndpoint actor={first} side="sender" active={event.from === first.id || event.to === first.id} />
      <div className="protocol-medium">
        <Globe2 aria-hidden="true" />
        <span>NETWORK PATH</span>
        <div className={`protocol-message ${changed ? "is-changed" : ""}`}>
          <small>{from.label} → {to.label}</small>
          <b>{event.payload || event.label}</b>
          <em>{changed ? "Experiment active" : "In transit"}</em>
        </div>
        <div className="protocol-route"><i /><i /><i /></div>
        <p>Each hop may replace the link frame. The transported information continues toward the destination.</p>
      </div>
      <ProtocolEndpoint actor={last} side="receiver" active={event.from === last.id || event.to === last.id} />
    </div>
  );
}

function RequestScene({ spec, event, eventIndex, changed }: SceneProps) {
  return (
    <div className="request-scene">
      <div className="request-track">
        {spec.actors.map((actor, index) => (
          <div className="request-hop-wrap" key={actor.id}>
            <article className={activeClass(actor, event)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><b>{actor.label}</b><small>{actor.role}</small></div>
              {actor.id === event.to && <Check aria-hidden="true" />}
            </article>
            {index < spec.actors.length - 1 && <ArrowRight aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="request-trace">
        <header><Radio aria-hidden="true" /><b>LIVE REQUEST TRACE</b><span>{changed ? "degraded path" : "normal path"}</span></header>
        {spec.events.slice(0, eventIndex + 1).map((item, index) => (
          <div className={index === eventIndex ? "current" : "complete"} key={item.id}>
            <span>{index + 1}</span><b>{item.label}</b><small>{item.state}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function MemoryScene({ spec, event, eventIndex, changed }: SceneProps) {
  return (
    <div className="memory-scene">
      <div className="memory-addresses">
        {spec.actors.map((actor, index) => (
          <article className={activeClass(actor, event)} key={actor.id}>
            <span>{actor.group === "reference" ? "REF" : `0x${(4096 + index * 16).toString(16).toUpperCase()}`}</span>
            <Box aria-hidden="true" />
            <b>{actor.label}</b>
            <small>{actor.role}</small>
          </article>
        ))}
      </div>
      <div className="memory-relations">
        <header><Braces aria-hidden="true" /><b>{changed ? "Mutation path" : "Reference path"}</b></header>
        <div>
          {spec.links.slice(0, 8).map((link, index) => (
            <span className={link.from === event.from && link.to === event.to ? "active" : ""} key={`${link.from}-${link.to}-${index}`}>
              <b>{actorById(spec, link.from).label}</b><ArrowRight aria-hidden="true" /><b>{actorById(spec, link.to).label}</b>
              {link.label && <small>{link.label}</small>}
            </span>
          ))}
        </div>
        <p>Operation {eventIndex + 1}: only highlighted locations participate in this state change.</p>
      </div>
    </div>
  );
}

function TreeScene({ spec, event, changed }: SceneProps) {
  const levels = buildGraphLevels(spec);
  return (
    <div className={`tree-scene ${changed ? "is-changed" : ""}`}>
      {levels.map((level, levelIndex) => (
        <div className="tree-level-wrap" key={levelIndex}>
          <div className="tree-level">
            {level.map((id) => {
              const actor = actorById(spec, id);
              return <article className={activeClass(actor, event)} key={id}><span>{levelIndex === 0 ? "ROOT" : `L${levelIndex}`}</span><b>{actor.label}</b><small>{actor.role}</small></article>;
            })}
          </div>
          {levelIndex < levels.length - 1 && <div className="tree-connector"><i /><ArrowDown aria-hidden="true" /><i /></div>}
        </div>
      ))}
      <div className="tree-decision"><CircleDot aria-hidden="true" /><span><b>Current decision</b><small>{actorById(spec, event.from).label} → {actorById(spec, event.to).label}</small></span></div>
    </div>
  );
}

function ExecutionScene({ spec, event, eventIndex, changed }: SceneProps) {
  const frames = spec.events.slice(0, eventIndex + 1).map((item) => actorById(spec, item.to));
  return (
    <div className="execution-scene">
      <div className="execution-code">
        <header><Code2 aria-hidden="true" /><b>Execution trace</b></header>
        {spec.events.map((item, index) => (
          <div className={index === eventIndex ? "active" : index < eventIndex ? "done" : ""} key={item.id}>
            <span>{String(index + 1).padStart(2, "0")}</span><code>{item.label}</code>
          </div>
        ))}
      </div>
      <div className={`execution-stack ${changed ? "is-changed" : ""}`}>
        <header><Layers3 aria-hidden="true" /><b>Runtime frames</b><small>top of stack</small></header>
        <div>
          {[...frames].reverse().slice(0, 6).map((frame, index) => (
            <article className={index === 0 ? "active" : ""} key={`${frame.id}-${index}`}>
              <span>FRAME {frames.length - index}</span><b>{frame.label}</b><small>{frame.role}</small>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConcurrencyScene({ spec, event, eventIndex, changed }: SceneProps) {
  return (
    <div className="concurrency-scene">
      <div className="timeline-axis" style={{ gridTemplateColumns: `170px repeat(${spec.events.length}, minmax(72px, 1fr))` }}>
        <b>ACTOR / TIME</b>{spec.events.map((_, index) => <span key={index}>T{index + 1}</span>)}
      </div>
      {spec.actors.map((actor) => (
        <div className="timeline-lane" style={{ gridTemplateColumns: `170px repeat(${spec.events.length}, minmax(72px, 1fr))` }} key={actor.id}>
          <header><b>{actor.label}</b><small>{actor.role}</small></header>
          {spec.events.map((item, index) => {
            const participates = item.from === actor.id || item.to === actor.id;
            return <span className={`${participates ? "participates" : ""} ${index === eventIndex && participates ? "active" : ""}`} key={item.id}>{participates ? <Cpu aria-hidden="true" /> : <i />}</span>;
          })}
        </div>
      ))}
      <p className="timeline-note"><Clock3 aria-hidden="true" />{changed ? "Experiment: timing or ordering has changed." : `Now running: ${event.label}`}</p>
    </div>
  );
}

function DistributedScene({ spec, event, eventIndex, changed }: SceneProps) {
  return (
    <div className="distributed-scene">
      <div className="service-grid">
        {spec.actors.map((actor, index) => {
          const Icon = index % 3 === 0 ? Globe2 : index % 3 === 1 ? Server : Database;
          return <article className={activeClass(actor, event)} key={actor.id}><Icon aria-hidden="true" /><span>{actor.group || "component"}</span><b>{actor.label}</b><small>{actor.role}</small><em>{actor.id === event.to ? (changed ? "changed" : "active") : "ready"}</em></article>;
        })}
      </div>
      <div className="distributed-ledger">
        <header><Network aria-hidden="true" /><b>Message ledger</b></header>
        {spec.events.slice(0, eventIndex + 1).map((item, index) => (
          <div className={index === eventIndex ? "active" : ""} key={item.id}><span>{index + 1}</span><b>{actorById(spec, item.from).label}</b><ArrowRight aria-hidden="true" /><b>{actorById(spec, item.to).label}</b><small>{item.label}</small></div>
        ))}
      </div>
    </div>
  );
}

function StateMachineScene({ spec, event, eventIndex }: SceneProps) {
  return (
    <div className="state-scene">
      <div className="state-cycle">
        {spec.actors.map((actor, index) => (
          <div className="state-wrap" key={actor.id}>
            <article className={activeClass(actor, event)}><span>STATE {index + 1}</span><b>{actor.label}</b><small>{actor.role}</small></article>
            {index < spec.actors.length - 1 && <ArrowRight aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="state-transition"><CircleDot aria-hidden="true" /><span><small>TRANSITION {eventIndex + 1}</small><b>{event.label}</b><em>{actorById(spec, event.from).label} → {actorById(spec, event.to).label}</em></span></div>
    </div>
  );
}
