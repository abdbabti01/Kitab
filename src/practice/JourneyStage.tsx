// The diagram with Follow the Journey on it: canvas, controls, explanation card and view options.
// Shared by the playground and missions; it reads everything from one useJourney() state.
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { Globe2 } from "lucide-react";
import { NetworkCanvas } from "./NetworkCanvas.tsx";
import { JourneyCard, JourneyControls } from "./Journey.tsx";
import { DeviceCloseup } from "./PacketInspector.tsx";
import { motionAt } from "./network/motion.ts";
import type { Journey } from "./useJourney.ts";
import type { DeviceKind, Network } from "./network/model.ts";

// The sequence diagram is only downloaded when the learner picks the Exchange view.
const ExchangeView = lazy(() => import("./ExchangeView.tsx"));

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
  prompt,
  options,
}: {
  /** Shown under the controls, e.g. a prediction question. */
  prompt?: ReactNode;
  /** Extra view options, e.g. the Predict as you go switch. */
  options?: ReactNode;
  /** False in missions: failure advice is left for the learner to work out. */
  advice?: boolean;
  journey: Journey;
  network: Network;
  selected: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onAdd: (kind: DeviceKind, x?: number, y?: number) => void;
  /** The first-run button shown on the diagram before anything has been sent. */
  start?: { label: string; disabled: boolean; onClick: () => void };
  onAbout: (id: string) => void;
  /** Opens the Packet tab; `scroll` false keeps a narrow page where it is. */
  onInspect: (scroll?: boolean) => void;
}) {
  const [inside, setInside] = useState(false);
  // A hop takes most of its playback step, so the frame arrives before the next event is shown.
  const motion = useMemo(
    () => (j.trace ? { ...motionAt(j.trace.events, j.index, network), ms: Math.round(Math.max(120, (j.durations[j.index] ?? 1100) / j.speed) * 0.8) } : undefined),
    [j.trace, j.index, j.speed, j.durations, network],
  );
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
          motion={motion}
          onPacket={() => {
            j.setPlaying(false);
            onInspect(true);
          }}
        >
          {!j.trace && start && (
            <button
              className="button primary journey-start"
              disabled={start.disabled}
              onClick={() => {
                start.onClick();
                // This button goes once the run starts: the focus moves to Pause, so playback can be stopped at once.
                requestAnimationFrame(() => j.journeyRef.current?.querySelector<HTMLButtonElement>(".play-button")?.focus({ preventScroll: true }));
              }}
            >
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
          outcomeHidden={j.gated}
          outcomeShown={j.revealed}
        />
        {prompt}
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
            onInspect={() => onInspect(true)}
            onReadDetails={() => j.setPlaying(false)}
            advice={advice}
            beats={j.beats}
          />
        )}
        <p className="sr-only" aria-live="polite">
          {j.announcement}
        </p>
      </div>
      {/* Always mounted, so choosing Exchange (a transition) keeps the page as it is until the view has loaded. */}
      <Suspense fallback={<p className="exchange-loading">Loading the exchange…</p>}>
        {j.mode === "exchange" && j.trace && (
          <ExchangeView
            trace={j.trace}
            index={j.index}
            network={network}
            onSelect={(i) => {
              j.step(i);
              onInspect(false);
            }}
            onInspect={() => onInspect(true)}
            partial={j.gated}
          />
        )}
      </Suspense>
      <div className="view-options">
        {options}
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
