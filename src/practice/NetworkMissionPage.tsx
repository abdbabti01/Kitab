// A networking practice mission: a broken network to investigate, fix and explain.
// It reuses the playground's workspace (diagram, journey, inspectors) and the same deterministic engine.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, CircleHelp, FlaskConical, Lock as LockIcon, X } from "lucide-react";
import { linkProps, navigate } from "../app/router.ts";
import { JourneyStage } from "./JourneyStage.tsx";
import { SendPanel } from "./SendPanel.tsx";
import { InspectorPanel, type InspectorTab } from "./InspectorPanel.tsx";
import { useJourney } from "./useJourney.ts";
import { connect, validateNetwork } from "./network/topology.ts";
import { SCRATCH_KEY } from "./network/storage.ts";
import { areaLabels, aspectLabels, findNetworkMission, missions, variantFor, type Area, type NetworkMission } from "./network/missions.ts";
import { assessFix, diagnose, evidenceShows, investigationAnswer, lockBroken, type Assessment } from "./network/mission-assess.ts";
import {
  loadMissionStore,
  missionState,
  notYetMastered,
  recordAttempt,
  saveMissionStore,
  type MissionAttempt,
} from "./network/mission-progress.ts";
import { practiceLabels } from "../learning/practice-state.ts";
import type { Action, Network, Trace } from "./network/model.ts";
import "./practice.css";

const DRAFT_KEY = "kitab.network-missions.draft";
const storage = () => {
  try {
    return localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined } as unknown as Storage;
  }
};
type Draft = { missionId: string; version: string; attempt: MissionAttempt; network: Network };

function loadDraft(mission: NetworkMission): Draft | null {
  try {
    const d = JSON.parse(storage().getItem(`${DRAFT_KEY}.${mission.id}`) ?? "null") as Draft | null;
    if (!d || d.missionId !== mission.id || d.version !== mission.version) return null;
    if (!mission.variants.some((v) => v.id === d.attempt.variant) || validateNetwork(d.network).length) return null;
    return d;
  } catch {
    return null;
  }
}

function freshAttempt(mission: NetworkMission): MissionAttempt {
  const done = loadMissionStore(storage()).missions[mission.id]?.attempts.length ?? 0;
  return {
    variant: variantFor(mission, done + 1).id,
    startedAt: new Date().toISOString(),
    completedAt: null,
    diagnosis: null,
    evidence: false,
    explanation: null,
    prediction: null,
    hints: 0,
  };
}

export function NetworkMissionPage({ mission }: { mission: NetworkMission }) {
  const [restored] = useState(() => loadDraft(mission));
  const [attempt, setAttempt] = useState<MissionAttempt>(() => restored?.attempt ?? freshAttempt(mission));
  const variant = mission.variants.find((v) => v.id === attempt.variant)!;
  const [network, setNetwork] = useState<Network>(() => restored?.network ?? variant.build());
  const [action, setAction] = useState<Action>(variant.probe);
  const [selected, setSelected] = useState(""),
    [tab, setTab] = useState<InspectorTab>("mission"),
    [notice, setNotice] = useState(""),
    [store, setStore] = useState(() => loadMissionStore(storage())),
    [assessment, setAssessment] = useState<Assessment | null>(null),
    [failedOnce, setFailedOnce] = useState(false),
    [predicted, setPredicted] = useState<string | null>(null),
    [guess, setGuess] = useState<{ device: string; area: Area | "" }>({ device: "", area: "" }),
    [diagnosisFeedback, setDiagnosisFeedback] = useState(""),
    [answer, setAnswer] = useState(""),
    [answerFeedback, setAnswerFeedback] = useState(""),
    [explained, setExplained] = useState<string | null>(null);
  const journey = useJourney(network);
  const inspectorRef = useRef<HTMLElement>(null);
  const record = store.missions[mission.id];
  const state = missionState(record, mission);
  const position = mission.variants.indexOf(variant) + 1;
  useEffect(() => {
    document.title = `${mission.title} · Networking missions · Kitab`;
  }, [mission.title]);
  // Every change to the attempt is saved: progress and the learner's own network survive a reload.
  function save(next: MissionAttempt, nextNetwork = network) {
    setAttempt(next);
    const updated = recordAttempt(store, mission, next);
    setStore(updated);
    saveMissionStore(storage(), updated);
    try {
      storage().setItem(`${DRAFT_KEY}.${mission.id}`, JSON.stringify({ missionId: mission.id, version: mission.version, attempt: next, network: nextNetwork }));
    } catch {
      // Progress is still kept for this visit.
    }
  }
  function edit(next: Network, positionsOnly = false) {
    setNetwork(next);
    if (!positionsOnly) {
      journey.reset();
      setAssessment(null);
    }
    save(attempt, next);
  }
  const blocked = (message: string) => setNotice(message);

  // When the prediction is asked depends on what it is about.
  const prediction = mission.prediction;
  const askPrediction =
    prediction && predicted === null && attempt.prediction === null
      ? prediction.when === "before-probe"
        ? !journey.trace
        : prediction.when === "after-failure"
          ? failedOnce
          : mission.kind === "fix" && !attempt.completedAt
      : false;
  const correctPrediction = useMemo(() => prediction?.answer(variant.build(), variant), [prediction, variant]);

  function send() {
    setNotice("");
    const result = journey.run(action);
    if (!result) return;
    if (!result.success) setFailedOnce(true);
  }
  function check() {
    if (mission.kind !== "fix") return;
    const result = assessFix(mission, variant, network);
    setAssessment(result);
    const failing = result.checks.find((c) => !c.passed);
    journey.show((failing ?? result.checks[0]).trace, (failing ?? result.checks[0]).evidence);
    if (result.completed && !attempt.completedAt) save({ ...attempt, completedAt: new Date().toISOString() });
  }
  // The step on the diagram is the learner's evidence.
  function evidenceNow(trace: Trace | null = journey.trace) {
    return !!trace && evidenceShows(mission, variant, trace, journey.index);
  }
  function submitDiagnosis() {
    if (!guess.device || !guess.area) return;
    const result = diagnose(variant, { device: guess.device, area: guess.area }, network);
    const evidence = evidenceNow();
    setDiagnosisFeedback(
      `${result.message}${evidence ? " The step you are showing is good evidence." : " To count as evidence, show a step of a failing run where the problem appears (for example where it stopped)."}`,
    );
    const diagnosis = result.correct ? (attempt.diagnosis === null ? "first-try" : attempt.diagnosis === "wrong" ? "later" : attempt.diagnosis) : attempt.diagnosis ?? "wrong";
    save({ ...attempt, diagnosis, evidence: attempt.evidence || (result.correct && evidence) });
  }
  function submitAnswer() {
    if (mission.kind !== "investigate") return;
    const expected = investigationAnswer(mission, variant);
    const right = Number(answer) === expected;
    const evidence = evidenceNow();
    setAnswerFeedback(
      right
        ? evidence
          ? "Correct, and the step you are showing is the retransmission evidence."
          : "Correct. Now show the retransmitted segment on the diagram (step to it) and submit again to record your evidence."
        : `Not ${answer}. ${mission.question.explain}`,
    );
    save({
      ...attempt,
      completedAt: right ? attempt.completedAt ?? new Date().toISOString() : attempt.completedAt,
      evidence: attempt.evidence || (right && evidence),
    });
  }
  function nextVersion() {
    const next = { ...freshAttempt(mission) };
    const v = mission.variants.find((x) => x.id === next.variant)!;
    const n = v.build();
    setNetwork(n);
    setAction(v.probe);
    journey.reset();
    setAssessment(null);
    setFailedOnce(false);
    setPredicted(null);
    setGuess({ device: "", area: "" });
    setDiagnosisFeedback("");
    setAnswer("");
    setAnswerFeedback("");
    setExplained(null);
    setSelected("");
    save(next, n);
  }
  function openInPlayground() {
    try {
      sessionStorage.setItem(SCRATCH_KEY, JSON.stringify({ ...structuredClone(network), name: `${mission.title} (practice copy)` }));
    } catch {
      return setNotice("Your browser blocked the copy. The playground is still available from the menu.");
    }
    navigate("/practice/network?scratch=1");
  }
  const useHint = () => save({ ...attempt, hints: Math.min(3, attempt.hints + 1) });
  const hints = [...mission.hints, variant.focus].slice(0, attempt.hints);
  const completed = !!attempt.completedAt;
  const gaps = notYetMastered(record, mission);
  const steps = (
    <div className="mission-steps" aria-label="Mission steps">
      {askPrediction && prediction && (
        <section className="mission-card" aria-label="Predict">
          <h3>Predict first</h3>
          <p>{prediction.prompt}</p>
          <div className="mission-options">
            {prediction.options(network).map((o) => (
              <button
                key={o.id}
                className="small-button"
                onClick={() => {
                  setPredicted(o.id);
                  save({ ...attempt, prediction: o.id === correctPrediction });
                }}
              >
                {o.text}
              </button>
            ))}
          </div>
        </section>
      )}
      {predicted !== null && prediction && (
        <section className={`mission-card ${predicted === correctPrediction ? "is-right" : "is-wrong"}`} role="status">
          <h3>{predicted === correctPrediction ? "Your prediction was right." : "Not quite."}</h3>
          <p>{prediction.explain}</p>
        </section>
      )}
      {mission.kind === "fix" ? (
        <>
          <section className="mission-card" aria-label="Diagnose">
            <h3>Name the cause <small>(for mastery; you can fix it without this)</small></h3>
            <p>Pick the device and the kind of setting at fault, and show a step of a failing run on the diagram as your evidence.</p>
            <div className="mission-fields">
              <label>
                <span>Device</span>
                <select aria-label="Faulty device" value={guess.device} onChange={(e) => setGuess((g) => ({ ...g, device: e.target.value }))}>
                  <option value="">Choose a device</option>
                  {network.devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Setting</span>
                <select aria-label="Faulty setting" value={guess.area} onChange={(e) => setGuess((g) => ({ ...g, area: e.target.value as Area }))}>
                  <option value="">Choose a kind of setting</option>
                  {mission.areas.map((a) => (
                    <option key={a} value={a}>
                      {areaLabels[a]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="small-button" disabled={!guess.device || !guess.area} onClick={submitDiagnosis}>
                Submit diagnosis
              </button>
            </div>
            <p className="mission-evidence-now">
              Evidence shown now: {journey.trace ? `step ${journey.index + 1}, ${journey.trace.events[journey.index].title}` : "nothing yet; send something first"}
            </p>
            {diagnosisFeedback && (
              <p className="mission-feedback" role="status">
                {diagnosisFeedback}
              </p>
            )}
          </section>
          <section className="mission-card" aria-label="Check your fix">
            <h3>Fix it, then check</h3>
            <p>Change the settings in the Device tab. The check runs real traffic on your network and shows the evidence.</p>
            <button className="button primary" onClick={check}>
              Check my fix
            </button>
            {assessment && (
              <ul className="mission-checks" aria-label="Check results">
                {assessment.checks.map((c) => (
                  <li key={c.id} className={c.passed ? "is-passed" : "is-failed"}>
                    {c.passed ? <Check size={14} /> : <X size={14} />} <b>{c.label}</b>
                    {c.message && <span>{c.message}</span>}
                    <button className="text-button" onClick={() => journey.show(c.trace, c.evidence)}>
                      Show {c.passed ? "the proof" : "where it failed"}
                    </button>
                  </li>
                ))}
                {[...assessment.locked, ...assessment.shortcuts].map((m) => (
                  <li key={m} className="is-failed">
                    <X size={14} /> <span>{m}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="mission-card" aria-label="Investigate">
          <h3>{mission.question.prompt}</h3>
          <p>Send the request, find the evidence in the journey, then answer. Leave the diagram on the step that proves it.</p>
          <div className="mission-fields">
            <label>
              <span>Acknowledgement number</span>
              <input aria-label="Acknowledgement number" inputMode="numeric" value={answer} onChange={(e) => setAnswer(e.target.value.replace(/\D/g, ""))} />
            </label>
            <button className="small-button" disabled={!answer} onClick={submitAnswer}>
              Submit answer
            </button>
          </div>
          <p className="mission-evidence-now">
            Evidence shown now: {journey.trace ? `step ${journey.index + 1}, ${journey.trace.events[journey.index].title}` : "nothing yet; send the request first"}
          </p>
          {answerFeedback && (
            <p className="mission-feedback" role="status">
              {answerFeedback}
            </p>
          )}
        </section>
      )}
      <section className="mission-card mission-hints" aria-label="Hints">
        {hints.map((h, i) => (
          <p key={h}>
            <b>Hint {i + 1}:</b> {h}
          </p>
        ))}
        <button className="text-button" disabled={attempt.hints >= 3} onClick={useHint}>
          <CircleHelp size={13} /> {attempt.hints >= 3 ? "No more hints" : `Show hint ${attempt.hints + 1} of 3`}
        </button>
        {attempt.hints === 2 && <small>The last hint points to the device or setting; using it still completes the mission, but not towards mastery.</small>}
      </section>
      {completed && (
        <section className="mission-card is-right" aria-label="Mission completed">
          <h3>Completed. What you proved:</h3>
          <p>{mission.proved}</p>
          <p>
            <b>What was wrong:</b> {variant.cause}
          </p>
          <h3>{mission.explanation.prompt}</h3>
          <div className="mission-options">
            {mission.explanation.options.map((o) => (
              <button
                key={o.id}
                className={`small-button ${explained === o.id ? (o.correct ? "is-right" : "is-wrong") : ""}`}
                disabled={explained !== null && attempt.explanation === true}
                onClick={() => {
                  setExplained(o.id);
                  if (attempt.explanation === null) save({ ...attempt, explanation: o.correct });
                }}
              >
                {o.text}
              </button>
            ))}
          </div>
          {explained && (
            <p className="mission-feedback">
              {mission.explanation.options.find((o) => o.id === explained)!.correct ? "Yes, that is the rule at work." : "That is a common misconception; read the step explanations on the diagram and try another answer."}
            </p>
          )}
        </section>
      )}
      <section className="mission-card" aria-label="Progress">
        <h3>{state === "mastered" ? "Mastered" : "Towards mastery"}</h3>
        {state === "mastered" ? (
          <p>You solved two versions with different causes, with first-try diagnoses, evidence and explanations.</p>
        ) : (
          <ul>
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        )}
        <div className="mission-actions">
          {completed && (
            <button className="button primary" onClick={nextVersion}>
              Try another version <ArrowRight size={14} />
            </button>
          )}
          <a className="text-button" {...linkProps("/practice/missions")}>
            All missions
          </a>
        </div>
      </section>
    </div>
  );
  return (
    <main id="main" className="network-playground network-mission">
      <header className="mission-heading">
        <a className="eyebrow" {...linkProps("/practice/missions")}>
          ← NETWORKING MISSIONS · LEVEL {mission.level}
        </a>
        <h1>{mission.title}</h1>
        <p className="mission-symptom">{variant.symptom}</p>
        <p className="mission-meta">
          <span className={`state-pill is-${state}`}>{practiceLabels[state]}</span> Version {position} of {mission.variants.length}
          <button
            className="text-button mission-jump"
            onClick={() => {
              setTab("mission");
              inspectorRef.current?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            }}
          >
            Mission steps ↓
          </button>
        </p>
      </header>
      <details className="mission-brief" open={!journey.trace}>
        <summary>About this mission</summary>
          <p>{mission.brief}</p>
          <h3>What you will practise</h3>
          <ul>
            {mission.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          {(mission.locks.length > 0 || mission.topologyLocked) && (
            <details className="mission-locks">
              <summary>
                <LockIcon size={13} /> Fixed in this mission
              </summary>
              <ul>
                {mission.topologyLocked && <li>Cables and devices: {mission.topologyLocked}</li>}
                {mission.locks.map((l) => (
                  <li key={`${l.aspect}${l.devices}`}>
                    <b>{aspectLabels[l.aspect]}</b>
                    {l.devices ? ` on ${l.devices.map((id) => network.devices.find((d) => d.id === id)?.name ?? id).join(", ")}` : ""}: {l.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button className="text-button" onClick={openInPlayground}>
            <FlaskConical size={13} /> Open a copy in the playground
          </button>
      </details>
      {notice && (
        <div className="network-notice" role="status">
          <span>{notice}</span>
          <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <section className="lab-shell" aria-label="Mission network">
        <div className="workspace-grid">
          <div className="workspace-stage">
            <JourneyStage
              journey={journey}
              network={network}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                setTab("device");
              }}
              onMove={(id, x, y) => edit({ ...network, devices: network.devices.map((d) => (d.id === id ? { ...d, x, y } : d)) }, true)}
              onAdd={() => blocked("This mission doesn't need extra devices. Open a copy in the playground to experiment freely.")}
              start={{ label: `${action.kind === "dhcp" ? "Configure automatically" : "Send request"} and follow it`, disabled: !action.source, onClick: send }}
              onAbout={(id) => {
                setSelected(id);
                setTab("device");
              }}
              onInspect={() => {
                journey.setPlaying(false);
                setTab("packet");
              }}
              advice={false}
            />
            <SendPanel
              network={network}
              action={action}
              onAction={setAction}
              onSend={send}
              inputError={journey.inputError}
              onClearError={journey.clearInputError}
              onRestart={() => journey.reset()}
              kinds={mission.kinds}
            />
          </div>
          <InspectorPanel
            journey={journey}
            network={network}
            selected={selected}
            onSelect={setSelected}
            tab={tab}
            onTab={setTab}
            panelRef={inspectorRef}
            mission={steps}
            editor={{
              onApply: (updated) => {
                const before = network.devices.find((d) => d.id === updated.id)!;
                const lock = lockBroken(mission, before, updated);
                if (lock) return blocked(`${aspectLabels[lock.aspect][0].toUpperCase()}${aspectLabels[lock.aspect].slice(1)} can't be changed in this mission: ${lock.why}`);
                const next = { ...network, devices: network.devices.map((d) => (d.id === updated.id ? updated : d)) };
                const errors = validateNetwork(next);
                if (errors.length) return blocked(errors.join(" "));
                setNotice("");
                edit(next);
              },
              onDelete: () => blocked("Devices can't be removed in this mission."),
              onConnect: (a, b, medium) => {
                if (mission.topologyLocked) return blocked(`Cables can't be changed in this mission. ${mission.topologyLocked}`);
                try {
                  edit(connect(network, a, b, medium));
                } catch (e) {
                  blocked((e as Error).message);
                }
              },
              onDisconnect: (id) => {
                if (mission.topologyLocked) return blocked(`Cables can't be changed in this mission. ${mission.topologyLocked}`);
                edit({ ...network, links: network.links.filter((l) => l.id !== id) });
              },
            }}
          />
        </div>
      </section>
    </main>
  );
}

/** Resolves the mission here, so the main bundle never loads the networking engine. */
export function NetworkMissionRoute({ id, notFound }: { id: string; notFound: ReactNode }) {
  const mission = findNetworkMission(id);
  return mission ? <NetworkMissionPage mission={mission} /> : <>{notFound}</>;
}

/** Every networking mission, with the same progress states as the TCP missions. */
export function NetworkMissionsIndex({ tcp }: { tcp: { id: string; title: string; summary: string; state: import("../learning/practice-state.ts").PracticeState }[] }) {
  const store = loadMissionStore(storage());
  useEffect(() => {
    document.title = "Networking missions · Kitab";
  }, []);
  return (
    <main id="main" className="network-playground network-missions">
      <header className="mission-heading">
        <span className="eyebrow">PRACTICE · NETWORKING</span>
        <h1>Networking missions</h1>
        <p>
          Real problems on real simulated networks. Investigate with the journey, fix the configuration, and prove it with evidence. Each mission has several versions with different causes.
        </p>
        <a className="text-button" {...linkProps("/practice/network")}>
          Prefer to build freely? Open the network playground →
        </a>
      </header>
      <ol className="mission-list">
        {missions.map((m) => {
          const state = missionState(store.missions[m.id], m);
          return (
            <li key={m.id}>
              <a {...linkProps(`/practice/missions/${m.id}`)}>
                <span className="mission-level">Level {m.level}</span>
                <b>{m.title}</b>
                <span>{m.brief}</span>
                <span className={`state-pill is-${state}`}>{practiceLabels[state]}</span>
              </a>
            </li>
          );
        })}
      </ol>
      <h2 className="mission-list-heading">TCP missions</h2>
      <ol className="mission-list">
        {tcp.map((m) => (
          <li key={m.id}>
            <a {...linkProps(`/missions/${m.id}`)}>
              <span className="mission-level">TCP</span>
              <b>{m.title}</b>
              <span>{m.summary}</span>
              <span className={`state-pill is-${m.state}`}>{practiceLabels[m.state]}</span>
            </a>
          </li>
        ))}
      </ol>
    </main>
  );
}
