// One run of the simulation and the learner's place in it: shared by the playground and missions.
// There is exactly one playback state; every view reads the current event index from here.
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { newSession, simulate } from "./network/engine.ts";
import { stageAt, stagesOf } from "./network/stages.ts";
import { beatsOf, durationsOf, type Beat } from "./network/motion.ts";
import { MODE_KEY, type JourneyMode, type Point } from "./journey-nav.ts";
import type { Action, Network, Session, Trace } from "./network/model.ts";

export type InputError = { field: "source" | "target"; message: string };

/**
 * `onShowStop` hears when "Show where and why" puts the stop on the diagram (missions track it as assistance).
 * `limit` hides the rest of a run after one event (Predict as you go): every view then receives the run only
 * up to that event, so nothing later can be seen, scrubbed to or played until the limit moves on.
 */
export function useJourney(network: Network, onShowStop?: (trace: Trace, index: number) => void, limit?: (trace: Trace) => number | undefined) {
  const [session, setSession] = useState<Session>(newSession),
    [full, setTrace] = useState<Trace | null>(null),
    [wanted, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    // On narrow screens the whole network is too small to read, so the camera follows the journey.
    [follow, setFollow] = useState(() => {
      try {
        return matchMedia("(max-width: 760px)").matches;
      } catch {
        return false;
      }
    }),
    [cardOpen, setCardOpen] = useState(true),
    // Whether the run's result may be shown: not while Send's playback is on its way to it.
    [revealed, setRevealed] = useState(true),
    [positions, setPositions] = useState<Record<string, Point>>({}),
    [scale, setScale] = useState(1),
    [inputError, setInputError] = useState<InputError | null>(null),
    // Summary is the first-visit default; the learner's choice is remembered on this device.
    [mode, setMode] = useState<JourneyMode>(() => {
      try {
        const saved = localStorage.getItem(MODE_KEY);
        return saved === "events" || saved === "exchange" ? saved : "summary";
      } catch {
        return "summary";
      }
    });
  const journeyRef = useRef<HTMLDivElement>(null);
  const gate = full && limit ? limit(full) : undefined;
  const trace = useMemo(
    () => (full && gate !== undefined && gate < full.events.length - 1 ? { ...full, events: full.events.slice(0, gate + 1) } : full),
    [full, gate],
  );
  /** Later events exist but are hidden. */
  const gated = trace !== full;
  // Steps may be asked for beyond the limit (an answer moves it on in the same moment); they are shown once visible.
  const index = Math.min(wanted, (trace?.events.length ?? 1) - 1);
  const stages = useMemo(() => (trace ? stagesOf(trace.events, network) : []), [trace, network]);
  const stage = trace ? stages[stageAt(stages, index)] : undefined;
  const event = trace?.events[index];
  // Playback time per event, read from the whole run (so hiding its end changes nothing), and what each event shows.
  const { durations, beats } = useMemo(() => {
    if (!full) return { durations: [] as number[], beats: [] as Beat[] };
    return { durations: durationsOf(full.events, network, stagesOf(full.events, network)), beats: beatsOf(full.events, network) };
  }, [full, network]);
  useEffect(() => {
    if (!playing || !trace) return;
    // The end of what can be seen: the run's last event, or the last one before a hidden part.
    if (index >= trace.events.length - 1) return setPlaying(false);
    const timer = window.setTimeout(() => setIndex(index + 1), Math.max(60, (durations[index] ?? 1100) / speed));
    return () => clearTimeout(timer);
  }, [playing, speed, trace, index, durations]);
  // The result is shown once the run reaches its last event, by playing there or by going there.
  useEffect(() => {
    if (full && !gated && index >= full.events.length - 1) setRevealed(true);
  }, [full, gated, index]);
  // Playback does not carry on unseen in a background tab.
  useEffect(() => {
    const away = () => document.hidden && setPlaying(false);
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, []);

  /** Forgets the run and any acquired state such as DHCP leases. */
  function reset() {
    setSession(newSession());
    setTrace(null);
    setIndex(0);
    setPlaying(false);
  }
  /** Runs an action on the current session. A typing mistake is shown at the form and returns null. With `play`
   * the journey starts playing at once (the playground's Send); otherwise it waits on the first event. */
  function run(action: Action, on: Network = network, { play = false } = {}): Trace | null {
    setPlaying(false);
    const result = simulate(on, session, action);
    if (result.reason?.startsWith("INPUT_")) {
      setInputError({ field: result.reason === "INPUT_SOURCE" ? "source" : "target", message: result.summary });
      return null;
    }
    setInputError(null);
    // Bring the diagram into view if the learner pressed Send from further down the page.
    requestAnimationFrame(() => {
      const box = journeyRef.current?.getBoundingClientRect();
      if (box && (box.top < 0 || box.top > innerHeight * 0.4))
        journeyRef.current!.scrollIntoView({
          block: "start",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
    });
    setSession(result.session);
    setTrace(result);
    setIndex(0);
    setPlaying(play);
    // Played from the start, the result waits for the end; a run that is not played shows it at once (missions).
    setRevealed(!play);
    return result;
  }
  /** Shows a run that was made elsewhere (e.g. a mission check), at a chosen event. The session is kept. */
  function show(result: Trace, at: number) {
    setPlaying(false);
    setTrace(result);
    setIndex(Math.max(0, Math.min(result.events.length - 1, at)));
    setRevealed(true);
    setCardOpen(true);
  }
  function step(next: number) {
    setPlaying(false);
    setIndex(Math.max(0, Math.min((full?.events.length ?? 1) - 1, next)));
  }
  function play() {
    if (trace && index >= trace.events.length - 1) {
      // At a hidden part there is nothing further to play; at the real end, play from the start.
      if (gated) return setPlaying(false);
      setIndex(0);
    }
    setPlaying((p) => !p);
  }
  function chooseMode(next: JourneyMode) {
    // A transition keeps the current view on screen while the Exchange view loads, instead of a fallback.
    startTransition(() => setMode(next));
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // The choice still applies for this visit.
    }
  }
  // The failing step holds the full explanation; status lines only point to it.
  const stoppedAt = trace && !trace.success && !gated ? trace.events.length - 1 : -1;
  const stoppedBy = stoppedAt >= 0 ? network.devices.find((d) => d.id === trace!.events[stoppedAt].actor)?.name ?? "" : "";
  function showStop() {
    if (trace) onShowStop?.(trace, stoppedAt);
    step(stoppedAt);
    setCardOpen(true);
  }
  // Announce stage changes; when stepping by hand in Every event, announce each event.
  // With the rest of the run hidden, so is its length.
  const announcement = !trace
    ? ""
    : mode === "events" && !playing
      ? `Event ${index + 1}${gated ? "" : ` of ${trace.events.length}`}: ${trace.events[index].title}`
      : `Stage ${stageAt(stages, index) + 1}${gated ? "" : ` of ${stages.length}`}: ${stage?.title}`;
  return {
    session,
    shownSession: event?.snapshot ?? session,
    trace,
    /** The whole run, including any part hidden by `limit`. */
    fullTrace: full,
    gated,
    /** The result may be shown: the run has reached its end, or was opened or shown rather than played. */
    revealed: revealed && !gated,
    index,
    playing,
    setPlaying,
    /** Milliseconds at 1× for each event of the whole run, and what each event shows (motion.ts). */
    durations,
    beats,
    speed,
    setSpeed,
    follow,
    setFollow,
    cardOpen,
    setCardOpen,
    positions,
    scale,
    setLayout: (p: Record<string, Point>, s: number) => {
      setPositions(p);
      setScale(s);
    },
    inputError,
    clearInputError: () => setInputError(null),
    mode,
    chooseMode,
    stages,
    stage,
    event,
    journeyRef,
    reset,
    run,
    show,
    step,
    play,
    stoppedAt,
    stoppedBy,
    showStop,
    announcement,
  };
}
export type Journey = ReturnType<typeof useJourney>;
