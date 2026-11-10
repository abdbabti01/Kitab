import type { Network, TraceEvent } from "./network/model.ts";
import { narrate } from "./network/narration.ts";
import { linkProps } from "../app/router.ts";

/** One event explained at three depths: what and why, the cause and rule, then the protocol detail. */
export function StepExplanation({
  events,
  index,
  network,
  onReadDetails,
  onGoto,
  embedded = false,
}: {
  events: TraceEvent[];
  index: number;
  network: Network;
  onReadDetails: () => void;
  onGoto: (index: number) => void;
  /** Inside the journey card, which already shows the title and summary. */
  embedded?: boolean;
}) {
  const n = narrate(events, index, network);
  const failure = n.failure;
  return (
    <section className="step-guide" aria-label="Understand this step">
      {!embedded && failure && <h4 className="failure-title">{failure.title}</h4>}
      {!embedded && <p className="step-summary">{failure ? events[index].explanation : n.summary}</p>}
      <h4>{failure ? "Why it stopped" : "Why this happens"}</h4>
      {n.cause && (
        <p className="step-cause">
          {n.cause.text}{" "}
          <button className="text-button" onClick={() => onGoto(n.cause!.index)}>
            Go to step {n.cause.index + 1}: {events[n.cause.index].title}
          </button>
        </p>
      )}
      <p>{n.why}</p>
      {failure && failure.chain.length > 1 && (
        <>
          <h4>Caused by</h4>
          <ol className="failure-chain" aria-label="What caused it">
            {failure.chain.slice(1).map((link, i) => (
              <li key={i}>
                <b>{link.title}</b> <span>at {link.device}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {failure && (
        <p className="failure-check">
          <b>Where to look:</b> {failure.check}
        </p>
      )}
      {n.note && (
        <p className="step-note">
          {n.note.text} <a {...linkProps(n.note.href)}>{n.note.label}</a>
        </p>
      )}
      <details
        onToggle={(e) => {
          if (e.currentTarget.open) onReadDetails();
        }}
      >
        <summary>Who receives it, and what happens next?</summary>
        <dl>
          <dt>Who is involved?</dt>
          <dd>{n.audience}</dd>
          <dt>Inside the message</dt>
          <dd className="step-message">{n.message}</dd>
          <dt>What happens next?</dt>
          <dd>{n.outcome}</dd>
          <dt>A little more detail</dt>
          <dd>{n.detail}</dd>
          {n.rule && (
            <>
              <dt>The rule</dt>
              <dd>
                {n.rule.text} <cite>{n.rule.source}</cite>
              </dd>
            </>
          )}
          {n.real && (
            <>
              <dt>In real networks</dt>
              <dd>{n.real}</dd>
            </>
          )}
          <dt>Simulator log</dt>
          <dd className="step-message">{events[index].explanation}</dd>
        </dl>
      </details>
    </section>
  );
}
