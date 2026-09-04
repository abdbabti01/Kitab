import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { FlowCanvas } from "./canvas/FlowCanvas";
import { parseScene } from "./core/schema";
import { tcpEvents, tcpScene } from "./simulations/tcp-model";
import "./visual-lab.css";

export default function VisualLab() {
  const [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false);
  const event = tcpEvents[step];
  const scene = useMemo(() => parseScene(tcpScene(event)), [event]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (step === tcpEvents.length - 1) setPlaying(false);
      else setStep((value) => value + 1);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [playing, step]);
  function move(value: number) {
    setPlaying(false);
    setStep(Math.max(0, Math.min(tcpEvents.length - 1, value)));
  }
  return (
    <div className="kve-lab">
      <header>
        <a href="/">
          <ArrowLeft />
          Kitab
        </a>
        <div>
          <span>VISUAL ENGINE LAB · MILESTONE 01</span>
          <h1>TCP connection model</h1>
        </div>
        <div className="kve-status">
          <i />
          Schema valid
        </div>
      </header>
      <div className="kve-layout">
        <aside className="kve-events">
          <div>
            <BookOpen />
            <span>
              <b>Deterministic timeline</b>
              <small>{tcpEvents.length} calculated states</small>
            </span>
          </div>
          {tcpEvents.map((x, i) => (
            <button
              className={i === step ? "active" : ""}
              onClick={() => move(i)}
              key={x.id}
            >
              <span>{i + 1}</span>
              <div>
                <b>{x.title}</b>
                <small>
                  {x.client} → {x.server}
                </small>
              </div>
            </button>
          ))}
        </aside>
        <main>
          <div className="kve-scene-head">
            <div>
              <span>
                EVENT {step + 1} / {tcpEvents.length}
              </span>
              <h2>{event.title}</h2>
              <p>{event.narration}</p>
            </div>
            {event.packet && (
              <div className="packet-facts">
                <span>{event.packet.flags.join(" + ")}</span>
                <b>SEQ {event.packet.seq}</b>
                {event.packet.ack !== undefined && (
                  <b>ACK {event.packet.ack}</b>
                )}
              </div>
            )}
          </div>
          <FlowCanvas scene={scene} />
          <div className="kve-controls">
            <button onClick={() => move(0)}>
              <RotateCcw />
              Reset
            </button>
            <button onClick={() => move(step - 1)} disabled={step === 0}>
              <ChevronLeft />
              Previous
            </button>
            <button className="play" onClick={() => setPlaying((v) => !v)}>
              {playing ? <Pause /> : <Play />}
              {playing ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => move(step + 1)}
              disabled={step === tcpEvents.length - 1}
            >
              Next
              <ChevronRight />
            </button>
          </div>
        </main>
        <aside className="kve-inspector">
          <span>STATE INSPECTOR</span>
          <h2>What is true now?</h2>
          <dl>
            <div>
              <dt>Client</dt>
              <dd>{event.client}</dd>
            </div>
            <div>
              <dt>Server</dt>
              <dd>{event.server}</dd>
            </div>
            {event.packet && (
              <>
                <div>
                  <dt>Direction</dt>
                  <dd>
                    {event.packet.from} →{" "}
                    {event.packet.from === "client" ? "server" : "client"}
                  </dd>
                </div>
                <div>
                  <dt>Flags</dt>
                  <dd>{event.packet.flags.join(", ")}</dd>
                </div>
                <div>
                  <dt>Sequence</dt>
                  <dd>{event.packet.seq}</dd>
                </div>
                {event.packet.ack !== undefined && (
                  <div>
                    <dt>Acknowledgment</dt>
                    <dd>{event.packet.ack}</dd>
                  </div>
                )}
              </>
            )}
          </dl>
          <div className="kve-rule">
            <b>Model rule</b>
            <p>
              {step === 1
                ? "SYN consumes one sequence number even when it carries no application bytes."
                : step === 2
                  ? "ACK 1001 means the next client sequence expected is 1001."
                  : step === 4
                    ? "1460 bytes beginning at 1001 occupy positions 1001 through 2460."
                    : "Every value shown is derived from the TCP event model, not animation coordinates."}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
