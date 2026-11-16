import { lazy, Suspense, useEffect } from "react";
import { ArrowRight, Binary, BookOpen, FlaskConical, HelpCircle, Network, Workflow } from "lucide-react";
import { findTrack, type LearningTrack } from "../learning/tracks.ts";
import { playgrounds, PLAYGROUNDS_PATH } from "./playgrounds.ts";
import { linkProps } from "./router.ts";

// The demonstration arrives just after the heading is painted; its place is held, so nothing moves when it arrives.
const HeroDemo = lazy(() => import("./HeroDemo.tsx").then((m) => ({ default: m.HeroDemo })));

const ways = [
  { Icon: BookOpen, title: "Learn", path: "/learn", link: "See the roadmap", text: "Lessons follow one concrete example, one step at a time. Nothing to get wrong: you read, watch and try." },
  { Icon: HelpCircle, title: "Practise", path: "/practice", link: "See the missions", text: "Missions ask you to predict what happens, or find what is broken. The simulator shows whether you were right." },
  { Icon: FlaskConical, title: "Experiment", path: PLAYGROUNDS_PATH, link: "See the Playgrounds", text: "Each subject has a Playground: a free simulator where you change anything, run it step by step and compare." },
];

const networking = findTrack("networking")!;
const dataStructures = findTrack("data-structures")!;
const systemDesign = findTrack("system-design")!;

function SubjectCard({ track, Icon, tone, action }: { track: LearningTrack; Icon: typeof Network; tone: string; action: string }) {
  return (
    <li className={`subject-card is-${tone}`}>
      <span className="subject-icon" aria-hidden="true"><Icon /></span>
      <span className="subject-kind">Subject · {track.stages.length} units</span>
      <h3 id={`subject-${track.id}`}>{track.title}</h3>
      <p>{track.summary}</p>
      <ol className="subject-units" aria-label={`${track.title} units`}>
        {track.stages.slice(0, 4).map((stage) => <li key={stage.id}>{stage.title}</li>)}
        {track.stages.length > 4 && <li className="more">and {track.stages.length - 4} more</li>}
      </ol>
      <a className="button primary" {...linkProps(track.path)} aria-describedby={`subject-${track.id}`}>{action} <ArrowRight aria-hidden="true" /></a>
    </li>
  );
}

/** Home: what Kitab offers, the same for every visitor. Progress and "Continue" live on each subject's page. */
export function Home() {
  useEffect(() => {
    document.title = "Kitab — learn networking, data structures and system design by watching them work";
  }, []);
  return (
    <div className="home">
      <main id="main">
        <section className="home-hero" aria-labelledby="hero-title">
          <p className="eyebrow">Free · no account · progress saved on this device</p>
          <h1 id="hero-title">See how computers really work, one step at a time.</h1>
          <p className="lead">Kitab teaches with short visual lessons and a real simulator. Pick a subject to learn, or experiment freely in one of its Playgrounds.</p>
        </section>

        <section className="subjects" aria-labelledby="subjects-title">
          <h2 id="subjects-title" className="sr-only">Choose what to explore</h2>
          <ul className="subject-grid">
            <SubjectCard track={networking} Icon={Network} tone="networking" action="Explore Networking" />
            <SubjectCard track={dataStructures} Icon={Binary} tone="structures" action="Explore Data structures" />
            <SubjectCard track={systemDesign} Icon={Workflow} tone="design" action="Explore System design" />
          </ul>
        </section>

        <section className="playground-feature" aria-labelledby="feature-title">
          <div className="feature-copy">
            <p className="feature-eyebrow"><FlaskConical aria-hidden="true" /> Interactive Playgrounds</p>
            <h2 id="feature-title">Change anything. Watch every step.</h2>
            <p>Three free simulators, one for each subject. Every step shows what happens, why it happens and what changed, and nothing is graded.</p>
            <ul className="feature-starters feature-playgrounds">
              {playgrounds.map(({ id, title, summary, path, Icon }) => (
                <li key={id}>
                  <a {...linkProps(path)}><b><Icon aria-hidden="true" /> {title}</b><small>{summary}</small><ArrowRight aria-hidden="true" /></a>
                </li>
              ))}
            </ul>
            <a className="button primary" {...linkProps(PLAYGROUNDS_PATH)}>Explore the Playgrounds <ArrowRight aria-hidden="true" /></a>
          </div>
          <Suspense fallback={<div className="hero-demo is-loading" aria-hidden="true" />}>
            <HeroDemo />
          </Suspense>
        </section>

        <section className="section" aria-labelledby="how-title">
          <h2 id="how-title">How Kitab works</h2>
          <ol className="ways">
            {ways.map(({ Icon, title, text, path, link }, index) => (
              <li key={title}>
                <span className="way-number" aria-hidden="true">{index + 1}</span>
                <Icon aria-hidden="true" />
                <b>{title}</b>
                <span>{text}</span>
                <a className="text-button" {...linkProps(path)}>{link}</a>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" aria-labelledby="library-title">
          <h2 id="library-title">Also on Kitab</h2>
          <a className="track-card" {...linkProps("/learn/library")}>
            <span className="eyebrow">Library</span>
            <b>Readings</b>
            <span>Short illustrated walkthroughs: DNS, web requests, databases, operating systems and more.</span>
          </a>
        </section>
      </main>
      <footer className="footer"><p>Kitab · understand the mechanism, not just the definition.</p></footer>
    </div>
  );
}
