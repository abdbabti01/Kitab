import { ArrowRight, Check, FlaskConical } from "lucide-react";
import { activityState, isRequired, stageProgress, type Activity, type Evidence } from "../learning/networking-path.ts";
import { practiceLabels } from "../learning/practice-state.ts";
import { kindOf, nextLink, recommendFor, trackProgress, type LearningTrack } from "../learning/tracks.ts";
import { linkProps } from "./router.ts";

function Step({ activity, evidence, next }: { activity: Activity; evidence: Evidence; next: boolean }) {
  const state = activityState(activity, evidence);
  const required = isRequired(activity);
  return (
    <li>
      <a className={`path-activity${next ? " is-next" : ""}`} aria-current={next ? "step" : undefined} {...linkProps(activity.path)}>
        <span className="path-kind">
          {kindOf(activity)}
          {!required && " · not scored"}
          {next && " · Next step"}
        </span>
        <b>{activity.title}</b>
        <small>{activity.detail}</small>
        {/* Explorations show no chip until opened: there is nothing to complete. */}
        {(required || state !== "not-started") && <span className={`status-chip status-${state}`}>{practiceLabels[state]}</span>}
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
        {list.map((activity) => <Step key={activity.id} activity={activity} evidence={evidence} next={activity.id === nextId} />)}
      </ul>
    </>
  );
}

/**
 * A track's roadmap: its units in order, each with what it teaches, its lessons and explorations, then its
 * practice, with recorded states. The unit with the recommended step is open, or the unit a link points to.
 */
export function TrackRoadmap({ track, evidence }: { track: LearningTrack; evidence: Evidence }) {
  const recommendation = recommendFor(track, evidence);
  const next = nextLink(recommendation, track);
  const nextId = recommendation.kind === "done" ? "" : recommendation.activity.id;
  const totals = trackProgress(track, evidence);
  const linked = window.location.hash.startsWith("#unit-") ? window.location.hash.slice("#unit-".length) : "";
  const openId = linked || (recommendation.kind === "done" ? "" : recommendation.stage.id);
  const networking = track.id === "networking";
  return (
    <section className="section networking-path track-roadmap" aria-labelledby="roadmap-title">
      <div className="path-head">
        <div>
          <h2 id="roadmap-title">The roadmap</h2>
          <p className="section-lead">{track.stages.length} units. Each one teaches an idea, then lets you practise it. Follow them in order or start anywhere: nothing is locked.</p>
        </div>
        <div className="actions">
          <a className="button primary" {...linkProps(next.path)}>{next.label} <ArrowRight aria-hidden="true" /></a>
          {networking && recommendation.kind !== "done" && <a className="button" {...linkProps("/practice/network")}>Build freely in the Playground</a>}
        </div>
      </div>
      <div className="track-meter">
        <span className="track-meter-bar" aria-hidden="true"><i style={{ width: `${totals.percent}%` }} /></span>
        <p>
          <b>{totals.completed} of {totals.total}</b> lessons and missions completed{totals.mastered ? ` · ${totals.mastered} mastered` : ""}. Explorations and readings are not scored.
        </p>
      </div>
      {recommendation.kind === "done" && <p className="path-note">You've mastered every mission in this track. {networking ? "Keep experimenting in the Playground." : "Read further in the Library."}</p>}
      <ol className="path-stages">
        {track.stages.map((stage, index) => {
          const progress = stageProgress(stage, evidence);
          const complete = progress.tracked ? progress.completed === progress.tracked : progress.explored === progress.explorations;
          const starter = stage.learn.find((activity) => activity.id.startsWith("starter:"));
          return (
            <li key={stage.id} id={`unit-${stage.id}`}>
              <details open={stage.id === openId}>
                <summary>
                  <span className={`path-number${complete ? " is-complete" : ""}`} aria-hidden="true">{complete ? <Check /> : index + 1}</span>
                  <span className="path-summary">
                    <b><span className="sr-only">Unit {index + 1}: </span>{stage.title}{complete && <span className="sr-only"> (complete)</span>}</b>
                    <small>
                      {progress.tracked
                        ? `${progress.completed} of ${progress.tracked} completed${progress.mastered ? ` · ${progress.mastered} mastered` : ""}`
                        : `Exploration · ${progress.explored} of ${progress.explorations} opened`}
                    </small>
                  </span>
                </summary>
                <p className="path-objective"><b>You'll understand:</b> {stage.objective}</p>
                <Group title="Learn and explore" list={stage.learn} evidence={evidence} nextId={nextId} />
                <Group title="Practise" list={stage.practise} evidence={evidence} nextId={nextId} />
                {networking && (
                  <p className="unit-playground">
                    <FlaskConical aria-hidden="true" />
                    <span>
                      {starter ? (
                        <>Experiment freely: <a {...linkProps(starter.path)}>open “{starter.title}” in the Playground</a>, change one setting and send again.</>
                      ) : (
                        <>Experiment freely: <a {...linkProps("/practice/network")}>build your own network in the Playground</a>.</>
                      )}
                    </span>
                  </p>
                )}
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
