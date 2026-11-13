// Break and compare (playground, loaded on demand): break one setting on a copy of the learner's network, run the
// same action on both with the real engine, and show where the runs first differ. The learner's network is never
// changed; the broken copy exists only while the experiment is open.
// The chooser and the two runs sit under the track; the explanation (cause and effect) is in the Now panel.
import { useEffect, useRef, useState } from "react";
import { aftermath, asData, findExperiments, type ExperimentData, type FoundData } from "./network/experiments.ts";
import type { Action, Network, Session, Trace } from "./network/model.ts";
import "./compare.css";

export type Side = "working" | "broken";
export const SIDE_LABEL: Record<Side, string> = { working: "Your network", broken: "With the fault" };

export default function BreakCompare({
  network,
  action,
  session,
  active,
  side,
  at,
  onStart,
  onShow,
  onRestore,
}: {
  network: Network;
  action: Action;
  session: Session;
  active: ExperimentData | null;
  side: Side;
  /** The event each run is at: each run keeps its own place, so an index of one is never used in the other. */
  at: Record<Side, number>;
  onStart: (x: ExperimentData) => void;
  /** Shows one run in the Journey at an event; `inspect` also opens its packet. */
  onShow: (side: Side, index: number, inspect: boolean) => void;
  onRestore: () => void;
}) {
  // Both runs of every candidate fault, computed once the request stops changing (not on every keystroke), in a
  // worker so the page never waits for the engine; a change of request ends the search. Without workers, one engine
  // run at a time on the page, letting the browser handle input in between.
  const [found, setFound] = useState<{ for: unknown[]; result: FoundData } | null>(null);
  useEffect(() => {
    const done = (result: FoundData) => setFound({ for: [network, action, session], result });
    let stop = () => {};
    const stepped = () => {
      const steps = findExperiments(network, action, session);
      let t = setTimeout(function next() {
        const step = steps.next();
        if (step.done) done({ working: step.value.working, experiments: step.value.experiments.map(asData) });
        else t = setTimeout(next);
      });
      return () => clearTimeout(t);
    };
    const wait = setTimeout(() => {
      if (typeof Worker === "undefined") return void (stop = stepped());
      const worker = new Worker(new URL("./compare.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<FoundData>) => {
        worker.terminate();
        done(e.data);
      };
      worker.onerror = () => {
        worker.terminate();
        stop = stepped();
      };
      worker.postMessage({ network, action, session });
      stop = () => worker.terminate();
    }, 150);
    return () => {
      clearTimeout(wait);
      stop();
    };
  }, [network, action, session]);
  const [choice, setChoice] = useState("");
  // Opening the panel, or starting or ending a comparison, replaces the controls that had the focus: move it to
  // the panel's heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const shownId = active?.fault.id ?? "";
  useEffect(() => heading.current?.focus({ preventScroll: !!active }), [shownId]);
  // What both runs start from: state kept from earlier runs, which can make a run shorter than a first one.
  const known = [
    [Object.keys(session.leases).length, "DHCP lease", "DHCP leases"],
    [Object.keys(session.arp).length, "ARP entry", "ARP entries"],
    [Object.keys(session.dns).length, "DNS answer", "DNS answers"],
  ]
    .filter(([count]) => count)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  const startsFrom = known.length
    ? `Both runs start from the simulator's current state, which already holds ${known.join(", ")} from earlier runs, so they can be shorter than a first run. Restart simulation (under the send form) empties it.`
    : "Both runs start from a fresh simulator state.";
  // Results for an earlier request are never offered.
  const current = found && found.for[0] === network && found.for[1] === action && found.for[2] === session ? found.result : null;
  const start = current?.working,
    offers = current?.experiments ?? [];
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const what = action.kind === "dhcp" ? "the DHCP request" : action.kind === "ping" ? `the ping to ${action.target}` : `the request for ${action.target}`;

  if (!active) {
    return (
      <section className="compare" aria-label="Break and compare">
        <h2 ref={heading} tabIndex={-1}>
          Break and compare
        </h2>
        <p className="compare-intro">
          Break one setting on a copy of your network, run {what} on both, and see where the runs first differ, what follows, and why the broken one fails. Your own network is not changed.
        </p>
        {!start ? (
          <p className="compare-empty" role="status">
            Finding settings that change this request…
          </p>
        ) : !offers.length ? (
          <p className="compare-empty" role="status">
            {start.success
              ? "None of the settings Kitab can break changes the outcome of this request, so there is nothing to compare. Try another request."
              : `Break and compare starts from something that works. This request stops: ${start.failure?.message ?? start.summary} Fix it first, or choose a request that succeeds.`}
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const x = offers.find((o) => o.fault.id === choice);
              if (x) onStart(x);
            }}
          >
            <fieldset>
              <legend>Choose one setting to break</legend>
              {offers.map((o) => (
                <label key={o.fault.id} className={`compare-option${choice === o.fault.id ? " is-chosen" : ""}`}>
                  <input type="radio" name="fault" value={o.fault.id} checked={choice === o.fault.id} onChange={() => setChoice(o.fault.id)} />
                  <span>
                    {o.fault.label}
                    <small>
                      {o.fault.setting}: {o.fault.before} → {o.fault.after}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <button type="submit" className="button primary" disabled={!choice}>
              Run both and compare
            </button>
          </form>
        )}
      </section>
    );
  }

  const { working, broken, divergence: d } = active;
  const run = (s: Side, t: Trace, first: number | undefined) => {
    const event = first === undefined ? undefined : t.events[first];
    return (
      <div className={`compare-run is-${s}${side === s ? " is-shown" : ""}`} aria-current={side === s ? "true" : undefined}>
        <h3>
          {SIDE_LABEL[s]}
          {side === s && <small> · shown now, step {at[s] + 1}</small>}
        </h3>
        <p className={`compare-outcome ${t.success ? "success" : "failure"}`}>
          <b>{t.success ? "Works." : "Stops."}</b> {t.success ? t.summary : t.failure?.device ? `Delivery stopped at ${name(t.failure.device)}.` : t.summary}
        </p>
        <p className="compare-count">{t.events.length} recorded events</p>
        {d && (
          <div className="compare-event">
            <span className="eyebrow">First difference · {name(d.device)}</span>
            <p>{event ? `Step ${first! + 1}: ${event.title}` : `${name(d.device)} records nothing further in this run.`}</p>
            <div className="compare-actions">
              <button className="text-button" onClick={() => onShow(s, first ?? t.events.length - 1, false)}>
                {event ? "Show it in the Journey" : "Show where this run ends"}
              </button>
              {event && event.layers.length > 0 && (
                <button className="text-button" onClick={() => onShow(s, first!, true)}>
                  Inspect its packet
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };
  return (
    <section className="compare is-active" aria-label="Break and compare">
      <h2 ref={heading} tabIndex={-1}>
        Break and compare
      </h2>
      <p className="compare-start">{startsFrom}</p>
      <div className="compare-grid">
        {run("working", working, d?.working)}
        {run("broken", broken, d?.broken)}
      </div>
      <p className="compare-more">What changed, where the runs part and why the broken one stops are explained in Now.</p>
      <div className="compare-actions">
        <button className="button primary" onClick={onRestore}>
          Restore my network
        </button>
      </div>
    </section>
  );
}

/**
 * The experiment explained in the Now panel, as cause and effect, every line read from the two recorded runs: the
 * one change, the devices it touches, where the runs first part, what the broken run does after that, why it stops,
 * and how to get the learner's network back.
 */
export function CompareNow({
  x,
  side,
  network,
  onShow,
  onRestore,
}: {
  x: ExperimentData;
  side: Side;
  network: Network;
  onShow: (side: Side, index: number, inspect: boolean) => void;
  onRestore: () => void;
}) {
  const { fault, working, broken, divergence: d } = x;
  const name = (id: string) => network.devices.find((v) => v.id === id)?.name ?? id;
  const list = (ids: string[]) => (ids.length < 2 ? ids.map(name).join("") : `${ids.slice(0, -1).map(name).join(", ")} and ${name(ids.at(-1)!)}`);
  const after = aftermath(x);
  return (
    <section className={`compare-now is-${side}`} aria-label="What the experiment shows">
      <span className="eyebrow">Break and compare · showing {SIDE_LABEL[side].toLowerCase()}</span>
      <h2>{fault.label}</h2>
      <ol className="compare-story">
        <li>
          <b>What changed.</b>{" "}
          {fault.kind === "cable" ? (
            <>
              The cable {fault.before}: <span className="compare-before">connected</span> → <span className="compare-after">unplugged</span>.
            </>
          ) : (
            <>
              {fault.setting} on {name(fault.device)}: <span className="compare-before">{fault.before}</span> → <span className="compare-after">{fault.after}</span>.
            </>
          )}{" "}
          Nothing else differs between the two copies.
        </li>
        <li>
          <b>Where.</b> {fault.devices.length > 1 ? `${list(fault.devices)}, the two ends of the link` : name(fault.device)}, marked on the diagram.
        </li>
        {d ? (
          <li>
            <b>Where the runs first part.</b> Every device made the same decisions in both runs until {name(d.device)}
            {d.working !== undefined && d.broken !== undefined
              ? `, at step ${d.working + 1} of your network and step ${d.broken + 1} with the fault`
              : d.working !== undefined
                ? `, at step ${d.working + 1} of your network; with the fault it records nothing more`
                : ""}
            .
            <table>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">{SIDE_LABEL.working}</th>
                  <th scope="col">{SIDE_LABEL.broken}</th>
                </tr>
              </thead>
              <tbody>
                {/* The engine's reason codes are left out here: "Why it fails" gives the reason in words. */}
                {d.differences.filter((v) => v.what !== "Reason").map((v) => (
                  <tr key={v.what}>
                    <th scope="row">{v.what}</th>
                    <td>{v.what === "Sent to" ? name(v.working) : v.working}</td>
                    <td>{v.what === "Sent to" ? name(v.broken) : v.broken}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="compare-actions">
              {d.working !== undefined && (
                <button className="text-button" onClick={() => onShow("working", d.working!, false)}>
                  Show it in your network
                </button>
              )}
              {d.broken !== undefined && (
                <button className="text-button" onClick={() => onShow("broken", d.broken!, false)}>
                  Show it with the fault
                </button>
              )}
            </span>
          </li>
        ) : (
          <li>
            <b>Where the runs first part.</b> Kitab could not pin down a single first difference: every device recorded the same decisions in both runs, so only the two outcomes are compared.
          </li>
        )}
        {after && (
          <li>
            <b>What happens next.</b>{" "}
            {after.steps
              ? `With the fault, the run records ${after.steps} more ${after.steps === 1 ? "step" : "steps"}${after.devices.length ? `, at ${list(after.devices)}` : ""}, and ends with “${after.last.title}” at ${name(after.last.actor)}.`
              : `With the fault, nothing more happens: that step is the run's last.`}
          </li>
        )}
        <li>
          <b>Why it {broken.success ? "still works" : "fails"}.</b> {broken.success ? broken.summary : (broken.failure?.message ?? broken.summary)}
          {d && after?.stopsAt && after.stopsAt !== d.device && (
            <>
              {" "}
              <span className="compare-apart">
                The runs part at {name(d.device)}, but the failure shows up later, at {name(after.stopsAt)}: the first difference is the cause, the stop is where it becomes visible.
              </span>
            </>
          )}{" "}
          {working.success && <>Your network: {working.summary}</>}
        </li>
        <li>
          <b>Getting it back.</b> Restore my network shows your own network again, unchanged, and puts you back where you were in its run.
          <span className="compare-actions">
            <button className="button primary" onClick={onRestore}>
              Restore my network
            </button>
          </span>
        </li>
      </ol>
    </section>
  );
}
