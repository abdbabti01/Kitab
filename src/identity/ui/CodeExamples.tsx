import { useState } from "react";
import { safeStorage } from "../../learning/progress.ts";
import { readLanguage, writeLanguage } from "../../structures/guide/language.ts";
import type { Lang } from "../../structures/guide/content.ts";
import { examplesFor, exampleTopics, type IdentityExample } from "../code.ts";

const langs: { id: Lang; label: string }[] = [{ id: "csharp", label: "C#" }, { id: "java", label: "Java" }, { id: "python", label: "Python" }];

function Example({ example }: { example: IdentityExample }) {
  return (
    <article className="id-example" aria-labelledby={`ex-${example.id}`}>
      <h4 id={`ex-${example.id}`}>{example.title}</h4>
      <p className="muted"><b>{example.framework}</b> · where it goes: <code>{example.file}</code>{example.deps.length > 0 && <> · packages: {example.deps.join(", ")}</>}</p>
      <p className={`id-verified ${example.verify === "run" ? "is-run" : "is-build"}`}>
        {example.verify === "run" ? "Compiled and run by Kitab's verification script; the output below is what it printed." : "Compiled by Kitab's verification script. Running it needs a real identity provider, so its behaviour is explained rather than shown."}
      </p>
      <pre className="id-code"><code>{example.source}</code></pre>
      {example.extra?.map((x) => (
        <figure key={x.file} className="real-example"><figcaption>{x.file}</figcaption><pre><code>{x.source}</code></pre></figure>
      ))}
      {example.output && (<><h5>Output</h5><pre className="id-output">{example.output}</pre></>)}
      <h5>The important lines</h5>
      <dl className="id-notes">{example.notes.map((n) => <div key={n.code}><dt><code>{n.code}</code></dt><dd>{n.explain}</dd></div>)}</dl>
      <h5>A failure to recognise</h5>
      <p>{example.failure}</p>
      <h5>In production</h5>
      <ul>{example.production.map((p) => <li key={p}>{p}</li>)}</ul>
    </article>
  );
}

/** A unit's examples in the learner's language (the same preference the Data Structures guide uses). */
export function CodeExamples({ topics }: { topics: string[] }) {
  const [lang, setLang] = useState<Lang>(() => readLanguage(safeStorage()));
  const choose = (next: Lang) => {
    setLang(next);
    writeLanguage(safeStorage(), next);
  };
  return (
    <section className="lesson-section id-examples" aria-labelledby="code-title">
      <h2 id="code-title">In code: C#, Java and Python</h2>
      <p>Real framework code with maintained libraries. Keys and tokens inside these programs are generated for the demonstration and labelled so; a real application gets them from its identity provider.</p>
      <div className="id-lang" role="group" aria-label="Language">
        {langs.map((l) => <button key={l.id} type="button" className="filter-chip" aria-pressed={lang === l.id} onClick={() => choose(l.id)}>{l.label}</button>)}
      </div>
      {topics.map((topic) => (
        <div key={topic} className="id-topic">
          <h3>{exampleTopics[topic as IdentityExample["topic"]]}</h3>
          {examplesFor(topic).filter((e) => e.lang === lang).map((e) => <Example key={e.id} example={e} />)}
        </div>
      ))}
    </section>
  );
}
