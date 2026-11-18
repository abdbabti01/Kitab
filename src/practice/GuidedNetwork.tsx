// A guided experiment inside the Network Playground (?experiment=<id>): the cycle's network is loaded as a practice
// copy, and the real run the cycle judged is played on the playground's own diagram and Journey.
import { useEffect, useRef } from "react";
import type { Cycle } from "../learning/cycle.ts";
import { CyclePanel, useCycle } from "../ui/PredictCycle.tsx";
import { networkFor, type NetRun, type NetSetup } from "./network/cycles.ts";
import type { Action, Network } from "./network/model.ts";

export function GuidedNetwork({ cycle, onTrial, onRun, onShow, onLock, onLeave }: {
  cycle: Cycle<NetSetup, NetRun>;
  /** Show this trial's network and traffic (before its prediction: nothing has run). */
  onTrial: (network: Network, action: Action) => void;
  /** Play the run the cycle judged. */
  onRun: (run: NetRun) => void;
  onShow: (event: number) => void;
  /** True while the prediction is not committed: the playground keeps Send for this network closed. */
  onLock: (locked: boolean) => void;
  onLeave: () => void;
}) {
  const c = useCycle(cycle);
  const arrived = useRef(true);
  useEffect(() => {
    // The playground opened on the first trial's network; any other trial (or a resumed one) is loaded here.
    if (arrived.current && c.trial.id === "base") return void (arrived.current = false);
    arrived.current = false;
    onTrial(networkFor(c.trial.setup), c.trial.setup.action);
  }, [c.trial.id, c.state.attempt]);
  useEffect(() => {
    if (c.run) onRun(c.run);
  }, [c.run]);
  useEffect(() => onLock(c.locked), [c.locked]);
  useEffect(() => () => onLock(false), []);
  return (
    <section className="lab-card guided-network" aria-label="Guided experiment">
      <div className="guided-banner">
        <p><b>Guided experiment.</b> A practice copy: your own network is not changed.</p>
        <button type="button" className="text-button" onClick={onLeave}>Leave and explore freely</button>
      </div>
      <CyclePanel c={c} onShow={onShow} />
    </section>
  );
}
