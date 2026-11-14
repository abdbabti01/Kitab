import { useEffect, useState, type ReactNode } from "react";
import { getEngine } from "../learning/registry.ts";
import { loadEngine, onDemandEngines } from "../learning/engines/browser.ts";
import { loadScene, sceneFor } from "./scenes/index.ts";

/**
 * Lessons and missions whose engine loads on demand (engines/browser.ts) wait here for the engine and its scene; every
 * other engine is already registered, so its page renders at once with no loading state.
 */
export function EngineGate({ engineId, title, children }: { engineId: string; title: string; children: () => ReactNode }) {
  const [state, setState] = useState<"ready" | "loading" | "failed">(() => (getEngine(engineId) && (sceneFor(engineId) || !onDemandEngines[engineId]) ? "ready" : "loading"));
  useEffect(() => {
    if (state !== "loading") return;
    // Pages are keyed by lesson or mission, so leaving one unmounts this; a late result is then ignored.
    let current = true;
    Promise.all([loadEngine(engineId), loadScene(engineId)]).then(
      () => current && setState("ready"),
      () => current && setState("failed"),
    );
    return () => {
      current = false;
    };
  }, [engineId, state]);
  if (state === "ready") return <>{children()}</>;
  if (state === "loading") return <main id="main" className="page" aria-busy="true"><p role="status" className="engine-loading">Opening {title}…</p></main>;
  return (
    <main id="main" className="page narrow">
      <div role="alert" className="engine-load-failed">
        <h1>{title} couldn't load</h1>
        <p>Part of this page didn't download. Check your connection and try again. Your saved progress is unchanged.</p>
      </div>
      <div className="actions">
        <button type="button" className="button primary" onClick={() => setState("loading")}>Try again</button>
        <a className="button" href="/">Back to Kitab</a>
      </div>
    </main>
  );
}
