// Scene for "Local delivery, gateways and routing". Everything it draws is read from the simulator run the engine used
// (runOf), so the diagram, the envelopes and the decision always match the step's facts. Predictions keep their state
// in the scene only: nothing is scored or stored.
import { lazy, Suspense, useState } from "react";
import { baseOf, frameOf, packetOf, runName, runOf, RUNS, type LocalDeliveryData } from "../../learning/engines/local-delivery.ts";
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

const PHASE = { normal: "In the normal run", changed: "In this experiment", restored: "Put back" } as const;

/** What to try with each network this lesson ran, on the "Try it in the lab" step. */
const LAB_TRY = {
  lan: "Ping the local server: ARP and the switch deliver it with no router.",
  routed: "Change your PC's or the server's default gateway, run the ping again and find where it stops.",
  internet: "Turn off NAT on the home router and follow the reply to where it stops.",
} as const;

/** An experiment's one setting, and (except on the change itself, which the learner predicts) the run's result. */
function Setting({ change, trace }: { change: NonNullable<LocalDeliveryData["change"]>; trace: ReturnType<typeof runOf>["trace"] }) {
  const value = change.phase === "changed" ? change.changed : change.normal;
  return (
    <div className="ld-event">
      <dl className="ld-decision" aria-label="The setting this experiment changes">
        <div><dt>Device</dt><dd>{change.deviceName}</dd></div>
        <div><dt>Setting</dt><dd>{change.setting}</dd></div>
        <div><dt>Normal value</dt><dd><code>{change.normal}</code></dd></div>
        <div className={change.phase === "changed" ? "is-changed" : ""}><dt>{PHASE[change.phase]}</dt><dd><code>{value}</code></dd></div>
      </dl>
      {change.phase !== "changed" && (
        <p className={`ld-result${trace.success ? "" : " is-failed"}`} role="status">
          <b>{trace.success ? "Simulated run succeeded." : "Simulated run failed."}</b> {trace.summary}
        </p>
      )}
    </div>
  );
}

/** The event where the run stops, and the simulator's own account of why. */
function Stop({ trace, name }: { trace: ReturnType<typeof runOf>["trace"]; name: (id: string) => string }) {
  const f = trace.failure!;
  const rows: Row[] = [["Reason", f.reason], ["Observed", f.message]];
  if (f.detail) rows.push(["Why", f.detail]);
  if (f.cause && !f.message.includes(f.cause.message)) rows.push(["Underlying cause", f.cause.message]);
  const advice = f.advice ?? f.cause?.advice;
  if (advice) rows.push(["What to check", advice]);
  return (
    <section className="ld-stop" aria-label="Where the run stopped">
      <h4>The run stops at {name(f.device)}</h4>
      <dl className="ld-decision">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{label === "Reason" ? <code>{value}</code> : value}</dd></div>)}</dl>
    </section>
  );
}

export function LocalDeliveryScene(props: Props) {
  const d = props.frame.data,
    { network, trace } = runOf(d.run),
    event = trace.events[d.index],
    name = (id: string) => network.devices.find((x) => x.id === id)?.name ?? id;
  const key = `${props.trace.scenarioKey}:${props.frame.id}`;
  const [attempt, setAttempt] = useState({ key, tried: [] as number[], shown: false });
  const current = attempt.key === key ? attempt : { key, tried: [] as number[], shown: false };
  const q = d.question,
    answered = !q || current.shown || current.tried.includes(q.choices.findIndex((c) => c.correct));
  let evidence: React.ReactNode = null;
  if (d.view === "task") {
    // A mission's question: the PC's settings and the destination only. The diagram shows no event yet.
    const value = (id: string) => String(props.frame.facts.find((f) => f.id === id)?.value ?? "");
    evidence = (
      <dl className="ld-decision ld-task" aria-label="Your PC's settings">
        <div><dt>Your PC</dt><dd><code>{value("pc-address")}</code></dd></div>
        <div><dt>Default gateway</dt><dd><code>{value("gateway")}</code></dd></div>
        <div><dt>Destination</dt><dd><code>{value("destination")}</code></dd></div>
      </dl>
    );
  } else if (d.view === "settings") {
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
    // Two steps of one device (NAT) are named by what it did; otherwise by who sent the frame.
    const same = before.actor === event.actor;
    evidence = (
      <div className="ld-compare">
        <Envelope event={before} title={same ? `Before: ${before.title}` : `Sent by ${name(before.actor)}`} />
        <Envelope event={event} title={same ? `After: ${event.title}` : `Sent on by ${name(event.actor)}`} changed={changed} />
        <p className="ld-summary" role="status">{changed.length ? `Changed: ${changed.join(", ")}. Unchanged: ${Object.keys(rb).filter((l) => l !== "Outgoing port" && !changed.includes(l)).join(", ")}.` : "Nothing in the frame or the packet changed."}</p>
      </div>
    );
  } else if (d.view === "change" && d.change) {
    evidence = <Setting change={d.change} trace={trace} />;
  } else if (d.view === "lab") {
    evidence = (
      <ul className="ld-starters" aria-label="The networks this lesson ran, in the lab">
        {(Object.keys(LAB_TRY) as (keyof typeof LAB_TRY)[]).map((id) => (
          <li key={id}><a {...linkProps(`/practice/network?starter=${RUNS[id].starter}`)}><b>{runName(id)}</b><small>{LAB_TRY[id]}</small></a></li>
        ))}
      </ul>
    );
  } else {
    evidence = (
      <div className="ld-event">
        <Envelope event={event} title={`At ${name(event.actor)}`} />
        <Decision event={event} />
        {d.differences && (
          <table className="ld-differences">
            <caption>Where this run first differs from the normal run</caption>
            <thead><tr><th scope="col">At {name(event.actor)}</th><th scope="col">Normal run</th><th scope="col">This run</th></tr></thead>
            <tbody>{d.differences.map((row) => <tr key={row.what}><th scope="row">{row.what}</th><td>{row.normal}</td><td className="is-changed">{row.experiment}</td></tr>)}</tbody>
          </table>
        )}
        {d.view === "stop" && <Stop trace={trace} name={name} />}
      </div>
    );
  }
  return (
    <SceneSection label={props.frame.title} className="ld-scene">
      <p className="ld-run">
        Simulated run: <b>{runName(d.run)}</b>, step {d.index + 1} of {trace.events.length}
      </p>
      <Suspense fallback={<p className="ld-loading" role="status">Loading the network diagram…</p>}>
        <LocalDeliveryCanvas network={network} events={trace.events} index={d.index} still={d.view === "task"} onSelect={props.onSelect} />
      </Suspense>
      {q && (
        <PredictionCard id={`lesson2-${props.frame.id}`} question={q} attempt={current} revealed={answered}
          onTry={(i) => setAttempt({ ...current, tried: [...current.tried, i] })} onShow={() => setAttempt({ ...current, shown: true })} />
      )}
      {answered && evidence}
      {d.mission && <a className="ld-lab" {...linkProps(`/practice/missions/${d.mission.id}`)}>Practise: {d.mission.title} →</a>}
      {/* A practice network differs from the starter, so it isn't offered as "this network"; the lab step lists them all. */}
      {!d.run.startsWith("practice-") && d.view !== "lab" && <a className="ld-lab" {...linkProps(`/practice/network?starter=${RUNS[baseOf(d.run)].starter}`)}>Open this network in the Playground →</a>}
    </SceneSection>
  );
}

export const localDeliveryScene = { Scene: LocalDeliveryScene };
