import { linkProps } from "../app/router.ts";
import { sameConfiguration } from "./network/editing.ts";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Download,
  Flag,
  HardDrive,
  Layers,
  Monitor,
  Network as NetworkIcon,
  Plus,
  Redo2,
  Save,
  Server,
  Smartphone,
  Undo2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { JourneyStage } from "./JourneyStage.tsx";
import { SendPanel } from "./SendPanel.tsx";
import { InspectorPanel, type InspectorTab } from "./InspectorPanel.tsx";
import { useJourney } from "./useJourney.ts";
import { createDevice, type Network, type DeviceKind, type Action } from "./network/model.ts";
import { starter, starterOptions } from "./network/starters.ts";
import { connect, importNetwork, validateNetwork } from "./network/topology.ts";
import { challenges, assessChallenge, type ChallengeVerdict } from "./network/challenges.ts";
import { loadWorkspace, saveNamed, savedNetworks, WORKSPACE_KEY, CHALLENGES_KEY } from "./network/storage.ts";
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
    [tab, setTab] = useState<InspectorTab>("packet");
  const journey = useJourney(network),
    { trace } = journey;
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
    [verdict, setVerdict] = useState<ChallengeVerdict | null>(null),
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
  const challenge = challengeList.find((c) => c.id === challengeId);
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
  function resetSession(
    message = "Simulation restarted. DHCP clients need a new lease.",
  ) {
    journey.reset();
    setNotice(message);
    setVerdict(null);
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
    const result = journey.run(action);
    if (!result) return;
    setTab("packet");
    const assessed =
      challenge && assessChallenge(challenge, action, result, network);
    setVerdict(assessed || null);
    if (
      challenge &&
      assessed?.status === "passed" &&
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
    setVerdict(null);
  }
  const { stoppedBy, showStop } = journey;
  function inspectPacket() {
    journey.setPlaying(false);
    setTab("packet");
    if (window.matchMedia("(max-width: 850px)").matches)
      inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const select = (id: string) => {
    setSelected(id);
    setTab("device");
  };
  const nextChallenge =
    challenge &&
    challengeList[challengeList.findIndex((c) => c.id === challenge.id) + 1];
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
              {verdict && (
                <div
                  className={`challenge-verdict is-${verdict.status}`}
                  role="status"
                >
                  <b>
                    {verdict.status === "passed"
                      ? "Challenge complete. What you proved:"
                      : verdict.status === "incomplete"
                        ? "It ran, but the challenge is not complete yet."
                        : "The network stopped the delivery."}
                  </b>
                  {verdict.status === "failed" ? (
                    <p>
                      The delivery stopped{stoppedBy ? ` at ${stoppedBy}` : ""} before the goal was reached.{" "}
                      <button className="text-button stop-link" onClick={showStop}>
                        Show where and why
                      </button>
                    </p>
                  ) : (
                    <p>{verdict.message}</p>
                  )}
                  {verdict.status === "passed" && nextChallenge && (
                    <button
                      className="small-button"
                      onClick={() => loadChallenge(nextChallenge.id)}
                    >
                      Next challenge: {nextChallenge.title}{" "}
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              )}
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
            <JourneyStage
              journey={journey}
              network={network}
              selected={selected}
              onSelect={select}
              onMove={(id, x, y) =>
                edit({ ...network, devices: network.devices.map((d) => (d.id === id ? { ...d, x, y } : d)) }, true)
              }
              onAdd={add}
              start={{
                label: `${action.kind === "dhcp" ? "Configure automatically" : "Send request"} and follow it`,
                disabled: !action.source,
                onClick: run,
              }}
              onAbout={select}
              onInspect={inspectPacket}
            />
            <SendPanel
              network={network}
              action={action}
              onAction={setAction}
              onSend={run}
              inputError={journey.inputError}
              onClearError={journey.clearInputError}
              onRestart={() => resetSession()}
            />
          </div>
          <InspectorPanel
            journey={journey}
            network={network}
            selected={selected}
            onSelect={setSelected}
            tab={tab}
            onTab={setTab}
            panelRef={inspectorRef}
            editor={{
              onApply: (updated) =>
                change({ ...network, devices: network.devices.map((d) => (d.id === updated.id ? updated : d)) }),
              onDelete: (device) => {
                edit({
                  ...network,
                  devices: network.devices.filter((d) => d.id !== device.id),
                  links: network.links.filter((l) => l.a.device !== device.id && l.b.device !== device.id),
                });
                setSelected("");
              },
              onConnect: (a, b, medium) => {
                try {
                  edit(connect(network, a, b, medium));
                } catch (e) {
                  setNotice((e as Error).message);
                }
              },
              onDisconnect: (id) => edit({ ...network, links: network.links.filter((l) => l.id !== id) }),
            }}
          />
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
