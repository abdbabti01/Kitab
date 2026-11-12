import { linkProps } from "../app/router.ts";
import { PathNext } from "../app/NetworkingPath.tsx";
import { sameConfiguration } from "./network/editing.ts";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Download,
  GraduationCap,
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
import { loadWorkspace, saveNamed, savedNetworks, SCRATCH_KEY, WORKSPACE_KEY } from "./network/storage.ts";
import { missions } from "./network/missions.ts";
import { loadMissionStore, missionState } from "./network/mission-progress.ts";
import { PredictCard, PredictSwitch, usePredictions } from "./Predict.tsx";
import type { Experiment } from "./network/experiments.ts";
import type { Trace } from "./network/model.ts";
import { checkpointsFor } from "./network/predict.ts";
import type { Side } from "./BreakCompare.tsx";

// Break and compare runs the engine for every fault it could offer, so it is only downloaded when opened.
const BreakCompare = lazy(() => import("./BreakCompare.tsx"));
import "./practice.css";
const deviceTypes = [
  { kind: "pc", label: "PC", icon: Monitor },
  { kind: "phone", label: "Phone", icon: Smartphone },
  { kind: "switch", label: "Switch", icon: NetworkIcon },
  { kind: "router", label: "Router", icon: HardDrive },
  { kind: "ap", label: "Access point", icon: Wifi },
  { kind: "server", label: "Server", icon: Server },
] as const;
// A practice copy of a mission's network, opened with ?scratch=1. It is never saved over the workspace.
function scratchCopy() {
  try {
    if (!new URLSearchParams(location.search).has("scratch")) return null;
    const raw = sessionStorage.getItem(SCRATCH_KEY);
    return raw ? importNetwork(raw) : null;
  } catch {
    return null;
  }
}
// A starter opened from the networking path (?starter=lan): like a practice copy, never saved over the workspace.
function pathStarter() {
  const id = new URLSearchParams(location.search).get("starter");
  return starterOptions.find((s) => s.id === id);
}
export function NetworkPlayground() {
  const [path] = useState(pathStarter);
  const [startup] = useState(() => {
    if (path)
      return {
        network: starter(path.id),
        scratch: true,
        error: `This is the “${path.name}” starter, opened from the networking path. Experiment freely: your own playground network is not changed, and nothing here is saved unless you save it under a name. ${path.steps?.[0].note ?? ""}`.trim(),
      };
    const copy = scratchCopy();
    if (copy)
      return {
        network: copy,
        scratch: true,
        error: "This is a practice copy of a mission network. Experiment freely: it is not saved over your own playground network or your mission. Save it under a name to keep it.",
      };
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
    [saveBlocked, setSaveBlocked] = useState(!!startup.error || "scratch" in startup),
    [saved, setSaved] = useState("Saved on this device");
  const [selected, setSelected] = useState(""),
    [tab, setTab] = useState<InspectorTab>("now");
  // Break and compare: a temporary broken copy, shown instead of the learner's network while it is open.
  const [comparing, setComparing] = useState(false),
    [experiment, setExperiment] = useState<{ x: Experiment; side: Side } | null>(null);
  const shown = experiment?.side === "broken" ? experiment.x.network : network;
  const predict = usePredictions(shown);
  // Predictions apply to the learner's own runs, not to the two runs of an experiment.
  const journey = useJourney(shown, undefined, experiment ? undefined : predict.limit);
  /** While an experiment is open nothing is edited or sent: the learner restores their network first. */
  function locked() {
    if (experiment) setNotice("This is a temporary experiment. Choose Restore my network to change or send anything.");
    return !!experiment;
  }
  function restore() {
    const x = experiment?.x;
    setExperiment(null);
    // Back to the learner's own network, showing its run at the same place as the comparison. With predictions on,
    // the questions before that place count as passed (as when predictions are turned on mid-run).
    if (!x) return;
    const at = x.divergence?.working ?? 0;
    if (predict.on)
      predict.setPicks({ trace: x.working, by: Object.fromEntries(checkpointsFor(x.working, network).filter((c) => c.ask < at).map((c) => [c.id, "seen"])) });
    journey.show(x.working, at);
  }
  // A starter's guided steps: after one succeeds, the next is loaded into the send form.
  const [steps, setSteps] = useState(path?.steps ?? []);
  const [action, setAction] = useState<Action>(() => path?.steps?.[0].action ?? {
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
    [help, setHelp] = useState(false),
    [saveList, setSaveList] = useState(false);
  const [practice] = useState(() => {
    try {
      const store = loadMissionStore(localStorage);
      const states = missions.map((m) => missionState(store.missions[m.id], m));
      return { done: states.filter((x) => x === "completed" || x === "mastered").length, mastered: states.filter((x) => x === "mastered").length };
    } catch {
      return { done: 0, mastered: 0 };
    }
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (inspectorRef.current) inspectorRef.current.scrollTop = 0;
  }, [tab, selected]);
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
    // A later guided step relies on state from earlier ones (such as a DHCP lease), which a reset discards.
    if (steps.findIndex((s) => s.action === action) > 0) {
      setAction(steps[0].action);
      message = `${message} ${steps[0].note}`;
    }
    setNotice(message);
  }
  function edit(next: Network, positionsOnly = false) {
    if (locked()) return;
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
    if (locked()) return;
    edit(structuredClone(next));
    // A practice copy never starts saving over the learner's own network, whatever it loads.
    if (!("scratch" in startup)) setSaveBlocked(false);
    setSelected("");
    setTab("now");
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
    if (locked()) return;
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
    if (locked()) return;
    setNotice("");
    // Send plays the journey straight away; pause, step and scrub stay available throughout.
    const result = journey.run(action, undefined, { play: true });
    if (!result) return;
    // The panel follows the run: Now explains each step as it plays.
    setTab("now");
    // Only the step as given advances; once the learner changes the form, they are on their own. The next step
    // is offered when this run's result is shown, so it does not give the result away.
    const at = steps.findIndex((s) => s.action === action);
    const next = at >= 0 ? steps[at + 1] : undefined;
    setNextStep(result.success && next ? { trace: result, step: next } : null);
  }
  const [nextStep, setNextStep] = useState<{ trace: Trace; step: (typeof steps)[number] } | null>(null);
  useEffect(() => {
    if (!nextStep || !journey.revealed || journey.fullTrace !== nextStep.trace) return;
    setAction(nextStep.step.action);
    setNotice(nextStep.step.note);
    setNextStep(null);
  }, [nextStep, journey.revealed, journey.fullTrace]);
  function history(undo: boolean) {
    if (locked()) return;
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
  function inspectPacket(scroll = true) {
    journey.setPlaying(false);
    setTab("packet");
    if (scroll && window.matchMedia("(max-width: 850px)").matches)
      inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const select = (id: string) => {
    setSelected(id);
    setTab("device");
  };
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
          <a className="small-button" {...linkProps("/practice/missions")}>
            <GraduationCap size={16} /> Practice missions{" "}
            <span className="count">
              {practice.done}/{missions.length} done
            </span>
          </a>
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
              {!saveBlocked && <span className="live-dot" />}
              {saveBlocked ? ("scratch" in startup ? "Practice copy · not saved" : "Not saved") : saved}
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
                const option = starterOptions.find((s) => s.id === e.target.value);
                replace(starter(e.target.value), option?.steps?.[0].action);
                setSteps(option?.steps ?? []);
                if (option?.steps) setNotice(option.steps[0].note);
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
            {experiment && (
              <div className="experiment-banner" role="status">
                <span>
                  <b>Temporary experiment.</b> Showing {experiment.side === "broken" ? "the broken copy" : "your network"}: {experiment.x.fault.label}. Your saved network is unchanged.
                </span>
                <button className="button" onClick={restore}>
                  Restore my network
                </button>
              </div>
            )}
            <JourneyStage
              journey={journey}
              network={shown}
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
              prompt={experiment ? null : <PredictCard predict={predict} journey={journey} network={shown} />}
              options={<PredictSwitch predict={predict} journey={journey} network={shown} />}
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
            <div className="compare-toggle">
              <button
                className="button"
                aria-expanded={comparing}
                onClick={() => {
                  if (comparing) restore();
                  setComparing(!comparing);
                }}
              >
                {comparing ? "Close Break and compare" : "Break and compare…"}
              </button>
            </div>
            {comparing && (
              <Suspense fallback={<p className="compare-loading">Loading Break and compare…</p>}>
                <BreakCompare
                  network={network}
                  action={action}
                  session={journey.session}
                  active={experiment?.x ?? null}
                  side={experiment?.side ?? "broken"}
                  onStart={(x) => {
                    setNotice("");
                    setExperiment({ x, side: "broken" });
                    journey.show(x.broken, x.divergence?.broken ?? x.broken.events.length - 1);
                  }}
                  onShow={(side, index, inspect) => {
                    if (!experiment) return;
                    setExperiment({ ...experiment, side });
                    journey.show(side === "broken" ? experiment.x.broken : experiment.x.working, index);
                    if (inspect) return inspectPacket();
                    // The panel sits below the diagram on narrow screens: bring the Journey into view if it is off screen.
                    const box = journey.journeyRef.current?.getBoundingClientRect();
                    if (box && (box.bottom < 0 || box.top > innerHeight))
                      journey.journeyRef.current!.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                  }}
                  onRestore={restore}
                />
              </Suspense>
            )}
          </div>
          <InspectorPanel
            journey={journey}
            network={shown}
            selected={selected}
            now={{ onAbout: select, onInspect: () => inspectPacket() }}
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
      {path && <PathNext id={`starter:${path.id}`} />}
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
