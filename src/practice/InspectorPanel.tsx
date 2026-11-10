// The inspector beside the diagram: the selected device, the current packet, state tables and every step.
import type { ReactNode, RefObject } from "react";
import { Flag, Layers, ListOrdered, Monitor, Server, Settings2 } from "lucide-react";
import { DeviceInspector } from "./DeviceInspector.tsx";
import { PacketInspector, StateTables } from "./PacketInspector.tsx";
import { StepsList } from "./Journey.tsx";
import type { Journey } from "./useJourney.ts";
import type { Device, Endpoint, Medium, Network } from "./network/model.ts";

export type InspectorTab = "mission" | "device" | "packet" | "tables" | "steps";
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
  onSelect,
  tab,
  onTab,
  editor,
  panelRef,
  mission,
}: {
  /** A mission page's own tab, shown first. */
  mission?: ReactNode;
  journey: Journey;
  network: Network;
  selected: string;
  onSelect: (id: string) => void;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  editor: DeviceEditor;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const device = network.devices.find((d) => d.id === selected);
  const tabs: [InspectorTab, typeof Settings2, string][] = [
    ...(mission ? [["mission", Flag, "Mission"] as [InspectorTab, typeof Settings2, string]] : []),
    ["device", Settings2, "Device"],
    ["packet", Layers, "Packet"],
    ["tables", Server, "Tables"],
    ["steps", ListOrdered, "Steps"],
  ];
  return (
    <aside ref={panelRef} className="network-inspector" aria-label="Network inspector">
      <div className="inspector-tabs">
        {tabs.map(([id, Icon, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => onTab(id)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {tab === "mission" && mission ? (
          mission
        ) : tab === "device" ? (
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
            />
          ) : (
            <div className="inspector-empty">
              <Monitor size={32} />
              <h2>Select a device</h2>
              <p>Click a device on the canvas to see what it does, configure its interfaces and connect it to your network.</p>
            </div>
          )
        ) : tab === "steps" ? (
          j.trace ? (
            <StepsList trace={j.trace} stages={j.stages} index={j.index} mode={j.mode} network={network} onStep={j.step} />
          ) : (
            <div className="inspector-empty">
              <ListOrdered size={32} />
              <h2>No journey yet</h2>
              <p>Send something. Every step it takes will be listed here.</p>
            </div>
          )
        ) : tab === "packet" ? (
          <PacketInspector events={j.trace?.events ?? []} index={j.index} network={network} onStep={j.step} />
        ) : (
          <>
            <label className="table-device-picker">
              Inspect device
              <select aria-label="Table device" value={selected || j.event?.actor || ""} onChange={(e) => onSelect(e.target.value)}>
                <option value="" disabled>
                  Choose a device
                </option>
                {network.devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <StateTables network={network} session={j.shownSession} actor={selected || j.event?.actor || ""} />
          </>
        )}
      </div>
    </aside>
  );
}
