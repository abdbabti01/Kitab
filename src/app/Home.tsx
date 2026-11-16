import { lazy, Suspense, useEffect } from "react";
import { ArrowRight, Binary, BookOpen, FlaskConical, HelpCircle, Network, Waypoints, Workflow } from "lucide-react";
import { findTrack, type LearningTrack } from "../learning/tracks.ts";
import { linkProps } from "./router.ts";

// The demonstration arrives just after the heading is painted; its place is held, so nothing moves when it arrives.
const HeroDemo = lazy(() => import("./HeroDemo.tsx").then((m) => ({ default: m.HeroDemo })));

const ways = [
  { Icon: BookOpen, title: "Learn", path: "/learn", link: "See the roadmap", text: "Lessons follow one concrete example, one step at a time. Nothing to get wrong: you read, watch and try." },
  { Icon: HelpCircle, title: "Practise", path: "/practice", link: "See the missions", text: "Missions ask you to predict what happens, or find what is broken. The simulator shows whether you were right." },
  { Icon: FlaskConical, title: "Experiment", path: "/practice/network", link: "Open the Playground", text: "The Playground is a free network you build yourself: add devices, send anything, break one setting and compare." },
];

const networking = findTrack("networking")!;
const dataStructures = findTrack("data-structures")!;
const systemDesign = findTrack("system-design")!;
// The Playground's starter networks, as the networking track lists them (each opens with its guided first step).
const starters = networking.stages.flatMap((stage) => stage.learn).filter((a) => a.id.startsWith("starter:"));

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
    document.title = "Kitab — learn networking and data structures by watching them work";
  }, []);
  return (
    <div className="home">
      <main id="main">
        <section className="home-hero" aria-labelledby="hero-title">
          <p className="eyebrow">Free · no account · progress saved on this device</p>
          <h1 id="hero-title">See how computers really work, one step at a time.</h1>
          <p className="lead">Kitab teaches with short visual lessons and a real simulator. Pick a subject to learn, or experiment freely in the Network Playground.</p>
        </section>

        <section className="subjects" aria-labelledby="subjects-title">
          <h2 id="subjects-title" className="sr-only">Choose what to explore</h2>
          <ul className="subject-grid">
            <SubjectCard track={networking} Icon={Network} tone="networking" action="Explore Networking" />
            <SubjectCard track={dataStructures} Icon={Binary} tone="structures" action="Explore Data structures" />
            <SubjectCard track={systemDesign} Icon={Workflow} tone="design" action="Explore System design" />
            <li className="subject-card is-playground">
              <span className="subject-icon" aria-hidden="true"><Waypoints /></span>
              <span className="subject-kind">Interactive lab</span>
              <h3 id="subject-playground">Network Playground</h3>
              <p>Build a network, send a request and watch each packet travel across devices, step by step.</p>
              <ul className="subject-units" aria-label="Starter scenarios">
                {starters.slice(0, 4).map((s) => <li key={s.id}>{s.title}</li>)}
              </ul>
              <a className="button primary" {...linkProps("/practice/network")} aria-describedby="subject-playground">Open the Playground <ArrowRight aria-hidden="true" /></a>
            </li>
          </ul>
        </section>

        <section className="playground-feature" aria-labelledby="feature-title">
          <div className="feature-copy">
            <p className="feature-eyebrow"><Waypoints aria-hidden="true" /> Network Playground</p>
            <h2 id="feature-title">Send a request. Watch every packet.</h2>
            <p>Each step shows which device acts, what it decides and why: ARP, switching, routing, DNS, TCP and HTTP, on a network you can change and break.</p>
            <h3>Start with a scenario</h3>
            <ul className="feature-starters">
              {starters.map((s) => (
                <li key={s.id}>
                  <a {...linkProps(s.path)}><b>{s.title}</b><small>{s.detail}</small><ArrowRight aria-hidden="true" /></a>
                </li>
              ))}
            </ul>
            <a className="button primary" {...linkProps("/practice/network")}>Open the Playground <ArrowRight aria-hidden="true" /></a>
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
          <a className="track-card" {...linkProps("/practice/architecture")}>
            <span className="eyebrow">Interactive lab</span>
            <b>Architecture Playground</b>
            <span>Design an application from APIs, databases, caches, load balancers and queues, then send simulated traffic through it.</span>
          </a>
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
