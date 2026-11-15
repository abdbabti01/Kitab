import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, Loader2, Search, Sparkles } from "lucide-react";
import { chapters, type Chapter } from "../content/chapters.ts";
import { missions } from "../learning/missions/catalog.ts";
import { kindOf, locate, tracks } from "../learning/tracks.ts";
import { api, ApiError } from "./api.ts";
import { linkProps, navigate } from "./router.ts";

type SavedConcept = { slug: string; title: string; category: string; source: "curated" | "ai"; status: string };

/** Where a reading sits: its unit in a track, or the missions that practise it. */
function placeOf(chapter: Chapter) {
  const at = locate(`concept:${chapter.slug}`);
  if (at) return `${at.track.title} · Unit ${at.stageNumber}`;
  const count = missions.filter((m) => m.concept === chapter.slug).length;
  return count ? `${count} mission${count === 1 ? "" : "s"} to practise` : "Illustrated walkthrough";
}

function ReadingList({ list }: { list: Chapter[] }) {
  return (
    <ul className="concept-list">
      {list.map((chapter) => (
        <li key={chapter.slug}>
          <a {...linkProps(`/concepts/${chapter.slug}`)}>
            <BookOpen aria-hidden="true" />
            <span><b>{chapter.title}</b><small>{chapter.family} · {placeOf(chapter)}</small></span>
            <ArrowRight aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Every reading, and one search across the tracks' lessons, readings, explorations and missions. When nothing
 * reviewed matches, Kitab can write a clearly labelled AI draft, as Home's search did before.
 */
export function Library() {
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<SavedConcept[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const clean = query.trim().toLowerCase();

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

  const inTracks = chapters.filter((c) => locate(`concept:${c.slug}`));
  const more = chapters.filter((c) => !locate(`concept:${c.slug}`));
  const activities = tracks.flatMap((track) => track.stages.flatMap((stage) => [...stage.learn, ...stage.practise]));
  const found = clean.length >= 2
    ? activities.filter((a) => `${a.title} ${a.detail} ${kindOf(a)}`.toLowerCase().includes(clean))
    : [];
  const foundReadings = clean.length >= 2 ? chapters.filter((c) => !locate(`concept:${c.slug}`) && `${c.title} ${c.family} ${c.summary}`.toLowerCase().includes(clean)) : [];
  const nothing = clean.length >= 2 && !found.length && !foundReadings.length && !saved.length && !searching;

  return (
    <div className="library">
      <form className="search" role="search" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="search-input" className="sr-only">Search lessons, readings and missions</label>
        <Search aria-hidden="true" />
        <input id="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lessons, readings and missions — subnet, TCP, arrays…" autoComplete="off" />
        {searching && <Loader2 className="spin" aria-label="Searching saved drafts" />}
      </form>

      {clean.length >= 2 ? (
        <section className="section" aria-labelledby="results-title">
          <h2 id="results-title">Results for “{query.trim()}”</h2>
          <p className="sr-only" role="status">{found.length + foundReadings.length + saved.length} results</p>
          {found.length > 0 && (
            <ul className="concept-list">
              {found.map((a) => {
                const at = locate(a.id)!;
                return (
                  <li key={a.id}>
                    <a {...linkProps(a.path)}>
                      <BookOpen aria-hidden="true" />
                      <span><b>{a.title}</b><small>{kindOf(a)} · {at.track.title} · Unit {at.stageNumber}</small></span>
                      <ArrowRight aria-hidden="true" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          {foundReadings.length > 0 && <ReadingList list={foundReadings} />}
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
          {nothing && (
            <div className="empty">
              <p>Nothing reviewed matches “{query.trim()}” yet. Kitab can write an AI draft: an explanation with an illustrative walkthrough, clearly labelled as unreviewed.</p>
              <button type="button" className="button primary" onClick={() => void createDraft()} disabled={creating}>
                {creating ? <><Loader2 className="spin" aria-hidden="true" /> Writing draft…</> : <>Create a draft about “{query.trim()}”</>}
              </button>
              {error && <p className="error-text" role="alert">{error}</p>}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="section" aria-labelledby="track-readings">
            <h2 id="track-readings">Readings in the tracks</h2>
            <p className="section-lead">Short illustrated walkthroughs that a unit uses before its missions.</p>
            <ReadingList list={inTracks} />
          </section>
          <section className="section" aria-labelledby="more-readings">
            <h2 id="more-readings">More readings</h2>
            <p className="section-lead">How other systems work, step by step. These are illustrations, not simulations; where a mission exists, it computes the real thing.</p>
            <ReadingList list={more} />
          </section>
        </>
      )}
    </div>
  );
}
