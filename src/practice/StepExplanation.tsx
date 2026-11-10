import type { Network, TraceEvent } from "./network/model.ts";
import { explainStep } from "./network/explanations.ts";
import { linkProps } from "../app/router.ts";

export function StepExplanation({
  event,
  network,
  onReadDetails,
}: {
  event: TraceEvent;
  network: Network;
  onReadDetails: () => void;
}) {
  const explanation = explainStep(event, network);
  const failure = explanation.failure;
  return (
    <section className="step-guide" aria-label="Understand this step">
      {failure && <h4 className="failure-title">{failure.title}</h4>}
      <h4>{failure ? "Why it stopped" : "Why this happens"}</h4>
      <p>{explanation.why}</p>
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
      {explanation.note && (
        <p className="step-note">
          {explanation.note.text}{" "}
          <a {...linkProps(explanation.note.href)}>{explanation.note.label}</a>
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
          <dd>{explanation.audience}</dd>
          <dt>Inside the message</dt>
          <dd className="step-message">{explanation.message}</dd>
          <dt>What happens next?</dt>
          <dd>{explanation.outcome}</dd>
          <dt>A little more detail</dt>
          <dd>{explanation.detail}</dd>
          {failure?.source && (
            <>
              <dt>Standard</dt>
              <dd>{failure.source}</dd>
            </>
          )}
        </dl>
      </details>
    </section>
  );
}
