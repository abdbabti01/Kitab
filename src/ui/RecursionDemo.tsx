import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { recursionSteps, type ConceptLearn } from "../learning/concept-learn.ts";
import type { RecursionSetup } from "../structures/experiments.ts";
import { ExploreLink } from "./LessonDemo.tsx";

/**
 * The recursion lesson's one illustration: the call sequence of a fixed example, a call or a return per step, beside
 * the conceptual frames still waiting. Derived from the recursion engine, so it agrees with the Playground's run.
 */
export function RecursionDemo({ setup, explore }: { setup: RecursionSetup; explore?: ConceptLearn["explore"] }) {
  const steps = useMemo(() => recursionSteps(setup), [setup]);
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const last = steps.length - 1;
  return (
    <div className="lesson-demo recursion-demo card">
      <p className="demo-kind">Deterministic simulation · computed by Kitab's recursion engine</p>
      <div className="recursion-demo-body">
        <div>
          <h3 className="demo-label">Call sequence</h3>
          <ol className="call-sequence">
            {steps.map((s, i) => (
              <li key={s.id} style={{ paddingInlineStart: `${s.depth * 1.1}rem` }} className={i === index ? "is-current" : i < index ? "is-done" : "is-later"} aria-current={i === index ? "step" : undefined}>
                <code>{s.line}</code>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="demo-label">Call frames <small>(conceptual)</small></h3>
          <ol className="call-frames" aria-label={`Call frames after step ${index + 1}, top of the stack first`}>
            {step.frames.map((frame, i) => (
              <li key={`${frame.label}-${i}`} className={frame.current ? "is-current" : undefined}><b>{frame.label}</b><span>{frame.detail}</span></li>
            ))}
          </ol>
        </div>
      </div>
      <div className="demo-step" aria-live="polite">
        <p className="demo-count">Step {index + 1} of {steps.length}</p>
        <p>{step.explain}</p>
      </div>
      <div className="demo-controls" role="group" aria-label="Demonstration steps">
        <button type="button" className="button" onClick={() => setIndex(index - 1)} disabled={index === 0}><ChevronLeft aria-hidden="true" /> Previous</button>
        {index < last
          ? <button type="button" className="button primary" onClick={() => setIndex(index + 1)}>Next <ChevronRight aria-hidden="true" /></button>
          : <button type="button" className="button" onClick={() => setIndex(0)}><RotateCcw aria-hidden="true" /> Watch again</button>}
      </div>
      <p className="demo-note">Frames here are a teaching model: CPython, .NET and the JVM lay out their call stacks differently. What every runtime shares is the order: the last call made is the first to return.</p>
      {explore && <ExploreLink explore={explore} />}
    </div>
  );
}
