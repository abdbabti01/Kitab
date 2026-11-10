import { ArrowRight } from "lucide-react";
import { activityState, networkingPath, stageProgress, type Activity, type Evidence, type Recommendation } from "../learning/networking-path.ts";
import { practiceLabels } from "../learning/practice-state.ts";
import { linkProps } from "./router.ts";

/** The recommended next step as a link, worded by how much the path actually knows. */
export function recommendationLink(r: Recommendation) {
  if (r.kind === "done") return { label: "Open the network playground", path: "/practice/network" };
  const label = {
    start: "Start the networking path",
    suggested: `Suggested next: ${r.activity.title}`,
    continue: `Continue: ${r.activity.title}`,
    next: `Next: ${r.activity.title}`,
    mastery: `Work towards mastery: ${r.activity.title}`,
  }[r.kind];
  return { label, path: r.activity.path };
}

function kindOf(a: Activity) {
  if (a.track === "lesson") return "Lesson";
  if (a.track) return "Mission";
  if (a.id.startsWith("starter:")) return "Playground";
  return a.id === "connections" ? "Explorer" : "Walkthrough";
}

function ActivityLink({ activity, evidence, next }: { activity: Activity; evidence: Evidence; next: boolean }) {
  const state = activityState(activity, evidence);
  return (
    <li>
      <a className={`path-activity${next ? " is-next" : ""}`} aria-current={next ? "step" : undefined} {...linkProps(activity.path)}>
        <span className="path-kind">{kindOf(activity)}{next && " · Next step"}</span>
        <b>{activity.title}</b>
        <small>{activity.detail}</small>
        {/* Only recorded progress is shown: explorations and the playground record none. */}
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
          <p className="section-lead">Five stages, from the boxes in your home to TCP. Follow them in order or start anywhere: nothing is locked.</p>
        </div>
        <div className="actions">
          <a className="button primary" {...linkProps(next.path)}>{next.label} <ArrowRight aria-hidden="true" /></a>
          <a className="button" {...linkProps("/practice/network")}>Build freely in the playground</a>
        </div>
      </div>
      {recommendation.kind === "suggested" && (
        <p className="path-note">Kitab doesn't record explorations or playground sessions, so this is a suggestion. If you've done it already, carry on with the next step.</p>
      )}
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
                        : "Exploration · progress not recorded"}
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
