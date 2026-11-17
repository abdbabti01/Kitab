import type { ReactNode } from "react";

export type Control = { name: string; does: string };

/**
 * A free-exploration Playground says so in one line (no objective, no pass or fail) and keeps the rest on demand:
 * what you can build, things to try, what each control does, and where guided work with a goal lives instead.
 */
export function ExploreGuide({ build, tryThis, controls, guided }: { build: string; tryThis: ReactNode[]; controls: Control[]; guided: ReactNode }) {
  return (
    <section className="explore-guide" aria-label="About this Playground">
      <p className="explore-mode"><span className="mode-chip">Free exploration</span> No objective and no pass or fail: build, run and compare. {guided}</p>
      <details>
        <summary>How this Playground works</summary>
        <p>{build}</p>
        <h3>Things to try</h3>
        <ul>{tryThis.map((item, index) => <li key={index}>{item}</li>)}</ul>
        <h3>What the controls do</h3>
        <dl>{controls.map((c) => <div key={c.name}><dt>{c.name}</dt><dd>{c.does}</dd></div>)}</dl>
      </details>
    </section>
  );
}

/** A representative configuration snippet, always with the label saying which technology it is. */
export function ExampleBlock({ example }: { example: { label: string; code: string } }) {
  return (
    <figure className="real-example">
      <figcaption>{example.label}</figcaption>
      <pre><code>{example.code}</code></pre>
    </figure>
  );
}
