import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, Loader2, Search, Sparkles } from "lucide-react";
import { chapters } from "../content/chapters.ts";
import { missions } from "../learning/missions/catalog.ts";
import { loadProgress, missionStatus, safeStorage } from "../learning/progress.ts";
import { KitabAvatar } from "../mission/KitabAvatar.tsx";
import { api, ApiError } from "./api.ts";
import { linkProps, navigate } from "./router.ts";

type SavedConcept = { slug: string; title: string; category: string; source: "curated" | "ai"; status: string };

const statusLabel = { new: "New", visited: "Opened", practiced: "Practiced", mastered: "Mastered" } as const;

export function Home() {
  const progress = useMemo(() => loadProgress(safeStorage()).progress, []);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<SavedConcept[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const clean = query.trim().toLowerCase();

  useEffect(() => {
    document.title = "Kitab — learn by predicting, running and explaining";
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

  const featured = missions.find((mission) => missionStatus(progress, mission.id, mission.version) !== "mastered") ?? missions[0];
  const matchedMissions = missions.filter((mission) => !clean || `${mission.title} ${mission.topic} ${mission.summary} ${mission.concept}`.toLowerCase().includes(clean));
  const matchedChapters = chapters.filter((chapter) => !clean || `${chapter.title} ${chapter.family} ${chapter.summary}`.toLowerCase().includes(clean));
  const topics = [...new Set(matchedMissions.map((mission) => mission.topic))];

  async function createDraft(event?: FormEvent) {
    event?.preventDefault();
    if (query.trim().length < 2 || creating) return;
    setCreating(true);
    setError("");
    try {
      const draft = await api<{ slug: string }>("/api/concept", { method: "POST", body: JSON.stringify({ concept: query.trim() }), timeoutMs: 60_000 });
      navigate(`/drafts/${encodeURIComponent(draft.slug)}`, { draft });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The draft could not be created.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="home">
      <header className="topbar">
        <a className="brand" {...linkProps("/")}><KitabAvatar mood="idle" size={34} /><b>Kitab</b><span lang="ar">كتاب</span></a>
        <nav aria-label="Sections"><a href="#missions">Missions</a><a href="#concepts">Concepts</a></nav>
      </header>
      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Next mission · {featured.topic}</p>
            <h1 id="hero-title">{featured.title}</h1>
            <p className="lead">{featured.objective}</p>
            <div className="actions">
              <a className="button primary" {...linkProps(`/missions/${featured.id}`)}>Start mission <ArrowRight aria-hidden="true" /></a>
              <a className="button" href="#missions">Browse all missions</a>
            </div>
            <ol className="loop" aria-label="How a mission works">
              {["Inspect", "Predict", "Run", "Explain", "Retry"].map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}
            </ol>
          </div>
          <div className="hero-guide" aria-hidden="true">
            <KitabAvatar mood="welcoming" size={128} />
            <p>“Make a call before you watch. I'll show you exactly where the system agrees or disagrees with you.”</p>
          </div>
        </section>

        <form className="search" role="search" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="search-input" className="sr-only">Search missions and concepts</label>
          <Search aria-hidden="true" />
          <input id="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search missions and concepts — TCP, arrays, recursion…" autoComplete="off" />
          {searching && <Loader2 className="spin" aria-label="Searching saved drafts" />}
        </form>

        <section id="missions" className="section" aria-labelledby="missions-title">
          <h2 id="missions-title">Missions</h2>
          <p className="section-lead">Reviewed scenarios. Every number is computed by a deterministic engine; your prediction is checked against it.</p>
          {topics.length === 0 && <p className="muted">No mission matches “{query}”.</p>}
          {topics.map((topic) => (
            <div className="topic" key={topic}>
              <h3>{topic}</h3>
              <ul className="mission-grid">
                {matchedMissions.filter((mission) => mission.topic === topic).map((mission) => {
                  const status = missionStatus(progress, mission.id, mission.version);
                  return (
                    <li key={mission.id}>
                      <a className="mission-card" {...linkProps(`/missions/${mission.id}`)}>
                        <span className={`status-chip status-${status}`}>{statusLabel[status]}</span>
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
