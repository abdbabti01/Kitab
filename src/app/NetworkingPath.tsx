import { ArrowRight, Binary, FlaskConical, Waypoints } from "lucide-react";
import { cyclesFor } from "../learning/cycle-catalog.ts";
import type { Activity } from "../learning/networking-path.ts";
import { locate, unitPath } from "../learning/tracks.ts";
import { experimentForUnit, setupPath } from "../structures/experiments.ts";
import { linkProps } from "./router.ts";

const links = (list: Activity[]) => list.map((a, i) => <span key={a.id}>{i > 0 && ", "}<a {...linkProps(a.path)}>{a.title}</a></span>);

/**
 * The end of every step: what follows it in its track, the unit's practice after a learn step, and the way back
 * to the roadmap. It never reads progress: it only points the way, so nobody has to go back to Home.
 */
export function PathNext({ id }: { id: string }) {
  const at = locate(id);
  if (!at) return null;
  // Networking steps point to the Playground: this unit's starter network, or a free one.
  const starter = at.stage.learn.find((a) => a.id.startsWith("starter:"));
  const playground = at.track.id === "networking" && !id.startsWith("starter:") && at.next;
  // Data-structures steps open this unit's experiment, already set up, with a way back here.
  const experiment = at.track.id === "data-structures" ? experimentForUnit(at.stage.id) : undefined;
  // This unit's guided experiments (predict, then test), opened set up in the Playground, with a way back here.
  const predict = at.track.id === "data-structures" || at.track.id === "networking" ? cyclesFor(at.track.id, at.stage.id) : [];
  const back = (path: string) => (at.track.id === "data-structures" ? `${path}&from=${encodeURIComponent(window.location.pathname)}` : path);
  return (
    <nav className="path-next" aria-label="Next step">
      <p className="path-kind">{at.track.title} · Unit {at.stageNumber} of {at.track.stages.length} · {at.stage.title}</p>
      {at.role === "learn" && at.stage.practise.length > 0 && <p>Practise this unit: {links(at.stage.practise)}</p>}
      {playground && (
        <p className="path-playground">
          <Waypoints aria-hidden="true" />
          <span>Try it in the Playground: <a {...linkProps(starter?.path ?? "/practice/network")}>{starter ? `open “${starter.title}”` : "build your own network"}</a>, change one setting and send again.</span>
        </p>
      )}
      {experiment && (
        <p className="path-playground">
          <Binary aria-hidden="true" />
          <span>Try it in the Playground: <a {...linkProps(setupPath(experiment.setup, window.location.pathname))}>{experiment.title.toLowerCase()}</a>, then change the values and run it again.</span>
        </p>
      )}
      {predict.length > 0 && (
        <p className="path-playground">
          <FlaskConical aria-hidden="true" />
          <span>Predict, then test: {predict.map((c, i) => <span key={c.id}>{i > 0 && ", "}<a {...linkProps(back(c.path))}>{c.title}</a></span>)}. Commit to a prediction, run it, then explain what the run shows.</span>
        </p>
      )}
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
