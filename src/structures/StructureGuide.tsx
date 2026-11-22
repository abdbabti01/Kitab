import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { safeStorage } from "../learning/progress.ts";
import { guides, languages, type Guide, type GuideId, type Lang, type RuntimeFact } from "./guide/content.ts";
import { examples, type CodeExample } from "./guide/code.ts";
import { judge, scenarios, verdictWords } from "./guide/choose.ts";
import type { MemoryChange, MemoryRow } from "./guide/memory.ts";
import { isLang, LANGUAGE_KEY, readLanguage, writeLanguage } from "./guide/language.ts";
import { linkProps } from "../app/router.ts";
import "./guide.css";

/** The Engineering Lab where each structure is written and run for real (in JavaScript, the browser's language). */
const labFor: Partial<Record<GuideId, { title: string; path: string }>> = {
  array: { title: "Insert, remove and search in an array", path: "/lab/structures/arrays" },
  stack: { title: "Stacks and queues", path: "/lab/structures/stacks-queues" },
  queue: { title: "Stacks and queues", path: "/lab/structures/stacks-queues" },
  recursion: { title: "Recursion and a real stack overflow", path: "/lab/structures/recursion" },
  "binary-tree": { title: "Debug a binary search that never finishes", path: "/lab/structures/debugging" },
};

export type GuideTab = "memory" | "overview" | "code" | "cost" | "choose";
/** The current Playground step, when there is one: its conceptual memory and what the engine counted so far. */
export type GuideStep = { title: string; rows: MemoryRow[]; changes: MemoryChange[]; counts?: Record<string, number> };

const tabs: { id: GuideTab; label: string }[] = [
  { id: "memory", label: "Memory" },
  { id: "overview", label: "What & why" },
  { id: "code", label: "Code" },
  { id: "cost", label: "Cost" },
  { id: "choose", label: "Choose" },
];

/** The chosen code language, kept across visits and followed across tabs. */
function useLanguage(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>(() => readLanguage(safeStorage()));
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_KEY && isLang(event.newValue)) setLang(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [lang, (next) => { setLang(next); writeLanguage(safeStorage(), next); }];
}

const basisWords: Record<RuntimeFact["basis"], string> = { guaranteed: "Guaranteed", implementation: "Implementation detail", concept: "Concept" };

function LanguagePicker({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  return (
    <div className="dsg-langs" role="group" aria-label="Programming language">
      {languages.map((l) => (
        <button key={l.id} type="button" aria-pressed={lang === l.id} onClick={() => onChange(l.id)}>{l.label}</button>
      ))}
    </div>
  );
}

function Runtime({ guide, lang }: { guide: Guide; lang: Lang }) {
  const runtime = guide.runtime[lang];
  const label = languages.find((l) => l.id === lang)!.label;
  return (
    <section className="dsg-runtime">
      <h4>What {label} actually stores <small>({runtime.types})</small></h4>
      <ul>
        {runtime.facts.map((fact) => (
          <li key={fact.text}><span className={`dsg-basis is-${fact.basis}`}>{basisWords[fact.basis]}</span> {fact.text}</li>
        ))}
      </ul>
    </section>
  );
}

function MemoryTab({ guide, step, lang }: { guide: Guide; step?: GuideStep; lang: Lang }) {
  const changed = new Map(step?.changes.map((change) => [change.key, change]));
  const groups = step ? [...new Set(step.rows.map((row) => row.group))] : [];
  return (
    <>
      {step ? (
        <section>
          <h4>This step in memory <small>conceptual model · {step.title}</small></h4>
          <p className="dsg-changes" aria-live="polite">
            {step.changes.length
              ? <><b>Changed:</b> {step.changes.map((c) => c.kind === "removed" ? `${c.label} removed` : c.kind === "added" ? `${c.label} = ${c.after}` : `${c.label}: ${c.before} → ${c.after}`).join("; ")}.</>
              : <><b>Nothing in memory changed</b> in this step: it only read or compared.</>}
          </p>
          <div className="dsg-memory">
            {groups.map((group) => (
              <table key={group}>
                <caption>{group}</caption>
                <tbody>
                  {step.rows.filter((row) => row.group === group).map((row) => {
                    const change = changed.get(row.key);
                    return (
                      <tr key={row.key} className={change ? "is-changed" : undefined}>
                        <th scope="row">{row.label}</th>
                        <td>{change?.kind === "changed" && <s aria-label={`was ${change.before}`}>{change.before}</s>} {row.value}{change && <span className="sr-only"> (changed in this step)</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}
          </div>
          {step.counts && (
            <p className="dsg-note">Counted by Kitab's engine so far: {Object.entries(step.counts).map(([k, v]) => `${v} ${k}`).join(", ")}. These are operation counts, not measured time.</p>
          )}
        </section>
      ) : (
        <section>
          <h4>The memory model</h4>
          <p>{guide.memory.summary}</p>
        </section>
      )}
      {step && <p className="dsg-note">{guide.memory.summary}</p>}
      <ul className="dsg-points">{guide.memory.points.map((point) => <li key={point}>{point}</li>)}</ul>
      <Runtime guide={guide} lang={lang} />
    </>
  );
}

function OverviewTab({ guide }: { guide: Guide }) {
  return (
    <div className="dsg-overview">
      <section><h4>What is it?</h4><p>{guide.what}</p></section>
      <section><h4>Why does it exist?</h4><p>{guide.why}</p></section>
      <section>
        <h4>Use it when</h4>
        <ul>{guide.use.map((u) => <li key={u.title}><b>{u.title}.</b> {u.detail}</li>)}</ul>
      </section>
      <section>
        <h4>Avoid it when</h4>
        <ul>{guide.avoid.map((a) => <li key={a.title}><b>{a.title}.</b> {a.instead}</li>)}</ul>
      </section>
      <section>
        <h4>How it works</h4>
        <ol>{guide.how.map((step) => <li key={step}>{step}</li>)}</ol>
      </section>
    </div>
  );
}

function Example({ example }: { example: CodeExample }) {
  return (
    <article className="dsg-example">
      <header>
        <h4>{example.title}</h4>
        <span className={`dsg-kind is-${example.kind}`}>{example.kind === "library" ? "Standard library" : "Teaching implementation"}</span>
      </header>
      {example.kind === "teaching" && <p className="dsg-note">Written to show the mechanism step by step. It is not the source code of .NET, the JDK or CPython, which are more elaborate.</p>}
      <pre className="dsg-code" tabIndex={0} aria-label={`${example.title}, source code`}><code>{example.source}</code></pre>
      <p className="dsg-output-label">Prints</p>
      <pre className="dsg-output" tabIndex={0} aria-label="Output"><code>{example.output}</code></pre>
      <dl className="dsg-notes">
        {example.notes.map((note) => (
          <div key={note.code}><dt><code>{note.code}</code></dt><dd>{note.explain}</dd></div>
        ))}
      </dl>
      <p><b>Cost:</b> {example.complexity}</p>
      {example.caveat && <p className="dsg-note"><b>Caveat:</b> {example.caveat}</p>}
      {example.playground && <p className="dsg-note"><b>In the Playground:</b> {example.playground}</p>}
    </article>
  );
}

function CodeTab({ id, lang }: { id: GuideId; lang: Lang }) {
  return (
    <>
      <p className="dsg-note">Each program was compiled and run with .NET, Java and Python, and prints exactly what is shown. Kitab does not run C#, Java or Python in your browser.</p>
      {examples[id][lang].map((example) => <Example key={example.id} example={example} />)}
      {labFor[id] && (
        <p className="dsg-note"><b>Write and run it yourself:</b> <a {...linkProps(labFor[id]!.path)}>{labFor[id]!.title}</a> in the Engineering Lab. Lab exercises run JavaScript in your browser; the ideas carry over to C#, Java and Python.</p>
      )}
    </>
  );
}

function CostTab({ guide, counts }: { guide: Guide; counts?: Record<string, number> }) {
  return (
    <>
      <p className="dsg-note">Best, typical (average or expected) and worst case describe how the work grows with n, the number of elements. Amortized means averaged over a long run of operations. None of these is a time in milliseconds.</p>
      <ul className="dsg-costs">
        {guide.costs.map((cost) => (
          <li key={cost.operation}>
            <h4>{cost.operation}</h4>
            <dl>
              <div><dt>Best</dt><dd>{cost.best}</dd></div>
              <div><dt>Typical</dt><dd>{cost.typical}</dd></div>
              <div><dt>Worst</dt><dd>{cost.worst}</dd></div>
              {cost.amortized && <div><dt>Amortized</dt><dd>{cost.amortized}</dd></div>}
              <div><dt>Extra space</dt><dd>{cost.extra}</dd></div>
            </dl>
            <p><b>Why:</b> {cost.why}</p>
            {cost.assumes && <p className="dsg-note"><b>Assumes:</b> {cost.assumes}</p>}
          </li>
        ))}
      </ul>
      <p><b>Storage:</b> {guide.storage}</p>
      <ul className="dsg-points">{guide.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul>
      {counts && <p className="dsg-note">This run, counted by the engine: {Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.</p>}
    </>
  );
}

function ChooseTab({ id }: { id: GuideId }) {
  const ordered = useMemo(() => [...scenarios.filter((s) => s.guide === id), ...scenarios.filter((s) => s.guide !== id)], [id]);
  const [scenarioId, setScenarioId] = useState(ordered[0].id);
  const [pick, setPick] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const scenario = ordered.find((s) => s.id === scenarioId) ?? ordered[0];
  const result = checked && pick ? judge(scenario, pick) : null;
  const name = useId();
  return (
    <div className="dsg-choose">
      <label className="dsg-field">
        <span>Scenario</span>
        <select value={scenario.id} onChange={(event) => { setScenarioId(event.target.value); setPick(null); setChecked(false); }}>
          {ordered.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </label>
      <p>{scenario.situation}</p>
      <p className="dsg-note"><b>Requirements:</b> {scenario.requirements.join(" · ")}</p>
      <fieldset>
        <legend>Which would you use?</legend>
        {scenario.options.map((option) => (
          <label key={option.id} className="dsg-option">
            <input type="radio" name={name} value={option.id} checked={pick === option.id} onChange={() => { setPick(option.id); setChecked(false); }} />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      <button type="button" className="button" disabled={!pick} onClick={() => setChecked(true)}>Check my choice</button>
      {result && (
        <div className={`dsg-verdict is-${result.picked.verdict}`} role="status">
          <p><b>{verdictWords[result.picked.verdict]}.</b> {result.picked.reason}</p>
          {result.alsoGood.length > 0 && <p>Also a good fit: {result.alsoGood.map((o) => `${o.label} (${o.reason})`).join(" ")}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Everything about one structure beside the Playground or a lesson: memory (this step, or the model), what and
 * why, code in C#, Java and Python, cost, and choosing a structure. Changing tab or language never touches the run.
 */
export function StructureGuide({ id, step, counts, defaultTab = "memory", headingLevel = 2 }: { id: GuideId; step?: GuideStep; counts?: Record<string, number>; defaultTab?: GuideTab; headingLevel?: 2 | 3 }) {
  const guide = guides[id];
  const [tab, setTab] = useState<GuideTab>(defaultTab);
  const [lang, setLang] = useLanguage();
  const base = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const onKey = (event: KeyboardEvent, index: number) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const to = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : delta ? (index + delta + tabs.length) % tabs.length : -1;
    if (to < 0) return;
    event.preventDefault();
    setTab(tabs[to].id);
    document.getElementById(`${base}-${tabs[to].id}`)?.focus();
  };
  return (
    <section className="sp-panel dsg" aria-labelledby={`${base}-title`}>
      <div className="dsg-head">
        <Heading id={`${base}-title`}>{guide.title}</Heading>
        {(tab === "memory" || tab === "code") && <LanguagePicker lang={lang} onChange={setLang} />}
      </div>
      <div role="tablist" aria-label={`${guide.title}: views`} className="dsg-tabs">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`${base}-${item.id}`}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            aria-controls={tab === item.id ? `${base}-panel` : undefined}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => onKey(event, index)}
          >{item.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${tab}`} className="dsg-panel">
        {tab === "memory" && <MemoryTab guide={guide} step={step} lang={lang} />}
        {tab === "overview" && <OverviewTab guide={guide} />}
        {tab === "code" && <CodeTab id={id} lang={lang} />}
        {tab === "cost" && <CostTab guide={guide} counts={counts ?? step?.counts} />}
        {tab === "choose" && <ChooseTab id={id} />}
      </div>
    </section>
  );
}

/** The structures each data-structures lesson covers (concept slug → guides). */
export const conceptGuides: Record<string, GuideId[]> = {
  arrays: ["array"],
  "linked-lists": ["linked-list"],
  "hash-tables": ["hash-table"],
  trees: ["binary-tree", "graph"],
  recursion: ["recursion"],
  "data-structures": ["stack", "queue"],
};

/** A lesson's "go deeper" section: the guide for each structure it covers, one at a time. */
export function ConceptGuide({ slug }: { slug: string }) {
  const ids = conceptGuides[slug] ?? [];
  const [id, setId] = useState(ids[0]);
  if (!id) return null;
  return (
    <div className="dsg-concept">
      {ids.length > 1 && (
        <div className="dsg-langs" role="group" aria-label="Structure">
          {ids.map((g) => <button key={g} type="button" aria-pressed={g === id} onClick={() => setId(g)}>{guides[g].title.split(" (")[0]}</button>)}
        </div>
      )}
      <StructureGuide key={id} id={id} headingLevel={3} defaultTab={slug === "data-structures" ? "choose" : "overview"} />
    </div>
  );
}
