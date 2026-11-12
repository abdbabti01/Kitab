// Predict as you go (playground only): the Journey stops before a decision, the learner predicts, then sees what
// the simulator did. Practice only: nothing is saved and nothing counts towards missions.
import { useEffect, useRef, useState } from "react";
import { checkpointsFor, type Checkpoint } from "./network/predict.ts";
import type { Journey } from "./useJourney.ts";
import type { Network, Trace } from "./network/model.ts";
import "./predict.css";

/** "shown": revealed without a prediction; "seen": already passed when predictions were turned on. */
type Picks = { trace: Trace | null; by: Record<string, string> };

export function usePredictions(network: Network) {
  const [on, setOn] = useState(false);
  const [picks, setPicks] = useState<Picks>({ trace: null, by: {} });
  // The checkpoint whose result is on screen, until the learner continues.
  const [result, setResult] = useState<string | null>(null);
  const answers = (t: Trace) => (picks.trace === t ? picks.by : {});
  /** Where the Journey must wait: the next checkpoint not yet answered. */
  const limit = on ? (t: Trace) => checkpointsFor(t, network).find((c) => !(c.id in answers(t)))?.ask : undefined;
  return { on, setOn, picks, setPicks, result, setResult, answers, limit };
}
export type Predictions = ReturnType<typeof usePredictions>;

/** The switch, shown with the view options. Turning it on mid-run asks only from the current step onwards. */
export function PredictSwitch({ predict: p, journey: j, network }: { predict: Predictions; journey: Journey; network: Network }) {
  return (
    <label className="network-check">
      <input
        type="checkbox"
        checked={p.on}
        onChange={(e) => {
          const t = j.fullTrace;
          if (e.target.checked && t) p.setPicks({ trace: t, by: Object.fromEntries(checkpointsFor(t, network).filter((c) => c.ask < j.index).map((c) => [c.id, "seen"])) });
          p.setResult(null);
          p.setOn(e.target.checked);
        }}
      />{" "}
      Predict as you go
    </label>
  );
}

export function PredictCard({ predict: p, journey: j, network }: { predict: Predictions; journey: Journey; network: Network }) {
  const t = j.fullTrace;
  const [choice, setChoice] = useState("");
  // Replaying a revealed outcome ("Watch it happen") stops when the outcome is reached.
  const [watching, setWatching] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const cs = p.on && t ? checkpointsFor(t, network) : [];
  const by = t ? p.answers(t) : {};
  const pending = cs.find((c) => !(c.id in by));
  const done = cs.find((c) => c.id === p.result && j.index >= c.ask && j.index <= c.at);
  const open = !done && pending && j.index === pending.ask ? pending : undefined;
  const shown = done ?? open;
  // A new question or result takes the focus, so keyboard and screen reader users land on it.
  const key = shown ? `${shown.id}:${done ? "result" : "ask"}` : "";
  useEffect(() => {
    if (!key) return;
    // Playback stops at the question (it cannot go further anyway).
    j.setPlaying(false);
    setChoice("");
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest(".predict-card")?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [key]);
  const reached = watching && !!done && j.index >= done.at;
  useEffect(() => {
    if (!reached) return;
    j.setPlaying(false);
    setWatching(false);
  }, [reached]);
  if (!p.on || !t) return null;
  if (!cs.length)
    return <p className="predict-note">This run has no decision to predict, so it plays as usual.</p>;
  if (!shown) return null;
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const number = cs.indexOf(shown) + 1;
  const text = (c: Checkpoint, id: string) => c.options.find((o) => o.id === id)?.text ?? "";

  function resolve(c: Checkpoint, pick: string) {
    p.setPicks({ trace: t, by: { ...by, [c.id]: pick } });
    p.setResult(c.id);
    // The outcome becomes visible with the answer; show the event that records it.
    j.step(c.at);
  }
  function again(c: Checkpoint) {
    const keep = Object.fromEntries(Object.entries(by).filter(([id]) => cs.findIndex((x) => x.id === id) < cs.indexOf(c)));
    p.setPicks({ trace: t, by: keep });
    p.setResult(null);
    j.step(c.ask);
  }
  function watch(c: Checkpoint) {
    // The result stays on screen while the Journey plays from the question to the outcome.
    j.step(c.ask);
    j.play();
    setWatching(true);
  }
  function next() {
    p.setResult(null);
    // Play on to the next question, unless it is asked right here.
    if (!(pending && pending.ask === j.index)) j.play();
  }

  if (done) {
    const pick = by[done.id];
    const verdict =
      pick === "shown" ? "Here is what happened." : pick === done.answer ? "Your prediction was right." : `Not quite. You predicted: ${text(done, pick)}.`;
    return (
      <section className={`predict-card is-result ${pick === done.answer ? "is-right" : pick === "shown" ? "" : "is-wrong"}`} aria-label="Prediction result">
        <span className="eyebrow">
          Prediction {number} of {cs.length} · at {name(done.device)}
        </span>
        <h2 ref={heading} tabIndex={-1}>
          {verdict}
        </h2>
        <p role="status">
          <b>What happened:</b> {text(done, done.answer)}.
        </p>
        {done.options.find((o) => o.id === pick)?.why && <p className="predict-miss">{done.options.find((o) => o.id === pick)!.why}</p>}
        <p className="predict-why">{done.explain}</p>
        <div className="predict-actions">
          <button className="button primary" onClick={next}>
            Continue
          </button>
          {done.at - done.ask > 1 && j.index === done.at && (
            <button className="text-button" onClick={() => watch(done)}>
              Watch it happen
            </button>
          )}
          <button className="text-button" onClick={() => again(done)}>
            Try this one again
          </button>
        </div>
      </section>
    );
  }
  const q = open!;
  return (
    <section className="predict-card" aria-label="Prediction">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (choice) resolve(q, choice);
        }}
      >
        <fieldset>
          <legend>
            <span className="eyebrow">
              Predict · {number} of {cs.length} · at {name(q.device)}
            </span>
            <h2 ref={heading} tabIndex={-1}>
              {q.question}
            </h2>
          </legend>
          {q.options.map((o) => (
            <label key={o.id} className={`predict-option${choice === o.id ? " is-chosen" : ""}`}>
              <input type="radio" name={`predict-${q.id}`} value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} />
              <span>{o.text}</span>
            </label>
          ))}
        </fieldset>
        <div className="predict-actions">
          <button type="submit" className="button primary" disabled={!choice}>
            Check my prediction
          </button>
          <button type="button" className="text-button" onClick={() => resolve(q, "shown")}>
            Show me
          </button>
        </div>
      </form>
    </section>
  );
}
