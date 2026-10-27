import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { parseDraftContract, type DraftContract } from "../learning/draft-contract.ts";
import { normalizeVisualization } from "../visual-engine/core/visualization-spec.ts";
import { EngineCanvas } from "../visual-engine/engines/EngineCanvas.tsx";
import { FeedbackForm } from "../mission/FeedbackForm.tsx";
import { api, ApiError } from "./api.ts";
import { linkProps } from "./router.ts";

type Load = { status: "loading" } | { status: "ready"; draft: DraftContract } | { status: "error"; message: string; stale?: boolean };

function fromHistory(slug: string): DraftContract | null {
  const parsed = parseDraftContract((window.history.state as { draft?: unknown } | null)?.draft);
  return parsed.success && parsed.data.slug === slug ? parsed.data : null;
}

export function DraftPage({ slug }: { slug: string }) {
  const [load, setLoad] = useState<Load>(() => {
    const draft = fromHistory(slug);
    return draft ? { status: "ready", draft } : { status: "loading" };
  });
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (load.status !== "loading") return;
    const controller = new AbortController();
    api<unknown>(`/api/lessons/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then((data) => {
        const parsed = parseDraftContract(data);
        setLoad(parsed.success ? { status: "ready", draft: parsed.data } : { status: "error", message: "This draft uses an incompatible format and can't be shown." });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: error instanceof ApiError ? error.message : "The draft could not be loaded.", stale: error instanceof ApiError && error.code === "STALE_GENERATED_LESSON" });
      });
    return () => controller.abort();
  }, [slug, load.status]);

  const draft = load.status === "ready" ? load.draft : null;
  const spec = useMemo(() => (draft ? normalizeVisualization(draft.visualization, { title: draft.title, category: draft.category, trustedEngine: draft.visualization.engine }) : null), [draft]);
  useEffect(() => { if (draft) document.title = `${draft.title} (draft) · Kitab`; }, [draft]);

  return (
    <div className="concept-page">
      <header className="topbar">
        <a className="back" {...linkProps("/")}><ArrowLeft aria-hidden="true" /> <span>Kitab</span></a>
        <p className="crumb">AI draft</p>
        <p className="review-chip draft"><AlertTriangle aria-hidden="true" /> Draft — not reviewed</p>
      </header>
      <main id="main" className="page">
        {load.status === "loading" && <p role="status"><Loader2 className="spin inline-icon" aria-hidden="true" /> Loading draft…</p>}
        {load.status === "error" && (
          <div role="alert">
            <h1>Draft unavailable</h1>
            <p>{load.message}</p>
            {load.stale && <p>Search for the topic again on the home page to rebuild it.</p>}
            <a className="button" {...linkProps("/")}>Back to Kitab</a>
          </div>
        )}
        {draft && spec && (
          <>
            <p className="eyebrow">{draft.category}</p>
            <h1>{draft.title}</h1>
            <p className="notice warning"><AlertTriangle aria-hidden="true" /> Written by AI and checked only for structure and topic. Not reviewed by a person, and the walkthrough is illustrative — no engine computed it.</p>
            <p className="lead">{draft.summary}</p>
            <p className="analogy"><b>Mental model.</b> {draft.analogy}</p>
            <section className="section" aria-labelledby="draft-walkthrough">
              <h2 id="draft-walkthrough">Illustrative walkthrough</h2>
              <div className="card walkthrough">
                <p className="scene-step">Step {index + 1} of {spec.events.length}</p>
                <EngineCanvas spec={spec} eventIndex={index} />
                <div className="playback-row">
                  <button type="button" className="icon-button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} aria-label="Previous step"><ChevronLeft aria-hidden="true" /></button>
                  <label className="scrubber"><span className="sr-only">Walkthrough step</span><input type="range" min={0} max={spec.events.length - 1} value={index} onChange={(event) => setIndex(Number(event.target.value))} /></label>
                  <button type="button" className="icon-button" onClick={() => setIndex((value) => Math.min(spec.events.length - 1, value + 1))} disabled={index === spec.events.length - 1} aria-label="Next step"><ChevronRight aria-hidden="true" /></button>
                </div>
              </div>
              {draft.meta.versionId && <FeedbackForm target={{ kind: "draft", versionId: draft.meta.versionId, frameId: spec.events[index].id }} frameTitle={spec.events[index].label} />}
            </section>
            <section className="section reading">
              {draft.sections.map((section) => <article key={section.heading}><h2>{section.heading}</h2><p>{section.body}</p></article>)}
              <h2>Key terms</h2>
              <dl className="facts">{draft.terms.map((term) => <div key={term.term}><dt>{term.term}</dt><dd>{term.definition}</dd></div>)}</dl>
              <h2>Try it yourself</h2>
              <ol>{draft.tryIt.map((item) => <li key={item}>{item}</li>)}</ol>
              <p className="muted small">Draft version {draft.meta.contentVersion ?? "unsaved"}{draft.meta.model ? ` · ${draft.meta.model}` : ""}</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
