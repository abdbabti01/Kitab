// Predict as you go: a few checkpoints at the decisions that teach how the network works. The Journey stops at
// `ask`, before anything shows the outcome; the outcome first appears at `at`. Every correct answer is read from
// recorded events and header fields; the other choices are values a learner could reasonably expect. A checkpoint
// the trace cannot support (a missing event, field or reason) is left out.
import { optionOrder } from "../../learning/assessment.ts";
import { isPrivate } from "./engine.ts";
import type { Network, Trace, TraceEvent } from "./model.ts";

export type CheckpointKind = "next-hop" | "arp-answer" | "arp-cache" | "flood" | "dhcp" | "router" | "nat-out" | "nat-in" | "ack" | "loss";
export type Checkpoint = {
  id: string;
  kind: CheckpointKind;
  /** The Journey waits here with the question; nothing after this event is shown until it is answered. */
  ask: number;
  /** The first event that shows the outcome. */
  at: number;
  /** Where the decision is made. */
  device: string;
  question: string;
  /** `why`: for some wrong choices, what that choice mixes up, from the same recorded values. */
  options: { id: string; text: string; why?: string }[];
  answer: string;
  /** What happened and why, from the recorded events. */
  explain: string;
};
/** `ips`: the choices are addresses, labelled with their device only when every one of them has one. */
type Draft = Omit<Checkpoint, "id" | "options" | "answer"> & {
  right: string;
  wrong: (string | false | undefined)[];
  ips?: boolean;
  /** Why a particular wrong choice is wrong, keyed by that choice. */
  whyNot?: Record<string, string>;
};

const field = (e: TraceEvent | undefined, layer: string, name: string) => e?.layers.find((l) => l.name === layer)?.fields[name];
const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

function make(d: Draft): Checkpoint | null {
  const texts = [...new Set([d.right, ...d.wrong.filter((w): w is string => !!w)])];
  if (texts.length < 2 || d.ask < 0 || d.at <= d.ask) return null;
  const id = `${d.kind}:${d.at}`;
  const ids = texts.map((_, k) => String.fromCharCode(97 + k));
  const options = optionOrder(id, ids).map((o) => {
    const text = texts[ids.indexOf(o)];
    return d.whyNot?.[text] && text !== d.right ? { id: o, text, why: d.whyNot[text] } : { id: o, text };
  });
  const { right, wrong, ips, whyNot, ...rest } = d;
  return { ...rest, id, options, answer: "a" };
}

/** The checkpoints of one run, in order, never overlapping: each question's outcome comes before the next question. */
export function checkpointsOf(trace: Trace, network: Network): Checkpoint[] {
  const ev = trace.events;
  const device = (id: string) => network.devices.find((d) => d.id === id);
  const name = (id: string) => device(id)?.name ?? id;
  // Whose address an IP is: from the settings, or from the trace for addresses a device was given (DHCP).
  const arpSender = (ip: string) => ev.find((e) => e.title.startsWith("ARP") && (field(e, "ARP request", "Sender IP") ?? field(e, "ARP reply", "Sender IP")) === ip)?.actor;
  const owner = (ip: string) => network.devices.find((d) => d.interfaces.some((p) => p.ip === ip)) ?? device(arpSender(ip) ?? "");
  const addr = (ip: unknown) => (owner(String(ip)) ? `${ip} (${owner(String(ip))!.name})` : String(ip));
  const kind = (id: string) => device(id)?.kind ?? "";
  const find = (from: number, test: (e: TraceEvent, i: number) => boolean) => {
    for (let i = from; i < ev.length; i++) if (test(ev[i], i)) return i;
    return -1;
  };
  const failure = ev.at(-1)?.error ? ev.at(-1) : undefined;
  const drafts: (Draft | null)[] = [];
  const labelled = (d: Draft): Draft => {
    if (!d.ips) return d;
    const all = [d.right, ...d.wrong].filter((w): w is string => !!w);
    const label = (ip: string) => (all.every((x) => owner(x)) ? `${ip} (${owner(ip)!.name})` : ip);
    return {
      ...d,
      right: label(d.right),
      wrong: d.wrong.map((w) => w && label(w)),
      whyNot: d.whyNot && Object.fromEntries(Object.entries(d.whyNot).map(([k, v]) => [label(k), v])),
    };
  };

  // Which next hop a device chooses: the first host, and the first router.
  for (const kinds of [["pc", "phone", "server"], ["router"]]) {
    const i = find(1, (e) => e.title === "Choose a route" && !!e.facts?.["Next hop"] && kinds.includes(kind(e.actor)));
    if (i < 0) continue;
    const e = ev[i],
      nh = String(e.facts!["Next hop"]),
      dest = String(e.facts!.Destination);
    const known = device(e.actor)!.interfaces.map((p) => p.gateway).concat(device(e.actor)!.routes.map((r) => r.via));
    drafts.push({
      kind: "next-hop",
      ask: i - 1,
      at: i,
      device: e.actor,
      question: `${name(e.actor)} has a packet for ${dest}. Which address will it send it to first?`,
      right: nh,
      wrong: [dest, ...known.filter((ip) => ip && ip !== nh)].slice(0, 3),
      ips: true,
      whyNot: {
        [dest]: `${dest} is the destination address. It stays in the packet's IPv4 header all the way, but ${name(e.actor)} sends the frame only as far as the next hop on its link, ${addr(nh)}.`,
      },
      explain:
        nh === dest
          ? `${dest} is on a network ${name(e.actor)} is connected to (route "${e.facts!.Route}"), so it sends the packet straight to it.`
          : `${dest} is not on ${name(e.actor)}'s own network, so the route "${e.facts!.Route}" sends it to ${addr(nh)} first. The destination IP stays ${dest}; only the next hop is chosen here.`,
    });
  }

  // Which device answers an ARP broadcast.
  const d = find(0, (e) => e.title === "ARP: discover the next-hop MAC" && !!e.packet);
  if (d >= 0) {
    const asker = ev[d].actor,
      id = ev[d].packet!,
      who = String(field(ev[d], "ARP request", "Who has"));
    const reply = find(d, (e) => e.title === "ARP reply" && e.packet === `${id}-reply`);
    const heard = [...new Set(ev.filter((e) => e.packet === id && e.title === "Receive frame" && !["switch", "ap"].includes(kind(e.actor))).map((e) => e.actor))];
    const holder = owner(who)?.id;
    const nobody = `No device: nobody on this LAN replies for ${who}`;
    // The reply's frame, as recorded: addressed to one device, not to everyone.
    const replyFrame = ev.find((e) => e.packet === `${id}-reply` && e.frame);
    const unicast = !!replyFrame && field(replyFrame, "Ethernet frame", "Destination MAC") !== undefined && field(replyFrame, "Ethernet frame", "Destination MAC") !== "ff:ff:ff:ff:ff:ff";
    const others = [...new Set([...heard, ...(holder ? [holder] : [])])].filter((x) => x !== asker);
    if (reply >= 0)
      drafts.push({
        kind: "arp-answer",
        ask: d,
        at: reply,
        device: asker,
        question: `${name(asker)} broadcasts "Who has ${who}?" to every device on its LAN. Which device answers?`,
        right: name(ev[reply].actor),
        wrong: [...others.filter((x) => x !== ev[reply].actor).slice(0, 2).map(name), nobody],
        whyNot: Object.fromEntries(
          heard
            .filter((x) => x !== ev[reply].actor && x !== asker)
            .map((x) => [
              name(x),
              `${name(x)} received the broadcast, as every device on the LAN does, but it does not have ${who}, so it stays silent.${unicast ? ` Only ${name(ev[reply].actor)} replies, and its reply is sent to ${name(asker)} alone, not broadcast.` : ""}`,
            ]),
        ),
        explain: `${name(ev[reply].actor)} has the address ${who}, so it alone replies with its MAC address ${field(ev[reply], "ARP reply", "Sender MAC")}. Every other device that hears the broadcast ignores it.`,
      });
    else if (failure?.reason?.startsWith("ARP_") && failure.failure)
      drafts.push({
        kind: "arp-answer",
        ask: d,
        at: ev.length - 1,
        device: asker,
        question: `${name(asker)} broadcasts "Who has ${who}?" to every device on its LAN. Which device answers?`,
        right: nobody,
        wrong: others.slice(0, 3).map(name),
        explain: `No reply was recorded. ${failure.failure.message}`,
      });
  }

  // Whether a device uses its ARP cache the second time it needs the same address.
  const asked = new Map<string, number>();
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    const ip = e.title === "ARP cache hit" ? e.facts?.IP : e.title === "ARP: discover the next-hop MAC" ? field(e, "ARP request", "Who has") : undefined;
    if (ip === undefined) continue;
    const key = `${e.actor} ${ip}`;
    if (!asked.has(key)) {
      asked.set(key, i);
      continue;
    }
    if (ev[i - 1]?.actor !== e.actor) break;
    const hit = e.title === "ARP cache hit";
    const cache = `It uses the MAC address already in its ARP cache`,
      again = `It broadcasts a new ARP request for ${ip}`;
    drafts.push({
      kind: "arp-cache",
      ask: i - 1,
      at: i,
      device: e.actor,
      question: `${name(e.actor)} needs the MAC address of ${ip} again for this packet. What does it do?`,
      right: hit ? cache : again,
      wrong: [hit ? again : cache, `It sends the frame to the broadcast MAC address instead`],
      explain: hit
        ? `${name(e.actor)} learned that ${ip} is at ${e.facts!.MAC} from the earlier ARP reply and kept it in its ARP cache, so it needs no new request.`
        : `${name(e.actor)} had no usable entry for ${ip}, so it asked again.`,
    });
    break;
  }

  // Where a switch sends a frame for a MAC address it does not know.
  const u = find(0, (e) => e.title.startsWith("Unknown MAC") && !!e.packet);
  if (u >= 0) {
    const sw = ev[u].actor,
      p = ev[u].packet!,
      mac = String(ev[u].facts?.MAC ?? field(ev[u - 1], "Ethernet frame", "Destination MAC"));
    const copies = ev.flatMap((e, h) => (e.packet === p && e.actor === sw && e.hop?.from === sw && ev[h - 1]?.title.startsWith("Unknown MAC") ? [e.hop.to] : []));
    let ingress = "";
    for (let h = u; h >= 0 && !ingress; h--) if (ev[h].packet === p && ev[h].hop?.to === sw) ingress = ev[h].hop!.from;
    const target = network.devices.find((x) => x.interfaces.some((q) => q.mac === mac))?.id;
    const dropped = [...new Set(ev.filter((e) => e.packet === p && e.title.startsWith("Discard")).map((e) => e.actor))];
    if (copies.length && ingress && mac)
      drafts.push({
        kind: "flood",
        ask: u - 1,
        at: u,
        device: sw,
        question: `${name(sw)} has no entry for ${mac} in its MAC table. Where does it send this frame?`,
        right: `A copy out of every other port: to ${list(copies.map(name))}`,
        wrong: [
          target && !(copies.length === 1 && copies[0] === target) && `Only to ${name(target)}, the device with that MAC address`,
          `A copy out of every port, including back to ${name(ingress)}`,
          `Nowhere: it drops the frame`,
        ],
        explain: `A switch that does not know where a MAC address is sends the frame out of every port except the one it came in on.${dropped.length ? ` ${list(dropped.map(name))} discarded it because it was not addressed to ${dropped.length > 1 ? "them" : "it"}.` : ""}`,
      });
  }

  // Whether a DHCP exchange succeeds.
  const discover = find(0, (e) => e.title === "DHCP Discover");
  if (discover >= 0) {
    const client = ev[discover].actor;
    const applied = find(discover, (e) => e.title === "Apply DHCP lease" && e.actor === client);
    const offer = find(discover, (e) => e.title === "DHCP Offer");
    const yes = `Yes: a DHCP server offers one and ${name(client)} applies it`,
      noServer = `No: no DHCP server answers on this LAN`,
      noPool = `No: the DHCP server has no free address to give`;
    const outcome = applied >= 0 ? yes : failure?.reason === "DHCP_NO_SERVER" ? noServer : failure?.reason === "DHCP_POOL_EMPTY" ? noPool : null;
    if (outcome)
      drafts.push({
        kind: "dhcp",
        ask: discover,
        at: applied >= 0 ? applied : ev.length - 1,
        device: client,
        question: `${name(client)} has no address yet and broadcasts a DHCP Discover. Will it get an address?`,
        right: outcome,
        wrong: [yes, noServer, noPool].filter((o) => o !== outcome),
        explain:
          applied >= 0 && offer >= 0
            ? `${name(ev[offer].actor)} answered with an Offer; ${name(client)} asked for it with a Request, the server confirmed with an ACK, and ${name(client)} applied the lease.`
            : (failure?.failure?.message ?? ""),
      });
  }

  // What a router does with a packet: the first one to reach a router, and the one that stopped the run there.
  const arrivals = [ev.findIndex((e) => !!e.packet?.startsWith("ip-") && !!e.hop && !!e.frame && kind(e.hop.to) === "router")];
  if (failure && kind(failure.actor) === "router")
    for (let h = ev.length - 1; h >= 0; h--)
      if (ev[h].packet?.startsWith("ip-") && ev[h].hop?.to === failure.actor && ev[h].frame) {
        arrivals.push(h);
        break;
      }
  for (const h of new Set(arrivals)) {
    if (h < 0) continue;
    const r = ev[h].hop!.to,
      p = ev[h].packet!,
      dest = String(field(ev[h], "IPv4 packet", "Destination IP"));
    const received = find(h, (e) => e.actor === r && e.packet === p && e.title === "Receive frame");
    const sent = find(h, (e) => e.packet === p && e.hop?.from === r);
    const route = find(h, (e) => e.actor === r && e.packet === p && e.title === "Choose a route");
    const kept = find(h, (e) => e.actor === r && e.packet === p && e.title === "Deliver IP payload");
    const stop = failure?.actor === r && ev.length - 1 > h ? ev.length - 1 : -1;
    const forward = `Forward it on towards ${dest}`,
      keep = `Keep it: the packet is addressed to ${name(r)}`,
      drop = `Drop it: it goes no further than ${name(r)}`;
    const outcome = sent >= 0 && route >= 0 ? [forward, route] : kept >= 0 ? [keep, kept] : stop >= 0 && sent < 0 ? [drop, stop] : null;
    if (received < 0 || !outcome) continue;
    const ttl = field(ev[route], "IPv4 packet", "TTL");
    drafts.push({
      kind: "router",
      ask: received,
      at: outcome[1] as number,
      device: r,
      question: `A packet for ${dest} has reached ${name(r)}, a router. What will ${name(r)} do with it?`,
      right: outcome[0] as string,
      wrong: [forward, keep, drop].filter((o) => o !== outcome[0]),
      explain:
        outcome[0] === forward
          ? `${dest} is not ${name(r)}'s own address, so it lowered the TTL to ${ttl} and chose the next hop ${addr(ev[route].facts?.["Next hop"])} (route "${ev[route].facts?.Route}").`
          : outcome[0] === keep
            ? `${dest} is ${name(r)}'s own address, so it delivered the packet to itself.`
            : (failure?.failure?.message ?? ""),
    });
  }

  // Whether NAT rewrites the source on the way out (or does not), and the destination on the way back.
  const lan = (r: string) => device(r)?.interfaces.find((q) => q.ip && isPrivate(q.ip))?.ip;
  const t = find(1, (e) => e.title === "Translate source with NAT");
  const leak = find(1, (e) => {
    const src = String(field(e, "IPv4 packet", "Source IP") ?? ""),
      dst = String(field(e, "IPv4 packet", "Destination IP") ?? "");
    return kind(e.actor) === "router" && e.hop?.from === e.actor && !!e.frame && !!src && !!dst && isPrivate(src) && !isPrivate(dst);
  });
  const out = t >= 0 ? t : leak;
  if (out >= 0) {
    const r = ev[out].actor,
      p = ev[out].packet;
    const before = String(field(ev[out - 1], "IPv4 packet", "Source IP")),
      after = String(field(ev[out], "IPv4 packet", "Source IP"));
    // Without a translation, ask before the router decides where the packet goes.
    const ask = t >= 0 ? t - 1 : find(0, (e) => e.actor === r && e.packet === p && e.title === "Choose a route");
    if (ev[out - 1]?.packet === p && field(ev[out - 1], "IPv4 packet", "Source IP") !== undefined)
      drafts.push({
        kind: "nat-out",
        ask,
        at: out,
        device: r,
        question: `${name(r)} is sending this packet from the home network out to the internet. What will its Source IP be when it leaves?`,
        right: after,
        wrong: [before, lan(r)],
        ips: true,
        whyNot:
          t >= 0
            ? {
                [before]: `${before} is the private source the packet arrived with. Private addresses are not routed on the internet, so ${name(r)} rewrites the source, not the destination, before the packet leaves.`,
                ...(lan(r) ? { [lan(r)!]: `${lan(r)} is ${name(r)}'s address on the home network. Replies from the internet must reach the router's public side, so that is the source it uses.` } : {}),
              }
            : undefined,
        explain:
          t >= 0
            ? `${name(r)} uses NAT: it replaced the private source ${ev[t].facts?.Inside} with its public address ${ev[t].facts?.Outside}, and remembers that mapping so the reply can find its way back.`
            : `${name(r)} did not translate it: the packet left with the private source ${before}. Private addresses are not routed on the internet, so a reply has no way back.`,
      });
  }
  const back = find(1, (e) => e.title === "Restore reply destination");
  if (back >= 0) {
    const r = ev[back].actor;
    const before = String(field(ev[back - 1], "IPv4 packet", "Destination IP")),
      after = String(field(ev[back], "IPv4 packet", "Destination IP"));
    if (ev[back - 1].packet === ev[back].packet)
      drafts.push({
        kind: "nat-in",
        ask: back - 1,
        at: back,
        device: r,
        question: `A reply addressed to ${before} has reached ${name(r)}. What destination will it have when ${name(r)} sends it into the home network?`,
        right: after,
        wrong: [before, lan(r)],
        ips: true,
        whyNot: {
          [before]: `${before} is ${name(r)}'s own public address, where the reply arrived. To pass it on to the device that asked, ${name(r)} uses its NAT mapping to rewrite the destination back to that device's private address.`,
        },
        explain: `${name(r)} found the NAT mapping it made for the outgoing packet (${ev[back].facts?.Outside} → ${ev[back].facts?.Inside}) and restored the private destination.`,
      });
  }

  // What a cumulative acknowledgement number says.
  const a = find(1, (e) => e.title === "Acknowledge received bytes");
  if (a >= 0) {
    const rv = ev[a].actor;
    let data = -1;
    for (let i = a - 1; i >= 0 && data < 0; i--) if (ev[i].actor === rv && ev[i].title === "Deliver IP payload" && Number(field(ev[i], "TCP segment", "Payload bytes"))) data = i;
    const ack = Number(field(ev[a], "TCP segment", "Acknowledgement")),
      seq = Number(field(ev[data], "TCP segment", "Sequence")),
      bytes = Number(field(ev[data], "TCP segment", "Payload bytes"));
    if (data >= 0 && ack)
      drafts.push({
        kind: "ack",
        ask: a - 1,
        at: a,
        device: rv,
        question: `${name(rv)} has received ${bytes} bytes starting at sequence number ${seq}. What acknowledgement number will it send back?`,
        right: String(ack),
        wrong: [String(seq), String(seq + bytes - 1), String(ack + 1)],
        whyNot: {
          [String(seq)]: `${seq} is the sequence number of the first byte that arrived. An acknowledgement names the next byte expected, here ${ack}, not the first one received.`,
          [String(seq + bytes - 1)]: `${seq + bytes - 1} is the last byte that arrived. An acknowledgement names the next byte expected, here ${ack}.`,
          [String(ack + 1)]: `One too many: ${ack - 1} is the last byte ${name(rv)} has, so the next byte it expects is ${ack}.`,
        },
        explain: `An acknowledgement number is the next byte expected. ${name(rv)} has every byte up to ${ack - 1}, so it sends ${ack}: one number that acknowledges all the bytes before it.`,
      });
  }

  // What TCP does after a segment is lost.
  const lost = find(0, (e) => e.title === "Drop TCP data segment");
  if (lost >= 0) {
    const sender = ev[lost].actor,
      seq = field(ev[lost], "TCP segment", "Sequence"),
      bytes = field(ev[lost], "TCP segment", "Payload bytes");
    const again = find(lost, (e) => e.actor === sender && e.title === "Retransmit TCP segment" && field(e, "TCP segment", "Sequence") === seq);
    if (again >= 0)
      drafts.push({
        kind: "loss",
        ask: lost,
        at: again,
        device: sender,
        question: `This segment, ${bytes} bytes starting at sequence ${seq}, was lost on the link. What happens next?`,
        right: `${name(sender)} sends the same ${bytes} bytes again, starting at sequence ${seq}`,
        wrong: [
          `${name(sender)} goes on with the next bytes and leaves a gap`,
          `The receiver asks for the missing bytes with a new request`,
          `The connection closes and the page fails to load`,
        ],
        explain: `The segment never arrived, so no acknowledgement covered its bytes. TCP sent the same bytes again with the same sequence number ${seq}; the receiver can only acknowledge bytes it actually has.`,
      });
  }

  const made = drafts.flatMap((x) => (x ? [make(labelled(x))] : [])).filter((c): c is Checkpoint => !!c);
  made.sort((x, y) => x.ask - y.ask || x.at - y.at);
  const kept: Checkpoint[] = [];
  for (const c of made) if (!kept.length || c.ask >= kept.at(-1)!.at) kept.push(c);
  return kept;
}

const cache = new WeakMap<Trace, Checkpoint[]>();
/** The checkpoints of a run, computed once per run. */
export function checkpointsFor(trace: Trace, network: Network) {
  if (!cache.has(trace)) cache.set(trace, checkpointsOf(trace, network));
  return cache.get(trace)!;
}
