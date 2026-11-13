// The homepage's demonstration: a recording of a real run of the network lab (see src/practice/network/hero.ts), not
// an illustration. It plays the recorded link crossings once, in order, and ends on the run's own summary; Replay
// shows the same recording again (the network sends nothing more). It holds still with reduced motion, pauses when
// the page is hidden or the demo is off screen, and never takes the focus.
import { useEffect, useRef, useState } from "react";
import { Laptop, Pause, Play, RotateCcw, Router, Server, SkipBack, SkipForward } from "lucide-react";
import recording from "./hero-trace.json";

const MOVE = 1100,
  HOLD = 1500;
const icons = { pc: Laptop, router: Router, server: Server } as Record<string, typeof Laptop>;
const W = 560,
  H = 210,
  X = [80, 280, 480];
/** "Ethernet frame carrying an ARP request" → "ARP request"; what the capsule is labelled with. */
const short = (what: string) => what.split(/ with an? | carrying an? /).at(-1)!;

export function HeroDemo() {
  const { devices, crossings, events, summary, source } = recording;
  const name = (id: string) => devices.find((d) => d.id === id)!.name;
  const at = (id: string) => X[devices.findIndex((d) => d.id === id)];
  // Step k shows crossing k; `done` is the end, with the summary. t is how far the capsule has travelled (0–1).
  const [step, setStep] = useState(0),
    [t, setT] = useState(1),
    [playing, setPlaying] = useState(false),
    [done, setDone] = useState(false);
  const reduced = useRef(false);
  const figure = useRef<HTMLElement>(null);
  const visible = useRef({ page: true, screen: false });
  // Start when the demo is first on screen, unless motion is reduced.
  useEffect(() => {
    reduced.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = figure.current;
    if (!el) return;
    let started = false;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current.screen = entry.isIntersecting;
      if (entry.isIntersecting && !started && !reduced.current) {
        started = true;
        setT(0);
        setPlaying(true);
      }
      if (!entry.isIntersecting) setPlaying(false);
    });
    observer.observe(el);
    const away = () => document.hidden && setPlaying(false);
    document.addEventListener("visibilitychange", away);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", away);
    };
  }, []);
  // One crossing: the capsule travels, then the step is held so its explanation can be read.
  useEffect(() => {
    if (!playing || done) return;
    let frame = 0,
      timer = 0;
    const from = performance.now() - t * MOVE;
    const tick = (now: number) => {
      const k = Math.min(1, (now - from) / MOVE);
      setT(k);
      if (k < 1) frame = requestAnimationFrame(tick);
      else
        timer = window.setTimeout(() => {
          if (step + 1 < crossings.length) {
            setStep(step + 1);
            setT(0);
          } else {
            setDone(true);
            setPlaying(false);
          }
        }, HOLD);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [playing, step, done]);

  const c = crossings[step];
  const go = (k: number) => {
    setPlaying(false);
    setDone(false);
    setStep(Math.max(0, Math.min(crossings.length - 1, k)));
    setT(reduced.current ? 0.5 : 1);
  };
  function playPause() {
    if (done) {
      setDone(false);
      setStep(0);
      setT(reduced.current ? 0.5 : 0);
      setPlaying(!reduced.current);
      return;
    }
    if (playing) return setPlaying(false);
    if (t >= 1) {
      if (step + 1 >= crossings.length) return setDone(true);
      setStep(step + 1);
    }
    setT(0);
    setPlaying(true);
  }
  // With reduced motion the capsule rests half way along its link; nothing moves by itself.
  const k = reduced.current && !playing ? 0.5 : t;
  const x = at(c.from) + (at(c.to) - at(c.from)) * (1 - (1 - k) ** 2);
  const label = short(c.what);
  const capsuleW = label.length * 7.4 + 26;
  return (
    <figure className="hero-demo" ref={figure} aria-labelledby="hero-demo-title">
      <div className="hero-demo-top">
        <span>Recorded in the network lab</span>
        <span>{source.action}</span>
      </div>
      <figcaption id="hero-demo-title">Watch one ping cross a router, frame by frame.</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="hero-demo-stage" aria-hidden="true">
        <line x1={X[0]} x2={X[1]} y1="78" y2="78" className={`hero-wire${!done && (c.from === devices[0].id || c.to === devices[0].id) ? " is-on" : ""}`} />
        <line x1={X[1]} x2={X[2]} y1="78" y2="78" className={`hero-wire${!done && (c.from === devices[2].id || c.to === devices[2].id) ? " is-on" : ""}`} />
        {devices.map((d, i) => {
          const Icon = icons[d.kind] ?? Laptop;
          const role = !done && d.id === c.from ? " is-sender" : !done && d.id === c.to ? " is-receiver" : "";
          return (
            <g key={d.id} transform={`translate(${X[i]} 78)`} className={`hero-device${role}`}>
              <rect x="-38" y="-34" width="76" height="68" rx="16" />
              <Icon x={-14} y={-14} width={28} height={28} />
              <text y="58" textAnchor="middle" className="hero-name">
                {d.name}
              </text>
              <text y="76" textAnchor="middle" className="hero-ip">
                {d.ip}
              </text>
            </g>
          );
        })}
        {!done && (
          <g className={`hero-packet kind-${c.kind}${c.broadcast ? " is-broadcast" : ""}`} transform={`translate(${x} 40)`}>
            <rect x={-capsuleW / 2} y="-13" width={capsuleW} height="26" rx="13" />
            <text y="4.5" textAnchor="middle">
              {label}
            </text>
          </g>
        )}
      </svg>
      <div className="hero-demo-caption" aria-live={playing ? "off" : "polite"}>
        {done ? (
          <>
            <b>{summary}</b>
            <span>
              {crossings.length} link crossings, recorded from {events} simulated events. Replay shows the same recording again.
            </span>
          </>
        ) : (
          <>
            <b>{c.stage}</b>
            <span>
              {name(c.from)} sends to {name(c.to)}: {c.broadcast ? "a broadcast " : /^[AEIOH]/.test(c.what) ? "an " : "a "}
              {c.what}.
            </span>
            <small>
              Step {step + 1} of {crossings.length} · event {c.index + 1} of {events}
            </small>
          </>
        )}
      </div>
      <div className="hero-demo-controls">
        <button type="button" onClick={() => go(step - 1)} disabled={!done && step === 0} aria-label="Previous step">
          <SkipBack aria-hidden="true" />
        </button>
        <button type="button" onClick={playPause} aria-label={done ? "Replay the recording" : playing ? "Pause" : "Play"}>
          {done ? <RotateCcw aria-hidden="true" /> : playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => (step + 1 < crossings.length ? go(step + 1) : (setPlaying(false), setDone(true)))} disabled={done} aria-label="Next step">
          <SkipForward aria-hidden="true" />
        </button>
      </div>
      <details className="hero-demo-steps">
        <summary>All {crossings.length} steps as text</summary>
        <ol>
          {crossings.map((s) => (
            <li key={s.index}>
              {name(s.from)} → {name(s.to)}: {s.broadcast ? "broadcast " : ""}
              {s.what}
            </li>
          ))}
        </ol>
      </details>
    </figure>
  );
}
