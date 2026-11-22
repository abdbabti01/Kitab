import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { chapters, type Chapter } from "../content/chapters.ts";
import { locate } from "../learning/tracks.ts";
import { missions } from "../learning/missions/catalog.ts";
import { LearningHeading } from "../ui/LearningHeading.tsx";
import { ReadingWalkthrough } from "../ui/ReadingWalkthrough.tsx";
import { visualizationForChapter } from "../visual-engine/lessons/curated-visualizations.ts";
import { linkProps } from "./router.ts";
import { PathNext } from "./NetworkingPath.tsx";

// Data-structures lessons add the structure guide (what and why, memory, C#/Java/Python, cost, choosing). Loaded only there.
const ConceptGuide = lazy(() => import("../structures/StructureGuide.tsx").then((m) => ({ default: m.ConceptGuide })));
const guideSlugs = new Set(["arrays", "linked-lists", "hash-tables", "trees", "recursion", "data-structures"]);

/** Curated concept walkthrough. Honest label: it is illustrative unless a mission computes it. */
export function ConceptPage({ chapter }: { chapter: Chapter }) {
  const spec = useMemo(() => visualizationForChapter(chapter), [chapter]);
  const [index, setIndex] = useState(0);
  const related = missions.filter((mission) => mission.concept === chapter.slug);
  // Two other readings outside the tracks, starting with the same family.
  const more = chapters.filter((c) => c.slug !== chapter.slug && !locate(`concept:${c.slug}`)).sort((x, y) => Number(y.family === chapter.family) - Number(x.family === chapter.family)).slice(0, 2);
  useEffect(() => { document.title = `${chapter.title} · Kitab`; }, [chapter]);

  return (
    <div className="concept-page">
      <main id="main" className="page reading-page">
        <LearningHeading eyebrow={`${chapter.family} · Concept`} title={chapter.title} description={chapter.summary} review="reviewed" reviewDetail="illustrative" />
        <p className="analogy"><b>Mental model.</b> {chapter.analogy}</p>

        <section className="section" aria-labelledby="walkthrough">
          <h2 id="walkthrough">Walkthrough</h2>
          <p className="notice"><Info aria-hidden="true" /> Follow a reviewed illustration one step at a time.{related.length ? " Use the missions below to practise with a computed example." : ""}</p>
          <ReadingWalkthrough spec={spec} index={index} onChange={setIndex} />
          <aside className="what-if">
            <h3>What if: {chapter.experiment.toLowerCase()}?</h3>
            <p>{chapter.changed}</p>
            <p className="muted small">Described, not simulated.</p>
          </aside>
        </section>

        {guideSlugs.has(chapter.slug) && (
          <section className="section" aria-labelledby="go-deeper">
            <h2 id="go-deeper">Go deeper</h2>
            <p className="muted">Memory, real-world use, code in C#, Java and Python, and what each operation costs. Optional: nothing here is required to finish the lesson.</p>
            <Suspense fallback={<p className="muted">Loading…</p>}><ConceptGuide slug={chapter.slug} /></Suspense>
          </section>
        )}

        {related.length > 0 && (
          <section className="section" aria-labelledby="practice">
            <h2 id="practice">Practice with a mission</h2>
            <ul className="mission-grid">
              {related.map((mission) => (
                <li key={mission.id}>
                  <a className="mission-card" {...linkProps(`/missions/${mission.id}`)}>
                    <b>{mission.title}</b>
                    <span>{mission.summary}</span>
                    <small>Computed by Kitab · reviewed <ArrowRight aria-hidden="true" className="inline-icon" /></small>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {locate(`concept:${chapter.slug}`) ? (
          <PathNext id={`concept:${chapter.slug}`} />
        ) : (
          <nav className="path-next" aria-label="Next step">
            <p className="path-kind">Library · {chapter.family}</p>
            {more.length > 0 && <p>More readings: {more.map((c, i) => <span key={c.slug}>{i > 0 && ", "}<a {...linkProps(`/concepts/${c.slug}`)}>{c.title}</a></span>)}</p>}
            <div className="actions">
              <a className="button primary" {...linkProps("/learn/library")}>Back to the Library <ArrowRight aria-hidden="true" /></a>
              <a className="text-button" {...linkProps("/learn")}>See the learning tracks</a>
            </div>
          </nav>
        )}
      </main>
    </div>
  );
}
