import { ArrowRight, Laptop, Router, Server } from "lucide-react";
import type { Lesson } from "../learning/lessons/schema.ts";
import { linkProps } from "./router.ts";
import { HTTP_WALKTHROUGH_PATH } from "./routes.ts";

const nodes = [
  { Icon: Laptop, title: "Your PC", caption: "Creates a packet" },
  { Icon: Router, title: "Router", caption: "Chooses a route" },
  { Icon: Server, title: "Server", caption: "Sends a reply" },
];

export function LibraryHero({ firstLesson }: { firstLesson: Lesson }) {
  return (
    <section className="hero journey-hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">Kitab learning library</p>
        <h1 id="hero-title">Computer systems, step by step.</h1>
        <p className="lead">Follow a packet across a network, see an array move in memory, and practise predicting what the code does next.</p>
        <div className="actions">
          <a className="button primary" {...linkProps(`/learn/${firstLesson.id}`)}>Start {firstLesson.title} <ArrowRight aria-hidden="true" /></a>
          <a className="button" {...linkProps(HTTP_WALKTHROUGH_PATH)}>Open Packet Journey</a>
        </div>
      </div>
      <figure className="network-preview">
        <div className="network-preview-top"><span>Networking</span><span>01 / LEARNING PATH</span></div>
        <figcaption>{firstLesson.question}</figcaption>
        <ol className="network-preview-nodes">
          {nodes.map(({ Icon, title, caption }) => (
            <li key={title}><Icon aria-hidden="true" /><b>{title}</b><small>{caption}</small></li>
          ))}
        </ol>
        <p>Start with addresses and subnets. Then follow an HTTP request and its reply.</p>
      </figure>
    </section>
  );
}
