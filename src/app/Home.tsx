import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, Compass, Loader2, Search, Sparkles } from "lucide-react";
import { chapters } from "../content/chapters.ts";
import { missions } from "../learning/missions/catalog.ts";
import { loadProgress, practiceState, safeStorage } from "../learning/progress.ts";
import { practiceLabels, type PracticeState } from "../learning/practice-state.ts";
import { journeys } from "../learning/lessons/catalog.ts";
import { lessonStatus, loadLearning } from "../learning/lessons/progress.ts";
import { findActivity, recommend } from "../learning/networking-path.ts";
import { loadMissionStore } from "../practice/network/mission-progress.ts";
import { api, ApiError } from "./api.ts";
import { linkProps, navigate } from "./router.ts";
import { LibraryHero } from "./LibraryHero.tsx";
import { NetworkingPath, recommendationLink } from "./NetworkingPath.tsx";

type SavedConcept = { slug: string; title: string; category: string; source: "curated" | "ai"; status: string };

const learningLabel = { new: "Not started", visited: "Opened", learning: "In progress", completed: "Walkthrough complete" } as const;

export function Home() {
  const progress = useMemo(() => loadProgress(safeStorage()).progress, []);
  const learning = useMemo(() => loadLearning(safeStorage()).learning, []);
  const evidence = useMemo(() => ({ learning, progress, network: loadMissionStore(safeStorage()) }), [learning, progress]);
  const recommendation = useMemo(() => recommend(evidence), [evidence]);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<SavedConcept[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const clean = query.trim().toLowerCase();

  useEffect(() => {
    document.title = "Kitab — see how systems work, then practise";
    const section = window.location.hash.slice(1);
    if (["path", "journeys", "missions", "concepts"].includes(section)) document.getElementById(section)?.scrollIntoView();
  }, []);

  useEffect(() => {
    if (clean.length < 2) { setSaved([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api<{ concepts: SavedConcept[] }>(`/api/concepts?q=${encodeURIComponent(clean)}`, { signal: controller.signal, timeoutMs: 8_000 });
        setSaved(data.concepts.filter((item) => item.source === "ai"));
      } catch {
        setSaved([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [clean]);

  // Networking content lives in the path; search still finds every mission.
  const matchedMissions = missions.filter((mission) => (clean ? `${mission.title} ${mission.topic} ${mission.summary} ${mission.concept}`.toLowerCase().includes(clean) : !findActivity(mission.id)));
  const otherJourneys = journeys.filter((journey) => !findActivity(journey.id));
  const matchedChapters = chapters.filter((chapter) => !clean || `${chapter.title} ${chapter.family} ${chapter.summary}`.toLowerCase().includes(clean));
  const topics = [...new Set(matchedMissions.map((mission) => mission.topic))];

  async function createDraft(event?: FormEvent) {
    event?.preventDefault();
    if (query.trim().length < 2 || creating) return;
    setCreating(true);
    setError("");
    try {
      const draft = await api<{ slug: string }>("/api/concept", { method: "POST", body: JSON.stringify({ concept: query.trim() }), timeoutMs: 100_000 });
      navigate(`/drafts/${encodeURIComponent(draft.slug)}`, { draft });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The draft could not be created.");
    } finally {
      setCreating(false);
    }
  }

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

        <form className="search" role="search" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="search-input" className="sr-only">Search missions and concepts</label>
          <Search aria-hidden="true" />
          <input id="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search missions and concepts — TCP, arrays, recursion…" autoComplete="off" />
          {searching && <Loader2 className="spin" aria-label="Searching saved drafts" />}
        </form>

        <section id="missions" className="section" aria-labelledby="missions-title">
          <h2 id="missions-title">Practice missions</h2>
          <p className="section-lead">Networking and TCP missions are in the <a href="#path">networking path</a> above, or <a {...linkProps("/practice/missions")}>all in one list</a>.</p>
          <p className="section-lead">Predict, run and explain. Reviewed scenarios with a fresh setup each try; every number is computed by a deterministic engine and your prediction is checked against it.</p>
          {topics.length === 0 && <p className="muted">No mission matches “{query}”.</p>}
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

        <section id="concepts" className="section" aria-labelledby="concepts-title">
          <h2 id="concepts-title">Concepts</h2>
          <p className="section-lead">Short walkthroughs of how each system works. Walkthroughs without a mission are illustrative, not simulated.</p>
          <ul className="concept-list">
            {matchedChapters.map((chapter) => {
              const count = missions.filter((mission) => mission.concept === chapter.slug).length;
              return (
                <li key={chapter.slug}>
                  <a {...linkProps(`/concepts/${chapter.slug}`)}>
                    <BookOpen aria-hidden="true" />
                    <span><b>{chapter.title}</b><small>{chapter.family} · {count ? `${count} mission${count === 1 ? "" : "s"}` : "Illustrative walkthrough"}</small></span>
                    <ArrowRight aria-hidden="true" />
                  </a>
                </li>
              );
            })}
          </ul>
          {saved.length > 0 && (
            <>
              <h3>Saved AI drafts</h3>
              <ul className="concept-list">
                {saved.map((item) => (
                  <li key={item.slug}>
                    <a {...linkProps(`/drafts/${encodeURIComponent(item.slug)}`)}>
                      <Sparkles aria-hidden="true" />
                      <span><b>{item.title}</b><small>{item.category} · AI draft, not reviewed</small></span>
                      <ArrowRight aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {clean.length >= 2 && !matchedChapters.length && !matchedMissions.length && !searching && (
            <div className="empty">
              <p>Nothing reviewed matches “{query}” yet. Kitab can write an AI draft: an explanation with an illustrative walkthrough, clearly labelled as unreviewed.</p>
              <button type="button" className="button primary" onClick={() => void createDraft()} disabled={creating}>
                {creating ? <><Loader2 className="spin" aria-hidden="true" /> Writing draft…</> : <>Create a draft about “{query.trim()}”</>}
              </button>
              {error && <p className="error-text" role="alert">{error}</p>}
            </div>
          )}
        </section>
      </main>
      <footer className="footer"><p>Kitab · understand the mechanism, not just the definition.</p></footer>
    </div>
  );
}
