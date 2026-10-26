import { findMission } from "../learning/missions/catalog.ts";
import { PROGRESS_KEY, safeStorage } from "../learning/progress.ts";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { Home } from "./Home.tsx";
import { linkProps, useRoute } from "./router.ts";
import { chapters } from "../content/chapters.ts";

const MissionPage = lazy(() => import("../mission/MissionPage.tsx").then((module) => ({ default: module.MissionPage })));
const ConceptPage = lazy(() => import("./ConceptPage.tsx").then((module) => ({ default: module.ConceptPage })));
const DraftPage = lazy(() => import("./DraftPage.tsx").then((module) => ({ default: module.DraftPage })));

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
    const chapter = chapters.find((item) => item.slug === route.slug);
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
        <Suspense fallback={<main id="main" className="page" aria-busy="true"><p role="status">Opening…</p></main>}>{view}</Suspense>
      </ErrorBoundary>
    </>
  );
}
