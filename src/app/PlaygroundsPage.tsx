import { useEffect } from "react";
import { ArrowRight, FlaskConical } from "lucide-react";
import { findTrack } from "../learning/tracks.ts";
import { experiments, setupPath } from "../structures/experiments.ts";
import { playgrounds, type PlaygroundId } from "./playgrounds.ts";
import { linkProps } from "./router.ts";

type Example = { title: string; path: string };

const starters = findTrack("networking")!.stages.flatMap((stage) => stage.learn).filter((a) => a.id.startsWith("starter:"));

/** A few real starting points per Playground: each link opens that tool already set up. */
const examples: Record<PlaygroundId, Example[]> = {
  network: starters.slice(0, 4).map((s) => ({ title: s.title, path: s.path })),
  structures: ["array-insert-middle", "list-insert-head", "hash-collision", "recursion-no-base"].map((id) => {
    const experiment = experiments.find((e) => e.id === id)!;
    return { title: experiment.title, path: setupPath(experiment.setup) };
  }),
  architecture: [
    { title: "Client, API, database", path: "/practice/architecture?template=three-tier" },
    { title: "API with a cache", path: "/practice/architecture?template=cached-api" },
    { title: "Load-balanced API", path: "/practice/architecture?template=load-balanced" },
    { title: "Lab: a retry storm", path: "/practice/architecture/labs/retry-storm" },
  ],
};

/** /playground: choose one of the three Playgrounds. Open to everyone; visiting records nothing. */
export function PlaygroundsPage() {
  useEffect(() => {
    document.title = "Playgrounds — Kitab";
  }, []);
  return (
    <main id="main" className="page lab-page playgrounds-page lab-theme">
      <header className="playground-heading">
        <div className="playground-title">
          <FlaskConical className="playground-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Interactive Playgrounds</p>
            <h1>Choose a Playground</h1>
            <p>Each Playground is a free simulator for one subject. Change anything, run it step by step and see why it behaves that way. Nothing here is graded.</p>
            <p className="heading-links">Want real code and real HTTP requests instead of a simulation? <a {...linkProps("/lab")}>Open the Real Engineering Lab</a>.</p>
          </div>
        </div>
      </header>
      <ul className="playground-choices">
        {playgrounds.map(({ id, title, subject, summary, explore, path, Icon }) => (
          <li key={id} className={`playground-choice is-${id}`}>
            <span className="playground-choice-icon" aria-hidden="true"><Icon /></span>
            <p className="playground-choice-subject">{subject}</p>
            <h2 id={`pg-${id}`}>{title}</h2>
            <p>{summary}</p>
            <h3>What you can explore</h3>
            <ul className="playground-explore">{explore.map((item) => <li key={item}>{item}</li>)}</ul>
            <h3>Try an experiment</h3>
            <ul className="playground-examples">
              {examples[id].map((example) => (
                <li key={example.path}><a {...linkProps(example.path)}>{example.title}<ArrowRight aria-hidden="true" /></a></li>
              ))}
            </ul>
            <a className="button primary" {...linkProps(path)} aria-describedby={`pg-${id}`}>Open Playground <ArrowRight aria-hidden="true" /></a>
          </li>
        ))}
      </ul>
    </main>
  );
}
