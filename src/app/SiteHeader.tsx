import { BookOpen, Target, Waypoints } from "lucide-react";
import { PLAYGROUNDS_PATH } from "./playgrounds.ts";
import { linkProps } from "./router.ts";

export type Section = "learn" | "practice" | "playground";

const sections = [
  { id: "learn", label: "Learn", path: "/learn", Icon: BookOpen },
  { id: "practice", label: "Practice", path: "/practice", Icon: Target },
  { id: "playground", label: "Playground", path: PLAYGROUNDS_PATH, Icon: Waypoints },
] as const;

/** The site navigation. Progress is shown inside each subject (its Learn page), not here. */
export function SiteHeader({ section }: { section: Section | null }) {
  return (
    <header className="site-header lab-theme">
      <div className="site-header-inner">
        <a className="brand" {...linkProps("/")}>
          <span className="brand-mark"><BookOpen aria-hidden="true" /></span>
          <b>Kitab</b><span className="brand-arabic" lang="ar" aria-hidden="true">كتاب</span>
        </a>
        <nav aria-label="Main navigation">
          {sections.map(({ id, label, path, Icon }) => (
            <a key={id} className={id === "playground" ? "nav-playground" : undefined} {...linkProps(path)} aria-current={section === id ? "page" : undefined}>
              <Icon aria-hidden="true" />{label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
