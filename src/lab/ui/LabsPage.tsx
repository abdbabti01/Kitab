import { useEffect, useMemo } from "react";
import { ArrowRight, Binary, Clock, SquareTerminal, Waypoints, Workflow } from "lucide-react";
import { linkProps } from "../../app/router.ts";
import { safeStorage } from "../../learning/progress.ts";
import { futureLabs, labById, labsFor } from "../catalog.ts";
import { SUBJECTS, difficultyLabel, labPath, modeLabel, modeMeaning, subjectLabel, type ExecutionMode, type Subject } from "../model.ts";
import { lastLab, labStateLabel, readLabs, stateOf } from "../progress.ts";
import { ModeBadges } from "./LabPage.tsx";
import "./lab.css";

const icons: Record<Subject, typeof Waypoints> = { networking: Waypoints, structures: Binary, architecture: Workflow };
const legend: ExecutionMode[] = ["real-execution", "real-protocol", "simulated", "unavailable"];

/** /lab: every Engineering Lab by subject, with saved progress, and what can't run in a browser (yet). */
export function LabsPage() {
  useEffect(() => {
    document.title = "Engineering Lab — Kitab";
  }, []);
  const { records, last } = useMemo(() => {
    const storage = safeStorage();
    return { records: readLabs(storage).records.labs, last: lastLab(storage, (id) => !!labById(id)) };
  }, []);
  const resume = last ? labById(last) : undefined;
  return (
    <main id="main" className="page lab-page eng-lab eng-catalog lab-theme">
      <header className="playground-heading">
        <div className="playground-title">
          <SquareTerminal className="playground-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Real Engineering Lab</p>
            <h1>Work with the real thing</h1>
            <p>Write code that really runs and send HTTP requests that really reach a server. Every lab says exactly what is real and what is a model, checks your work from what actually happened, and saves it in this browser.</p>
          </div>
        </div>
      </header>
      <section className="eng-intro" aria-label="How the lab differs">
        <p><b>Learn</b> explains how something works. <b>Playgrounds</b> simulate it so you can change anything safely. <b>The Engineering Lab</b> hands you real tools: your JavaScript runs on this browser's engine, and your requests travel to Kitab's server and back.</p>
        <dl className="eng-legend-list">
          {legend.map((mode) => (
            <div key={mode}><dt><span className={`eng-mode is-${mode}`}>{modeLabel[mode]}</span></dt><dd>{modeMeaning[mode]}</dd></div>
          ))}
        </dl>
      </section>
      {resume && (
        <p className="eng-resume">
          <a className="button primary" {...linkProps(labPath(resume))}>Continue: {resume.title}<ArrowRight aria-hidden="true" /></a>
          <span className="eng-muted">{labStateLabel[stateOf(records[resume.id])]}</span>
        </p>
      )}
      {SUBJECTS.map((subject) => {
        const Icon = icons[subject];
        return (
          <section key={subject} className="eng-subject" aria-labelledby={`eng-${subject}`}>
            <h2 id={`eng-${subject}`}><Icon aria-hidden="true" />{subjectLabel[subject]}</h2>
            <ul className="eng-cards">
              {labsFor(subject).map((lab) => {
                const state = stateOf(records[lab.id]);
                return (
                  <li key={lab.id} className="eng-card">
                    <h3><a {...linkProps(labPath(lab))}>{lab.title}</a></h3>
                    <p>{lab.summary}</p>
                    <p className="eng-card-facts">
                      <ModeBadges lab={lab} />
                      <span className="eng-fact">{difficultyLabel[lab.difficulty]}</span>
                      <span className="eng-fact"><Clock aria-hidden="true" />{lab.minutes} min</span>
                      <span className={`eng-state is-${state}`}>{labStateLabel[state]}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <section className="eng-subject eng-future" aria-labelledby="eng-future">
        <h2 id="eng-future">Needs real infrastructure: not in the browser</h2>
        <p className="eng-muted">These need a real operating system, server process or network access that a web page can't safely have. Kitab won't imitate them. You can run each one on your own machine today; Kitab can't see your terminal, so these aren't checked.</p>
        <ul className="eng-cards">
          {futureLabs.map((f) => (
            <li key={f.id} className="eng-card is-unavailable">
              <h3>{f.title}</h3>
              <p className="eng-card-facts"><span className="eng-mode is-unavailable">{modeLabel.unavailable}</span></p>
              <p><b>Needs:</b> {f.needs}</p>
              <p><b>On your own machine:</b> <code>{f.localPath}</code></p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
