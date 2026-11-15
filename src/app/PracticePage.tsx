import { useEffect, useState } from "react";
import { Binary, FlaskConical, Router } from "lucide-react";
import { activityState, type Activity, type Evidence } from "../learning/networking-path.ts";
import { practiceLabels, type PracticeState } from "../learning/practice-state.ts";
import { kindOf, tracks, unitPath, type TrackId } from "../learning/tracks.ts";
import { linkProps } from "./router.ts";

type Filter = "all" | "to-do" | "in-progress" | "completed" | "mastered";
const filters: { id: Filter; label: string; matches: (state: PracticeState) => boolean }[] = [
  { id: "all", label: "All", matches: () => true },
  // An opened mission has not been started: it is still to do.
  { id: "to-do", label: "Not started", matches: (s) => s === "not-started" || s === "visited" },
  { id: "in-progress", label: "In progress", matches: (s) => s === "in-progress" },
  { id: "completed", label: "Completed, not mastered", matches: (s) => s === "completed" },
  { id: "mastered", label: "Mastered", matches: (s) => s === "mastered" },
];
const kinds = [
  { kind: "Predict", text: "Say what the simulation will do before it runs, then prove it from the evidence." },
  { kind: "Troubleshoot", text: "A network is broken. Investigate, name the cause, fix it and check." },
  { kind: "Challenge", text: "An open lab: change every setting and predict every result." },
];

function readQuery() {
  const query = new URLSearchParams(window.location.search);
  const status = filters.find((f) => f.id === query.get("status"))?.id ?? "all";
  const track = tracks.find((t) => t.id === query.get("track"))?.id ?? "all";
  return { status, track: track as TrackId | "all" };
}

function MissionCard({ activity, state, unit }: { activity: Activity; state: PracticeState; unit: string }) {
  const kind = kindOf(activity);
  return (
    <li>
      <a className="mission-card practice-card" {...linkProps(activity.path)}>
        <span className="practice-card-top">
          <span className={`practice-kind kind-${kind.toLowerCase()}`}>{kind}</span>
          <span className={`status-chip status-${state}`}>{practiceLabels[state]}</span>
        </span>
        <b>{activity.title}</b>
        <span>{activity.detail}</span>
        <small>{unit}</small>
      </a>
    </li>
  );
}

/** Every mission in one place, in the order of its track, with filters by state and track. */
export function PracticePage({ evidence }: { evidence: Evidence }) {
  const [{ status, track }, setQuery] = useState(readQuery);
  useEffect(() => {
    document.title = "Practice · Kitab";
  }, []);
  function choose(next: Partial<{ status: Filter; track: TrackId | "all" }>) {
    const value = { status, track, ...next };
    setQuery(value);
    const query = new URLSearchParams();
    if (value.status !== "all") query.set("status", value.status);
    if (value.track !== "all") query.set("track", value.track);
    // Shareable and kept on Back, without adding a history entry per click.
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query.toString() ? `?${query}` : ""}`);
  }
  const all = tracks.flatMap((t) => t.stages.flatMap((stage, index) => stage.practise.map((activity) => ({ track: t, stage, number: index + 1, activity, state: activityState(activity, evidence) }))));
  const inTrack = all.filter((m) => track === "all" || m.track.id === track);
  const matches = filters.find((f) => f.id === status)!.matches;
  const shown = inTrack.filter((m) => matches(m.state));
  return (
    <main id="main" className="page practice-page">
      <header className="learn-head">
        <p className="eyebrow">Practice</p>
        <h1>Missions</h1>
        <p className="section-lead">
          Missions check what you have learned. Each belongs to a unit of a track, and has several versions, so a retry brings a new setup. Your progress is saved on this device.
        </p>
      </header>
      <ul className="practice-kinds" aria-label="Kinds of mission">
        {kinds.map(({ kind, text }) => (
          <li key={kind}><span className={`practice-kind kind-${kind.toLowerCase()}`}>{kind}</span> {text}</li>
        ))}
      </ul>

      <div className="practice-filters">
        <div role="group" aria-label="Show missions by state">
          {filters.map((f) => (
            <button key={f.id} type="button" className="filter-chip" aria-pressed={status === f.id} onClick={() => choose({ status: f.id })}>
              {f.label} <span className="filter-count">{inTrack.filter((m) => f.matches(m.state)).length}</span>
            </button>
          ))}
        </div>
        <div role="group" aria-label="Show missions by track">
          {[{ id: "all" as const, title: "All tracks" }, ...tracks].map((t) => (
            <button key={t.id} type="button" className="filter-chip" aria-pressed={track === t.id} onClick={() => choose({ track: t.id })}>
              {t.title}
            </button>
          ))}
        </div>
      </div>
      <p className="sr-only" role="status">{shown.length} of {inTrack.length} missions shown</p>

      {shown.length === 0 && (
        <div className="empty">
          <p>No mission is {filters.find((f) => f.id === status)!.label.toLowerCase()} yet{track !== "all" ? " in this track" : ""}.</p>
          <button type="button" className="button" onClick={() => choose({ status: "all" })}>Show all missions</button>
        </div>
      )}

      {tracks.filter((t) => shown.some((m) => m.track === t)).map((t) => (
        <section key={t.id} className="section practice-track" aria-labelledby={`practice-${t.id}`}>
          <h2 id={`practice-${t.id}`}>{t.title}</h2>
          {t.stages.filter((stage) => shown.some((m) => m.stage === stage)).map((stage) => {
            const number = t.stages.indexOf(stage) + 1;
            const learnFirst = stage.learn.filter((a) => kindOf(a) === "Lesson" || kindOf(a) === "Reading");
            return (
              <div key={stage.id} className="practice-unit">
                <div className="practice-unit-head">
                  <h3>Unit {number} · {stage.title}</h3>
                  <p>
                    {learnFirst.length > 0 && <>Learn first: {learnFirst.map((a, i) => <span key={a.id}>{i > 0 && ", "}<a {...linkProps(a.path)}>{a.title}</a></span>)} · </>}
                    <a {...linkProps(unitPath(t, stage))}>Unit on the roadmap</a>
                  </p>
                </div>
                <ul className="mission-grid">
                  {shown.filter((m) => m.stage === stage).map((m) => (
                    <MissionCard key={m.activity.id} activity={m.activity} state={m.state} unit={`${t.title} · Unit ${number}`} />
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ))}

      <section className="section" aria-labelledby="tools-title">
        <h2 id="tools-title">Tools to practise with</h2>
        <p className="section-lead">Not scored: use them any time, before or after a mission.</p>
        <ul className="concept-list">
          <li><a {...linkProps("/practice/subnets")}><Binary aria-hidden="true" /><span><b>Explore subnets</b><small>Any IPv4 address and prefix: its bits, its block, and practice questions</small></span></a></li>
          <li><a {...linkProps("/practice/connections")}><Router aria-hidden="true" /><span><b>How your home connects</b><small>DSL, cable or fiber, Wi-Fi or Ethernet: follow one message</small></span></a></li>
          <li><a {...linkProps("/practice/network")}><FlaskConical aria-hidden="true" /><span><b>Playground</b><small>Build any network, send anything, break one setting and compare</small></span></a></li>
        </ul>
      </section>
    </main>
  );
}
