import { lazy, Suspense } from "react";
import { ArrowRight, Eye, FlaskConical, HelpCircle } from "lucide-react";
import { linkProps } from "./router.ts";

// The demonstration arrives just after the heading is painted (its first render cost a throttled phone about 170 ms
// before the heading appeared); its place is held, so nothing moves when it arrives.
const HeroDemo = lazy(() => import("./HeroDemo.tsx").then((m) => ({ default: m.HeroDemo })));

// What the network lab is for, in the three things a learner does there.
const actions = [
  { Icon: Eye, title: "Watch", text: "Follow each frame across the network and open its layers, from Ethernet to HTTP." },
  { Icon: HelpCircle, title: "Predict", text: "Answer before each decision: which next hop, who replies, what NAT rewrites." },
  { Icon: FlaskConical, title: "Experiment", text: "Break one setting and compare the working and broken runs, step by step." },
];

export function LibraryHero({ next }: { next: { label: string; path: string } }) {
  return (
    <section className="hero journey-hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">Kitab learning library</p>
        <h1 id="hero-title">See a network work, one packet at a time.</h1>
        <p className="lead">The network lab runs a real simulation: every frame, header and decision you see is recorded from it.</p>
      </div>
      <Suspense fallback={<div className="hero-demo is-loading" aria-hidden="true" />}>
        <HeroDemo />
      </Suspense>
      <div className="hero-next">
        <ul className="hero-actions-list">
          {actions.map(({ Icon, title, text }) => (
            <li key={title}>
              <Icon aria-hidden="true" />
              <span>
                <b>{title}</b> {text}
              </span>
            </li>
          ))}
        </ul>
        <div className="actions">
          <a className="button primary" {...linkProps("/practice/network")}>
            Open the network lab <ArrowRight aria-hidden="true" />
          </a>
          <a className="button" {...linkProps(next.path)}>
            {next.label}
          </a>
        </div>
      </div>
    </section>
  );
}
