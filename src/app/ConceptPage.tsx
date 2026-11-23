import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { chapters, type Chapter } from "../content/chapters.ts";
import { locate } from "../learning/tracks.ts";
import { missions } from "../learning/missions/catalog.ts";
import { conceptLearn, exploreFor, type ConceptLearn } from "../learning/concept-learn.ts";
import { isRecursion } from "../structures/experiments.ts";
import { LearningHeading } from "../ui/LearningHeading.tsx";
import { ReadingWalkthrough } from "../ui/ReadingWalkthrough.tsx";
import { ExploreLink } from "../ui/ExploreLink.tsx";
import { UnderstandingCheck } from "../ui/UnderstandingCheck.tsx";
import { visualizationForChapter } from "../visual-engine/lessons/curated-visualizations.ts";
import { linkProps } from "./router.ts";
import { PathNext } from "./NetworkingPath.tsx";

// Data-structures lessons add the structure guide (what and why, memory, C#/Java/Python, cost, choosing). Loaded only there.
const ConceptGuide = lazy(() => import("../structures/StructureGuide.tsx").then((m) => ({ default: m.ConceptGuide })));
// A demonstration runs the Playground's engine and scene: loaded only by the concepts that have one.
const LessonDemo = lazy(() => import("../ui/LessonDemo.tsx").then((m) => ({ default: m.LessonDemo })));
const RecursionDemo = lazy(() => import("../ui/RecursionDemo.tsx").then((m) => ({ default: m.RecursionDemo })));
const guideSlugs = new Set(["arrays", "linked-lists", "hash-tables", "trees", "recursion", "data-structures"]);

type Section = NonNullable<ConceptLearn["sections"]>[number];
function Explained({ section }: { section: Section }) {
  return (
    <section className="section concept-section">
      <h2>{section.heading}</h2>
      {section.body.map((p) => <p key={p}>{p}</p>)}
      {section.code && <pre className="concept-code"><code>{section.code}</code></pre>}
    </section>
  );
}

/**
 * One concept, to understand it (Learn). A data-structures concept shows one operation computed by the same engine as
 * the Playground, stepped with Previous and Next; the Playground, opened on that exact setup, owns everything else
 * (changing inputs, playback, memory tables, costs). Other concepts keep their reviewed, conceptual illustration.
 */
export function ConceptPage({ chapter }: { chapter: Chapter }) {
  const learn: ConceptLearn = conceptLearn[chapter.slug] ?? {};
  const explore = exploreFor(chapter.slug);
  const spec = useMemo(() => visualizationForChapter(chapter), [chapter]);
  const [index, setIndex] = useState(0);
  const related = missions.filter((mission) => mission.concept === chapter.slug);
  // Two other readings outside the tracks, starting with the same family.
  const more = chapters.filter((c) => c.slug !== chapter.slug && !locate(`concept:${c.slug}`)).sort((x, y) => Number(y.family === chapter.family) - Number(x.family === chapter.family)).slice(0, 2);
  useEffect(() => { document.title = `${chapter.title} · Kitab`; }, [chapter]);
  const sections = learn.sections ?? [];
  const before = sections.slice(0, learn.demoAfter ?? sections.length);
  const after = sections.slice(learn.demoAfter ?? sections.length);

  return (
    <div className="concept-page">
      <main id="main" className="page reading-page">
        <LearningHeading eyebrow={`${chapter.family} · Concept`} title={chapter.title} description={chapter.summary} review="reviewed" reviewDetail={learn.demo ? "computed by Kitab" : "illustrative"} />
        <p className="analogy"><b>Mental model.</b> {chapter.analogy}</p>

        {before.map((section) => <Explained key={section.heading} section={section} />)}
        {learn.demo && !learn.sections && (
          <section className="section" aria-labelledby="how-it-works">
            <h2 id="how-it-works">How it works</h2>
            <ol className="key-steps">{chapter.steps.map((step) => <li key={step.title}><b>{step.title}.</b> {step.detail}</li>)}</ol>
          </section>
        )}

        {learn.demo ? (
          <section className="section" aria-labelledby="see-it">
            <h2 id="see-it">{isRecursion(learn.demo) ? `Follow ${learn.demo.fn}(${learn.demo.n})` : "See it happen"}</h2>
            {/* The fallback keeps the demonstration's space, so the page doesn't jump when it arrives. */}
            <Suspense fallback={<div className="lesson-demo card demo-loading"><p className="muted">Loading the demonstration…</p></div>}>
              {isRecursion(learn.demo) ? <RecursionDemo setup={learn.demo} explore={explore} /> : <LessonDemo setup={learn.demo} explore={explore} />}
            </Suspense>
            <aside className="what-if">
              <h3>What if: {chapter.experiment.toLowerCase()}?</h3>
              <p>{chapter.changed}</p>
            </aside>
          </section>
        ) : (
          <section className="section" aria-labelledby="walkthrough">
            <h2 id="walkthrough">Walkthrough</h2>
            <p className="notice"><Info aria-hidden="true" /> A conceptual illustration, reviewed for accuracy: follow it one step at a time.{related.length ? " The missions below compute real examples." : ""}</p>
            <ReadingWalkthrough spec={spec} index={index} onChange={setIndex} />
            <aside className="what-if">
              <h3>What if: {chapter.experiment.toLowerCase()}?</h3>
              <p>{chapter.changed}</p>
              <p className="muted small">Described, not simulated.</p>
            </aside>
            {explore && <ExploreLink explore={explore} />}
          </section>
        )}

        {after.map((section) => <Explained key={section.heading} section={section} />)}

        {learn.misconception && (
          <section className="section misconception" aria-labelledby="misconception">
            <h2 id="misconception">A common misconception</h2>
            <p className="myth"><b>Myth:</b> {learn.misconception.myth}</p>
            <p><b>In fact:</b> {learn.misconception.truth}</p>
          </section>
        )}

        {learn.check && (
          <section className="section" aria-labelledby="check">
            <h2 id="check">Check your understanding</h2>
            <UnderstandingCheck check={learn.check} />
          </section>
        )}

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
          // The page's own Explore link already opens the Playground; the end of the page doesn't repeat it.
          <PathNext id={`concept:${chapter.slug}`} playground={!explore} />
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
