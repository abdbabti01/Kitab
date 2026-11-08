import type { Network, TraceEvent } from "./network/model.ts";
import { explainStep } from "./network/explanations.ts";

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
  return (
    <section className="step-guide" aria-label="Understand this step">
      <h4>Why this happens</h4>
      <p>{explanation.why}</p>
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
        </dl>
      </details>
    </section>
  );
}
