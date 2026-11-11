import { ArrowRight, Laptop, Router, Server } from "lucide-react";
import { linkProps } from "./router.ts";

const nodes = [
  { Icon: Laptop, title: "Your PC", caption: "Creates a packet" },
  { Icon: Router, title: "Router", caption: "Chooses a route" },
  { Icon: Server, title: "Server", caption: "Sends a reply" },
];

export function LibraryHero({ next }: { next: { label: string; path: string } }) {
  return (
    <section className="hero journey-hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">Kitab learning library</p>
        <h1 id="hero-title">Computer systems, step by step.</h1>
        <p className="lead">Follow a packet across a network, see an array move in memory, and practise predicting what the code does next.</p>
        <div className="actions">
          <a className="button primary" {...linkProps(next.path)}>{next.label} <ArrowRight aria-hidden="true" /></a>
          <a className="button" href="#path">See the networking path</a>
        </div>
      </div>
      <figure className="network-preview">
        <div className="network-preview-top"><span>Networking</span><span>01 / LEARNING PATH</span></div>
        <figcaption>How does a message get from your laptop to a website?</figcaption>
        <ol className="network-preview-nodes">
          {nodes.map(({ Icon, title, caption }) => (
            <li key={title}><Icon aria-hidden="true" /><b>{title}</b><small>{caption}</small></li>
          ))}
        </ol>
        <p>Start with the boxes in your home. Then follow a packet across your LAN, through a router and across the Internet.</p>
      </figure>
    </section>
  );
}
