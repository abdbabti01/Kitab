// Break and compare: change one setting of a working network, run the same action on both copies with the real
// engine, and find where the two runs first differ. A fault is offered only when the engine shows it changes the
// outcome of this action; the difference is read from the two recorded traces, never assumed.
import { newSession, simulate } from "./engine.ts";
import { dotted, ipNumber, mask, sameSubnet } from "./topology.ts";
import type { Action, Device, Network, Session, Trace, TraceEvent } from "./model.ts";

export type FaultKind = "mask" | "no-gateway" | "wrong-gateway" | "cable" | "dhcp-pool" | "route" | "nat";
export type Fault = {
  id: string;
  kind: FaultKind;
  /** The device whose setting changes (for a cable, the device it is unplugged from). */
  device: string;
  /** The setting, and its value before and after, as the learner would read them. */
  setting: string;
  before: string;
  after: string;
  /** "Remove Your PC's default gateway". */
  label: string;
  apply: (n: Network) => void;
};
export type Divergence = {
  device: string;
  /** The first differing event of that device in each run; absent when that run records nothing more for it. */
  working?: number;
  broken?: number;
  /** What differs, from the two recorded events. */
  differences: { what: string; working: string; broken: string }[];
};
export type Experiment = { fault: Fault; network: Network; working: Trace; broken: Trace; divergence: Divergence | null };

const dev = (n: Network, id: string) => n.devices.find((d) => d.id === id)!;
const differs = (a: Trace, b: Trace) => a.success !== b.success || a.reason !== b.reason;
const host = (d: Device) => d.interfaces.find((p) => p.enabled && p.ip && p.mode === "static");

/** The faults that are worth trying for this network and action, before checking their effect. */
function candidates(network: Network, action: Action, working: Trace): Fault[] {
  const out: Fault[] = [];
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const source = network.devices.find((d) => d.id === action.source);
  const port = source && host(source);
  if (source && port) {
    for (const prefix of [28, 30, 25, 16].filter((p) => p !== port.prefix))
      out.push({
        id: `mask:${source.id}:${prefix}`,
        kind: "mask",
        device: source.id,
        setting: "Subnet mask",
        before: `/${port.prefix} (${dotted(mask(port.prefix))})`,
        after: `/${prefix} (${dotted(mask(prefix))})`,
        label: `Change ${source.name}'s subnet mask from /${port.prefix} to /${prefix}`,
        apply: (n) => void (dev(n, source.id).interfaces.find((p) => p.id === port.id)!.prefix = prefix),
      });
    if (port.gateway) {
      out.push({
        id: `no-gateway:${source.id}`,
        kind: "no-gateway",
        device: source.id,
        setting: "Default gateway",
        before: port.gateway,
        after: "none",
        label: `Remove ${source.name}'s default gateway`,
        apply: (n) => void (dev(n, source.id).interfaces.find((p) => p.id === port.id)!.gateway = ""),
      });
      // An address in the same subnet that no device has.
      const used = new Set(network.devices.flatMap((d) => d.interfaces.map((p) => p.ip)));
      const base = ipNumber(port.ip) & mask(port.prefix);
      const unused = [99, 254, 2, 3]
        .map((k) => dotted((base + k) >>> 0))
        .find((ip) => !used.has(ip) && sameSubnet(ip, port.ip, port.prefix) && ip !== port.gateway);
      if (unused)
        out.push({
          id: `wrong-gateway:${source.id}`,
          kind: "wrong-gateway",
          device: source.id,
          setting: "Default gateway",
          before: port.gateway,
          after: unused,
          label: `Point ${source.name}'s default gateway at ${unused}, an address no device has`,
          apply: (n) => void (dev(n, source.id).interfaces.find((p) => p.id === port.id)!.gateway = unused),
        });
    }
  }
  // Cables the working run crossed, in the order it first crossed them.
  const links = [...new Set(working.events.flatMap((e) => (e.hop && e.frame ? [e.hop.link] : [])))];
  for (const id of links) {
    const l = network.links.find((x) => x.id === id);
    if (!l) continue;
    out.push({
      id: `cable:${id}`,
      kind: "cable",
      device: l.b.device,
      setting: "Cable",
      before: `${name(l.a.device)} ${l.a.port} ↔ ${name(l.b.device)} ${l.b.port}`,
      after: "unplugged",
      label: `Unplug the ${l.medium === "wifi" ? "Wi-Fi link" : "cable"} between ${name(l.a.device)} and ${name(l.b.device)}`,
      apply: (n) => void (n.links = n.links.filter((x) => x.id !== id)),
    });
  }
  // The DHCP server that answered: shrink its pool to one address another device already has.
  const offer = working.events.find((e) => e.title === "DHCP Offer");
  if (action.kind === "dhcp" && offer) {
    const server = dev(network, offer.actor);
    const lanPort = server.interfaces.find((p) => p.id === server.dhcp.port) ?? server.interfaces[0];
    const taken = network.devices
      .filter((d) => d.id !== server.id && d.id !== action.source)
      .flatMap((d) => d.interfaces.filter((p) => p.ip && lanPort.ip && sameSubnet(p.ip, lanPort.ip, lanPort.prefix)).map((p) => ({ d, ip: p.ip })))[0];
    if (taken)
      out.push({
        id: `dhcp-pool:${server.id}`,
        kind: "dhcp-pool",
        device: server.id,
        setting: "DHCP pool",
        before: `${server.dhcp.start} – ${server.dhcp.end}`,
        after: `${taken.ip} – ${taken.ip}`,
        label: `Shrink ${server.name}'s DHCP pool to ${taken.ip}, which ${taken.d.name} already uses`,
        apply: (n) => void Object.assign(dev(n, server.id).dhcp, { start: taken.ip, end: taken.ip }),
      });
  }
  // A static route a router actually used.
  for (const e of working.events) {
    const m = /^Static (\S+)\/(\d+)$/.exec(String(e.facts?.Route ?? ""));
    if (e.title !== "Choose a route" || !m || out.some((f) => f.id.startsWith(`route:${e.actor}:`))) continue;
    const r = dev(network, e.actor);
    const route = r.routes.find((x) => x.network === m[1] && x.prefix === Number(m[2]));
    if (!route) continue;
    out.push({
      id: `route:${r.id}:${route.network}/${route.prefix}`,
      kind: "route",
      device: r.id,
      setting: "Static route",
      before: `${route.network}/${route.prefix} via ${route.via}`,
      after: "removed",
      label: `Remove ${r.name}'s route to ${route.network}/${route.prefix} (via ${route.via})`,
      apply: (n) => void (dev(n, r.id).routes = dev(n, r.id).routes.filter((x) => !(x.network === route.network && x.prefix === route.prefix))),
    });
  }
  // NAT on a router that translated this traffic.
  const nat = working.events.find((e) => e.title === "Translate source with NAT");
  if (nat)
    out.push({
      id: `nat:${nat.actor}`,
      kind: "nat",
      device: nat.actor,
      setting: "NAT",
      before: "on",
      after: "off",
      label: `Turn off NAT on ${name(nat.actor)}`,
      apply: (n) => void (dev(n, nat.actor).nat = false),
    });
  return out;
}

/**
 * The experiments for this network and action: at most one per kind of fault, each a single changed setting whose
 * broken run the engine shows ends differently from the working run. None when the working run itself fails.
 */
export function experimentsFor(network: Network, action: Action, session: Session = newSession()): { working: Trace; experiments: Experiment[] } {
  const working = simulate(network, session, action);
  if (!working.success) return { working, experiments: [] };
  const found: Experiment[] = [];
  for (const fault of candidates(network, action, working)) {
    if (found.some((x) => x.fault.kind === fault.kind)) continue;
    const broken = structuredClone(network);
    fault.apply(broken);
    const result = simulate(broken, session, action);
    if (differs(working, result)) found.push({ fault, network: broken, working, broken: result, divergence: divergence(working, result) });
  }
  return { working, experiments: found };
}

// An event as a device's decision: what it did, why, where it sent the message and what the message carried.
// Packet ids and frame numbers are left out: they count messages and shift when one run has more of them.
const decision = (e: TraceEvent) =>
  JSON.stringify([e.title, e.reason ?? "", e.facts ?? {}, e.hop ? [e.hop.from, e.hop.to] : [], e.layers.map((l) => [l.name, l.fields])]);

/**
 * Where the runs first differ. Each device's own sequence of decisions is compared, so a different interleaving of
 * devices (harmless ordering) is not a difference; the earliest device whose decisions differ is the divergence.
 * Null when every device recorded the same decisions.
 */
export function divergence(working: Trace, broken: Trace): Divergence | null {
  const perDevice = (t: Trace) => {
    const m = new Map<string, number[]>();
    t.events.forEach((e, i) => m.set(e.actor, [...(m.get(e.actor) ?? []), i]));
    return m;
  };
  const w = perDevice(working),
    b = perDevice(broken);
  let best: { rank: number; device: string; k: number } | null = null;
  for (const device of new Set([...w.keys(), ...b.keys()])) {
    const ws = w.get(device) ?? [],
      bs = b.get(device) ?? [];
    let k = 0;
    while (k < ws.length && k < bs.length && decision(working.events[ws[k]]) === decision(broken.events[bs[k]])) k++;
    if (k === ws.length && k === bs.length) continue;
    // Before the first difference both runs are the same computation, so their positions agree.
    const rank = Math.min(ws[k] ?? Infinity, bs[k] ?? Infinity);
    // On a tie, prefer a step the working run took and the broken one did not (the cause) over the stop it led to.
    if (!best || rank < best.rank || (rank === best.rank && ws[k] !== undefined && bs[k] === undefined)) best = { rank, device, k };
  }
  if (!best) return null;
  const wi = w.get(best.device)?.[best.k],
    bi = b.get(best.device)?.[best.k];
  return { device: best.device, working: wi, broken: bi, differences: compare(wi === undefined ? undefined : working.events[wi], bi === undefined ? undefined : broken.events[bi]) };
}

/** What differs between two recorded events of one device, field by field. */
function compare(x?: TraceEvent, y?: TraceEvent) {
  if (!x || !y) return [{ what: "Step", working: x?.title ?? "nothing further", broken: y?.title ?? "nothing further" }];
  const out: Divergence["differences"] = [];
  // A different step: what each run did there (and why the broken one stopped), not field-by-field noise.
  if (x.title !== y.title)
    return [{ what: "Step", working: x.title, broken: y.title }, ...(y.reason ? [{ what: "Reason", working: x.reason ?? "none", broken: y.reason }] : [])];
  for (const k of new Set([...Object.keys(x.facts ?? {}), ...Object.keys(y.facts ?? {})]))
    if (String(x.facts?.[k] ?? "") !== String(y.facts?.[k] ?? "")) out.push({ what: k, working: String(x.facts?.[k] ?? "none"), broken: String(y.facts?.[k] ?? "none") });
  if ((x.hop?.to ?? "") !== (y.hop?.to ?? "")) out.push({ what: "Sent to", working: x.hop?.to ?? "nowhere", broken: y.hop?.to ?? "nowhere" });
  if ((x.reason ?? "") !== (y.reason ?? "")) out.push({ what: "Reason", working: x.reason ?? "none", broken: y.reason ?? "none" });
  for (const l of x.layers) {
    const o = y.layers.find((z) => z.name === l.name);
    if (o) for (const [k, v] of Object.entries(l.fields)) if (o.fields[k] !== undefined && o.fields[k] !== v) out.push({ what: `${k} (${l.name})`, working: String(v), broken: String(o.fields[k]) });
  }
  if (!out.length) out.push({ what: "Layers", working: x.layers.map((l) => l.name).join(" in ") || "none", broken: y.layers.map((l) => l.name).join(" in ") || "none" });
  return out;
}
