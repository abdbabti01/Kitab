// The lab's own network diagram, read-only, showing one event of a simulated run. Loaded only by Lesson 2's scene, so
// other lessons never download the diagram or the lab's styles.
import { useMemo } from "react";
import { NetworkCanvas } from "../../practice/NetworkCanvas.tsx";
import { motionAt } from "../../practice/network/motion.ts";
import { capsuleAt } from "../../practice/network/packets.ts";
import type { Network, TraceEvent } from "../../practice/network/model.ts";
import "../../practice/practice.css";

const ignore = () => {};

/** With `still`, the network is drawn as it is before the run: no event, no packet and nothing the run decided. */
export default function LocalDeliveryCanvas({ network, events, index, still = false, onSelect }: { network: Network; events: TraceEvent[]; index: number; still?: boolean; onSelect: (id: string) => void }) {
  const event = events[index];
  // The packet sits where this event leaves it; no animation, so the step reads the same with reduced motion.
  const motion = useMemo(() => ({ ...motionAt(events, index, network), ms: 0, capsule: capsuleAt(events, index) }), [events, index, network]);
  return (
    <div className="ld-canvas">
      <NetworkCanvas
        network={network}
        session={still ? events[0].snapshot : event.snapshot}
        event={still ? undefined : event}
        selected={event.actor}
        onSelect={onSelect}
        onMove={ignore}
        onAdd={ignore}
        // Follow the device handling the packet, so a phone's stacked diagram shows it.
        follow
        focus={still ? { devices: ["pc"], hops: [] } : { devices: [event.actor], hops: event.hop ? [event.hop] : [] }}
        motion={still ? undefined : motion}
      />
    </div>
  );
}
