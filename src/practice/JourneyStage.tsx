// The diagram with Follow the Journey on it: canvas, controls, explanation card and view options.
// Shared by the playground and missions; it reads everything from one useJourney() state.
import { useState } from "react";
import { Globe2 } from "lucide-react";
import { NetworkCanvas } from "./NetworkCanvas.tsx";
import { JourneyCard, JourneyControls } from "./Journey.tsx";
import { DeviceCloseup } from "./PacketInspector.tsx";
import type { Journey } from "./useJourney.ts";
import type { DeviceKind, Network } from "./network/model.ts";

export function JourneyStage({
  journey: j,
  network,
  selected,
  onSelect,
  onMove,
  onAdd,
  start,
  onAbout,
  onInspect,
  advice = true,
}: {
  /** False in missions: failure advice is left for the learner to work out. */
  advice?: boolean;
  journey: Journey;
  network: Network;
  selected: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onAdd: (kind: DeviceKind, x: number, y: number) => void;
  /** The first-run button shown on the diagram before anything has been sent. */
  start?: { label: string; disabled: boolean; onClick: () => void };
  onAbout: (id: string) => void;
  onInspect: () => void;
}) {
  const [inside, setInside] = useState(false);
  return (
    <>
      <div className="journey-stage" ref={j.journeyRef}>
        <NetworkCanvas
          network={network}
          session={j.shownSession}
          event={j.event}
          focus={j.stage}
          onPositions={j.setLayout}
          selected={selected}
          onSelect={onSelect}
          onMove={onMove}
          onAdd={onAdd}
          follow={j.follow}
        >
          {!j.trace && start && (
            <button className="button primary journey-start" disabled={start.disabled} onClick={start.onClick}>
              {start.label}
            </button>
          )}
        </NetworkCanvas>
        <JourneyControls
          trace={j.trace}
          stages={j.stages}
          index={j.index}
          mode={j.mode}
          playing={j.playing}
          speed={j.speed}
          network={network}
          onStep={j.step}
          onPlay={j.play}
          onMode={j.chooseMode}
          onSpeed={j.setSpeed}
          onShowStop={j.showStop}
        />
        {j.trace && (
          <JourneyCard
            trace={j.trace}
            stages={j.stages}
            index={j.index}
            mode={j.mode}
            network={network}
            playing={j.playing}
            positions={j.positions}
            scale={j.scale}
            onAbout={(id) => {
              j.setPlaying(false);
              onAbout(id);
            }}
            open={j.cardOpen}
            onOpen={j.setCardOpen}
            onStep={j.step}
            onInspect={onInspect}
            onReadDetails={() => j.setPlaying(false)}
            advice={advice}
          />
        )}
        <p className="sr-only" aria-live="polite">
          {j.announcement}
        </p>
      </div>
      <div className="view-options">
        <label className="network-check">
          <input type="checkbox" checked={j.follow} onChange={(e) => j.setFollow(e.target.checked)} /> Zoom to the current stage
        </label>
        <label className="network-check">
          <input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} /> Look inside device
        </label>
        <span>
          <Globe2 size={13} /> Simulated network · no real traffic
        </span>
      </div>
      {inside && <DeviceCloseup event={j.event} network={network} />}
    </>
  );
}
