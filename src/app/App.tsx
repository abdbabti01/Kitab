import { findMission } from "../learning/missions/catalog.ts";
import { PROGRESS_KEY, safeStorage } from "../learning/progress.ts";
import { MissionPage } from "../mission/MissionPage.tsx";
import { ConceptPage } from "./ConceptPage.tsx";
import { DraftPage } from "./DraftPage.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { Home } from "./Home.tsx";
import { linkProps, useRoute } from "./router.ts";
import { findChapter } from "../content/chapters.ts";

function NotFound({ what }: { what: string }) {
  return (
    <main id="main" className="page narrow">
      <h1>Not found</h1>
      <p>Kitab couldn't find {what}.</p>
      <a className="button primary" {...linkProps("/")}>Back to Kitab</a>
    </main>
  );
}

export function App() {
  const route = useRoute();
  const key = JSON.stringify(route);
  let view;
  if (route.name === "home") view = <Home />;
  else if (route.name === "mission") {
    const mission = findMission(route.id);
    view = mission ? <MissionPage key={mission.id} mission={mission} /> : <NotFound what="that mission" />;
  } else if (route.name === "concept") {
    const chapter = findChapter(route.slug);
    view = chapter ? <ConceptPage key={chapter.slug} chapter={chapter} /> : <NotFound what="that concept" />;
  } else if (route.name === "draft") view = <DraftPage key={route.slug} slug={route.slug} />;
  else view = <NotFound what="this page" />;

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <ErrorBoundary
        resetKey={key}
        onReset={() => {
          // Reset only the current mission's in-progress attempt, keeping history.
          if (route.name !== "mission") return;
          try {
            const storage = safeStorage();
            const raw = JSON.parse(storage.getItem(PROGRESS_KEY) ?? "null");
            if (!raw?.missions?.[route.id]) return;
            raw.missions[route.id].current = null;
            storage.setItem(PROGRESS_KEY, JSON.stringify(raw));
          } catch {
            // nothing to reset
          }
        }}
      >
        {view}
      </ErrorBoundary>
    </>
  );
}
