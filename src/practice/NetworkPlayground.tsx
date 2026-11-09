import { linkProps } from "../app/router.ts";
import { StepExplanation } from "./StepExplanation.tsx";
import { sameConfiguration } from "./network/editing.ts";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  Globe2,
  HardDrive,
  Layers,
  Monitor,
  Network as NetworkIcon,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Server,
  Settings2,
  SkipBack,
  SkipForward,
  Smartphone,
  Undo2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { NetworkCanvas } from "./NetworkCanvas.tsx";
import { DeviceInspector } from "./DeviceInspector.tsx";
import {
  PacketInspector,
  StateTables,
  DeviceCloseup,
} from "./PacketInspector.tsx";
import {
  createDevice,
  type Network,
  type DeviceKind,
  type Action,
  type Trace,
  type Session,
} from "./network/model.ts";
import { starter, starterOptions } from "./network/starters.ts";
import { connect, importNetwork, validateNetwork } from "./network/topology.ts";
import { newSession, simulate } from "./network/engine.ts";
import { challenges, challengePassed } from "./network/challenges.ts";
import {
  loadWorkspace,
  saveNamed,
  savedNetworks,
  WORKSPACE_KEY,
  CHALLENGES_KEY,
} from "./network/storage.ts";
import "./practice.css";
const deviceTypes = [
  { kind: "pc", label: "PC", icon: Monitor },
  { kind: "phone", label: "Phone", icon: Smartphone },
  { kind: "switch", label: "Switch", icon: NetworkIcon },
  { kind: "router", label: "Router", icon: HardDrive },
  { kind: "ap", label: "Access point", icon: Wifi },
  { kind: "server", label: "Server", icon: Server },
] as const;
const challengeList = challenges();
const stageTitles = [
  "DHCP Discover",
  "DHCP Offer",
  "DHCP Request",
  "DHCP ACK",
  "Configuration complete",
  "Prepare HTTP request",
  "DNS query",
  "Create socket and connect",
  "TCP SYN",
  "Create TCP segment",
  "Create IPv4 packet",
  "Translate source with NAT",
  "Server reads HTTP request",
  "Build HTTP response",
  "Restore reply destination",
  "Read reassembled response",
  "Retransmit TCP segment",
  "HTTP journey complete",
  "Ping complete",
  "Delivery stopped",
];
export function NetworkPlayground() {
  const [startup] = useState(() => {
    try {
      return { network: loadWorkspace() ?? starter("internet"), error: "" };
    } catch {
      return {
        network: starter("internet"),
        error:
          "The saved workspace could not be read. Your saved data has not been overwritten. Export or start a fresh network to continue saving.",
      };
    }
  });
  const [network, setNetwork] = useState<Network>(startup.network),
    [notice, setNotice] = useState(startup.error),
    [saveBlocked, setSaveBlocked] = useState(!!startup.error),
    [saved, setSaved] = useState("Saved on this device");
  const [selected, setSelected] = useState(""),
    [tab, setTab] = useState<"device" | "packet" | "tables">("packet"),
    [session, setSession] = useState<Session>(newSession),
    [trace, setTrace] = useState<Trace | null>(null),
    [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [follow, setFollow] = useState(false),
    [inside, setInside] = useState(false),
    [showEvents, setShowEvents] = useState(false);
  const [action, setAction] = useState<Action>({
    kind: "http",
    source:
      startup.network.devices.find((d) => d.id === "pc")?.id ??
      startup.network.devices.find((d) => d.kind === "pc")?.id ??
      "",
    target: startup.network.devices.some((d) => d.id === "dns")
      ? "http://kitab.test/"
      : startup.network.devices.find((d) => d.id === "server")?.interfaces[0].ip
        ? `http://${startup.network.devices.find((d) => d.id === "server")!.interfaces[0].ip}/`
        : "http://kitab.test/",
    ttl: 64,
    dropOnce: false,
  });
  const [past, setPast] = useState<Network[]>([]),
    [future, setFuture] = useState<Network[]>([]),
    [challengeId, setChallengeId] = useState(""),
    [hints, setHints] = useState(0),
    [challengeOpen, setChallengeOpen] = useState(false),
    [help, setHelp] = useState(false),
    [saveList, setSaveList] = useState(false);
  const [completed, setCompleted] = useState<string[]>(() => {
    try {
      const a = JSON.parse(localStorage.getItem(CHALLENGES_KEY) ?? "[]");
      return Array.isArray(a) ? a.filter((v) => typeof v === "string") : [];
    } catch {
      return [];
    }
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (inspectorRef.current) inspectorRef.current.scrollTop = 0;
  }, [tab, selected]);
  const event = trace?.events[index],
    shownSession = event?.snapshot ?? session,
    device = network.devices.find((d) => d.id === selected),
    challenge = challengeList.find((c) => c.id === challengeId);
  useEffect(() => {
    document.title = "Network playground · Kitab";
  }, []);
  useEffect(() => {
    if (saveBlocked) return;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(network));
      setSaved("Saved on this device");
    } catch {
      setSaved("Could not save · export your network");
    }
  }, [network, saveBlocked]);
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
  function resetSession(
    message = "Simulation restarted. DHCP clients need a new lease.",
  ) {
    setSession(newSession());
    setTrace(null);
    setIndex(0);
    setPlaying(false);
    setNotice(message);
  }
  function edit(next: Network, positionsOnly = false) {
    setPast((p) => [...p.slice(-49), network]);
    setFuture([]);
    setNetwork(next);
    if (!positionsOnly)
      resetSession("Network updated. Run a new simulation to see the result.");
  }
  function change(next: Network) {
    const errors = validateNetwork(next);
    if (errors.length) {
      setNotice(errors.join(" "));
      return;
    }
    edit(next);
  }
  function replace(next: Network, nextAction?: Action) {
    edit(structuredClone(next));
    setSaveBlocked(false);
    setSelected("");
    setTab("packet");
    setNotice("");
    setAction(
      nextAction ?? {
        kind: "http",
        source:
          next.devices.find((d) => d.kind === "pc")?.id ??
          next.devices.find((d) => d.kind === "phone")?.id ??
          "",
        target: next.devices.find((d) => d.id === "server")?.interfaces[0].ip
          ? `http://${next.devices.find((d) => d.id === "server")!.interfaces[0].ip}/`
          : "192.168.1.10",
        ttl: 64,
      },
    );
  }
  function add(kind: DeviceKind, x = 650, y = 260) {
    if (network.devices.length >= 40) {
      setNotice("The workspace supports up to 40 devices.");
      return;
    }
    const d = createDevice(
      kind,
      `${kind}-${Date.now().toString(36)}`,
      Math.max(60, Math.min(2940, x)),
      Math.max(85, Math.min(1930, y)),
    );
    d.name = `${d.name} ${network.devices.filter((d) => d.kind === kind).length + 1}`;
    edit({ ...network, devices: [...network.devices, d] });
    setSelected(d.id);
    setTab("device");
    if (!action.source && ["pc", "phone", "server"].includes(kind))
      setAction((a) => ({ ...a, source: d.id }));
  }
  function run() {
    setNotice("");
    setPlaying(false);
    const result = simulate(network, session, action);
    setSession(result.session);
    setTrace(result);
    setIndex(0);
    setTab("packet");
    if (
      challenge &&
      challengePassed(challenge, action, result, network) &&
      !completed.includes(challenge.id)
    ) {
      const next = [...completed, challenge.id];
      setCompleted(next);
      try {
        localStorage.setItem(CHALLENGES_KEY, JSON.stringify(next));
      } catch {
        setNotice("Challenge completed, but progress could not be saved.");
      }
    }
  }
  function step(next: number) {
    setPlaying(false);
    setIndex(Math.max(0, Math.min((trace?.events.length ?? 1) - 1, next)));
  }
  function history(undo: boolean) {
    const source = undo ? past : future;
    if (!source.length) return;
    const next = source.at(-1)!;
    if (undo) {
      setPast((p) => p.slice(0, -1));
      setFuture((f) => [...f, network]);
    } else {
      setFuture((f) => f.slice(0, -1));
      setPast((p) => [...p, network]);
    }
    setNetwork(next);
    if (!sameConfiguration(network, next))
      resetSession(
        "Edit undone/redone. Run again to simulate this configuration.",
      );
  }
  function exportFile() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(network, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "kitab-network.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  function loadChallenge(id: string) {
    const c = challengeList.find((c) => c.id === id);
    if (!c) return;
    replace(c.network, { ...c.action, ttl: 64 });
    setChallengeId(id);
    setHints(0);
    setChallengeOpen(true);
  }
  return (
    <main id="main" className="network-playground">
      <header className="playground-heading">
        <div>
          <span className="eyebrow">PRACTICE / NETWORK LAB</span>
          <a style={{display:"block",fontSize:12,marginTop:8}} {...linkProps("/practice/connections")}>Wi-Fi, Ethernet, DSL, cable or fiber? Explore how your home connects →</a>
          <h1>
            Network playground<span className="heading-dot">.</span>
          </h1>
          <p>Build a network. Send a message. See everything in between.</p>
        </div>
        <div className="playground-heading-actions">
          <button
            className={`small-button ${challengeOpen ? "selected" : ""}`}
            onClick={() => setChallengeOpen((v) => !v)}
          >
            <Flag size={16} /> Challenges{" "}
            <span className="count">{completed.length}/6</span>
          </button>
          <button
            className="icon-button"
            aria-label="Open playground guide"
            onClick={() => setHelp((v) => !v)}
          >
            <BookOpen size={19} />
          </button>
        </div>
      </header>
      {help && (
        <section className="playground-guide">
          <button
            className="close-guide"
            aria-label="Close guide"
            onClick={() => setHelp(false)}
          >
            <X size={18} />
          </button>
          <h2>Your network, explained one step at a time.</h2>
          <div className="guide-grid">
            <div>
              <b>01 · Build</b>
              <p>
                Add devices and select one to connect its ports. Ethernet is a
                cable. Wi-Fi connects a phone to an access point.
              </p>
            </div>
            <div>
              <b>02 · Configure</b>
              <p>
                An IP identifies an interface. A subnet defines which addresses
                are local. A gateway reaches other networks. DNS resolves names.
              </p>
            </div>
            <div>
              <b>03 · Follow</b>
              <p>
                Send HTTP or ping, then step through the journey. TCP carries
                app bytes, IP routes packets, and frames move them over each
                link.
              </p>
            </div>
          </div>
          <p className="field-help">
            LAN = your local network. WAN = links between networks. The Internet
            starter is a small, fully simulated ISP network. This lab uses IPv4
            and simplified protocol rules, with no real network traffic.
          </p>
          <a href="/learn/ip-addressing">
            Review IP addresses, LANs and subnets <ArrowRight size={14} />
          </a>
        </section>
      )}
      {challengeOpen && (
        <section className="challenge-panel">
          <div className="challenge-heading">
            <div>
              <span className="eyebrow">LEARN BY DOING</span>
              <h2>
                {challenge?.title ?? "Six small challenges. One big picture."}
              </h2>
            </div>
            <select
              aria-label="Choose a challenge"
              value={challengeId}
              onChange={(e) => loadChallenge(e.target.value)}
            >
              <option value="">Choose your challenge</option>
              {challengeList.map((c) => (
                <option key={c.id} value={c.id}>
                  {completed.includes(c.id) ? "✓ " : ""}
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          {challenge ? (
            <>
              <p>{challenge.purpose}</p>
              <div className="challenge-goal">
                <Flag size={18} />
                <b>{challenge.goal}</b>
                {completed.includes(challenge.id) && (
                  <span className="success-pill">
                    <Check size={13} /> Completed
                  </span>
                )}
              </div>
              {challenge.hints.slice(0, hints).map((h) => (
                <p className="challenge-hint" key={h}>
                  {h}
                </p>
              ))}
              <div className="challenge-actions">
                <button
                  className="text-button"
                  disabled={hints >= challenge.hints.length}
                  onClick={() => setHints((h) => h + 1)}
                >
                  Show a hint
                </button>
                <button
                  className="text-button"
                  onClick={() => loadChallenge(challenge.id)}
                >
                  Reset challenge
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setChallengeId("");
                    setChallengeOpen(false);
                  }}
                >
                  Keep building freely <ArrowRight size={13} />
                </button>
              </div>
            </>
          ) : (
            <p>
              Practice cables, subnets, Wi-Fi, routing, NAT and TCP reliability.
              Each challenge opens an editable network with a clear goal.
            </p>
          )}
        </section>
      )}
      <section className="lab-shell" aria-label="Network workspace">
        <div className="workspace-toolbar">
          <div className="workspace-title">
            <input
              aria-label="Network name"
              value={network.name}
              maxLength={200}
              onChange={(e) => setNetwork({ ...network, name: e.target.value })}
            />
            <span className="save-status">
              <span className="live-dot" />
              {saved}
            </span>
          </div>
          <div className="workspace-actions">
            <label className="sr-only" htmlFor="starter-network">
              Starter network
            </label>
            <select
              id="starter-network"
              value=""
              onChange={(e) => {
                replace(starter(e.target.value));
                setChallengeId("");
              }}
            >
              <option value="" disabled>
                Starter networks
              </option>
              {starterOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              aria-label="Save named network"
              title="Save named network"
              className="icon-button"
              onClick={() => {
                try {
                  saveNamed(network);
                  setNotice(`Saved “${network.name}” to My networks.`);
                } catch {
                  setNotice(
                    "Could not save. Export your network to keep a copy.",
                  );
                }
              }}
            >
              <Save size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="My saved networks"
              title="My saved networks"
              onClick={() => setSaveList((v) => !v)}
            >
              <Layers size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Export network"
              title="Export JSON"
              onClick={exportFile}
            >
              <Download size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Import network"
              title="Import JSON"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={17} />
            </button>
            <input
              hidden
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 1000000)
                    throw new Error("Network file is too large.");
                  replace(importNetwork(await file.text()));
                  setChallengeId("");
                } catch (error) {
                  setNotice(`Import failed. ${(error as Error).message}`);
                }
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {saveList && (
          <div className="saved-list">
            <b>My networks</b>
            {(() => {
              try {
                const list = savedNetworks();
                return list.length ? (
                  list.map((e) => (
                    <button
                      className="small-button"
                      key={e.name}
                      onClick={() => {
                        replace(e.network);
                        setChallengeId("");
                        setSaveList(false);
                      }}
                    >
                      {e.name}
                    </button>
                  ))
                ) : (
                  <span>No named saves yet. Use the save button above.</span>
                );
              } catch {
                return <span>Saved networks could not be read.</span>;
              }
            })()}
          </div>
        )}
        <div className="device-tray">
          <span className="tray-label">ADD DEVICE</span>
          {deviceTypes.map(({ kind, label, icon: Icon }) => (
            <button
              key={kind}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("kitab/device", kind)}
              onClick={() => add(kind)}
              aria-label={`Add ${label}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              <Plus className="tray-plus" size={12} />
            </button>
          ))}
          <div className="tray-history">
            <button
              className="icon-button"
              aria-label="Undo"
              disabled={!past.length}
              onClick={() => history(true)}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Redo"
              disabled={!future.length}
              onClick={() => history(false)}
            >
              <Redo2 size={16} />
            </button>
          </div>
        </div>
        {notice && (
          <div className="network-notice" role="status">
            <span>{notice}</span>
            <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
              <X size={15} />
            </button>
          </div>
        )}
        <div className="workspace-grid">
          <div className="workspace-stage">
            <NetworkCanvas
              network={network}
              session={shownSession}
              event={event}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                setTab("device");
              }}
              onMove={(id, x, y) =>
                edit(
                  {
                    ...network,
                    devices: network.devices.map((d) =>
                      d.id === id ? { ...d, x, y } : d,
                    ),
                  },
                  true,
                )
              }
              onAdd={add}
              follow={follow}
            />
            <div className="view-options">
              <label className="network-check">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(e) => setFollow(e.target.checked)}
                />{" "}
                Follow active device
              </label>
              <label className="network-check">
                <input
                  type="checkbox"
                  checked={inside}
                  onChange={(e) => setInside(e.target.checked)}
                />{" "}
                Look inside device
              </label>
              <span>
                <Globe2 size={13} /> Simulated network · no real traffic
              </span>
            </div>
            {inside && <DeviceCloseup event={event} network={network} />}
            <section className="send-panel" aria-label="Send traffic">
              <div className="send-title">
                <span className="step-marker">01</span>
                <div>
                  <b>Send something</b>
                  <small>Choose the app and where its message goes.</small>
                </div>
              </div>
              <div className="send-fields">
                <label>
                  <span>From</span>
                  <select
                    aria-label="Source device"
                    value={action.source}
                    onChange={(e) =>
                      setAction((a) => ({ ...a, source: e.target.value }))
                    }
                  >
                    <option value="" disabled>
                      Choose a device
                    </option>
                    {network.devices
                      .filter((d) => d.kind !== "switch" && d.kind !== "ap")
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span>Action</span>
                  <select
                    aria-label="Traffic type"
                    value={action.kind}
                    onChange={(e) =>
                      setAction((a) => ({
                        ...a,
                        kind: e.target.value as Action["kind"],
                      }))
                    }
                  >
                    <option value="http">HTTP · load a page</option>
                    <option value="ping">Ping · check reachability</option>
                    <option value="dhcp">DHCP · configure automatically</option>
                  </select>
                </label>
                {action.kind !== "dhcp" && (
                  <label className="destination-field">
                    <span>To</span>
                    <input
                      aria-label="Destination"
                      value={action.target}
                      onChange={(e) =>
                        setAction((a) => ({ ...a, target: e.target.value }))
                      }
                      placeholder={
                        action.kind === "http"
                          ? "http://kitab.test/"
                          : "192.168.1.20"
                      }
                    />
                  </label>
                )}
                <button
                  className="button primary send-button"
                  disabled={!action.source}
                  onClick={run}
                >
                  <ArrowRight size={17} />{" "}
                  {action.kind === "dhcp"
                    ? "Configure automatically"
                    : "Send request"}
                </button>
              </div>
              <div className="send-options">
                {action.kind === "http" && (
                  <label className="network-check">
                    <input
                      type="checkbox"
                      checked={!!action.dropOnce}
                      onChange={(e) =>
                        setAction((a) => ({ ...a, dropOnce: e.target.checked }))
                      }
                    />{" "}
                    Drop one data segment
                  </label>
                )}
                {action.kind !== "dhcp" && (
                  <label className="ttl-input">
                    Starting TTL{" "}
                    <input
                      aria-label="Starting TTL"
                      type="number"
                      min={1}
                      max={255}
                      value={action.ttl ?? 64}
                      onChange={(e) =>
                        setAction((a) => ({
                          ...a,
                          ttl: Math.max(
                            1,
                            Math.min(255, Number(e.target.value) || 1),
                          ),
                        }))
                      }
                    />
                    <span>router hop limit</span>
                  </label>
                )}
                <button className="text-button" onClick={() => resetSession()}>
                  <RotateCcw size={13} /> Restart simulation
                </button>
              </div>
            </section>
            <section className="replay-panel" aria-label="Packet playback">
              <div className="replay-top">
                <div className="send-title">
                  <span className="step-marker">02</span>
                  <div>
                    <b>Follow the journey</b>
                    <small>
                      {trace
                        ? `${index + 1} of ${trace.events.length} events · simulated ${((event?.time ?? 0) / 1000).toFixed(2)}s`
                        : "Every hop. Every header. Every decision."}
                    </small>
                  </div>
                </div>
                <div className="replay-controls">
                  <button
                    aria-label="First event"
                    disabled={!trace}
                    onClick={() => step(0)}
                  >
                    <SkipBack size={16} />
                  </button>
                  <button
                    aria-label="Previous event"
                    disabled={!trace || index === 0}
                    onClick={() => step(index - 1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="play-button"
                    aria-label={playing ? "Pause playback" : "Play journey"}
                    disabled={!trace}
                    onClick={() => {
                      if (trace && index >= trace.events.length - 1)
                        setIndex(0);
                      setPlaying((p) => !p);
                    }}
                  >
                    {playing ? <Pause size={19} /> : <Play size={19} />}
                  </button>
                  <button
                    aria-label="Next event"
                    disabled={!trace || index >= trace.events.length - 1}
                    onClick={() => step(index + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                  <button
                    aria-label="Last event"
                    disabled={!trace}
                    onClick={() => step((trace?.events.length ?? 1) - 1)}
                  >
                    <SkipForward size={16} />
                  </button>
                  <select
                    aria-label="Playback speed"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={4}>4×</option>
                    <option value={8}>8×</option>
                  </select>
                </div>
              </div>
              {trace && (
                <div className="stage-shortcuts">
                  <span>JUMP TO</span>
                  {stageTitles.flatMap((title) => {
                    const i = trace.events.findIndex((e) => e.title === title);
                    return i < 0
                      ? []
                      : [
                          <button
                            key={title}
                            onClick={() => {
                              step(i);
                              setTab("packet");
                            }}
                            className={index === i ? "active" : ""}
                          >
                            {(
                              {
                                "Prepare HTTP request": "Request",
                                "Create socket and connect": "Socket",
                                "TCP SYN": "Handshake",
                                "Create TCP segment": "TCP wrapping",
                                "Create IPv4 packet": "IP wrapping",
                                "Translate source with NAT": "NAT out",
                                "Restore reply destination": "NAT reply",
                                "Server reads HTTP request": "Server",
                                "Build HTTP response": "Response",
                                "Read reassembled response": "Browser",
                                "HTTP journey complete": "Finish",
                                "Retransmit TCP segment": "Retransmit",
                              } as Record<string, string>
                            )[title] ?? title}
                          </button>,
                        ];
                  })}
                </div>
              )}
              <input
                className="timeline-slider"
                type="range"
                aria-label="Journey timeline"
                min={0}
                max={Math.max(1, (trace?.events.length ?? 1) - 1)}
                value={index}
                disabled={!trace}
                onChange={(e) => step(Number(e.target.value))}
              />
              <div
                className={`event-explanation ${event?.error ? "event-error" : ""}`}
              >
                <span className="event-symbol">
                  {event?.error ? "!" : <Layers size={20} />}
                </span>
                <div>
                  <span className="eyebrow">
                    {event
                      ? `${network.devices.find((d) => d.id === event.actor)?.name ?? event.actor} / ${event.location}`
                      : "READY WHEN YOU ARE"}
                  </span>
                  <h3>
                    {event?.title ?? "A message is more than its payload."}
                  </h3>
                  <p>
                    {event?.explanation ??
                      "Send a request to see how your application’s data gets wrapped, routed, delivered and unwrapped at its destination."}
                  </p>
                  {event && (
                    <StepExplanation
                      event={event}
                      network={network}
                      onReadDetails={() => setPlaying(false)}
                    />
                  )}
                </div>
              </div>
              {trace && (
                <>
                  <div
                    className={`run-status ${trace.success ? "success" : "failure"}`}
                    role="status"
                  >
                    {trace.success ? <Check size={15} /> : <span>!</span>}
                    <span>{trace.summary}</span>
                    <button
                      className="text-button"
                      onClick={() => setShowEvents((v) => !v)}
                    >
                      {showEvents ? "Hide" : "Show"} event list
                    </button>
                  </div>
                  {showEvents && (
                    <ol className="event-list">
                      {trace.events.map((e, i) => (
                        <li key={e.id}>
                          <button
                            aria-current={i === index ? "step" : undefined}
                            onClick={() => {
                              step(i);
                              setTab("packet");
                            }}
                          >
                            <span>{i + 1}</span>
                            <b>{e.title}</b>
                            <small>
                              {
                                network.devices.find((d) => d.id === e.actor)
                                  ?.name
                              }
                            </small>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </section>
          </div>
          <aside
            ref={inspectorRef}
            className="network-inspector"
            aria-label="Network inspector"
          >
            <div className="inspector-tabs">
              <button
                className={tab === "device" ? "active" : ""}
                onClick={() => setTab("device")}
              >
                <Settings2 size={15} /> Device
              </button>
              <button
                className={tab === "packet" ? "active" : ""}
                onClick={() => setTab("packet")}
              >
                <Layers size={15} /> Packet
              </button>
              <button
                className={tab === "tables" ? "active" : ""}
                onClick={() => setTab("tables")}
              >
                <Server size={15} /> Tables
              </button>
            </div>
            <div className="inspector-body">
              {tab === "device" ? (
                device ? (
                  <DeviceInspector
                    key={device.id}
                    device={device}
                    network={network}
                    session={shownSession}
                    onApply={(updated) =>
                      change({
                        ...network,
                        devices: network.devices.map((d) =>
                          d.id === updated.id ? updated : d,
                        ),
                      })
                    }
                    onDelete={() => {
                      edit({
                        ...network,
                        devices: network.devices.filter(
                          (d) => d.id !== device.id,
                        ),
                        links: network.links.filter(
                          (l) =>
                            l.a.device !== device.id &&
                            l.b.device !== device.id,
                        ),
                      });
                      setSelected("");
                    }}
                    onConnect={(a, b, medium) => {
                      try {
                        edit(connect(network, a, b, medium));
                      } catch (e) {
                        setNotice((e as Error).message);
                      }
                    }}
                    onDisconnect={(id) =>
                      edit({
                        ...network,
                        links: network.links.filter((l) => l.id !== id),
                      })
                    }
                  />
                ) : (
                  <div className="inspector-empty">
                    <Monitor size={32} />
                    <h2>Select a device</h2>
                    <p>
                      Click a device on the canvas to see what it does,
                      configure its interfaces and connect it to your network.
                    </p>
                  </div>
                )
              ) : tab === "packet" ? (
                <PacketInspector event={event} />
              ) : (
                <>
                  <label className="table-device-picker">
                    Inspect device
                    <select
                      aria-label="Table device"
                      value={selected || event?.actor || ""}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      <option value="" disabled>
                        Choose a device
                      </option>
                      {network.devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <StateTables
                    network={network}
                    session={shownSession}
                    actor={selected || event?.actor || ""}
                  />
                </>
              )}
            </div>
          </aside>
        </div>
      </section>
      <footer className="playground-footer">
        <span>
          <span className="legend-dot application" /> App data
        </span>
        <span>
          <span className="legend-dot transport" /> TCP / UDP
        </span>
        <span>
          <span className="legend-dot network" /> IP packet
        </span>
        <span>
          <span className="legend-dot link" /> Link frame
        </span>
        <a href="/learn/ip-addressing">
          Need the basics? Start with IP addresses <ArrowRight size={13} />
        </a>
      </footer>
    </main>
  );
}
