import { ArrowRight } from "lucide-react";
import type { Activity } from "../learning/networking-path.ts";
import { locate, unitPath } from "../learning/tracks.ts";
import { linkProps } from "./router.ts";

const links = (list: Activity[]) => list.map((a, i) => <span key={a.id}>{i > 0 && ", "}<a {...linkProps(a.path)}>{a.title}</a></span>);

/**
 * The end of every step: what follows it in its track, the unit's practice after a learn step, and the way back
 * to the roadmap. It never reads progress: it only points the way, so nobody has to go back to Home.
 */
export function PathNext({ id }: { id: string }) {
  const at = locate(id);
  if (!at) return null;
  return (
    <nav className="path-next" aria-label="Next step">
      <p className="path-kind">{at.track.title} · Unit {at.stageNumber} of {at.track.stages.length} · {at.stage.title}</p>
      {at.role === "learn" && at.stage.practise.length > 0 && <p>Practise this unit: {links(at.stage.practise)}</p>}
      <div className="actions">
        {at.next ? (
          <a className="button primary" {...linkProps(at.next.path)}>Next: {at.next.title} <ArrowRight aria-hidden="true" /></a>
        ) : at.track.id === "networking" ? (
          <span>You've reached the end of the track. Master each mission, or build freely in the <a {...linkProps("/practice/network")}>Playground</a>.</span>
        ) : (
          <span>You've reached the end of the track. Master each mission, or read more in the <a {...linkProps("/learn/library")}>Library</a>.</span>
        )}
        <a className="text-button" {...linkProps(unitPath(at.track, at.stage))}>Back to the roadmap</a>
      </div>
    </nav>
  );
}

/** What the track does before this activity. Suggestions only: nothing is locked. */
export function PathNeeds({ id }: { id: string }) {
  const needs = locate(id)?.needs ?? [];
  return needs.length ? <p className="path-needs">Before you start: {links(needs)}</p> : null;
}
