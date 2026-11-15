import { ChevronLeft, ChevronRight } from "lucide-react";
import { chapters } from "../content/chapters.ts";
import { activityState, type Evidence } from "../learning/networking-path.ts";
import { practiceLabels } from "../learning/practice-state.ts";
import { kindOf, locate, unitPath } from "../learning/tracks.ts";
import { linkProps } from "./router.ts";

/**
 * Where the learner is in the course, on every page that is a step of a track: track, unit, step number and
 * the unit's steps at a glance, with the previous and next step. Readings outside a track show their place in
 * the Library instead.
 */
export function StepBar({ id, evidence }: { id: string; evidence: Evidence }) {
  const at = locate(id);
  if (!at) {
    const reading = id.startsWith("concept:") ? chapters.find((c) => `concept:${c.slug}` === id) : undefined;
    if (!reading) return null;
    return (
      <nav className="step-bar" aria-label="Where you are">
        <div className="step-bar-inner">
          <span className="step-crumbs">
            <a {...linkProps("/learn")}>Learn</a>
            <span aria-hidden="true">›</span>
            <a {...linkProps("/learn/library")}>Library</a>
            <span aria-hidden="true">›</span>
            <span aria-current="page">{reading.title}</span>
          </span>
        </div>
      </nav>
    );
  }
  const steps = [...at.stage.learn, ...at.stage.practise];
  return (
    <nav className="step-bar" aria-label="Where you are">
      <div className="step-bar-inner">
        <span className="step-crumbs">
          <a {...linkProps(at.track.path)}>{at.track.title}</a>
          <span aria-hidden="true">›</span>
          <a {...linkProps(unitPath(at.track, at.stage))}>Unit {at.stageNumber}: {at.stage.title}</a>
        </span>
        <span className="step-where">
          <span className="step-count">Step {at.stepNumber} of {at.stepCount} · {kindOf(at.activity)}</span>
          <span className="step-dots" aria-hidden="true">
            {steps.map((step) => (
              <i key={step.id} className={`is-${activityState(step, evidence)}${step === at.activity ? " is-here" : ""}`} title={`${step.title}: ${practiceLabels[activityState(step, evidence)]}`} />
            ))}
          </span>
        </span>
        <span className="step-moves">
          {at.previous && (
            <a className="step-move" {...linkProps(at.previous.path)}>
              <ChevronLeft aria-hidden="true" /> <span>Previous</span><span className="sr-only"> step: {at.previous.title}</span>
            </a>
          )}
          {at.next && (
            <a className="step-move" {...linkProps(at.next.path)}>
              <span>Next</span><span className="sr-only"> step: {at.next.title}</span> <ChevronRight aria-hidden="true" />
            </a>
          )}
        </span>
      </div>
    </nav>
  );
}
