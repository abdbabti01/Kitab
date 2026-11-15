import type { CSSProperties } from "react";
import { BookOpen } from "lucide-react";
import { linkProps } from "./router.ts";

export type Section = "learn" | "practice" | "playground";

const sections: { id: Section; label: string; path: string }[] = [
  { id: "learn", label: "Learn", path: "/learn" },
  { id: "practice", label: "Practice", path: "/practice" },
  { id: "playground", label: "Playground", path: "/practice/network" },
];

/** A returning learner's course progress and where to continue; absent for a first visit. */
export type HeaderProgress = { track: string; percent: number; label: string; path: string };

export function SiteHeader({ section, progress }: { section: Section | null; progress: HeaderProgress | null }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="brand" {...linkProps("/")}>
          <span className="brand-mark"><BookOpen aria-hidden="true" /></span>
          <b>Kitab</b><span className="brand-arabic" lang="ar" aria-hidden="true">كتاب</span>
        </a>
        <nav aria-label="Main navigation">
          {sections.map(({ id, label, path }) => (
            <a key={id} {...linkProps(path)} aria-current={section === id ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        {progress && (
          <a className="header-continue" {...linkProps(progress.path)}>
            <span className="progress-ring" style={{ "--done": `${progress.percent}%` } as CSSProperties} aria-hidden="true" />
            <span className="header-continue-text"><small>{progress.track} · {progress.percent}%<span className="sr-only"> complete</span></small>Continue<span className="sr-only">: {progress.label.replace(/^[^:]*: /, "")}</span></span>
          </a>
        )}
      </div>
    </header>
  );
}
