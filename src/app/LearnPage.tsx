import { useEffect } from "react";
import type { Evidence } from "../learning/networking-path.ts";
import { findTrack } from "../learning/tracks.ts";
import { Library } from "./Library.tsx";
import type { LearnSection } from "./routes.ts";
import { linkProps } from "./router.ts";
import { TrackRoadmap } from "./TrackRoadmap.tsx";

const views: { id: LearnSection; label: string; path: string }[] = [
  { id: "networking", label: "Networking", path: "/learn" },
  { id: "data-structures", label: "Data structures & recursion", path: "/learn/data-structures" },
  { id: "system-design", label: "System design", path: "/learn/system-design" },
  { id: "library", label: "Library", path: "/learn/library" },
];

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
          {track ? track.summary : "Every reading in one place, and a search across lessons, readings and missions. Readings are short illustrated walkthroughs; missions compute the real thing."}
        </p>
      </header>
      <nav className="learn-tabs" aria-label="Tracks and Library">
        {views.map((view) => (
          <a key={view.id} {...linkProps(view.path)} aria-current={view.id === section ? "page" : undefined}>{view.label}</a>
        ))}
      </nav>
      {track ? <TrackRoadmap track={track} evidence={evidence} /> : <Library />}
    </main>
  );
}
