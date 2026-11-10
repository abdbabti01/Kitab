import { useEffect, useState } from "react";
import {
  Monitor,
  Router,
  Radio,
  Network,
  Server,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Cable,
  Lightbulb,
} from "lucide-react";
import { linkProps } from "../app/router.ts";
import { PathNext } from "../app/NetworkingPath.tsx";
import {
  accessJourney,
  boxRoles,
  technologies,
  type AccessTechnology,
  type LocalTechnology,
} from "./network/access.ts";
import "./access.css";

export function AccessExplorer() {
  const [technology, setTechnology] = useState<AccessTechnology>("fiber");
  const [local, setLocal] = useState<LocalTechnology>("wifi");
  const [combined, setCombined] = useState(true);
  const [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    // Which box's role is explained under the diagram (the modem or ONT by default).
    [about, setAbout] = useState(2);
  const roles = boxRoles(technology, combined),
    role = roles[about];
  const stages = accessJourney(technology, local, combined),
    stage = stages[index],
    t = technologies[technology];
  const reset = () => {
    setIndex(0);
    setPlaying(false);
  };
  const step = (i: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(stages.length - 1, i)));
  };
  useEffect(() => {
    document.title = "How your home connects · Kitab";
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setIndex((i) => {
          if (i >= stages.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      4500,
    );
    return () => clearInterval(timer);
  }, [playing, stages.length]);
  const xs = [85, 310, 520, 760, 1000];
  const labels = [
    "Your laptop",
    "Home router",
    t.terminal,
    "Your provider",
    "Web server",
  ];
  const icons = [
    Monitor,
    Router,
    technology === "fiber" ? Lightbulb : Cable,
    Network,
    Server,
  ];
  const jump = (id: string) => step(stages.findIndex((s) => s.id === id));
  return (
    <main id="main" className="access-page">
      <nav className="access-nav">
        <a {...linkProps("/practice/network")}>← Network playground</a>
        <span>TECHNOLOGY EXPLORER</span>
      </nav>
      <header className="access-heading">
        <span className="access-kicker">FROM YOUR HOME TO THE WORLD</span>
        <h1>
          One message.
          <br />
          <em>Different ways to travel.</em>
        </h1>
        <p>
          Choose the connections. Look inside the equipment. Follow the
          request—and its reply.
        </p>
      </header>
      <section className="access-choices" aria-label="Choose your connections">
        <fieldset>
          <legend>01 · Internet into your home</legend>
          <div className="access-options">
            {(Object.keys(technologies) as AccessTechnology[]).map((key) => (
              <button
                key={key}
                aria-pressed={technology === key}
                onClick={() => {
                  setTechnology(key);
                  reset();
                }}
              >
                <strong>{technologies[key].name}</strong>
                <small>{technologies[key].wire}</small>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>02 · Laptop to home box</legend>
          <div className="access-options">
            {(["wifi", "ethernet"] as const).map((key) => (
              <button
                key={key}
                aria-pressed={local === key}
                onClick={() => {
                  setLocal(key);
                  reset();
                }}
              >
                <strong>{key === "wifi" ? "Wi-Fi" : "Ethernet"}</strong>
                <small>
                  {key === "wifi"
                    ? "Radio through air"
                    : "Electrical signals in a cable"}
                </small>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="access-box-choice">
          Equipment layout
          <select
            value={combined ? "combined" : "separate"}
            onChange={(e) => {
              setCombined(e.target.value === "combined");
              reset();
            }}
          >
            <option value="combined">One combined gateway</option>
            <option value="separate">Router + separate modem / ONT</option>
          </select>
        </label>
      </section>
      <section className="access-map" aria-label="Connection diagram">
        <div className="access-map-top">
          <span>
            {local === "wifi" ? "Wi-Fi" : "Ethernet"} at home <b>·</b> {t.name}{" "}
            to your provider
          </span>
          <span>
            {stage.direction === "back"
              ? "← Response coming home"
              : stage.direction === "out"
                ? "Request going out →"
                : "Connecting to the home network"}
          </span>
        </div>
        <div
          className="access-map-scroll"
          tabIndex={0}
          aria-label="Network diagram; scroll horizontally on small screens"
        >
          <svg
            viewBox="0 0 1100 270"
            role="group"
            aria-label={`Laptop, home router, ${t.terminal}, ${t.provider}, web server. Current step: ${stage.title}`}
          >
            <rect
              x="225"
              y="25"
              width={combined ? 380 : 170}
              height="215"
              rx="20"
              fill="#edf3e8"
              stroke="#d5e1cd"
            />
            <text x="245" y="49" className="map-caption">
              {combined ? "ONE PHYSICAL HOME BOX" : "HOME WI-FI ROUTER"}
            </text>
            {xs.slice(0, -1).map((x, i) => (
              <g key={i}>
                <path
                  d={`M${x + 40} 125 H${xs[i + 1] - 40}`}
                  stroke={
                    i === 2
                      ? technology === "fiber"
                        ? "#b78949"
                        : "#7c83a5"
                      : "#a8bbae"
                  }
                  strokeWidth="3"
                  strokeDasharray={
                    i === 0 && local === "wifi"
                      ? "5 6"
                      : i === 3
                        ? "4 7"
                        : undefined
                  }
                />
                <text
                  x={(x + xs[i + 1]) / 2}
                  y="92"
                  textAnchor="middle"
                  className="map-link"
                >
                  {i === 0
                    ? local === "wifi"
                      ? "Radio"
                      : "Ethernet"
                    : i === 1
                      ? combined
                        ? "Internal"
                        : "Ethernet"
                      : i === 2
                        ? t.name
                        : "Many networks"}
                </text>
              </g>
            ))}
            {labels.map((name, i) => {
              const Icon = icons[i];
              return (
                <g
                  key={i}
                  className={`${stage.focus === i ? "map-node active" : "map-node"} ${about === i ? "is-about" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`What does the ${name} do?`}
                  aria-pressed={about === i}
                  onClick={() => setAbout(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setAbout(i);
                    }
                  }}
                >
                  <rect x={xs[i] - 38} y="103" width="76" height="65" rx="15" />
                  <Icon
                    x={xs[i] - 17}
                    y="118"
                    width="34"
                    height="34"
                    strokeWidth="1.4"
                  />
                  <text x={xs[i]} y="193" textAnchor="middle">
                    {name}
                  </text>
                  {i === 1 && (
                    <text
                      x={xs[i]}
                      y="214"
                      textAnchor="middle"
                      className="map-link"
                    >
                      AP · switch · DHCP · NAT
                    </text>
                  )}
                  {i === 3 && (
                    <text
                      x={xs[i]}
                      y="214"
                      textAnchor="middle"
                      className="map-link"
                    >
                      {t.provider}
                    </text>
                  )}
                </g>
              );
            })}
            {stage.hop && (
              <circle
                key={`${index}-${technology}-${local}`}
                cx={playing ? 0 : (xs[stage.hop[0]] + xs[stage.hop[1]]) / 2}
                cy={playing ? 0 : 125}
                r="7"
                fill={stage.direction === "back" ? "#b78949" : "#2f614b"}
                className="travel-marker"
              >
                {playing && (
                  <animateMotion
                    dur="2s"
                    repeatCount="indefinite"
                    path={`M${xs[stage.hop[0]]} 125 L${xs[stage.hop[1]]} 125`}
                  />
                )}
              </circle>
            )}
          </svg>
        </div>
        <p className="access-caption">
          {combined
            ? `The router, access point, switch, DHCP service and ${t.terminal} are shown as functions inside one example gateway. Actual products vary.`
            : `The router box contains Wi-Fi, switching, routing and DHCP. The ${t.terminal} is a separate box connected to its WAN port.`}{" "}
          The moving dot represents information, not a physical object.
          Select a box to see what it does.
        </p>
        <section className="access-about" aria-live="polite" aria-label={`About the ${role.name}`}>
          <span className="access-kicker">WHAT THIS BOX DOES</span>
          <h2>{role.name}</h2>
          <p>{role.what}</p>
          <ul>
            {role.does.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="access-about-not">{role.not}</p>
          {role.standard && <p className="access-about-standard">Standard: {role.standard}</p>}
        </section>
      </section>
      <section className="access-player" aria-label="Technology playback">
        <div className="access-controls">
          <button aria-label="Restart journey" onClick={reset}>
            <RotateCcw size={18} />
          </button>
          <button
            aria-label="Previous step"
            disabled={!index}
            onClick={() => step(index - 1)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="access-play"
            aria-label={playing ? "Pause journey" : "Play journey"}
            onClick={() => {
              if (index === stages.length - 1) setIndex(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button
            aria-label="Next step"
            disabled={index === stages.length - 1}
            onClick={() => step(index + 1)}
          >
            <ChevronRight size={20} />
          </button>
          <span>
            {String(index + 1).padStart(2, "0")} / {stages.length} steps
          </span>
          <div className="access-jumps">
            {[
              ["discover", "Connect"],
              ["request", "Request"],
              ["access-out", t.name + " link"],
              ["reply", "Reply"],
              ["done", "Arrived"],
            ].map(([id, label]) => (
              <button key={id} onClick={() => jump(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <input
          aria-label="Technology journey timeline"
          type="range"
          min="0"
          max={stages.length - 1}
          value={index}
          onChange={(e) => step(Number(e.target.value))}
        />
        <div className="access-focus">
          <article className="access-story">
            <span className="access-kicker">CLOSE-UP · {stage.where}</span>
            <h2>{stage.title}</h2>
            <p>{stage.why}</p>
            <div className="access-result">
              <strong>What happens next</strong>
              <p>{stage.result}</p>
            </div>
            <details
              onToggle={(e) => {
                if (e.currentTarget.open) setPlaying(false);
              }}
            >
              <summary>What are the parts inside my home box?</summary>
              <dl>
                <dt>Access point · radio hardware + firmware</dt>
                <dd>
                  Announces the Wi-Fi network, accepts wireless clients and
                  sends and receives frames by radio. With Ethernet selected,
                  your laptop bypasses Wi-Fi.
                </dd>
                <dt>Switch · LAN ports and forwarding logic</dt>
                <dd>
                  Connects wired devices on the same LAN using MAC addresses. It
                  is usually built into a home router box; a separate switch is
                  optional.
                </dd>
                <dt>Router · forwarding hardware + software</dt>
                <dd>
                  Chooses a next hop between IP networks. Here it also performs
                  NAT so the reply can find the private laptop.
                </dd>
                <dt>DHCP · software service</dt>
                <dd>
                  Supplies IP settings after a device joins the network. It also
                  supports lease renewal; it does not run for every web request.
                </dd>
                <dt>{t.terminal} · access equipment</dt>
                <dd>
                  {t.description} It handles the provider link; routing is a
                  different job.
                </dd>
              </dl>
            </details>
          </article>
          <aside
            className="access-data"
            aria-label="Data and signals at this step"
          >
            <span className="access-kicker">
              THE SAME INFORMATION, A NEW CARRIER
            </span>
            <div
              className={`signal-view ${stage.carrier.includes("Light") ? "optical" : stage.carrier.includes("Radio") ? "radio" : "electrical"}`}
            >
              {stage.carrier.includes("memory") ||
              stage.carrier.includes("Internal") ? (
                <div className="access-memory" aria-hidden="true">
                  01001000 01101001
                </div>
              ) : (
                <svg viewBox="0 0 320 65" aria-hidden="true">
                  {stage.carrier.includes("Light") ? (
                    Array.from({ length: 12 }, (_, i) => (
                      <circle
                        key={i}
                        cx={18 + i * 25}
                        cy="33"
                        r={i % 3 === 0 ? 4 : 7}
                      />
                    ))
                  ) : (
                    <path d="M0 33 Q10 0 20 33 T40 33 T60 33 T80 33 T100 33 T120 33 T140 33 T160 33 T180 33 T200 33 T220 33 T240 33 T260 33 T280 33 T300 33 T320 33" />
                  )}
                </svg>
              )}
              <strong>{stage.carrier}</strong>
              <small>Conceptual illustration · not a measured waveform</small>
            </div>
            <div className="access-envelope">
              <span>OUTER CARRIER / ENVELOPE</span>
              <strong>{stage.envelope}</strong>
              {stage.src && (
                <div className="access-ip">
                  <span>IPv4 packet</span>
                  <dl>
                    <dt>From</dt>
                    <dd>{stage.src}</dd>
                    <dt>To</dt>
                    <dd>{stage.dst}</dd>
                  </dl>
                  <div className="access-tcp">
                    <span>
                      TCP segment · ports {stage.sourcePort} → {stage.destPort}
                    </span>
                    <div className="access-http">
                      <span>HTTP bytes</span>
                      <code>{stage.payload}</code>
                    </div>
                  </div>
                </div>
              )}
              {!stage.src && stage.payload && (
                <code className="access-http">{stage.payload}</code>
              )}
            </div>
            <p className="access-data-note">
              Packets and frames are organized bits. Radio, electricity and
              light are ways to carry those bits. A modem or ONT changes the
              access-link representation; NAT changes the packet’s address
              fields.
            </p>
          </aside>
        </div>
      </section>
      <PathNext id="connections" />
      <footer className="access-footer">
        <p>
          <strong>A guided physical-media model.</strong> It summarizes DNS,
          ARP, TCP control traffic, provider provisioning, intermediate routers
          and access-link headers. It does not compare speed, reproduce
          waveforms or send real traffic. HTTP is unencrypted here so its data
          is visible.
        </p>
        <a {...linkProps("/practice/network")}>
          Inspect individual protocol packets in the network lab →
        </a>
        <details>
          <summary>Technology references</summary>
          <a href="https://help.bdc.fcc.gov/hc/en-us/articles/5290793888795-Fixed-Technology-Codes">
            FCC: copper, coaxial and fiber technologies
          </a>
          <br />
          <a href="https://www.cisco.com/site/us/en/learn/topics/small-business/what-is-an-access-point.html">
            Cisco: access points
          </a>
        </details>
      </footer>
    </main>
  );
}
