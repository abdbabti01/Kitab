import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import type { Chapter } from "../content/chapters.ts";
import { missions } from "../learning/missions/catalog.ts";
import { LearningHeading } from "../ui/LearningHeading.tsx";
import { ReadingWalkthrough } from "../ui/ReadingWalkthrough.tsx";
import { visualizationForChapter } from "../visual-engine/lessons/curated-visualizations.ts";
import { linkProps } from "./router.ts";
import { PathNext } from "./NetworkingPath.tsx";

/** Curated concept walkthrough. Honest label: it is illustrative unless a mission computes it. */
export function ConceptPage({ chapter }: { chapter: Chapter }) {
  const spec = useMemo(() => visualizationForChapter(chapter), [chapter]);
  const [index, setIndex] = useState(0);
  const related = missions.filter((mission) => mission.concept === chapter.slug);
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
        <PathNext id={`concept:${chapter.slug}`} />
      </main>
    </div>
  );
}
