import { useEffect } from "react";
import { AlertOctagon } from "lucide-react";
import { linkProps } from "../../app/router.ts";
import { safeStorage } from "../../learning/progress.ts";
import { loadIncidents, stateOf } from "../progress.ts";
import { incidentPath, SCENARIOS } from "../scenarios.ts";
import "./incidents.css";

const LABELS = { "not-started": "Not started", "in-progress": "In progress", completed: "Resolved" } as const;

export function IncidentsPage() {
  useEffect(() => {
    document.title = "Production incidents · Kitab";
  }, []);
  const { records } = loadIncidents(safeStorage());
  return (
    <main id="main" className="page lab-page lab-theme inc-page">
      <header className="playground-heading">
        <div>
          <p className="eyebrow">Practice · Production Incident Simulator</p>
          <h1>Diagnose, fix and recover</h1>
          <p className="section-lead">A small online store breaks in twelve different ways. Investigate with metrics, logs, traces and topology, form hypotheses from evidence, change the system, verify that it really recovered, then write the postmortem.</p>
        </div>
      </header>
      <p className="inc-sim-note"><b>SIMULATED</b> Every incident runs on a deterministic model of the store in your browser. Nothing is a measurement of real servers; the linked Engineering Labs are where real code and HTTP run.</p>
      <ul className="inc-grid" aria-label="Incidents">
        {SCENARIOS.map((s) => {
          const state = stateOf(records[s.id]);
          return (
            <li key={s.id}>
              <a className="mission-card practice-card inc-card-link" {...linkProps(incidentPath(s.id))}>
                <span className="practice-card-top">
                  <span className={`practice-kind diff-${s.difficulty}`}>{s.difficulty}</span>
                  <span className={`status-chip status-${state === "completed" ? "completed" : state}`}>{LABELS[state]}</span>
                </span>
                <b><AlertOctagon aria-hidden="true" /> {s.number}. {s.title}</b>
                <span>{s.report}</span>
                <small>{s.family} · {s.severity}{s.variants.length > 1 ? ` · ${s.variants.length} versions` : ""}</small>
              </a>
            </li>
          );
        })}
      </ul>
      <section className="section" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ul>
          <li><b>Guided</b> mode explains the system, suggests questions and offers hints; <b>Independent</b> mode leaves the investigation to you. Advanced incidents have more than one cause.</li>
          <li>Everything you see comes from one simulated run: the same seed always gives the same requests, logs and traces.</li>
          <li>An incident is resolved when your change passes its recovery criteria under today's load and under stress, keeps every safety requirement, removes the root cause, and you have confirmed that cause with evidence.</li>
          <li>Your work is saved in this browser only.</li>
        </ul>
      </section>
    </main>
  );
}
