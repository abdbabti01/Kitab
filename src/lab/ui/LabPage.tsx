import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Clock, CircleCheck, Info, SquareTerminal, TriangleAlert } from "lucide-react";
import { linkProps } from "../../app/router.ts";
import { safeStorage } from "../../learning/progress.ts";
import { glossary } from "../../learning/glossary.ts";
import { TermChips } from "../../ui/Terms.tsx";
import { findLab, labs } from "../catalog.ts";
import { difficultyLabel, labPath, modeLabel, modeMeaning, subjectLabel, type Lab } from "../model.ts";
import { readLabs, rememberOpened, saveLab, stateOf, labStateLabel, type LabRecord } from "../progress.ts";
import { CodeWorkspace } from "./CodeWorkspace.tsx";
import { HttpWorkspace } from "./HttpWorkspace.tsx";
import "./lab.css";

export type Save = (change: (current: LabRecord) => LabRecord) => LabRecord;

export function ModeBadges({ lab }: { lab: Pick<Lab, "modes"> }) {
  return (
    <span className="eng-modes">
      {lab.modes.map((mode) => (
        <span key={mode} className={`eng-mode is-${mode}`} title={modeMeaning[mode]}>{modeLabel[mode]}</span>
      ))}
    </span>
  );
}

/** Saved work and its persistence state for one lab. Every save re-reads storage (keyed-store) first. */
function useLabRecord(lab: Lab) {
  const storage = useRef(safeStorage()).current;
  const [record, setRecord] = useState<LabRecord | undefined>(() => readLabs(storage).records.labs[lab.id]);
  const [saveFailed, setSaveFailed] = useState(false);
  const save = useCallback<Save>(
    (change) => {
      const result = saveLab(storage, lab.id, lab.version, change);
      setRecord(result.record);
      setSaveFailed(!result.saved);
      return result.record;
    },
    [lab.id, lab.version, storage],
  );
  useEffect(() => {
    rememberOpened(storage, lab.id);
  }, [lab.id, storage]);
  return { record, save, saveFailed };
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="eng-brief-part" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

function Instructions({ lab }: { lab: Lab }) {
  return (
    <section className="eng-panel eng-brief" aria-labelledby="eng-brief-title">
      <h2 id="eng-brief-title">Your task</h2>
      <Section id="eng-problem" title="The real-world problem"><p>{lab.problem}</p></Section>
      <Section id="eng-build" title="What you'll build"><p>{lab.build}</p></Section>
      <Section id="eng-success" title="Success means"><p>{lab.success}</p></Section>
      <details className="eng-more">
        <summary>What you can change, tools, and how to check</summary>
        <Section id="eng-change" title="What you can change"><p>{lab.canChange}</p></Section>
        <Section id="eng-tools" title="Tools"><p>{lab.tools}</p></Section>
        <Section id="eng-verify" title="How to check your work"><p>{lab.verify}</p></Section>
      </details>
    </section>
  );
}

function Explanations({ lab }: { lab: Lab }) {
  const terms = lab.terms.map((key) => glossary[key]);
  return (
    <section className="eng-explain" aria-labelledby="eng-explain-title">
      <h2 id="eng-explain-title">Understand what's happening</h2>
      <details className="eng-panel eng-computer" open>
        <summary>What the computer does</summary>
        <p className="eng-legend"><span className="eng-tag is-observed">Shown</span> Kitab shows you the real evidence for this step. <span className="eng-tag">Explained</span> This happens, but a web page can't observe it.</p>
        <ol>
          {lab.computer.map((step) => (
            <li key={step.title}>
              <b>{step.title}</b> <span className={`eng-tag${step.observed ? " is-observed" : ""}`}>{step.observed ? "Shown" : "Explained"}</span>
              <p>{step.detail}</p>
            </li>
          ))}
        </ol>
      </details>
      {lab.configs.length > 0 && (
        <details className="eng-panel eng-configs">
          <summary>Where this lives in real systems</summary>
          {lab.configs.map((c) => (
            <article key={c.name} className="eng-config">
              <h4>{c.name}</h4>
              <dl>
                <dt>What it is</dt><dd>{c.what}</dd>
                <dt>Why it exists</dt><dd>{c.why}</dd>
                <dt>Where it's set</dt><dd>{c.where}</dd>
                <dt>Who controls it</dt><dd>{c.who}</dd>
                <dt>How to change it</dt><dd>{c.change}</dd>
                <dt>How to verify it</dt><dd>{c.verify}</dd>
                <dt>What changing it does</dt><dd>{c.effect}</dd>
                <dt>What Kitab does here</dt><dd>{c.kitab}</dd>
              </dl>
              {c.example && (
                <figure>
                  <figcaption>{c.example.label}</figcaption>
                  <pre><code>{c.example.code}</code></pre>
                </figure>
              )}
            </article>
          ))}
        </details>
      )}
      {terms.length > 0 && <TermChips label="Terms used in this lab" lead="Terms:" terms={terms} />}
      {lab.related.length > 0 && (
        <nav className="eng-related" aria-label="Related in Kitab">
          <h3>Related in Kitab</h3>
          <ul>
            {lab.related.map((r) => (
              <li key={r.path}><span className={`eng-kind is-${r.kind}`}>{r.kind === "learn" ? "Learn" : r.kind === "playground" ? "Playground" : "Practice"}</span><a {...linkProps(r.path)}>{r.label}</a></li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}

/** The next lab in the same subject, else the first not completed anywhere. */
function nextLab(lab: Lab) {
  const same = labs.filter((l) => l.subject === lab.subject);
  return same[same.indexOf(lab) + 1] ?? labs.find((l) => l.subject !== lab.subject);
}

export function Completed({ lab }: { lab: Lab }) {
  const next = nextLab(lab);
  return (
    <div className="eng-complete" role="status">
      <CircleCheck aria-hidden="true" />
      <div>
        <b>Lab completed.</b> Your work passed every check. It's saved in this browser.
        {next && <> Next: <a {...linkProps(labPath(next))}>{next.title} <ArrowRight aria-hidden="true" /></a></>}
      </div>
    </div>
  );
}

export function LabPage({ lab }: { lab: Lab }) {
  const { record, save, saveFailed } = useLabRecord(lab);
  useEffect(() => {
    document.title = `${lab.title} — Engineering Lab — Kitab`;
  }, [lab.title]);
  const state = stateOf(record);
  return (
    <main id="main" className="page lab-page eng-lab lab-theme">
      <header className="playground-heading eng-heading">
        <div className="playground-title">
          <SquareTerminal className="playground-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow"><a {...linkProps("/lab")}>Engineering Lab</a> · {subjectLabel[lab.subject]}</p>
            <h1>{lab.title}</h1>
            <p className="eng-objective"><b>Objective:</b> {lab.objective}</p>
          </div>
        </div>
        <div className="eng-facts">
          <ModeBadges lab={lab} />
          <span className="eng-fact">{difficultyLabel[lab.difficulty]}</span>
          <span className="eng-fact"><Clock aria-hidden="true" />About {lab.minutes} min</span>
          <span className={`eng-state is-${state}`}>{labStateLabel[state]}</span>
        </div>
      </header>
      <p className="notice eng-mode-note"><Info aria-hidden="true" /><span><b>What's real here:</b> {lab.modeNote}</span></p>
      {record && record.labVersion !== lab.version && (
        <p className="notice warning"><TriangleAlert aria-hidden="true" /><span>This lab has changed since you last saved. Your work is kept; Reset gives you the new starting point.</span></p>
      )}
      {saveFailed && (
        <p className="notice warning" role="alert"><TriangleAlert aria-hidden="true" /><span>Your work couldn't be saved in this browser: storage is full or blocked (private windows often block it). Keep this page open, or copy your work somewhere safe.</span></p>
      )}
      {state === "completed" && <Completed lab={lab} />}
      <div className={`eng-layout is-${lab.kind}`}>
        <Instructions lab={lab} />
        {lab.kind === "code" ? <CodeWorkspace lab={lab} record={record} save={save} /> : <HttpWorkspace lab={lab} record={record} save={save} />}
      </div>
      <Explanations lab={lab} />
    </main>
  );
}

/** /lab/:subject/:id */
export function EngineeringLabRoute({ subject, id, notFound }: { subject: string; id: string; notFound: ReactNode }) {
  const lab = findLab(subject, id);
  return lab ? <LabPage key={lab.id} lab={lab} /> : <>{notFound}</>;
}
