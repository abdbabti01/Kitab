// One run of the simulation and the learner's place in it: shared by the playground and missions.
// There is exactly one playback state; every view reads the current event index from here.
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { newSession, simulate } from "./network/engine.ts";
import { stageAt, stagesOf } from "./network/stages.ts";
import { MODE_KEY, type JourneyMode, type Point } from "./journey-nav.ts";
import type { Action, Network, Session, Trace } from "./network/model.ts";

export type InputError = { field: "source" | "target"; message: string };

/** `onShowStop` hears when "Show where and why" puts the stop on the diagram (missions track it as assistance). */
export function useJourney(network: Network, onShowStop?: (trace: Trace, index: number) => void) {
  const [session, setSession] = useState<Session>(newSession),
    [trace, setTrace] = useState<Trace | null>(null),
    [index, setIndex] = useState(0),
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
  const stages = useMemo(() => (trace ? stagesOf(trace.events, network) : []), [trace, network]);
  const stage = trace ? stages[stageAt(stages, index)] : undefined;
  const event = trace?.events[index];
  useEffect(() => {
    if (!playing || !trace) return;
    const timer = window.setInterval(
      () =>
        setIndex((i) => {
          if (i >= trace.events.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      Math.max(120, 1100 / speed),
    );
    return () => clearInterval(timer);
  }, [playing, speed, trace]);

  /** Forgets the run and any acquired state such as DHCP leases. */
  function reset() {
    setSession(newSession());
    setTrace(null);
    setIndex(0);
    setPlaying(false);
  }
  /** Runs an action on the current session. A typing mistake is shown at the form and returns null. */
  function run(action: Action, on: Network = network): Trace | null {
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
    return result;
  }
  /** Shows a run that was made elsewhere (e.g. a mission check), at a chosen event. The session is kept. */
  function show(result: Trace, at: number) {
    setPlaying(false);
    setTrace(result);
    setIndex(Math.max(0, Math.min(result.events.length - 1, at)));
    setCardOpen(true);
  }
  function step(next: number) {
    setPlaying(false);
    setIndex(Math.max(0, Math.min((trace?.events.length ?? 1) - 1, next)));
  }
  function play() {
    if (trace && index >= trace.events.length - 1) setIndex(0);
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
  const stoppedAt = trace && !trace.success ? trace.events.length - 1 : -1;
  const stoppedBy = stoppedAt >= 0 ? network.devices.find((d) => d.id === trace!.events[stoppedAt].actor)?.name ?? "" : "";
  function showStop() {
    if (trace) onShowStop?.(trace, stoppedAt);
    step(stoppedAt);
    setCardOpen(true);
  }
  // Announce stage changes; when stepping by hand in Every event, announce each event.
  const announcement = !trace
    ? ""
    : mode === "events" && !playing
      ? `Event ${index + 1} of ${trace.events.length}: ${trace.events[index].title}`
      : `Stage ${stageAt(stages, index) + 1} of ${stages.length}: ${stage?.title}`;
  return {
    session,
    shownSession: event?.snapshot ?? session,
    trace,
    index,
    playing,
    setPlaying,
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
