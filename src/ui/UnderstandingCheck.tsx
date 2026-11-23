import { useId, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import type { UnderstandingCheck as Check } from "../learning/concept-learn.ts";

/** A one-question check with feedback for every option. Nothing is recorded: it is for the learner, not a score. */
export function UnderstandingCheck({ check }: { check: Check }) {
  const id = useId();
  const [choice, setChoice] = useState<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const picked = check.options.find((o) => o.id === checked);
  return (
    <form className="understanding-check card" onSubmit={(event) => { event.preventDefault(); setChecked(choice); }}>
      <fieldset>
        <legend>{check.question}</legend>
        {check.options.map((option) => (
          <label key={option.id} className={`choice ${choice === option.id ? "is-chosen" : ""}`}>
            <input type="radio" name={id} value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} />
            {option.text}
          </label>
        ))}
      </fieldset>
      <button type="submit" className="button" disabled={!choice}>Check my answer</button>
      <div role="status" className="check-feedback">
        {picked && (
          <p className={picked.correct ? "is-right" : "is-wrong"}>
            {picked.correct ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
            <span><b>{picked.correct ? "Correct." : "Not quite."}</b> {picked.feedback}</span>
          </p>
        )}
      </div>
    </form>
  );
}
