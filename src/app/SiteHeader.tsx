import { BookOpen } from "lucide-react";
import { linkProps } from "./router.ts";
import type { Route } from "./routes.ts";

const sections = [
  { id: "path", label: "Learn", routes: ["lesson"] },
  { id: "missions", label: "Practice", routes: ["mission", "network-practice", "network-missions", "network-mission", "access-explorer", "subnet-explorer"] },
  { id: "concepts", label: "Concepts", routes: ["concept", "draft"] },
];

export function SiteHeader({ route }: { route: Route }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="brand" {...linkProps("/")}>
          <span className="brand-mark"><BookOpen aria-hidden="true" /></span>
          <b>Kitab</b><span className="brand-arabic" lang="ar" aria-hidden="true">كتاب</span>
        </a>
        <nav aria-label="Main navigation">
          {sections.map(({ id, label, routes }) => (
            <a key={id} href={`/#${id}`} aria-current={routes.includes(route.name) ? "true" : undefined}>{label}</a>
          ))}
        </nav>
      </div>
    </header>
  );
}
