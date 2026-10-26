import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import "../learning/engines/index.ts";
import { assessExplanation, assessPrediction, evidenceFrameIndex, fillTemplate, traceFor, type PredictionAnswer } from "../learning/assessment.ts";
import { guideReducer, initialGuide, type GuideEvent } from "../learning/guide.ts";
import { attemptStatus, createAttempt, createMissionState, missionReducer, paramsChangeIsCurrent, type MissionAction, type MissionState, type ParamsExpectation } from "../learning/mission-controller.ts";
import type { Mission } from "../learning/mission-schema.ts";
import { missions } from "../learning/missions/catalog.ts";
import { loadProgress, recordState, recordVisit, restoreState, safeStorage, saveProgress } from "../learning/progress.ts";
import { fallbackTutor, buildTutorContext, tutorRequestSchema } from "../learning/tutor.ts";
import type { FactValue } from "../learning/types.ts";
import { frameAt } from "../learning/registry.ts";
import { askTutor, sendLearningEvent } from "../app/api.ts";
import { linkProps } from "../app/router.ts";
import { Inspector } from "./Inspector.tsx";
import { KitabGuide, type GuideAction } from "./KitabGuide.tsx";
import { useFlip, useReducedMotion } from "./motion.ts";
import { PhasePanel } from "./PhasePanel.tsx";
import { PlaybackBar, usePlayback } from "./Playback.tsx";
import { sceneFor } from "./scenes/index.ts";
import "./mission.css";

const storage = safeStorage();

export function MissionPage({ mission }: { mission: Mission }) {
  const [progress, setProgress] = useState(() => recordVisit(loadProgress(storage).progress, mission.id, mission.version));
  const restored = useMemo(() => restoreState(progress, mission.id, mission.version), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, dispatchMission] = useReducer(missionReducer, null, () => restored ?? createMissionState(mission));
  const [guide, dispatchGuide] = useReducer(guideReducer, initialGuide);
  const [selected, setSelected] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState(1);
  const [tutorBusy, setTutorBusy] = useState(false);
  const tutorAbort = useRef<AbortController | null>(null);
  const reducedMotion = useReducedMotion();

  const trace = useMemo(() => traceFor(mission, state.attempt.params), [mission, state.attempt.params]);
  const unlocked = state.phase === "run" || state.phase === "explain" || state.phase === "result";
  const playback = usePlayback(trace, unlocked);
  // Before the prediction, only the inspect frame is visible: no future state leaks.
  const frame = unlocked ? frameAt(trace, playback.index) : trace.frames[0];
  const module = sceneFor(trace.engine.id);
  const lastIndex = trace.frames.length - 1;

  // The latest committed state, for replies that resolve after the render that issued them.
  const latest = useRef({ state, scenarioKey: trace.scenarioKey });
  latest.current = { state, scenarioKey: trace.scenarioKey };

  const emit = useCallback((event: GuideEvent) => dispatchGuide(event), []);
  const dispatch = useCallback((action: MissionAction) => dispatchMission(action), []);

  useEffect(() => {
    emit({ type: "mission-opened", objective: mission.objective, returning: Boolean(restored) });
    document.title = `${mission.title} · Kitab`;
  }, [emit, mission, restored]);

  // Persist meaningful state (phase/attempt changes), never per animation frame.
  useEffect(() => {
    setProgress((current) => {
      const next = recordState(current, state, trace.scenarioKey, attemptStatus(state.attempt));
      saveProgress(storage, next);
      return next;
    });
  }, [state, trace.scenarioKey]);

  // The run is complete only when the learner actually reaches the final engine frame.
  useEffect(() => {
    if (state.phase === "run" && playback.index === lastIndex) {
      dispatch({ type: "RUN_COMPLETED" });
      emit({ type: "run-completed", correct: state.attempt.skippedPrediction ? null : Boolean(state.attempt.prediction?.correct) });
    }
  }, [state.phase, playback.index, lastIndex, dispatch, emit, state.attempt]);

  // Cancel an in-flight tutor request when the attempt or its scenario changes (settings edits keep the attempt id), or on leaving.
  useEffect(() => () => {
    const pending = tutorAbort.current;
    if (pending && !pending.signal.aborted) {
      pending.abort();
      emit({ type: "tutor-cancelled" });
    }
  }, [state.attempt.id, trace.scenarioKey, emit]);

  const entities = new Map(frame.entities.map((item) => [item.id, item.label]));
  const attention = guide.target && entities.has(guide.target) ? guide.target : null;
  const selectedLabel = selected ? entities.get(selected) ?? null : null;

  function select(id: string) {
    setSelected(id);
    const facts = frame.facts.filter((fact) => fact.entityId === id).slice(0, 3).map((fact) => `${fact.label}: ${String(fact.value)}`).join(" · ");
    emit({ type: "object-selected", entityId: id, label: entities.get(id) ?? id, summary: facts });
  }

  function predict(answer: PredictionAnswer, reasoning: string) {
    const result = assessPrediction(mission, trace, answer);
    dispatch({ type: "SUBMIT_PREDICTION", answer, result, reasoning });
    emit({ type: "prediction-submitted" });
    playback.dispatch({ type: "SEEK", index: 0 });
    playback.dispatch({ type: "PLAY" });
    void sendLearningEvent({ type: "prediction-submitted", missionId: mission.id, missionVersion: mission.version, engineVersion: trace.engine.version, scenarioKey: trace.scenarioKey, correct: result.correct });
  }

  function skip() {
    dispatch({ type: "SKIP_PREDICTION" });
    playback.dispatch({ type: "SEEK", index: 0 });
    playback.dispatch({ type: "PLAY" });
    emit({ type: "run-started" });
  }

  function explain(choiceId: string) {
    const result = assessExplanation(mission, choiceId);
    dispatch({ type: "SUBMIT_EXPLANATION", choiceId, ...result });
    const mastered = result.correct && Boolean(state.attempt.prediction?.correct) && !state.attempt.skippedPrediction;
    if (mastered) {
      emit({ type: "mastered" });
      void sendLearningEvent({ type: "mission-mastered", missionId: mission.id, missionVersion: mission.version, engineVersion: trace.engine.version, scenarioKey: trace.scenarioKey, correct: true });
    } else {
      const misconception = result.misconception ? mission.misconceptions[result.misconception] : undefined;
      emit({ type: "explanation-assessed", correct: result.correct, message: misconception ? fillTemplate(misconception.message, trace) : undefined });
    }
  }

  function showEvidence() {
    const index = evidenceFrameIndex(mission, trace);
    playback.dispatch({ type: "SEEK", index });
    const code = state.attempt.prediction?.misconception;
    const misconception = code ? mission.misconceptions[code] : undefined;
    const evidenceFrame = trace.frames[index];
    if (misconception) emit({ type: "misconception-identified", label: misconception.label, message: fillTemplate(misconception.message, trace), target: misconception.target ? fillTemplate(misconception.target, trace) : evidenceFrame.focus[0] });
    else emit({ type: "hint-requested", text: `Step ${index + 1}: ${evidenceFrame.title}. ${evidenceFrame.narration}`, target: evidenceFrame.focus[0] });
  }

  function retry() {
    const attempt = createAttempt(mission, state.attempt.number + 1);
    dispatch({ type: "NEW_ATTEMPT", attempt });
    setSelected(null);
    setHintLevel(1);
    const variant = mission.variants.find((item) => item.id === attempt.variantId);
    emit({ type: "retry-started", variantLabel: variant?.label ?? "your settings" });
  }

  function setParam(key: string, value: FactValue) {
    setParams({ ...trace.params, [key]: value }, { attemptId: state.attempt.id, params: state.attempt.params });
  }

  /**
   * Applies new lab settings only while they are still based on the current attempt and scenario, before a
   * prediction. Checked against the latest state here and again inside the reducer.
   */
  function setParams(params: Record<string, FactValue>, expect: ParamsExpectation) {
    if (!paramsChangeIsCurrent(latest.current.state, expect)) return false;
    dispatch({ type: "APPLY_PARAMS", expect, params });
    return true;
  }

  async function askKitab(intent: GuideAction) {
    const request = tutorRequestSchema.parse({
      missionId: mission.id,
      missionVersion: mission.version,
      params: trace.params,
      frameIndex: frame.index,
      intent,
      hintLevel,
      phase: state.phase,
      prediction: state.attempt.prediction?.answer ?? null,
      reasoning: state.attempt.prediction?.reasoning ?? "",
    });
    if (intent === "hint") setHintLevel((level) => Math.min(4, level + 1));
    // The same context builder the server uses gives an instant, reviewed fallback.
    const fallback = fallbackTutor(buildTutorContext(mission, request));
    tutorAbort.current?.abort();
    const issued = { attemptId: state.attempt.id, scenarioKey: trace.scenarioKey };
    const stale = () => controller.signal.aborted || latest.current.state.attempt.id !== issued.attemptId || latest.current.scenarioKey !== issued.scenarioKey;
    const controller = new AbortController();
    tutorAbort.current = controller;
    setTutorBusy(true);
    emit({ type: "tutor-pending" });
    try {
      const reply = await askTutor(request, controller.signal);
      if (stale()) return;
      emit({ type: "tutor-response", text: reply.response.explanation, target: reply.response.attention ?? undefined, source: reply.source });
    } catch {
      if (stale()) return;
      emit({ type: "tutor-failed", fallbackText: fallback.explanation, target: fallback.attention ?? undefined });
    } finally {
      if (tutorAbort.current === controller) setTutorBusy(false);
    }
  }

  function showTarget() {
    if (!attention) return;
    const element = document.querySelector<HTMLElement>(`[data-entity="${CSS.escape(attention)}"]`);
    element?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    element?.focus({ preventScroll: true });
    setSelected(attention);
  }

  const sceneRef = useRef<HTMLDivElement>(null);
  useFlip(sceneRef, frame.id, `${state.attempt.id}:${trace.scenarioKey}`, Math.min(700, frame.durationMs * 0.6 / playback.speed), reducedMotion);

  useEffect(() => {
    if (playback.status === "paused" && state.phase === "run") emit({ type: "run-paused" });
  }, [playback.status, state.phase, emit]);

  const missionIndex = missions.findIndex((item) => item.id === mission.id);
  const nextMission = missions[missionIndex + 1]?.id;
  const Scene = module?.Scene;

  return (
    <div className="mission-page">
      <header className="topbar">
        <a className="back" {...linkProps("/")}><ArrowLeft aria-hidden="true" /> <span>Kitab</span></a>
        <p className="crumb"><span>{mission.topic}</span> · Mission</p>
        <p className={`review-chip ${mission.review.status}`}>
          <BadgeCheck aria-hidden="true" /> {mission.review.status === "reviewed" ? "Reviewed · computed by Kitab" : "Draft — not reviewed"}
        </p>
      </header>
      <main id="main" className="mission-layout">
        <div className="mission-main">
          <div className="mission-head">
            <p className="eyebrow">Mission {state.attempt.number > 1 ? `· attempt ${state.attempt.number}` : ""}</p>
            <h1>{mission.title}</h1>
            <p className="objective">{mission.objective}</p>
          </div>
          <section className="scene card" aria-label="Interactive scene">
            <div className="scene-head">
              <p className="scene-step">{unlocked ? `Step ${frame.index + 1} of ${trace.frames.length}` : "Starting state"}</p>
              <h2 className="scene-title">{frame.title}</h2>
              <p className="scene-narration">{frame.narration}</p>
            </div>
            <div className="scene-body" ref={sceneRef}>
              {Scene ? <Scene frame={frame} trace={trace} selected={selected} attention={attention} onSelect={select} /> : <p className="error-text">No renderer is registered for engine “{trace.engine.id}”.</p>}
            </div>
            <PlaybackBar playback={playback} trace={trace} enabled={unlocked} disabledReason="Make a prediction to run the system. Until then, only the starting state is shown." />
            <p className="sr-only" aria-live="polite">{unlocked ? `Step ${frame.index + 1}: ${frame.title}` : ""}</p>
          </section>
        </div>
        <div className="mission-side">
          <PhasePanel
            mission={mission}
            trace={trace}
            state={state}
            onBegin={() => { if (state.phase === "inspect") { dispatch({ type: "BEGIN_PREDICTION" }); emit({ type: "prediction-started" }); } }}
            onPredict={predict}
            onSkip={skip}
            onExplain={explain}
            onReflection={(text) => dispatch({ type: "SET_REFLECTION", text })}
            onRetry={() => retry()}
            onShowEvidence={showEvidence}
            onParam={setParam}
            onParams={setParams}
            nextMissionId={nextMission}
          />
          <KitabGuide
            guide={guide}
            busy={tutorBusy}
            canAskWhyWrong={(state.phase === "explain" || state.phase === "result") && state.attempt.prediction?.correct === false}
            canExplainStep
            targetLabel={attention ? entities.get(attention) ?? null : null}
            onAction={(action) => void askKitab(action)}
            onShowTarget={showTarget}
            onToggle={() => emit({ type: "toggle-collapsed" })}
          />
          <Inspector mission={mission} trace={trace} frame={frame} selected={selected} selectedLabel={selectedLabel} onSelect={select} Reference={module?.Reference} />
        </div>
      </main>
    </div>
  );
}

export type { MissionState };
