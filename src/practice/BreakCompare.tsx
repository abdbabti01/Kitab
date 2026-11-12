// Break and compare (playground, loaded on demand): break one setting on a copy of the learner's network, run the
// same action on both with the real engine, and show where the runs first differ. The learner's network is never
// changed; the broken copy exists only while the experiment is open.
import { useEffect, useRef, useState } from "react";
import { findExperiments, type Experiment, type Found } from "./network/experiments.ts";
import type { Action, Network, Session, Trace } from "./network/model.ts";
import "./compare.css";

export type Side = "working" | "broken";

export default function BreakCompare({
  network,
  action,
  session,
  active,
  side,
  onStart,
  onShow,
  onRestore,
}: {
  network: Network;
  action: Action;
  session: Session;
  active: Experiment | null;
  side: Side;
  onStart: (x: Experiment) => void;
  /** Shows one run in the Journey at an event; `inspect` also opens its packet. */
  onShow: (side: Side, index: number, inspect: boolean) => void;
  onRestore: () => void;
}) {
  // Both runs of every candidate fault, computed once the request stops changing (not on every keystroke).
  // One engine run at a time, letting the browser handle input in between; a change of request cancels the search.
  const [found, setFound] = useState<{ for: unknown[]; result: Found } | null>(null);
  useEffect(() => {
    const steps = findExperiments(network, action, session);
    let t = setTimeout(function next() {
      const step = steps.next();
      if (step.done) setFound({ for: [network, action, session], result: step.value });
      else t = setTimeout(next);
    }, 150);
    return () => clearTimeout(t);
  }, [network, action, session]);
  const [choice, setChoice] = useState("");
  // Opening the panel, or starting or ending a comparison, replaces the controls that had the focus: move it to
  // the panel's heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const shownId = active?.fault.id ?? "";
  useEffect(() => heading.current?.focus(), [shownId]);
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
          Break one setting on a copy of your network, run {what} on both, and see exactly where the runs first differ. Your own network is not changed.
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

  const { fault, working, broken, divergence: d } = active;
  const run = (s: Side, t: Trace, at: number | undefined) => {
    const event = at === undefined ? undefined : t.events[at];
    return (
      <div className={`compare-run is-${s}${side === s ? " is-shown" : ""}`}>
        <h3>{s === "working" ? "Your network" : "With the fault"}</h3>
        <p className={`compare-outcome ${t.success ? "success" : "failure"}`}>
          <b>{t.success ? "Works." : "Stops."}</b> {t.success ? t.summary : t.failure?.device ? `Delivery stopped at ${name(t.failure.device)}.` : t.summary}
        </p>
        <p className="compare-count">{t.events.length} recorded events</p>
        {d && (
          <div className="compare-event">
            <span className="eyebrow">First difference · {name(d.device)}</span>
            <p>{event ? `Step ${at! + 1}: ${event.title}` : `${name(d.device)} records nothing further in this run.`}</p>
            <div className="compare-actions">
              <button className="text-button" onClick={() => onShow(s, at ?? t.events.length - 1, false)}>
                {event ? "Show it in the Journey" : "Show where this run ends"}
              </button>
              {event && event.layers.length > 0 && (
                <button className="text-button" onClick={() => onShow(s, at!, true)}>
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
    <section className="compare" aria-label="Break and compare">
      <h2 ref={heading} tabIndex={-1}>
        Break and compare
      </h2>
      <p className="compare-changed" role="status">
        <b>One change:</b> {fault.setting} on {name(fault.device)}, {fault.before} → {fault.after}. This copy is temporary; your network is unchanged.
      </p>
      <p className="compare-start">{startsFrom}</p>
      <div className="compare-grid">
        {run("working", working, d?.working)}
        {run("broken", broken, d?.broken)}
      </div>
      {d ? (
        <div className="compare-why">
          <h3>Where they part</h3>
          <p>
            Every device made the same decisions in both runs until {name(d.device)}
            {d.working !== undefined ? `, at step ${d.working + 1} of the working run` : ""}:
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">What</th>
                <th scope="col">Your network</th>
                <th scope="col">With the fault</th>
              </tr>
            </thead>
            <tbody>
              {d.differences.map((x) => (
                <tr key={x.what}>
                  <th scope="row">{x.what}</th>
                  <td>{x.what === "Sent to" ? name(x.working) : x.working}</td>
                  <td>{x.what === "Sent to" ? name(x.broken) : x.broken}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!broken.success && broken.failure && (
            <p>
              <b>Why it stops:</b> {broken.failure.message}
            </p>
          )}
        </div>
      ) : (
        <p className="compare-why">
          Kitab could not pin down a single first difference: every device recorded the same decisions in both runs, so only the two outcomes are compared.
        </p>
      )}
      <div className="compare-actions">
        <button className="button primary" onClick={onRestore}>
          Restore my network
        </button>
      </div>
    </section>
  );
}
