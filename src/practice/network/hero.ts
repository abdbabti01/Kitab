// The homepage's demonstration, read from a real run: the routed starter's ping, Your PC → Router → Office server.
// Only what the hero draws is kept, one entry per recorded link crossing, so the homepage loads a small JSON file
// (src/app/hero-trace.json) instead of the engine. The test re-runs the engine and compares, so the file cannot
// drift from what the simulator does; `npm run hero-trace` writes it again.
import { simulate, newSession } from "./engine.ts";
import { starter, starterOptions } from "./starters.ts";
import { stagesOf, stageAt } from "./stages.ts";
import { carrying } from "./track.ts";
import type { DeviceKind } from "./model.ts";

export type HeroTrace = {
  /** Where the recording comes from, as the learner can reproduce it in the lab. */
  source: { starter: string; action: string };
  devices: { id: string; name: string; kind: DeviceKind; ip: string }[];
  crossings: {
    /** The event in the full run (it has `events` events). */
    index: number;
    from: string;
    to: string;
    kind: "arp" | "ip";
    broadcast: boolean;
    /** "Ethernet frame carrying an ARP request", from the event's own layers. */
    what: string;
    /** The stage the crossing belongs to: "ARP · Your PC looks for 192.168.1.1". */
    stage: string;
  }[];
  events: number;
  summary: string;
};

export function heroTrace(): HeroTrace {
  const network = starter("routed");
  const action = starterOptions.find((s) => s.id === "routed")!.steps![0].action;
  const trace = simulate(network, newSession(), action);
  const stages = stagesOf(trace.events, network);
  const ids = [...new Set(trace.events.flatMap((e) => (e.hop ? [e.hop.from, e.hop.to] : [])))];
  return {
    source: { starter: "routed", action: `ping ${action.target} from ${network.devices.find((d) => d.id === action.source)!.name}` },
    devices: ids.map((id) => {
      const d = network.devices.find((x) => x.id === id)!;
      return { id, name: d.name, kind: d.kind, ip: d.interfaces.find((p) => p.ip)?.ip ?? "" };
    }),
    crossings: trace.events.flatMap((e, index) =>
      e.hop && e.packet
        ? [
            {
              index,
              from: e.hop.from,
              to: e.hop.to,
              kind: e.packet.startsWith("arp-") ? ("arp" as const) : ("ip" as const),
              broadcast: e.layers.find((l) => /frame$/.test(l.name))?.fields["Destination MAC"] === "ff:ff:ff:ff:ff:ff",
              what: carrying(e.layers),
              stage: stages[stageAt(stages, index)].title,
            },
          ]
        : [],
    ),
    events: trace.events.length,
    summary: trace.summary,
  };
}
