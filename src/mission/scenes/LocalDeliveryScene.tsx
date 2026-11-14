// Scene for "Local delivery, gateways and routing". Everything it draws is read from the simulator run the engine used
// (runOf), so the diagram, the envelopes and the decision always match the step's facts. Predictions keep their state
// in the scene only: nothing is scored or stored.
import { lazy, Suspense, useState } from "react";
import { RUN_NAMES, frameOf, packetOf, runOf, type LocalDeliveryData } from "../../learning/engines/local-delivery.ts";
import type { TraceEvent } from "../../practice/network/model.ts";
import { compare } from "../../net/subnet-practice.ts";
import { PredictionCard } from "../../practice/SubnetParts.tsx";
import { linkProps } from "../../app/router.ts";
import { SceneSection, type SceneProps } from "./common.tsx";
import "./local-delivery.css";

type Props = SceneProps<LocalDeliveryData>;
const LocalDeliveryCanvas = lazy(() => import("./LocalDeliveryCanvas.tsx"));

type Row = [label: string, value: string];
/** The frame and the packet an event carries, exactly as the simulator recorded them. */
function envelope(event: TraceEvent) {
  const frame = frameOf(event),
    packet = packetOf(event),
    arp = event.layers.find((layer) => layer.kind === "link" && "Sender IP" in layer.fields)?.fields;
  const link: Row[] = frame ? [["Source MAC", String(frame["Source MAC"])], ["Destination MAC", String(frame["Destination MAC"])]] : [];
  if (frame && event.title === "Transmit over Ethernet" && frame["Outgoing port"]) link.push(["Outgoing port", String(frame["Outgoing port"])]);
  const arpRows: Row[] = arp ? Object.entries(arp).map(([key, value]) => [`ARP ${key.toLowerCase()}`, String(value)]) : [];
  const ip: Row[] = packet ? [["Source IP", String(packet["Source IP"])], ["Destination IP", String(packet["Destination IP"])], ["TTL", String(packet.TTL)]] : [];
  return { link, arpRows, ip };
}

function Envelope({ event, title, changed = [] }: { event: TraceEvent; title: string; changed?: string[] }) {
  const { link, arpRows, ip } = envelope(event);
  const row = ([label, value]: Row) => (
    <div key={label} className={changed.includes(label) ? "is-changed" : ""}>
      <dt>{label}</dt>
      <dd><code>{value}</code>{changed.includes(label) && <span className="ld-changed"> changed</span>}</dd>
    </div>
  );
  return (
    <section className="ld-envelope" aria-label={title}>
      <h4>{title}</h4>
      {(link.length > 0 || arpRows.length > 0) && <dl className="ld-frame"><p className="ld-layer">Frame (this link)</p>{link.map(row)}{arpRows.map(row)}</dl>}
      {ip.length > 0 && <dl className="ld-packet"><p className="ld-layer">IP packet (end to end)</p>{ip.map(row)}</dl>}
      {!link.length && !arpRows.length && !ip.length && <p className="ld-none">No frame or packet at this step.</p>}
    </section>
  );
}

function Decision({ event }: { event: TraceEvent }) {
  if (!event.facts) return null;
  return (
    <dl className="ld-decision" aria-label="What the simulator recorded at this step">
      {Object.entries(event.facts).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{String(value)}</code></dd></div>)}
    </dl>
  );
}

export function LocalDeliveryScene(props: Props) {
  const d = props.frame.data,
    { network, trace } = runOf(d.run),
    event = trace.events[d.index];
  const key = `${props.trace.scenarioKey}:${props.frame.id}`;
  const [attempt, setAttempt] = useState({ key, tried: [] as number[], shown: false });
  const current = attempt.key === key ? attempt : { key, tried: [] as number[], shown: false };
  const q = d.question,
    answered = !q || current.shown || current.tried.includes(q.choices.findIndex((c) => c.correct));
  let evidence: React.ReactNode = null;
  if (d.view === "settings") {
    const pc = network.devices.find((x) => x.id === "pc")!.interfaces[0],
      c = compare(pc.ip, String(trace.events[0].facts?.Destination), pc.prefix);
    evidence = (
      <div className="ld-settings">
        <p className="ld-label">A calculation your PC makes before sending: not a simulated event.</p>
        <dl className="subnet-and">
          <dt>Your PC</dt><dd><code>{pc.ip} AND {c.mask} = {c.own}</code></dd>
          <dt>Destination</dt><dd><code>{String(trace.events[0].facts?.Destination)} AND {c.mask} = {c.other}</code></dd>
        </dl>
        <p className={`subnet-verdict${c.same ? "" : " is-remote"}`}>
          {c.same ? <><b>Same subnet.</b> Your PC sends directly.</> : <><b>Different subnet.</b> Your PC sends to its default gateway, {pc.gateway}.</>}
        </p>
      </div>
    );
  } else if (d.view === "compare" && d.before) {
    const before = runOf(d.before.run).trace.events[d.before.index],
      a = envelope(before),
      b = envelope(event),
      rows = (e: ReturnType<typeof envelope>) => Object.fromEntries([...e.link, ...e.ip]),
      ra = rows(a),
      rb = rows(b),
      changed = Object.keys(rb).filter((label) => label !== "Outgoing port" && ra[label] !== undefined && ra[label] !== rb[label]);
    evidence = (
      <div className="ld-compare">
        <Envelope event={before} title={`Sent by ${network.devices.find((x) => x.id === before.actor)?.name ?? before.actor}`} />
        <Envelope event={event} title={`Sent on by ${network.devices.find((x) => x.id === event.actor)?.name ?? event.actor}`} changed={changed} />
        <p className="ld-summary" role="status">{changed.length ? `Changed: ${changed.join(", ")}. Unchanged: ${Object.keys(rb).filter((l) => l !== "Outgoing port" && !changed.includes(l)).join(", ")}.` : "Nothing in the frame or the packet changed."}</p>
      </div>
    );
  } else {
    evidence = (
      <div className="ld-event">
        <Envelope event={event} title={`At ${network.devices.find((x) => x.id === event.actor)?.name ?? event.actor}`} />
        <Decision event={event} />
      </div>
    );
  }
  return (
    <SceneSection label={props.frame.title} className="ld-scene">
      <p className="ld-run">
        Simulated run: <b>{RUN_NAMES[d.run]}</b>, step {d.index + 1} of {trace.events.length}
      </p>
      <Suspense fallback={<p className="ld-loading" role="status">Loading the network diagram…</p>}>
        <LocalDeliveryCanvas network={network} events={trace.events} index={d.index} onSelect={props.onSelect} />
      </Suspense>
      {q && (
        <PredictionCard id={`lesson2-${props.frame.id}`} question={q} attempt={current} revealed={answered}
          onTry={(i) => setAttempt({ ...current, tried: [...current.tried, i] })} onShow={() => setAttempt({ ...current, shown: true })} />
      )}
      {answered && evidence}
      <a className="ld-lab" {...linkProps(`/practice/network?starter=${d.run}`)}>Open this network in the lab →</a>
    </SceneSection>
  );
}

export const localDeliveryScene = { Scene: LocalDeliveryScene };
