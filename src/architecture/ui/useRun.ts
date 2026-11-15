import { useEffect, useMemo, useRef, useState } from "react";
import { foldEvents, type Fold } from "../metrics.ts";
import type { SimRun } from "../simulate.ts";

export const SPEEDS = [0.1, 0.25, 1, 4] as const;

/** How many events happened at or before time t. */
export function eventsUpTo(run: SimRun, t: number) {
  let lo = 0;
  let hi = run.events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (run.events[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type Cursor = { count: number; t: number };

/**
 * Playback of one run. The cursor is a number of events and a time; the fold of those events is the only state
 * the diagram, inspector, metrics and timeline read.
 */
export function useRunPlayback(run: SimRun | null) {
  const [cursor, setCursor] = useState<Cursor>({ count: 0, t: 0 });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const foldRef = useRef<Fold | null>(null);
  const lastT = useRef(0);

  useEffect(() => {
    foldRef.current = null;
    setCursor({ count: 0, t: 0 });
    setPlaying(false);
  }, [run]);

  useEffect(() => {
    if (!playing || !run) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = (now - last) * speed;
      last = now;
      let done = false;
      setCursor((c) => {
        const t = Math.min(run.endMs, c.t + dt);
        done = t >= run.endMs;
        return { t, count: eventsUpTo(run, t) };
      });
      if (done) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, run]);

  const fold = useMemo(() => {
    if (!run) return null;
    // Going back in time rebuilds from the start; going forward applies only the new events.
    const previous = cursor.t < lastT.current ? null : foldRef.current;
    const f = foldEvents(run, previous, cursor.count);
    f.t = cursor.t;
    f.transit = f.transit.filter((item) => item.until > cursor.t);
    foldRef.current = f;
    lastT.current = cursor.t;
    return f;
  }, [run, cursor]);

  const controls = {
    play: () => run && (cursor.t >= run.endMs ? (setCursor({ count: 0, t: 0 }), setPlaying(true)) : setPlaying(true)),
    pause: () => setPlaying(false),
    step: () => {
      if (!run || cursor.count >= run.events.length) return;
      setPlaying(false);
      setCursor((c) => ({ count: c.count + 1, t: run.events[c.count].t }));
    },
    stepBack: () => {
      if (!run || cursor.count === 0) return;
      setPlaying(false);
      setCursor((c) => ({ count: c.count - 1, t: c.count > 1 ? run.events[c.count - 2].t : 0 }));
    },
    reset: () => {
      setPlaying(false);
      setCursor({ count: 0, t: 0 });
    },
    seek: (t: number) => run && setCursor({ t, count: eventsUpTo(run, t) }),
    /** Jump to just after one event, e.g. from the timeline. */
    seekEvent: (index: number) => {
      if (!run) return;
      setPlaying(false);
      setCursor({ count: index + 1, t: run.events[index].t });
    },
    toEnd: () => run && (setPlaying(false), setCursor({ count: run.events.length, t: run.endMs })),
    setSpeed,
  };
  return { cursor, playing, speed, fold, controls };
}
