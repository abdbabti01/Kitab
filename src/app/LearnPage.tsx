import { useEffect } from "react";
import { ArrowRight, BookOpen } from "lucide-react";
import { chapters } from "../content/chapters.ts";
import type { Evidence } from "../learning/networking-path.ts";
import { findTrack, locate } from "../learning/tracks.ts";
import type { LearnSection } from "./routes.ts";
import { linkProps } from "./router.ts";
import { TrackRoadmap } from "./TrackRoadmap.tsx";

const views: { id: LearnSection; label: string; path: string }[] = [
  { id: "networking", label: "Networking", path: "/learn" },
  { id: "data-structures", label: "Data structures & recursion", path: "/learn/data-structures" },
  { id: "library", label: "Library", path: "/learn/library" },
];

/** Every reading, with its place in a track when it has one. */
function Readings() {
  return (
    <section className="section" aria-labelledby="readings-title">
      <h2 id="readings-title">Readings</h2>
      <p className="section-lead">Short illustrated walkthroughs of how each system works.</p>
      <ul className="concept-list">
        {chapters.map((chapter) => {
          const at = locate(`concept:${chapter.slug}`);
          return (
            <li key={chapter.slug}>
              <a {...linkProps(`/concepts/${chapter.slug}`)}>
                <BookOpen aria-hidden="true" />
                <span><b>{chapter.title}</b><small>{chapter.family}{at ? ` · ${at.track.title} · Unit ${at.stageNumber}` : ""}</small></span>
                <ArrowRight aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Learn: each track's roadmap of units, and the Library of readings. */
export function LearnPage({ section, evidence }: { section: LearnSection; evidence: Evidence }) {
  const track = section === "library" ? undefined : findTrack(section);
  useEffect(() => {
    document.title = `${track ? track.title : "Library"} · Learn · Kitab`;
  }, [track]);
  // A link to one unit (/learn#unit-routing) opens that unit; bring it into view once it is rendered.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView();
  }, [section]);
  return (
    <main id="main" className="page learn-page">
      <header className="learn-head">
        <p className="eyebrow">Learn</p>
        <h1>{track ? track.title : "Library"}</h1>
        <p className="section-lead">
          {track ? track.summary : "Every reading in one place: the ones the tracks use, and more on how other systems work."}
        </p>
      </header>
      <nav className="learn-tabs" aria-label="Tracks and Library">
        {views.map((view) => (
          <a key={view.id} {...linkProps(view.path)} aria-current={view.id === section ? "page" : undefined}>{view.label}</a>
        ))}
      </nav>
      {track ? <TrackRoadmap track={track} evidence={evidence} /> : <Readings />}
    </main>
  );
}
