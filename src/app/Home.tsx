import { lazy, Suspense, useEffect } from "react";
import { ArrowRight, BookOpen, Check, FlaskConical, HelpCircle } from "lucide-react";
import { findLesson } from "../learning/lessons/catalog.ts";
import { lessonStatus } from "../learning/lessons/progress.ts";
import { activityState, lastActive, stageProgress, type Activity, type Evidence } from "../learning/networking-path.ts";
import { activeTrack, findTrack, hasHistory, kindOf, nextLink, recommendFor, trackProgress, tracks, unitPath, type LearningTrack } from "../learning/tracks.ts";
import { linkProps } from "./router.ts";

// The demonstration arrives just after the heading is painted; its place is held, so nothing moves when it arrives.
const HeroDemo = lazy(() => import("./HeroDemo.tsx").then((m) => ({ default: m.HeroDemo })));

const ways = [
  { Icon: BookOpen, title: "Learn", path: "/learn", link: "See the roadmap", text: "Lessons follow one concrete example, one step at a time. Nothing to get wrong: you read, watch and try." },
  { Icon: HelpCircle, title: "Practise", path: "/practice", link: "See the missions", text: "Missions ask you to predict what happens, or find what is broken. The simulator shows whether you were right." },
  { Icon: FlaskConical, title: "Experiment", path: "/practice/network", link: "Open the Playground", text: "The Playground is a free network you build yourself: add devices, send anything, break one setting and compare." },
];

/** "today", "yesterday", "3 days ago" — or nothing when the record has no usable date. */
function when(iso: string) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "";
  return days === 0 ? "today" : new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-days, "day");
}

function UnitStrip({ track, evidence, current }: { track: LearningTrack; evidence: Evidence | null; current?: string }) {
  return (
    <ol className="unit-strip">
      {track.stages.map((stage, index) => {
        const p = evidence ? stageProgress(stage, evidence) : null;
        const share = p ? (p.tracked ? p.completed / p.tracked : p.explorations ? p.explored / p.explorations : 0) : 0;
        const complete = share === 1;
        return (
          <li key={stage.id}>
            <a className={`unit-tile${stage.id === current ? " is-current" : ""}`} {...linkProps(unitPath(track, stage))} aria-current={stage.id === current ? "step" : undefined}>
              <span className={`path-number${complete ? " is-complete" : ""}`} aria-hidden="true">{complete ? <Check /> : index + 1}</span>
              <b><span className="sr-only">Unit {index + 1}: </span>{stage.title}</b>
              {p && (
                <>
                  <span className="unit-meter" aria-hidden="true"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
                  <small>{p.tracked ? `${p.completed} of ${p.tracked} done` : `${p.explored} of ${p.explorations} opened`}</small>
                </>
              )}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function FirstVisit() {
  const networking = findTrack("networking")!;
  const start = networking.stages[0].learn[0];
  return (
    <>
      <section className="hero journey-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Learn networking from zero</p>
          <h1 id="hero-title">See how the Internet works, one packet at a time.</h1>
          <p className="lead">
            Start with the Wi-Fi box in your home and finish by following a web page across the Internet. Short lessons explain one idea at a time, missions check what you understood, and a real simulator shows every step.
          </p>
          <div className="actions">
            <a className="button primary" {...linkProps(start.path)}>Start learning <ArrowRight aria-hidden="true" /></a>
            <a className="text-button" {...linkProps("/learn")}>See the full roadmap</a>
          </div>
          <p className="hero-facts">Unit 1: {networking.stages[0].title} · {networking.stages.length} units · free, no account · progress saved on this device</p>
        </div>
        <Suspense fallback={<div className="hero-demo is-loading" aria-hidden="true" />}>
          <HeroDemo />
        </Suspense>
      </section>

      <section className="section" aria-labelledby="how-title">
        <h2 id="how-title">How Kitab works</h2>
        <ol className="ways">
          {ways.map(({ Icon, title, text, path, link }, index) => (
            <li key={title}>
              <span className="way-number" aria-hidden="true">{index + 1}</span>
              <Icon aria-hidden="true" />
              <b>{title}</b>
              <span>{text}</span>
              <a className="text-button" {...linkProps(path)}>{link}</a>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" aria-labelledby="track-title">
        <div className="section-head">
          <h2 id="track-title">The networking track</h2>
          <a className="text-button" {...linkProps("/learn")}>Open the roadmap</a>
        </div>
        <p className="section-lead">{networking.summary} No networking knowledge needed: Unit 1 starts with the boxes in your home.</p>
        <UnitStrip track={networking} evidence={null} />
      </section>

      <OtherTracks except="networking" />
    </>
  );
}

function OtherTracks({ except, evidence }: { except: string; evidence?: Evidence }) {
  return (
    <section className="section" aria-labelledby="more-title">
      <h2 id="more-title">Also on Kitab</h2>
      <ul className="more-tracks">
        {tracks.filter((t) => t.id !== except).map((t) => {
          const p = evidence ? trackProgress(t, evidence) : null;
          return (
            <li key={t.id}>
              <a className="track-card" {...linkProps(t.path)}>
                <span className="eyebrow">Track · {t.stages.length} units</span>
                <b>{t.title}</b>
                <span>{t.summary}</span>
                {p?.started && <small>{p.completed} of {p.total} lessons and missions completed</small>}
              </a>
            </li>
          );
        })}
        <li>
          <a className="track-card" {...linkProps("/learn/library")}>
            <span className="eyebrow">Library</span>
            <b>Readings</b>
            <span>Short illustrated walkthroughs: DNS, web requests, databases, operating systems and more.</span>
          </a>
        </li>
      </ul>
    </section>
  );
}

function Returning({ evidence }: { evidence: Evidence }) {
  const track = activeTrack(evidence);
  const r = recommendFor(track, evidence);
  const next = nextLink(r, track);
  const totals = trackProgress(track, evidence);
  const activity: Activity | null = r.kind === "done" ? null : r.activity;
  const lesson = activity?.track === "lesson" ? findLesson(activity.id) : undefined;
  const steps = lesson ? lessonStatus(evidence.learning, lesson) : null;
  const unit = r.kind === "done" ? null : track.stages.indexOf(r.stage) + 1;
  const last = activity ? when(lastActive(activity, evidence)) : "";
  const ready = track.stages.flatMap((s) => s.practise).filter((a) => activityState(a, evidence) === "completed").slice(0, 3);
  const after = r.kind === "done" ? [] : [...r.stage.learn, ...r.stage.practise].filter((a) => a !== r.activity && activityState(a, evidence) !== "completed" && activityState(a, evidence) !== "mastered").slice(0, 2);
  return (
    <>
      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">Welcome back</p>
        <h1 id="welcome-title">{r.kind === "continue" ? "Continue where you left off" : r.kind === "done" ? `You've mastered ${track.title}` : "Your next step"}</h1>
        <div className="continue-card">
          {activity ? (
            <div>
              <p className="continue-where">{track.title} · Unit {unit}: {r.stage.title} · {kindOf(activity)}</p>
              <h2>{activity.title}</h2>
              <p className="continue-meta">
                {steps && steps.total > 0 && steps.state !== "completed" ? `${steps.seen} of ${steps.total} steps seen` : activity.detail}
                {last && ` · last opened ${last}`}
              </p>
              {steps && steps.total > 0 && <span className="unit-meter" aria-hidden="true"><i style={{ width: `${Math.round((steps.seen / steps.total) * 100)}%` }} /></span>}
            </div>
          ) : (
            <div>
              <h2>Every mission mastered</h2>
              <p className="continue-meta">Keep experimenting, or start the other track.</p>
            </div>
          )}
          <a className="button primary" {...linkProps(next.path)}>{r.kind === "continue" ? "Continue" : next.label.split(":")[0]}<span className="sr-only">: {activity?.title ?? next.label}</span> <ArrowRight aria-hidden="true" /></a>
        </div>
      </section>

      <div className="dashboard">
        <section className="dash-card" aria-labelledby="progress-title">
          <div className="section-head">
            <h2 id="progress-title">{track.title}</h2>
            <a className="text-button" {...linkProps(track.path)}>Roadmap</a>
          </div>
          <p className="dash-total"><b>{totals.percent}%</b> · {totals.completed} of {totals.total} lessons and missions completed{totals.mastered ? ` · ${totals.mastered} mastered` : ""}</p>
          <UnitStrip track={track} evidence={evidence} current={r.kind === "done" ? undefined : r.stage.id} />
        </section>
        <section className="dash-card" aria-labelledby="after-title">
          <h2 id="after-title">{r.kind === "done" ? "What now" : `Also in Unit ${unit}`}</h2>
          {after.length > 0 ? (
            <ul className="dash-list">
              {after.map((a) => (
                <li key={a.id}><a {...linkProps(a.path)}><span className="path-kind">{kindOf(a)}</span> {a.title}</a></li>
              ))}
            </ul>
          ) : (
            <p className="muted">{r.kind === "done" ? "Build your own network in the Playground, or browse the Library." : "This is the last step of the unit."}</p>
          )}
          {ready.length > 0 && (
            <>
              <h3>Ready to master</h3>
              <p className="muted small">Completed once. Solve another version to show mastery.</p>
              <ul className="dash-list">
                {ready.map((a) => (
                  <li key={a.id}><a {...linkProps(a.path)}><span className="path-kind">{kindOf(a)}</span> {a.title}</a></li>
                ))}
              </ul>
            </>
          )}
          <p className="dash-links">
            <a {...linkProps("/practice")}>All missions</a> · <a {...linkProps("/practice/network")}>Playground</a> · <a {...linkProps("/learn/library")}>Library</a>
          </p>
        </section>
      </div>
      <OtherTracks except={track.id} evidence={evidence} />
    </>
  );
}

/** Home: for a first visit, what Kitab teaches and where to start; for a returning learner, where to continue. */
export function Home({ evidence }: { evidence: Evidence }) {
  const returning = hasHistory(evidence);
  useEffect(() => {
    document.title = "Kitab — learn how networks work, from zero";
  }, []);
  return (
    <div className="home">
      <main id="main">{returning ? <Returning evidence={evidence} /> : <FirstVisit />}</main>
      <footer className="footer"><p>Kitab · understand the mechanism, not just the definition.</p></footer>
    </div>
  );
}
