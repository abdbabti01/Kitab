import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, BadgeCheck, Check, ChevronLeft, ChevronRight, Crosshair, FlaskConical, Pause, Play, RotateCcw, Send } from "lucide-react";
import "../learning/engines/index.ts";
import { findMission } from "../learning/missions/catalog.ts";
import { loadProgress, missionStatus, safeStorage } from "../learning/progress.ts";
import { createNav, currentStep, navReducer, restoreNav, visibleSteps, type NavAction, type NavState } from "../learning/lessons/navigation.ts";
import { lessonStatus, loadLearning, recordLessonVisit, recordStep, saveLearning } from "../learning/lessons/progress.ts";
import { JOURNEY, resolveTrack, safeParams, stepDelta, type ResolvedStep, type Track } from "../learning/lessons/runtime.ts";
import type { Lesson } from "../learning/lessons/schema.ts";
import type { Entity, Fact, FactValue, LearningFrame } from "../learning/types.ts";
import { askLessonTutor } from "../app/api.ts";
import { linkProps } from "../app/router.ts";
import { KitabAvatar } from "../mission/KitabAvatar.tsx";
import { useFlip, useReducedMotion } from "../mission/motion.ts";
import { sceneFor } from "../mission/scenes/index.ts";
import type { GuideMood } from "../learning/guide.ts";
import "../mission/mission.css";
import "./lesson.css";

const storage = safeStorage();
const plain = new Intl.NumberFormat("en-US", { useGrouping: false });
const format = (value: FactValue) => (typeof value === "boolean" ? (value ? "yes" : "no") : typeof value === "number" ? plain.format(value) : value);

type TutorState =
  | { status: "idle" }
  | { status: "pending"; key: string }
  | { status: "answered"; key: string; text: string; source: "ai" | "fallback"; target: string | null; offline: boolean };

export function LessonPage({ lesson }: { lesson: Lesson }) {
  const trackFor = useCallback((params: Record<string, FactValue>, id: string) => resolveTrack(lesson, params, id), [lesson]);
  const [boot] = useState(() => {
    const { learning, recovered } = loadLearning(storage);
    const saved = learning.lessons[lesson.id];
    const restored = saved?.position && saved.lessonVersion === lesson.version
      ? restoreNav(lesson, { lessonId: lesson.id, lessonVersion: saved.lessonVersion, ...saved.position }, trackFor, (raw) => safeParams(lesson, raw))
      : null;
    return { learning: recordLessonVisit(learning, lesson), restored, recovered, updated: Boolean(saved && saved.lessonVersion !== lesson.version) };
  });
  const [learning, setLearning] = useState(boot.learning);
  const [nav, setNav] = useState<NavState>(() => boot.restored ?? createNav(lesson, trackFor({}, JOURNEY)));
  const dispatch = useCallback((action: NavAction) => setNav((state) => navReducer(state, action, trackFor)), [trackFor]);

  const track = useMemo(() => trackFor(nav.params, nav.track), [trackFor, nav.params, nav.track]);
  const step = currentStep(nav, track);
  const stepIndex = track.steps.indexOf(step);
  const list = visibleSteps(nav, track);
  const listIndex = list.indexOf(step);
  const previous = track.steps[stepIndex - 1];
  const following = track.steps[stepIndex + 1];
  const reduced = useReducedMotion();
  const module = sceneFor(track.trace.engine.id);
  const levelOf = (id: string) => lesson.levels.find((level) => level.id === id)!;
  const chapter = track.chapters[step.chapterIndex];
  const isJourney = track.id === JOURNEY;
  const atEnd = listIndex === list.length - 1 || (listIndex < 0 && stepIndex === track.steps.length - 1);

  useEffect(() => {
    document.title = `${lesson.title} · Kitab`;
  }, [lesson.title]);

  // Persist meaningful progress (the step the learner is on), never per animation frame.
  useEffect(() => {
    setLearning((current) => {
      const next = recordStep(current, lesson, nav, track);
      saveLearning(storage, next);
      return next;
    });
  }, [lesson, nav, track]);

  // ---------------------------------------------------------------- selection and Kitab's pointer
  const [selected, setSelected] = useState<string | null>(null);
  const [attention, setAttention] = useState<string | null>(null);
  useEffect(() => setAttention(null), [step.id, track.trace.scenarioKey]);
  useEffect(() => setSelected(null), [track.trace.scenarioKey]);

  // ---------------------------------------------------------------- replay: show the previous step's state, then move to this one
  // The replayed index belongs to one track, scenario and step: after any change it is ignored in the
  // same render, so it can never index a different (possibly shorter) trace.
  const replayKey = `${track.id}:${track.trace.scenarioKey}:${step.id}`;
  const [replay, setReplay] = useState<{ key: string; frameIndex: number } | null>(null);
  const replayFrame = replay?.key === replayKey ? replay.frameIndex : null;
  const replayable = Boolean(previous && previous.frameIndex !== step.frameIndex);
  useEffect(() => {
    if (!nav.replay || !previous || previous.frameIndex === step.frameIndex) return;
    setReplay({ key: replayKey, frameIndex: previous.frameIndex });
    const timer = window.setTimeout(() => setReplay(null), reduced ? 1100 : 600);
    return () => window.clearTimeout(timer);
  }, [nav.replay]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setReplay(null), [replayKey]);

  const shownIndex = replayFrame ?? step.frameIndex;
  const baseFrame = track.trace.frames[shownIndex];
  const sceneFrame: LearningFrame = useMemo(() => ({ ...baseFrame, focus: replayFrame === null ? step.focus : [] }), [baseFrame, replayFrame, step.focus]);
  const frame = track.trace.frames[step.frameIndex];
  const sceneRef = useRef<HTMLDivElement>(null);
  useFlip(sceneRef, `${baseFrame.id}`, `${track.id}:${track.trace.scenarioKey}`, 520, reduced);

  // ---------------------------------------------------------------- autoplay (off by default)
  const [auto, setAuto] = useState({ playing: false, speed: 1 });
  useEffect(() => {
    if (!auto.playing) return;
    if (atEnd) {
      setAuto((value) => ({ ...value, playing: false }));
      return;
    }
    const reading = 1600 + (step.what.length + step.why.length) * 30;
    const timer = window.setTimeout(() => dispatch({ type: "NEXT" }), reading / auto.speed);
    return () => window.clearTimeout(timer);
  }, [auto, step.id, atEnd, step.what.length, step.why.length, dispatch]);
  const manual = useCallback((action: NavAction) => {
    setAuto((value) => (value.playing ? { ...value, playing: false } : value));
    dispatch(action);
  }, [dispatch]);

  // Arrow keys step through the lesson unless the learner is typing or using a control that owns the arrows.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role='radiogroup']")) return;
      if (event.key === "ArrowRight") manual({ type: "NEXT" });
      else if (event.key === "ArrowLeft") manual({ type: "BACK" });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manual]);

  // ---------------------------------------------------------------- optional AI follow-up
  const tutorKey = `${track.id}|${track.trace.scenarioKey}|${step.id}|${nav.level?.id ?? ""}`;
  const latestKey = useRef(tutorKey);
  latestKey.current = tutorKey;
  const abort = useRef<AbortController | null>(null);
  const [tutor, setTutor] = useState<TutorState>({ status: "idle" });
  const [question, setQuestion] = useState("");
  // A different step, level, scenario or track makes any pending or shown answer obsolete.
  useEffect(() => () => abort.current?.abort(), [tutorKey]);
  useEffect(() => setTutor((current) => (current.status !== "idle" && current.key !== tutorKey ? { status: "idle" } : current)), [tutorKey]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 3 || tutor.status === "pending") return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const key = tutorKey;
    const stale = () => controller.signal.aborted || latestKey.current !== key;
    setTutor({ status: "pending", key });
    try {
      const reply = await askLessonTutor({ lessonId: lesson.id, lessonVersion: lesson.version, params: nav.params, track: track.id, stepId: step.id, level: nav.level?.id ?? null, question: text }, controller.signal);
      if (stale()) return;
      setTutor({ status: "answered", key, text: reply.response.explanation, source: reply.source, target: reply.response.attention, offline: false });
    } catch {
      if (stale()) return;
      setTutor({ status: "answered", key, text: `${step.what} ${step.why}`, source: "fallback", target: step.focus[0] ?? null, offline: true });
    }
  }

  // ---------------------------------------------------------------- derived panels
  const entities = new Map(frame.entities.map((item) => [item.id, item]));
  const selectedEntity = selected ? entities.get(selected) ?? null : null;
  const pointAt = (id: string | null) => {
    if (!id || !entities.has(id)) return;
    setAttention(id);
    document.querySelector<HTMLElement>(`[data-entity="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  };
  const delta = useMemo(() => stepDelta(track, previous, step).slice(0, 5), [track, previous, step]);
  const progress = useMemo(() => loadProgress(storage).progress, []);
  const journey = useMemo(() => trackFor(nav.params, JOURNEY), [trackFor, nav.params]);
  const status = lessonStatus(learning, lesson, journey.steps.length);
  const record = learning.lessons[lesson.id];
  const seenChapter = (id: string) => isJourney && Boolean(record?.chaptersSeen.includes(id));
  const nextChapter = track.chapters[step.chapterIndex + 1];
  const mood: GuideMood = tutor.status === "pending" ? "thinking" : attention ? "pointing" : stepIndex === 0 ? "welcoming" : atEnd && isJourney ? "celebrating" : "explaining";
  const Scene = module?.Scene;
  const focusLabels = step.focus.map((id) => entities.get(id)?.label).filter(Boolean);
  // Reviewed content only: the step's own line, else the first new term, else where the evidence is.
  const guideLine = step.kitab
    ?? (step.terms[0] ? `New term: ${step.terms[0].term}. ${step.terms[0].definition}` : focusLabels.length ? `Look at the highlighted ${focusLabels.slice(0, 2).join(" and ")}. Select it to see its exact values.` : "Select anything in the picture to see what it is.");

  return (
    <div className="lesson-page">
      <header className="lesson-top">
        <a className="back" {...linkProps("/")}><ArrowLeft aria-hidden="true" /> <span>Kitab</span></a>
        <div className="lesson-heading">
          <p className="eyebrow">{lesson.topic} · Guided walkthrough{isJourney ? "" : ` · Experiment`}</p>
          <p className="lesson-question">{isJourney ? lesson.question : track.title}</p>
        </div>
        <p className={`review-chip ${lesson.review.status}`}><BadgeCheck aria-hidden="true" /> {lesson.review.status === "reviewed" ? "Reviewed · computed by Kitab" : "Draft — not reviewed"}</p>
      </header>

      <nav className="chapter-strip" aria-label={isJourney ? "Chapters" : "Experiment"}>
        <ol>
          {track.chapters.map((item, index) => {
            const current = index === step.chapterIndex;
            const recommended = !current && item.id === nextChapter?.id && step.indexInChapter === step.chapterSize - 1;
            return (
              <li key={item.id}>
                <button type="button" className={`chapter-pill ${current ? "is-current" : ""} ${seenChapter(item.id) && !current ? "is-seen" : ""} ${recommended ? "is-recommended" : ""}`} aria-current={current ? "step" : undefined} onClick={() => manual({ type: "GOTO_CHAPTER", chapterId: item.id })}>
                  <span className="chapter-num" aria-hidden="true">{seenChapter(item.id) && !current ? <Check /> : index + 1}</span>
                  <span className="chapter-name">{item.title}</span>
                  {recommended && <span className="chapter-tag">Next</span>}
                </button>
              </li>
            );
          })}
        </ol>
        {!isJourney && <button type="button" className="button small-button" onClick={() => manual({ type: "END_EXPERIMENT" })}><ArrowLeft aria-hidden="true" /> Back to the journey</button>}
      </nav>

      {(boot.updated || boot.recovered) && stepIndex === 0 && (
        <p className="lesson-notice" role="status">{boot.updated ? "This lesson was updated since your last visit, so it starts from the beginning." : "Your saved place couldn't be read, so the lesson starts from the beginning."}</p>
      )}

      <main id="main" className="lesson-grid">
        <nav className="level-rail" aria-label="Levels">
          <p className="rail-title">Levels</p>
          <ol>
            {lesson.levels.map((level) => {
              const now = level.id === step.level;
              const open = nav.level?.id === level.id;
              return (
                <li key={level.id}>
                  <button type="button" className={`level-button ${now ? "is-now" : ""} ${open ? "is-open" : ""}`} aria-current={now ? "true" : undefined} aria-expanded={open} aria-controls="level-panel" onClick={() => manual(open ? { type: "CLOSE_LEVEL", resume: "return" } : { type: "OPEN_LEVEL", levelId: level.id })}>
                    <span className="level-name">{level.name}{now && <em className="level-now-tag">Now</em>}</span>
                    <small>{level.short}</small>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="stage" aria-labelledby="step-title">
          <div className="stage-head">
            <p className="step-meta">{isJourney ? `Chapter ${step.chapterIndex + 1} · ${chapter.title}` : chapter.title} · step {step.indexInChapter + 1} of {step.chapterSize}</p>
            <h1 id="step-title" className="step-title">{step.title}</h1>
            <p className="step-who"><span className={`level-badge level-${step.level}`}>{levelOf(step.level).name} level</span> <span>Who acts: <b>{step.actor}</b></span></p>
          </div>
          <p className="mobile-what">{step.what}</p>
          {step.indexInChapter === 0 && <p className="chapter-goal"><b>{chapter.title}.</b> {chapter.goal}</p>}
          <div className={`stage-scene ${replayFrame !== null ? "is-replaying" : ""}`}>
            {replayFrame !== null && <p className="replay-tag" role="status">Before: {previous?.title}</p>}
            <div className="scene-body" ref={sceneRef}>
              {Scene ? <Scene frame={sceneFrame} trace={track.trace} selected={selected} attention={attention} onSelect={(id: string) => { setSelected(id); setAttention(null); }} /> : <p className="error-text">No scene is registered for “{track.trace.engine.id}”.</p>}
            </div>
          </div>
          <Controls
            onBack={() => manual({ type: "BACK" })}
            onNext={() => manual({ type: "NEXT" })}
            onReplay={() => manual({ type: "REPLAY" })}
            canBack={listIndex > 0 || (listIndex < 0 && stepIndex > 0)}
            canNext={!atEnd}
            canReplay={replayable}
            auto={auto}
            onAuto={(value) => setAuto(value)}
            position={`${(listIndex < 0 ? stepIndex : listIndex) + 1} / ${list.length}`}
            nextLabel={following && following.chapterIndex !== step.chapterIndex && nav.level?.stage !== "explore" ? `Next: ${track.chapters[following.chapterIndex].title}` : "Next"}
          />
          <p className="sr-only" aria-live="polite">{auto.playing ? "" : `${step.title}. ${levelOf(step.level).name} level.`}</p>
          <ExampleControls lesson={lesson} params={track.trace.params} onApply={(params) => manual({ type: "SET_PARAMS", params: safeParams(lesson, { ...nav.params, ...params }) })} />
          {stepIndex === 0 && isJourney && (
            <details className="scope card" open>
              <summary>About this example</summary>
              <ul>{lesson.scope.map((line) => <li key={line}>{line}</li>)}</ul>
              <p className="muted small">Before you start: {lesson.prerequisites}</p>
            </details>
          )}
        </section>

        <aside className="explain" aria-label="Explanation">
          {nav.level && (
            <LevelPanel lesson={lesson} track={track} nav={nav} step={step} onExplore={() => manual({ type: "EXPLORE_LEVEL" })} onClose={(resume) => manual({ type: "CLOSE_LEVEL", resume })} />
          )}
          <section className="step-card card" aria-labelledby="step-what">
            <h2 id="step-what" className="card-label">What happens</h2>
            <p className="step-what">{step.what}</p>
            <h3 className="card-label">Why it's needed</h3>
            <p className="step-why">{step.why}</p>
            {delta.length > 0 && (
              <>
                <h3 className="card-label">Before → after</h3>
                <ul className="delta">{delta.map((line) => <li key={line}>{line}</li>)}</ul>
              </>
            )}
            {step.terms.length > 0 && (
              <div className="terms" aria-label="New terms">
                {step.terms.map((term) => (
                  <details className="term" key={term.id}>
                    <summary>{term.term}</summary>
                    <p>{term.definition}</p>
                  </details>
                ))}
              </div>
            )}
            <p className="connection">
              {previous && <span><small>Before:</small> {previous.title}</span>}
              {following && <span><small>Next:</small> {following.title}</span>}
            </p>
          </section>

          <ObjectPanel lesson={lesson} entity={selectedEntity} selected={selected} facts={frame.facts} onClear={() => setSelected(null)} />

          <section className="lesson-guide card" aria-label="Kitab, your guide">
            <div className="guide-head">
              <KitabAvatar mood={mood} size={56} />
              <div className="guide-title"><b>Kitab</b><small>your guide</small></div>
            </div>
            <p className="guide-message">{guideLine}</p>
            <div className="guide-actions">
              <button type="button" onClick={() => pointAt(step.focus.find((id) => entities.has(id)) ?? null)} disabled={!step.focus.some((id) => entities.has(id))}>
                <Crosshair aria-hidden="true" /> Show me where
              </button>
            </div>
            <form className="ask" onSubmit={ask}>
              <label htmlFor="ask-input">Ask a follow-up question <span className="muted">(optional, uses AI)</span></label>
              <div className="ask-row">
                <input id="ask-input" value={question} maxLength={300} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about this step…" autoComplete="off" />
                <button type="submit" className="icon-button" aria-label="Ask Kitab" disabled={question.trim().length < 3 || tutor.status === "pending"}><Send aria-hidden="true" /></button>
              </div>
            </form>
            {tutor.status === "pending" && <p className="guide-source" role="status">Kitab is checking this step…</p>}
            {tutor.status === "answered" && (
              <div className="tutor-answer" role="status">
                <p>{tutor.text}</p>
                <p className="guide-source">
                  {tutor.source === "ai" ? "AI answer, checked against this step's computed facts. It can still be imperfect." : tutor.offline ? "Kitab's AI helper couldn't be reached, so this is the reviewed explanation." : "Reviewed explanation (the AI helper was not used for this answer)."}
                </p>
                {tutor.target && entities.has(tutor.target) && <button type="button" className="text-button" onClick={() => pointAt(tutor.target)}><Crosshair aria-hidden="true" /> Show {entities.get(tutor.target)!.label}</button>}
              </div>
            )}
          </section>

          {isJourney && atEnd && <Completion lesson={lesson} status={status} completed={Boolean(record?.completedAt)} progress={progress} onExperiment={(id) => manual({ type: "START_EXPERIMENT", id })} />}
          {!isJourney && atEnd && <Compare lesson={lesson} track={track} journey={journey} onBack={() => manual({ type: "END_EXPERIMENT" })} />}
        </aside>
      </main>
    </div>
  );
}

function Controls({ onBack, onNext, onReplay, canBack, canNext, canReplay, auto, onAuto, position, nextLabel }: {
  onBack: () => void; onNext: () => void; onReplay: () => void; canBack: boolean; canNext: boolean; canReplay: boolean;
  auto: { playing: boolean; speed: number }; onAuto: (value: { playing: boolean; speed: number }) => void; position: string; nextLabel: string;
}) {
  return (
    <div className="lesson-controls" role="group" aria-label="Step controls">
      <button type="button" className="button" onClick={onBack} disabled={!canBack}><ChevronLeft aria-hidden="true" /> Back</button>
      <button type="button" className="button replay-button" aria-label="Replay" onClick={onReplay} disabled={!canReplay} title={canReplay ? "Show the previous state, then this change again" : "Nothing moved in this step"}><RotateCcw aria-hidden="true" /> <span className="control-label">Replay</span></button>
      <button type="button" className="button primary next-button" onClick={onNext} disabled={!canNext}><span>{canNext ? nextLabel : "End of this path"}</span> <ChevronRight aria-hidden="true" /></button>
      <span className="step-position" aria-label={`Step ${position}`}>{position}</span>
      <div className="autoplay">
        <button type="button" className="icon-button" onClick={() => onAuto({ ...auto, playing: !auto.playing })} disabled={!canNext && !auto.playing} aria-pressed={auto.playing} aria-label={auto.playing ? "Pause autoplay" : "Autoplay the steps"}>
          {auto.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <label>
          <span className="sr-only">Autoplay speed</span>
          <select value={auto.speed} onChange={(event) => onAuto({ ...auto, speed: Number(event.target.value) })}>
            <option value="0.75">0.75×</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function ExampleControls({ lesson, params, onApply }: { lesson: Lesson; params: Record<string, FactValue>; onApply: (params: Record<string, FactValue>) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!lesson.controls.length) return null;
  return (
    <details className="example-controls card">
      <summary>Change the example</summary>
      {lesson.controls.map((control) =>
        control.control === "text" ? (
          <form key={control.key} className="field" onSubmit={(event) => { event.preventDefault(); onApply({ [control.key]: drafts[control.key] ?? String(params[control.key]) }); }}>
            <label htmlFor={`control-${control.key}`}>{control.label}</label>
            <div className="ask-row">
              <input id={`control-${control.key}`} value={drafts[control.key] ?? String(params[control.key] ?? "")} onChange={(event) => setDrafts({ ...drafts, [control.key]: event.target.value })} maxLength={control.maxLength * 2} />
              <button type="submit" className="button">Use it</button>
            </div>
            <small className="muted">{control.help}</small>
          </form>
        ) : (
          <fieldset key={control.key} className="field">
            <legend>{control.label}</legend>
            <div className="choice-row" role="radiogroup" aria-label={control.label}>
              {control.options.map((option) => (
                <label key={String(option.value)} className={`choice ${params[control.key] === option.value ? "is-chosen" : ""}`}>
                  <input type="radio" name={control.key} checked={params[control.key] === option.value} onChange={() => onApply({ [control.key]: option.value })} />
                  {option.label}
                </label>
              ))}
            </div>
            <small className="muted">{control.help}</small>
          </fieldset>
        ),
      )}
    </details>
  );
}

function LevelPanel({ lesson, track, nav, step, onExplore, onClose }: { lesson: Lesson; track: Track; nav: NavState; step: ResolvedStep; onExplore: () => void; onClose: (resume: "return" | "here") => void }) {
  const level = lesson.levels.find((item) => item.id === nav.level!.id)!;
  const own = track.steps.filter((item) => item.level === level.id);
  const chapters = [...new Set(own.map((item) => track.chapters[item.chapterIndex].title))];
  const returnStep = track.steps.find((item) => item.id === nav.level!.returnStepId);
  const exploring = nav.level!.stage === "explore";
  return (
    <section id="level-panel" className={`level-panel card level-${level.id}`} aria-labelledby="level-panel-title">
      <p className="card-label">{exploring ? "Exploring a level" : "Level"}</p>
      <h2 id="level-panel-title">{level.name}: {level.short}</h2>
      {!exploring && <p>{level.intro}</p>}
      {exploring
        ? <p className="muted small">Step {own.indexOf(step) + 1} of {own.length} at this level. Back and Next stay on this level.</p>
        : <p className="muted small">{own.length} step{own.length === 1 ? "" : "s"} happen at this level{chapters.length ? `, in: ${chapters.join(", ")}` : ""}.</p>}
      <div className="actions">
        {!exploring && own.length > 0 && <button type="button" className="button primary" onClick={onExplore}>Explore these steps</button>}
        <button type="button" className="button" onClick={() => onClose("return")}>Back to the journey{returnStep && returnStep.id !== step.id ? ` (${returnStep.title})` : ""}</button>
        {exploring && returnStep?.id !== step.id && <button type="button" className="text-button" onClick={() => onClose("here")}>Continue the journey from here</button>}
      </div>
    </section>
  );
}

function ObjectPanel({ lesson, entity, selected, facts, onClear }: { lesson: Lesson; entity: Entity | null; selected: string | null; facts: Fact[]; onClear: () => void }) {
  if (!selected) return <p className="object-hint muted small">Tip: select anything in the picture to see what it is, where it came from and its exact values.</p>;
  if (!entity) {
    return (
      <section className="object-panel card" aria-label="Selected object">
        <p>The object you selected isn't present at this step.</p>
        <button type="button" className="text-button" onClick={onClear}>Clear selection</button>
      </section>
    );
  }
  const kind = lesson.kinds[entity.kind];
  const values = facts.filter((fact) => fact.entityId === entity.id);
  return (
    <section className="object-panel card" aria-labelledby="object-title">
      <p className="card-label">Selected</p>
      <h2 id="object-title">{entity.label}</h2>
      {kind && <p><b>What it is.</b> {kind.represents}</p>}
      {entity.origin && <p><b>Where it came from.</b> {entity.origin}</p>}
      {kind && <p><b>Why it matters.</b> {kind.matters}</p>}
      {values.length > 0 && (
        <dl className="facts">
          {values.map((fact) => (
            <div key={fact.id}><dt>{fact.label}</dt><dd>{format(fact.value)}</dd></div>
          ))}
        </dl>
      )}
      <button type="button" className="text-button" onClick={onClear}>Close</button>
    </section>
  );
}

function Completion({ lesson, status, completed, progress, onExperiment }: { lesson: Lesson; status: ReturnType<typeof lessonStatus>; completed: boolean; progress: ReturnType<typeof loadProgress>["progress"]; onExperiment: (id: string) => void }) {
  const practice = lesson.practice.map((item) => ({ ...item, mission: findMission(item.missionId)! })).filter((item) => item.mission);
  const states = practice.map((item) => missionStatus(progress, item.mission.id, item.mission.version));
  const attempted = states.some((state) => state === "practiced" || state === "mastered");
  const mastered = states.some((state) => state === "mastered");
  return (
    <section className="completion card" aria-labelledby="completion-title">
      <h2 id="completion-title">{completed ? "Walkthrough complete" : "End of the walkthrough"}</h2>
      <ul className="status-list">
        <li className="is-yes">Visited</li>
        <li className={status.seen >= status.total ? "is-yes" : ""}>Learning progress: {status.seen} of {status.total} steps seen</li>
        <li className={completed ? "is-yes" : ""}>{completed ? "Walkthrough completed" : "Walkthrough not complete yet: visit every chapter"}</li>
        <li className={attempted ? "is-yes" : ""}>{attempted ? "Practice attempted" : "Practice not attempted"}</li>
        <li className={mastered ? "is-yes" : ""}>{mastered ? "Mastery demonstrated in practice" : "Mastery not shown yet: it's earned by predicting in practice"}</li>
      </ul>
      {lesson.experiments.map((experiment) => (
        <button type="button" className="button primary" key={experiment.id} onClick={() => onExperiment(experiment.id)}><FlaskConical aria-hidden="true" /> Experiment: {experiment.title}</button>
      ))}
      {practice.length > 0 && (
        <>
          <h3 className="card-label">Practise with a new scenario</h3>
          <ul className="practice-list">
            {practice.map((item) => (
              <li key={item.missionId}><a {...linkProps(`/missions/${item.missionId}`)}><b>{item.mission.title}</b><small>{item.why}</small></a></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Compare({ lesson, track, journey, onBack }: { lesson: Lesson; track: Track; journey: Track; onBack: () => void }) {
  const experiment = lesson.experiments.find((item) => item.id === track.id)!;
  return (
    <section className="compare card" aria-labelledby="compare-title">
      <h2 id="compare-title">Normal run vs. this experiment</h2>
      <table>
        <thead><tr><th scope="col">Computed</th><th scope="col">Normal</th><th scope="col">Experiment</th></tr></thead>
        <tbody>
          {experiment.compare.map((item) => {
            const before = journey.trace.outcome[item.outcome];
            const after = track.trace.outcome[item.outcome];
            return (
              <tr key={item.outcome} className={before === after ? "" : "is-different"}>
                <th scope="row">{item.label}</th><td>{format(before)}</td><td>{format(after)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="button" onClick={onBack}><ArrowLeft aria-hidden="true" /> Back to the journey</button>
    </section>
  );
}
