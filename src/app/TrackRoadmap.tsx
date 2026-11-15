import { ArrowRight, Check, FlaskConical } from "lucide-react";
import { findLesson } from "../learning/lessons/catalog.ts";
import { lessonStatus } from "../learning/lessons/progress.ts";
import { activityState, isRequired, lastActive, stageProgress, type Activity, type Evidence } from "../learning/networking-path.ts";
import { practiceLabels } from "../learning/practice-state.ts";
import { kindOf, nextLink, recommendFor, trackProgress, type LearningTrack } from "../learning/tracks.ts";
import { linkProps } from "./router.ts";

/** "today", "yesterday", "3 days ago" — or nothing when the record has no usable date. */
function when(iso: string) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "";
  return days === 0 ? "today" : new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-days, "day");
}

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
  const activity = recommendation.kind === "done" ? null : recommendation.activity;
  const lesson = activity?.track === "lesson" ? findLesson(activity.id) : undefined;
  const steps = lesson ? lessonStatus(evidence.learning, lesson) : null;
  const last = activity ? when(lastActive(activity, evidence)) : "";
  const stage = recommendation.kind === "done" ? null : recommendation.stage;
  const resume = {
    start: "Start here",
    continue: "Continue where you left off",
    next: "Your next step",
    mastery: "Your next step",
    done: `You've mastered ${track.title}`,
  }[recommendation.kind];
  return (
    <section className="section networking-path track-roadmap" aria-labelledby="roadmap-title">
      {/* This subject's own progress and the exact place to resume it. */}
      <section className="path-head track-resume" aria-labelledby="resume-title">
        <div className="track-resume-copy">
          <p className="eyebrow" id="resume-title">{resume}</p>
          {activity ? (
            <>
              <h2 className="track-resume-title">{activity.title}</h2>
              <p className="continue-where">{stage && `Unit ${track.stages.indexOf(stage) + 1}: ${stage.title} · `}{kindOf(activity)}</p>
              <p className="continue-meta">
                {steps && steps.total > 0 && steps.state !== "completed" && steps.seen > 0 ? `${steps.seen} of ${steps.total} steps seen` : activity.detail}
                {last && ` · last opened ${last}`}
              </p>
              {steps && steps.total > 0 && steps.seen > 0 && <span className="unit-meter" aria-hidden="true"><i style={{ width: `${Math.round((steps.seen / steps.total) * 100)}%` }} /></span>}
            </>
          ) : (
            <h2 className="track-resume-title">Every mission mastered</h2>
          )}
        </div>
        <div className="actions">
          <a className="button primary" {...linkProps(next.path)}>{next.label} <ArrowRight aria-hidden="true" /></a>
          {networking && recommendation.kind !== "done" && <a className="button" {...linkProps("/practice/network")}>Build freely in the Playground</a>}
        </div>
      </section>
      <div className="track-meter">
        <span className="track-meter-bar" aria-hidden="true"><i style={{ width: `${totals.percent}%` }} /></span>
        <p>
          <b>{totals.completed} of {totals.total}</b> lessons and missions completed{totals.mastered ? ` · ${totals.mastered} mastered` : ""}. Explorations and readings are not scored.
        </p>
      </div>
      <h2 id="roadmap-title" className="roadmap-title">The roadmap</h2>
      <p className="section-lead">{track.stages.length} units. Each one teaches an idea, then lets you practise it. Follow them in order or start anywhere: nothing is locked.</p>
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
