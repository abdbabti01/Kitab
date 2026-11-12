// One panel beside the diagram (under it on a phone) for everything about the current step: Now (what is happening
// and why), Packet (what the message carries and what changed), Device (a device's role, state and settings), and
// every Step. Every view reads the one journey state; selecting the packet or a device opens its view.
import type { ReactNode, RefObject } from "react";
import { Flag, Layers, Monitor, PlayCircle, Settings2 } from "lucide-react";
import { DeviceInspector } from "./DeviceInspector.tsx";
import { PacketInspector, StateTables } from "./PacketInspector.tsx";
import { NowCard } from "./JourneyStage.tsx";
import type { Journey } from "./useJourney.ts";
import type { Device, Endpoint, Medium, Network } from "./network/model.ts";

export type InspectorTab = "mission" | "now" | "packet" | "device";
/** How the selected device may be changed. */
export type DeviceEditor = {
  onApply: (device: Device) => void;
  onDelete: (device: Device) => void;
  onConnect: (a: Endpoint, b: Endpoint, medium: Medium) => void;
  onDisconnect: (linkId: string) => void;
};

export function InspectorPanel({
  journey: j,
  network,
  selected,
  tab,
  onTab,
  editor,
  panelRef,
  mission,
  now,
  nowExtra,
}: {
  /** A mission page's own tab, shown first. */
  mission?: ReactNode;
  /** The Now tab, where the playground explains the current step (missions explain it under the diagram). */
  now?: { onAbout: (id: string) => void; onInspect: () => void };
  /** Shown at the top of Now, above the current step: what an open experiment shows (Break and compare). */
  nowExtra?: ReactNode;
  journey: Journey;
  network: Network;
  selected: string;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  editor: DeviceEditor;
  panelRef: RefObject<HTMLElement | null>;
}) {
  // The device chosen on the diagram, or else the one acting at this step.
  const device = network.devices.find((d) => d.id === (selected || j.event?.actor));
  const tabs: [InspectorTab, typeof Settings2, string][] = [
    ...(mission ? [["mission", Flag, "Mission"] as [InspectorTab, typeof Settings2, string]] : []),
    ...(now ? [["now", PlayCircle, "Now"] as [InspectorTab, typeof Settings2, string]] : []),
    ["packet", Layers, "Packet"],
    ["device", Settings2, "Device"],
  ];
  return (
    <aside ref={panelRef} className="network-inspector" aria-label="Network inspector">
      <div className="inspector-tabs">
        {tabs.map(([id, Icon, label]) => (
          <button key={id} className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => onTab(id)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {/* Now stays mounted while another view is shown, so what the learner opened in it stays open. */}
        {now && (
          <div hidden={tab !== "now"}>
            {nowExtra}
            {j.trace ? (
              <NowCard journey={j} network={network} onAbout={now.onAbout} onInspect={now.onInspect} />
            ) : (
              <div className="inspector-empty">
                <PlayCircle size={32} />
                <h2>Nothing is happening yet</h2>
                <p>Send something. This tab explains each step as it happens: which device acts, what it decides and why.</p>
              </div>
            )}
          </div>
        )}
        {tab === "mission" && mission ? (
          mission
        ) : tab === "now" ? null : tab === "device" ? (
          device ? (
            <DeviceInspector
              key={device.id}
              device={device}
              network={network}
              session={j.shownSession}
              events={j.trace?.events}
              index={j.index}
              onApply={editor.onApply}
              onDelete={() => editor.onDelete(device)}
              onConnect={editor.onConnect}
              onDisconnect={editor.onDisconnect}
              state={<StateTables network={network} session={j.shownSession} actor={device.id} embedded />}
            />
          ) : (
            <div className="inspector-empty">
              <Monitor size={32} />
              <h2>Select a device</h2>
              <p>Click a device on the canvas to see what it does, configure its interfaces and connect it to your network.</p>
            </div>
          )
        ) : (
          <PacketInspector events={j.trace?.events ?? []} index={j.index} network={network} onStep={j.step} />
        )}
      </div>
    </aside>
  );
}
