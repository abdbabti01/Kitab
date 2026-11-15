import { ArrowRight } from "lucide-react";
import { activityState, isRequired, networkingPath, stageProgress, type Activity, type Evidence, type Recommendation } from "../learning/networking-path.ts";
import { locate, unitPath } from "../learning/tracks.ts";
import { practiceLabels } from "../learning/practice-state.ts";
import { linkProps } from "./router.ts";

/** The recommended next step as a link, worded by how much the path actually knows. */
export function recommendationLink(r: Recommendation) {
  if (r.kind === "done") return { label: "Open the network playground", path: "/practice/network" };
  const label = {
    start: "Start the networking path",
    continue: `Continue: ${r.activity.title}`,
    next: `Next: ${r.activity.title}`,
    mastery: `Work towards mastery: ${r.activity.title}`,
  }[r.kind];
  return { label, path: r.activity.path };
}

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

function kindOf(a: Activity) {
  if (a.track === "lesson") return "Lesson";
  if (a.track) return "Mission";
  if (a.id.startsWith("starter:")) return "Playground";
  if (a.id.startsWith("concept:")) return "Concept";
  return a.id === "connections" || a.id === "subnet-explorer" ? "Explorer" : "Walkthrough";
}

function ActivityLink({ activity, evidence, next }: { activity: Activity; evidence: Evidence; next: boolean }) {
  // Explorations record visits only: they show "Opened" once visited and no chip before.
  const recorded = activityState(activity, evidence);
  const state = isRequired(activity) || recorded !== "not-started" ? recorded : null;
  return (
    <li>
      <a className={`path-activity${next ? " is-next" : ""}`} aria-current={next ? "step" : undefined} {...linkProps(activity.path)}>
        <span className="path-kind">{kindOf(activity)}{next && " · Next step"}</span>
        <b>{activity.title}</b>
        <small>{activity.detail}</small>
        {state && <span className={`status-chip status-${state}`}>{practiceLabels[state]}</span>}
      </a>
    </li>
  );
}

function Group({ title, list, evidence, nextId }: { title: string; list: Activity[]; evidence: Evidence; nextId: string }) {
  if (!list.length) return null;
  return (
    <>
      <h3>{title}</h3>
      <ul className="path-activities">
        {list.map((activity) => <ActivityLink key={activity.id} activity={activity} evidence={evidence} next={activity.id === nextId} />)}
      </ul>
    </>
  );
}

export function NetworkingPath({ evidence, recommendation }: { evidence: Evidence; recommendation: Recommendation }) {
  const next = recommendationLink(recommendation);
  const nextId = recommendation.kind === "done" ? "" : recommendation.activity.id;
  return (
    <section id="path" className="section networking-path" aria-labelledby="path-title">
      <div className="path-head">
        <div>
          <h2 id="path-title">Networking path</h2>
          <p className="section-lead">{networkingPath.length} stages, from the boxes in your home to TCP. Follow them in order or start anywhere: nothing is locked.</p>
        </div>
        <div className="actions">
          <a className="button primary" {...linkProps(next.path)}>{next.label} <ArrowRight aria-hidden="true" /></a>
          {/* When the path is done, the primary action already opens the playground. */}
          {recommendation.kind !== "done" && <a className="button" {...linkProps("/practice/network")}>Build freely in the playground</a>}
        </div>
      </div>
      {recommendation.kind === "done" && <p className="path-note">You've mastered every mission on the networking path. Keep experimenting in the playground.</p>}
      <ol className="path-stages">
        {networkingPath.map((stage, index) => {
          const progress = stageProgress(stage, evidence);
          return (
            <li key={stage.id}>
              <details open={stage.id === recommendation.stage.id && recommendation.kind !== "done"}>
                <summary>
                  <span className="path-number" aria-hidden="true">{index + 1}</span>
                  <span className="path-summary">
                    <b><span className="sr-only">Stage {index + 1}: </span>{stage.title}</b>
                    <small>
                      {progress.tracked
                        ? `${progress.completed} of ${progress.tracked} completed${progress.mastered ? ` · ${progress.mastered} mastered` : ""}`
                        : `Exploration · ${progress.explored} of ${progress.explorations} opened`}
                    </small>
                  </span>
                </summary>
                <p className="path-objective">{stage.objective}</p>
                <Group title="Learn and explore" list={stage.learn} evidence={evidence} nextId={nextId} />
                <Group title="Practise" list={stage.practise} evidence={evidence} nextId={nextId} />
              </details>
            </li>
          );
        })}
      </ol>
      <p className="path-foot"><a {...linkProps("/practice/missions")}>All networking and TCP missions in one list →</a></p>
    </section>
  );
}
