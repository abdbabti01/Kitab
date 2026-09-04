import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { tcpEvents } from "./simulations/tcp-model";
import {TcpViewRenderer,type TcpConfig,type TcpView} from "./simulations/tcp-views";
import "./visual-lab.css";

export default function VisualLab() {
  const [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false),
    [view,setView]=useState<TcpView>("handshake"),
    [config,setConfig]=useState<TcpConfig>({payload:3500,mss:1460,window:3,latency:45,drop:null,reorder:false});
  const event = tcpEvents[step];
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
          <div className="tcp-view-tabs">{(["handshake","encapsulation","network","reliability","flow","congestion"] as TcpView[]).map(x=><button className={view===x?"active":""} onClick={()=>setView(x)} key={x}>{x}</button>)}</div>
          <TcpViewRenderer view={view} event={event} eventIndex={step} config={config}/>
          <div className="tcp-config"><label>Payload <b>{config.payload} B</b><input type="range" min="500" max="8000" step="500" value={config.payload} onChange={e=>setConfig({...config,payload:+e.target.value})}/></label><label>MSS <b>{config.mss} B</b><select value={config.mss} onChange={e=>setConfig({...config,mss:+e.target.value})}><option value="536">536</option><option value="1200">1200</option><option value="1460">1460</option></select></label><label>Receive window <b>{config.window}</b><input type="range" min="1" max="6" value={config.window} onChange={e=>setConfig({...config,window:+e.target.value})}/></label><label>Latency <b>{config.latency} ms</b><input type="range" min="5" max="300" value={config.latency} onChange={e=>setConfig({...config,latency:+e.target.value})}/></label><button className={config.drop===2?"active":""} onClick={()=>setConfig({...config,drop:config.drop===2?null:2})}>Drop segment 2</button><button className={config.reorder?"active":""} onClick={()=>setConfig({...config,reorder:!config.reorder})}>Reorder arrival</button></div>
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
