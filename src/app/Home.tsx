import { useEffect, useMemo } from "react";
import { ArrowRight, Binary, Compass } from "lucide-react";
import { missions } from "../learning/missions/catalog.ts";
import { loadProgress, practiceState, safeStorage } from "../learning/progress.ts";
import { practiceLabels, type PracticeState } from "../learning/practice-state.ts";
import { journeys } from "../learning/lessons/catalog.ts";
import { lessonStatus, loadLearning } from "../learning/lessons/progress.ts";
import { findActivity, recommend } from "../learning/networking-path.ts";
import { loadMissionStore } from "../practice/network/mission-progress.ts";
import { loadVisits } from "../learning/visits.ts";
import { linkProps } from "./router.ts";
import { LibraryHero } from "./LibraryHero.tsx";
import { NetworkingPath, recommendationLink } from "./NetworkingPath.tsx";

const learningLabel = { new: "Not started", visited: "Opened", learning: "In progress", completed: "Walkthrough complete" } as const;

export function Home() {
  const progress = useMemo(() => loadProgress(safeStorage()).progress, []);
  const learning = useMemo(() => loadLearning(safeStorage()).learning, []);
  const evidence = useMemo(() => ({ learning, progress, network: loadMissionStore(safeStorage()), visits: loadVisits(safeStorage()) }), [learning, progress]);
  const recommendation = useMemo(() => recommend(evidence), [evidence]);
  useEffect(() => {
    document.title = "Kitab — see how systems work, then practise";
    const section = window.location.hash.slice(1);
    if (["path", "journeys", "missions", "concepts"].includes(section)) document.getElementById(section)?.scrollIntoView();
  }, []);

  // Networking content lives in the path; search is in the Library.
  const matchedMissions = missions.filter((mission) => !findActivity(mission.id));
  const otherJourneys = journeys.filter((journey) => !findActivity(journey.id));
  const topics = [...new Set(matchedMissions.map((mission) => mission.topic))];

  return (
    <div className="home">
      <main id="main">
        <LibraryHero next={recommendationLink(recommendation)} />

        <NetworkingPath evidence={evidence} recommendation={recommendation} />

        <section id="journeys" className="section" aria-labelledby="journeys-title">
          <h2 id="journeys-title">More learning journeys</h2>
          <p className="section-lead">Beyond networking: start from the basic parts and follow one concrete example, then practise.</p>
          <ul className="mission-grid journey-grid">
            {otherJourneys.map((lesson) => {
              const path = `/learn/${lesson.id}`;
              const walkthrough = "kind" in lesson;
              const status = walkthrough ? null : lessonStatus(learning, lesson);
              const practice = lesson.practice.map((item) => missions.find((mission) => mission.id === item.missionId)).filter((mission) => mission !== undefined);
              // The same four states as every mission card: all mastered, all completed, any started, or none.
              const states = practice.map((mission) => practiceState(progress, mission.id, mission.version));
              const overall: PracticeState = states.every((s) => s === "mastered") ? "mastered" : states.every((s) => s === "completed" || s === "mastered") ? "completed" : states.some((s) => s !== "not-started") ? "in-progress" : "not-started";
              const practiceLabel = `Practice: ${practiceLabels[overall].toLowerCase()}`;
              return (
                <li key={lesson.id}>
                  <a className="mission-card journey-card" {...linkProps(path)}>
                    {status ? <span className={`status-chip learning-${status.state}`}>{learningLabel[status.state]}{status.state === "learning" && status.total ? ` · ${status.seen}/${status.total}` : ""}</span> : <span className="status-chip">C# walkthrough</span>}
                    <b><Compass aria-hidden="true" className="inline-icon" /> {lesson.title}</b>
                    <span>{lesson.summary}</span>
                    <small>{lesson.topic} · {walkthrough ? `${lesson.steps} recorded steps` : `${lesson.chapters.length} chapters`}{practice.length > 0 && ` · ${practiceLabel}`}</small>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        <section id="missions" className="section" aria-labelledby="missions-title">
          <h2 id="missions-title">Practice missions</h2>
          <p className="section-lead">Networking and TCP missions are in the <a href="#path">networking path</a> above, or <a {...linkProps("/practice/missions")}>all in one list</a>.</p>
          <p className="section-lead">Predict, run and explain. Reviewed scenarios with a fresh setup each try; every number is computed by a deterministic engine and your prediction is checked against it.</p>
          <ul className="concept-list" aria-label="Practice tools">
            <li>
              <a {...linkProps("/practice/subnets")}>
                <Binary aria-hidden="true" />
                <span><b>Explore subnets</b><small>Any IPv4 address and prefix: its bits, its block, and predictions with feedback</small></span>
                <ArrowRight aria-hidden="true" />
              </a>
            </li>
          </ul>
          {topics.map((topic) => (
            <div className="topic" key={topic}>
              <h3>{topic}</h3>
              <ul className="mission-grid">
                {matchedMissions.filter((mission) => mission.topic === topic).map((mission) => {
                  // The same four states as the networking missions page.
                  const status = practiceState(progress, mission.id, mission.version);
                  return (
                    <li key={mission.id}>
                      <a className="mission-card" {...linkProps(`/missions/${mission.id}`)}>
                        <span className={`status-chip status-${status}`}>{practiceLabels[status]}</span>
                        <b>{mission.title}</b>
                        <span>{mission.summary}</span>
                        <small>{mission.learnerParams.length ? "Lab · configurable" : `${mission.variants.length} scenarios`} · {mission.review.status === "reviewed" ? "Reviewed" : "Draft"}</small>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

      </main>
      <footer className="footer"><p>Kitab · understand the mechanism, not just the definition.</p></footer>
    </div>
  );
}
