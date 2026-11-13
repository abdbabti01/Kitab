import { useRef, useState, useEffect, useLayoutEffect, useMemo, type PointerEvent, type ReactNode } from "react";
import { Maximize, Minus, Plus, Move, MousePointer2, Rows3, Shapes } from "lucide-react";
import { DeviceArt } from "./DeviceArt.tsx";
import { effectiveInterface } from "./network/engine.ts";
import { actionAt, type Motion } from "./network/motion.ts";
import { stackedLayout } from "./network/layout.ts";
import { tagMeaning, type Capsule } from "./network/packets.ts";
import type {
  Network,
  Session,
  TraceEvent,
  DeviceKind,
} from "./network/model.ts";

/** Below this canvas width the learner's own layout cannot be drawn readably, so the stacked layout is used. */
const NARROW = 640;
const LAYOUT_KEY = "kitab.network.layout";
const KIND_LABEL: Record<DeviceKind, string> = { pc: "PC", phone: "PHONE", switch: "SWITCH", router: "ROUTER", ap: "WI-FI AP", server: "SERVER" };

export function NetworkCanvas({
  network,
  session,
  event,
  selected,
  onSelect,
  onMove,
  onAdd,
  follow,
  focus,
  motion,
  onPacket,
  ask,
  changed,
  children,
}: {
  /** Break and compare: the devices the experiment's one change touches, and that setting's value in the run shown. */
  changed?: { devices: string[]; text: string };
  /** An open prediction question: the device that decides is marked, and devices named in the choices are lettered
   * answers that choose that option when tapped (the card's "Check my prediction" still submits it). */
  ask?: { device: string; answers: { device: string; option: string; letter: string; text: string }[]; chosen: string; onAnswer: (option: string) => void };
  /** What moves at this step, read from the trace (see motion.ts), how long a hop takes in ms, and the message's
   * layers and their changes at this step (capsuleAt). */
  motion?: Motion & { ms: number; capsule?: Capsule };
  /** Opens the current message's headers. */
  onPacket?: () => void;
  /** Shown in the canvas's own bar, such as the first-run start button. */
  children?: ReactNode;
  network: Network;
  session: Session;
  event?: TraceEvent;
  selected: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onAdd: (kind: DeviceKind, x?: number, y?: number) => void;
  follow: boolean;
  /** The current stage: its devices stay prominent and its links show their direction. */
  focus?: { devices: string[]; hops: { from: string; to: string; link: string }[] };
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [collapsedInternet, setCollapsedInternet] = useState(false),
    [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(
      null,
    );
  const gesture = useRef<{
    id: string;
    x: number;
    y: number;
    ox: number;
    oy: number;
  } | null>(null);
  // The drawing area in pixels, and which layout the learner chose: rows arranged for reading, or their own. Without
  // a choice, narrow screens get rows. The choice is a view preference on this device; no device is moved or saved.
  const [area, setArea] = useState({ w: 0, h: 0 }),
    [pref, setPref] = useState<"rows" | "own" | null>(() => {
      try {
        const v = localStorage.getItem(LAYOUT_KEY);
        return v === "rows" || v === "own" ? v : null;
      } catch {
        return null;
      }
    });
  const narrow = area.w > 0 && area.w < NARROW;
  const stacked = area.w > 0 && (pref ? pref === "rows" : narrow);
  function chooseLayout(next: "rows" | "own") {
    setPref(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // The choice still applies on this page.
    }
  }
  const layout = useMemo(() => stackedLayout(network), [network]);
  const bounds = () => {
    const xs = network.devices.map((d) => d.x),
      ys = network.devices.map((d) => d.y);
    return {
      x: Math.min(0, ...xs.map((x) => x - 100)),
      y: Math.max(0, Math.min(0, ...ys.map((y) => y - 120))),
      width: Math.max(800, ...xs.map((x) => x + 130)),
      height: Math.max(530, ...ys.map((y) => y + 150)),
    };
  };
  const [extent, setExtent] = useState(bounds);
  useEffect(() => {
    setExtent(bounds());
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [network.name, network.devices.length]);

  // ---- The view. The learner's layout: the whole network, or the current stage framed when it would be too small.
  let width = extent.width / zoom,
    height = extent.height / zoom;
  let view = { x: pan.x, y: pan.y };
  const framed = !stacked && follow && focus && area.w > 0 && area.w / extent.width < 0.4
    ? network.devices.filter((d) => focus.devices.includes(d.id) || focus.hops.some((h) => h.from === d.id || h.to === d.id))
    : [];
  if (framed.length) {
    let [x0, x1] = [Math.min(...framed.map((d) => d.x)) - 110, Math.max(...framed.map((d) => d.x)) + 110],
      [y0, y1] = [Math.min(...framed.map((d) => d.y)) - 110, Math.max(...framed.map((d) => d.y)) + 140];
    if (x1 - x0 < 420) [x0, x1] = [(x0 + x1) / 2 - 210, (x0 + x1) / 2 + 210];
    if (y1 - y0 < 300) [y0, y1] = [(y0 + y1) / 2 - 150, (y0 + y1) / 2 + 150];
    [width, height, view] = [x1 - x0, y1 - y0, { x: x0, y: y0 }];
  }
  // The stacked layout: a readable scale and a camera over it. Two columns fill a phone's width; a wide screen shows
  // whole rows when it can without going below that scale.
  const scale = Math.min(1.15, Math.max(0.8, area.w / Math.max(430, layout.width))) * zoom;
  const camW = area.w / scale || 430,
    camH = area.h / scale || 600;
  const clampCam = (c: { x: number; y: number }) => ({
    x: layout.width <= camW ? (layout.width - camW) / 2 : Math.min(layout.width - camW, Math.max(0, c.x)),
    y: layout.height <= camH ? (layout.height - camH) / 2 : Math.min(layout.height - camH, Math.max(0, c.y)),
  });
  // The camera's position lives in a ref: gliding and panning move the drawing's viewBox directly, without
  // rendering the diagram again on every frame; it is rendered once when the move ends.
  const camRef = useRef({ x: 0, y: 0 });
  const [, setCamTick] = useState(0);
  const setCam = (c: { x: number; y: number }) => {
    camRef.current = c;
    setCamTick((t) => t + 1);
  };
  // While the camera moves, one transform on the whole scene moves the drawing: changing the viewBox every frame would
  // make the browser lay out every device again on each frame. The final position is rendered once, at the end.
  const scene = useRef<SVGGElement>(null),
    shown = useRef({ x: 0, y: 0 });
  const drawCam = (c: { x: number; y: number }) => {
    camRef.current = c;
    scene.current?.setAttribute("transform", `translate(${shown.current.x - c.x} ${shown.current.y - c.y})`);
  };
  useLayoutEffect(() => {
    scene.current?.removeAttribute("transform");
  });
  const glide = useRef(0);
  function moveCam(target: { x: number; y: number }, animate: boolean) {
    cancelAnimationFrame(glide.current);
    const to = clampCam(target),
      from = camRef.current;
    if (!animate || reducedMotion() || (Math.abs(to.x - from.x) < 1 && Math.abs(to.y - from.y) < 1)) return setCam(to);
    const start = performance.now();
    const stepCam = (now: number) => {
      const k = Math.min(1, (now - start) / 360),
        e = 1 - (1 - k) ** 3;
      drawCam({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (k < 1) glide.current = requestAnimationFrame(stepCam);
      else setCam(to);
    };
    glide.current = requestAnimationFrame(stepCam);
  }
  useEffect(() => () => cancelAnimationFrame(glide.current), []);
  // A new arrangement of rows, or a new screen width, starts at the top of the layout.
  const rowsKey = layout.rows.map((r) => r.join(",")).join("|");
  useEffect(() => {
    if (stacked) moveCam({ x: (layout.width - camW) / 2, y: 0 }, false);
  }, [stacked, rowsKey, area.w]);
  // Following the journey: the camera moves only when the devices of this step leave the middle of the view.
  // A switch or access point copies a broadcast to many devices at once: the camera keeps that device in view rather
  // than chasing each copy across a large network (the copies still leave along their lit links). Any other frame,
  // including a host's own broadcast to its first hop, is followed to its receiver.
  const flooding = motion?.packet?.broadcast && ["switch", "ap"].includes(network.devices.find((d) => d.id === motion.packet!.from)?.kind ?? "");
  const watched = !event ? [] : flooding ? [motion!.packet!.from] : [event.actor, event.hop?.from, event.hop?.to].filter((x): x is string => !!x);
  const watchKey = watched.join(" ");
  /** The devices' extent, with room for their labels. */
  const extentOf = (ids: string[]) => {
    const ps = ids.map((id) => layout.pos[id]).filter(Boolean);
    return ps.length ? { x0: Math.min(...ps.map((p) => p.x)) - 80, x1: Math.max(...ps.map((p) => p.x)) + 80, y0: Math.min(...ps.map((p) => p.y)) - 90, y1: Math.max(...ps.map((p) => p.y)) + 160 } : null;
  };
  /**
   * Moves the camera only when a device of this step would leave the view (its tile and name), not to keep it
   * centred: each move repaints the whole drawing. When it has to move, it frames the whole stage if that fits, so
   * the rest of the stage needs no further move.
   */
  function reveal(ids: string[], stage: string[] = []) {
    const b = extentOf(ids);
    if (!b) return;
    const c = camRef.current,
      seen = (p: { x: number; y: number }) => p.x - 70 >= c.x && p.x + 70 <= c.x + camW && p.y - 65 >= c.y && p.y + 110 <= c.y + camH;
    if (ids.every((id) => !layout.pos[id] || seen(layout.pos[id]))) return;
    const s = extentOf([...new Set([...stage, ...ids])]);
    const t = s && s.x1 - s.x0 <= camW * 0.98 && s.y1 - s.y0 <= camH * 0.98 ? s : b;
    moveCam({ x: (t.x0 + t.x1) / 2 - camW / 2, y: (t.y0 + t.y1) / 2 - camH / 2 }, true);
  }
  const stageIds = focus ? [...focus.devices, ...focus.hops.flatMap((h) => [h.from, h.to])] : [];
  useEffect(() => {
    if (stacked && follow && watched.length) reveal(watched, stageIds);
  }, [watchKey, stacked, follow, layout, camW, camH]);
  // A question brings its device into view, framed with its lettered answers when they all fit (a phone's rows
  // often do not); the answers are also in the question's list.
  const askKey = ask ? [ask.device, ...ask.answers.map((a) => a.device)].join(" ") : "";
  useEffect(() => {
    if (!stacked || !askKey) return;
    const [asking, ...answers] = askKey.split(" ");
    reveal([asking], answers);
  }, [askKey, stacked]);
  if (stacked) {
    const c = clampCam(camRef.current);
    [width, height, view] = [camW, camH, c];
    shown.current = c;
  }

  function point(clientX: number, clientY: number) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  }
  function down(e: PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 || (e.target as Element).closest("[data-packet]")) return;
    const target = (e.target as Element).closest("[data-device]");
    const id = target?.getAttribute("data-device") ?? "";
    const p = point(e.clientX, e.clientY);
    const d = network.devices.find((d) => d.id === id);
    const answer = ask?.answers.find((a) => a.device === id);
    if (answer) ask!.onAnswer(answer.option);
    else if (d) onSelect(id);
    // Stacked devices have no position of their own to drag: any drag pans the view, measured in screen pixels
    // because the drawing moves under the pointer.
    gesture.current = stacked
      ? { id: "", x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }
      : { id, x: p.x, y: p.y, ox: d?.x ?? view.x, oy: d?.y ?? view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g) return;
    if (stacked) return drawCam(clampCam({ x: g.ox - (e.clientX - g.x) / scale, y: g.oy - (e.clientY - g.y) / scale }));
    const p = point(e.clientX, e.clientY);
    if (g.id)
      setDrag({
        id: g.id,
        x: Math.max(60, Math.min(2940, g.ox + p.x - g.x)),
        y: Math.max(85, Math.min(1930, g.oy + p.y - g.y)),
      });
    else if (!follow) setPan({ x: g.ox + (g.x - p.x), y: g.oy + (g.y - p.y) });
  }
  function up() {
    if (stacked && gesture.current) setCam(camRef.current);
    if (drag) onMove(drag.id, Math.round(drag.x), Math.round(drag.y));
    setDrag(null);
    gesture.current = null;
  }
  const placed = network.devices.map((d) => (stacked ? { ...d, ...layout.pos[d.id] } : d));
  const devices = placed.map((d) =>
    drag?.id === d.id ? { ...d, x: drag.x, y: drag.y } : d,
  );
  const internetIds = new Set(
    stacked
      ? []
      : devices
          .filter((d) => /^(ISP|Internet services)/.test(d.group))
          .map((d) => d.id),
  );
  const collapsed = collapsedInternet && !stacked;
  /** A prediction's lettered answers that a collapsed Internet hides. */
  const hiddenAnswers = collapsed ? (ask?.answers ?? []).filter((a) => internetIds.has(a.device)).sort((x, y) => x.letter.localeCompare(y.letter)) : [];
  const cloud = { x: 1060, y: 290 };
  const displayPosition = (d: (typeof devices)[number]) =>
    collapsed && internetIds.has(d.id) ? { ...d, ...cloud } : d;
  const visibleDevices = collapsed
    ? devices.filter((d) => !internetIds.has(d.id))
    : devices;
  // A zone is drawn only where it holds just its own devices (always so in the learner's own layouts).
  const groups = [
    ...new Set(visibleDevices.map((d) => d.group).filter(Boolean)),
  ].filter((group) => {
    if (!stacked) return true;
    const list = visibleDevices.filter((d) => d.group === group);
    const [x0, x1, y0, y1] = [Math.min(...list.map((d) => d.x)) - 85, Math.max(...list.map((d) => d.x)) + 85, Math.min(...list.map((d) => d.y)) - 97, Math.max(...list.map((d) => d.y)) + 120];
    return !visibleDevices.some((d) => d.group !== group && d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1);
  });
  const wrap = useRef<HTMLDivElement>(null);
  // Measure the drawing area once and whenever its size changes; never on every render, which would force a layout
  // at each step of playback.
  useLayoutEffect(() => {
    const report = () => {
      const r = svg.current?.getBoundingClientRect();
      if (r) setArea((a) => (Math.round(r.width) === a.w && Math.round(r.height) === a.h ? a : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    report();
    const observer = new ResizeObserver(report);
    if (svg.current) observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const place = (id: string) => {
    const d = devices.find((x) => x.id === id);
    return d && displayPosition(d);
  };
  const onPath = new Set(focus?.hops.map((h) => h.link));
  // Screen pixels per diagram unit, from the view itself (the drawing is scaled to fit its area, keeping its shape).
  const unitPx = area.w && area.h ? Math.min(area.w / width, area.h / height) : 1;
  // The message is about 20 px tall on screen however far the diagram is zoomed out, without outgrowing the devices.
  const tokenScale = Math.min(2, Math.max(1, 20 / (CAPSULE_H * unitPx)));
  // Half its drawn size, so its path stops clear of tiles and labels.
  const pad = { x: (capsuleWidth(motion?.capsule, motion?.packet?.label ?? motion?.held?.label ?? "") / 2) * tokenScale, y: (CAPSULE_H / 2) * tokenScale };
  const involved = focus && new Set([...focus.devices, ...focus.hops.flatMap((h) => [h.from, h.to])]);
  // Stacked, a cable leaves a device below its name and address and arrives at the top of the next tile, so it never
  // runs through a label; in the learner's own layout cables join device centres as before.
  const cable = (from: Point, to: Point) => {
    if (!stacked) return cableBetween(from, to, false);
    const end = (p: Point, o: Point) => ({ x: p.x, y: o.y > p.y + 1 ? p.y + 108 : o.y < p.y - 1 ? p.y - 52 : p.y - 50 });
    return cableBetween(end(from, to), end(to, from), true);
  };
  // What the acting device is doing, and the link its routing decision chose, as recorded in the trace.
  const action = event && !motion?.packet ? actionAt(event, network) : event?.hop ? { ...actionAt(event, network), device: event.hop.from } : undefined;
  /**
   * Whether an experiment's tag fits above a device without covering another device's tile, name or address. In a
   * crowded layout of the learner's own it may not: the device then gets a compact badge instead, and the full text
   * stays in its accessible name, its tooltip, the banner and Now. Positions are only read, never changed.
   */
  const tagFits = (d: (typeof devices)[number], text: string) => {
    const big = !stacked, k = big ? 1.15 : 1;
    const half = (text.length * 7.2 + 32) / 2, top = d.y + (big ? -92 : -82) - 14, bottom = top + 26;
    return !visibleDevices.some((o) => {
      if (o.id === d.id) return false;
      const name = Math.min(o.name.length, big ? 24 : 21) * 3.9 + 8;
      const boxes = [
        [o.x - 62 * k, o.x + 62 * k, o.y - 59 * k, o.y + 60 * k],
        [o.x - name, o.x + name, o.y + (big ? 78 : 62), o.y + (big ? 118 : 102)],
      ];
      return boxes.some(([x0, x1, y0, y1]) => d.x - half < x1 && d.x + half > x0 && top < y1 && bottom > y0);
    });
  };
  /** A device's name and address under its tile (drawn larger, and so lower, in the learner's own layout). */
  const labels = (d: (typeof devices)[number]) => {
    const p = d.interfaces.map((p) => effectiveInterface(d, p, session)).find((p) => p.ip);
    const max = stacked ? 21 : 24;
    return (
      <>
        <text className="device-name" y={stacked ? 76 : 92} textAnchor="middle">
          {d.name.length > max ? `${d.name.slice(0, max - 2)}…` : d.name}
        </text>
        <text className="device-ip" y={stacked ? 96 : 112} textAnchor="middle">
          {p?.ip ?? (d.kind === "phone" ? "DHCP · awaiting address" : d.kind === "switch" ? "MAC forwarding" : d.kind === "ap" ? d.ssid : "Unconfigured")}
        </text>
      </>
    );
  };
  const chosen = action && !motion?.packet ? action.link : undefined;
  const actor = event?.actor;
  const stopped = event?.error ? actor : undefined;
  return (
    <div
      ref={wrap}
      className={`network-canvas${stacked ? " is-stacked" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData("kitab/device") as DeviceKind;
        if (
          ["pc", "phone", "switch", "router", "ap", "server"].includes(kind)
        ) {
          // In the stacked layout a drop point is not a place in the learner's own layout.
          if (stacked) return onAdd(kind);
          const p = point(e.clientX, e.clientY);
          onAdd(kind, p.x, p.y);
        }
      }}
    >
      {/* The canvas's own controls sit in a bar of their own, so they never cover a device. */}
      <div className="canvas-bar">
        <div className="canvas-caption">
          <span className="live-dot" /> YOUR NETWORK{" "}
          <span>
            {network.devices.length} {network.devices.length === 1 ? "device" : "devices"} · {network.links.length} {network.links.length === 1 ? "link" : "links"}
          </span>
        </div>
        {children}
        <div className="canvas-tools">
          {network.devices.length > 0 && (
            <button className="canvas-layout" aria-pressed={stacked} onClick={() => chooseLayout(stacked ? "own" : "rows")} title={stacked ? "Show the layout you arranged" : "Arrange the devices in readable rows"}>
              {stacked ? <Rows3 size={15} /> : <Shapes size={15} />} {stacked ? "Rows" : "My layout"}
            </button>
          )}
          {internetIds.size > 0 && (
            <button
              className="internet-toggle"
              onClick={() => setCollapsedInternet((v) => !v)}
            >
              {collapsedInternet ? "Expand Internet" : "Collapse Internet"}
            </button>
          )}
          <div className="canvas-zoom">
            <button
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            >
              <Minus size={16} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
            >
              <Plus size={16} />
            </button>
            <button
              aria-label="Fit network"
              onClick={() => {
                setExtent(bounds());
                setZoom(1);
                setPan({ x: 0, y: 0 });
                if (stacked) moveCam({ x: (layout.width - camW) / 2, y: 0 }, true);
              }}
            >
              <Maximize size={16} />
            </button>
          </div>
        </div>
      </div>
      <svg
        ref={svg}
        viewBox={`${view.x} ${view.y} ${width} ${height}`}
        preserveAspectRatio={stacked ? "xMinYMin meet" : "xMidYMid meet"}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          gesture.current = null;
          setDrag(null);
        }}
        aria-label="Editable network topology"
        className="topology-svg"
      >
        <defs>
          <pattern
            id="network-grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="1" fill="#c6d0c5" />
          </pattern>
        </defs>
        <g ref={scene}>
        {/* The grid under everything: stacked, it covers the whole layout, so a camera glide never shows its edge. */}
        <rect
          x={stacked ? -2000 : view.x}
          y={stacked ? -2000 : view.y}
          width={stacked ? layout.width + 4000 : width}
          height={stacked ? layout.height + 4000 : height}
          fill="url(#network-grid)"
        />
        {groups.map((group, i) => {
          const list = visibleDevices.filter((d) => d.group === group);
          const x = Math.min(...list.map((d) => d.x)) - 85,
            y = Math.min(...list.map((d) => d.y)) - 97,
            w = Math.max(...list.map((d) => d.x)) - x + 85,
            h = Math.max(...list.map((d) => d.y)) - y + 120;
          return (
            <g key={group} className={`network-zone zone-${i % 3}`}>
              <rect x={x} y={y} width={w} height={h} rx="24" />
              <text x={x + 18} y={y + 27}>
                {group}
              </text>
            </g>
          );
        })}
        {network.links.map((l) => {
          const a = devices.find((d) => d.id === l.a.device)!,
            b = devices.find((d) => d.id === l.b.device)!;
          if (
            !a ||
            !b ||
            (collapsed &&
              internetIds.has(a.id) &&
              internetIds.has(b.id))
          )
            return null;
          const pa = displayPosition(a),
            pb = displayPosition(b);
          const active = event?.hop?.link === l.id;
          const forwarding = motion?.forward?.links.includes(l.id) ? `is-${motion.forward.kind}` : "";
          // The link a frame is crossing takes the colour of what it carries; a frame lost on it marks it.
          const carrying = active && motion?.packet ? `kind-${motion.packet.kind}${motion.packet.lost ? " is-lost" : ""}` : "";
          // Stacked, cables fan out from one device to many, so only Wi-Fi links and the link in use are named, near
          // the lower device where the cables have spread apart.
          const c = cable(pa, pb),
            mid = c.at(stacked ? (pa.y < pb.y ? 0.75 : 0.25) : 0.5),
            named = !stacked || l.medium === "wifi" || active || chosen === l.id;
          return (
            <g key={l.id}>
              <path
                d={c.d}
                className={`network-wire ${l.medium} ${active ? "active" : ""} ${carrying} ${chosen === l.id ? "is-chosen" : ""} ${onPath.has(l.id) ? "in-path" : ""} ${forwarding}`}
              />
              {named && (
              <text
                className="link-label"
                x={mid.x + (stacked ? 10 : 0)}
                y={mid.y - (stacked ? 0 : 12)}
                textAnchor={stacked ? "start" : "middle"}
              >
                {l.medium === "wifi" ? "Wi-Fi" : "Ethernet"}
              </text>
              )}
            </g>
          );
        })}
        {/* Direction of travel on each link the current stage used. */}
        {[...new Map(focus?.hops.map((h) => [`${h.link}>${h.from}`, h])).values()].map((h) => {
          const a = devices.find((d) => d.id === h.from),
            b = devices.find((d) => d.id === h.to);
          if (!a || !b) return null;
          const pa = displayPosition(a),
            pb = displayPosition(b);
          const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1,
            ux = (pb.x - pa.x) / len,
            uy = (pb.y - pa.y) / len;
          // Opposite directions sit on opposite sides of the cable.
          const at = cable(pa, pb).at(0.5);
          const mx = at.x - uy * 11,
            my = at.y + ux * 11;
          return (
            <path
              key={`${h.link}>${h.from}`}
              className="path-arrow"
              d={`M ${mx - ux * 9 - uy * 6} ${my - uy * 9 + ux * 6} L ${mx + ux * 7} ${my + uy * 7} L ${mx - ux * 9 + uy * 6} ${my - uy * 9 - ux * 6}`}
            />
          );
        })}
        {collapsed && internetIds.size > 0 && (
          <g
            transform={`translate(${cloud.x} ${cloud.y})`}
            className={`network-device ${event && internetIds.has(event.actor) ? "is-active" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`Expand simulated Internet${hiddenAnswers.length ? `, which holds ${hiddenAnswers.length === 1 ? "answer" : "answers"} ${hiddenAnswers.map((a) => a.letter).join(" and ")}` : ""}`}
            onClick={() => setCollapsedInternet(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setCollapsedInternet(false);
              }
            }}
          >
            <path
              className="device-tile"
              d="M-75 25C-120 25-125-35-77-40C-70-90 0-102 30-56C83-77 120-30 93 5C140 50 65 69 40 51H-60C-90 51-95 38-75 25Z"
            />
            <text textAnchor="middle" className="device-name" y="-2">
              Simulated Internet
            </text>
            <text textAnchor="middle" className="device-ip" y="20">
              {internetIds.size} devices · click to expand
            </text>
            {/* A question's answers that are inside: their letters, all alike, so nothing says which is right. */}
            {hiddenAnswers.length > 0 && (
              <g className="answer-badge" transform="translate(-92 -40)" aria-hidden="true">
                <rect x={-17} y={-17} width={hiddenAnswers.length * 22 + 12} height="34" rx="17" />
                <text x={hiddenAnswers.length * 11 - 11} y="6.5" textAnchor="middle">
                  {hiddenAnswers.map((a) => a.letter).join(" ")}
                </text>
              </g>
            )}
          </g>
        )}
        {/* The message's touch area: about 44 px wherever it rests, drawn under the devices so a device still
            gets taps on its own tile. At least about 44 px, and always 16 px beyond the drawn frame. */}
        {motion && (() => {
          const spot = restingSpot(motion, place, cable, stacked, pad);
          return (
            spot && (
              <circle
                className="packet-hit"
                cx={spot.at.x}
                cy={spot.at.y}
                r={Math.max(Math.min(60, Math.max(26, 22 / unitPx)), pad.y + 16 / unitPx)}
                data-packet=""
                aria-hidden="true"
                onClick={onPacket}
              />
            )
          );
        })()}
        {visibleDevices.map((d) => {
          const active = actor === d.id;
          const sender = event?.hop?.from === d.id,
            receiver = event?.hop?.to === d.id;
          // What the device is doing at this step, by class: sending, receiving, forwarding, working, stopped.
          const state = stopped === d.id
            ? "is-stopped"
            : motion?.halt?.device === d.id
              ? "is-discarded"
              : sender
                ? "is-sender"
                : receiver
                  ? "is-receiver"
                  : active && motion?.forward
                    ? "is-forwarding"
                    : active
                      ? "is-working"
                      : "";
          // In the learner's own layout the tile is drawn larger, the labels move down with it.
          const big = !stacked;
          const answer = ask?.answers.find((a) => a.device === d.id);
          const asking = ask?.device === d.id;
          const isChanged = !!changed?.devices.includes(d.id);
          return (
            <g
              key={d.id}
              transform={`translate(${d.x} ${d.y})`}
              className={`network-device kind-${d.kind} ${selected === d.id ? "selected" : ""} ${active ? "is-active" : ""} ${state} ${involved && !involved.has(d.id) ? "is-dimmed" : ""}${asking ? " is-asking" : ""}${answer ? ` is-answer${ask!.chosen === answer.option ? " is-chosen" : ""}` : ""}${isChanged ? " is-changed" : ""}`}
              // A frame arrives when its hop ends: the receiver lights up then, not before.
              style={receiver && motion ? ({ "--arrive": `${motion.ms}ms` } as React.CSSProperties) : undefined}
              role="button"
              tabIndex={0}
              aria-label={answer ? `Answer ${answer.letter}: ${answer.text}` : `Select ${d.name}${asking ? ", where the question is asked" : ""}${isChanged ? `, changed in this experiment: ${changed!.text}` : ""}`}
              aria-pressed={answer ? ask!.chosen === answer.option : undefined}
              data-device={d.id}
              // A device reached with the keyboard is brought into view.
              onFocus={() => stacked && reveal([d.id])}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (answer) ask!.onAnswer(answer.option);
                  else onSelect(d.id);
                }
                if (
                  !stacked &&
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    e.key,
                  )
                ) {
                  e.preventDefault();
                  const own = network.devices.find((x) => x.id === d.id)!;
                  onMove(
                    d.id,
                    Math.max(
                      60,
                      Math.min(
                        2940,
                        own.x +
                          (e.key === "ArrowRight"
                            ? 20
                            : e.key === "ArrowLeft"
                              ? -20
                              : 0),
                      ),
                    ),
                    Math.max(
                      85,
                      Math.min(
                        1930,
                        own.y +
                          (e.key === "ArrowDown"
                            ? 20
                            : e.key === "ArrowUp"
                              ? -20
                              : 0),
                      ),
                    ),
                  );
                }
              }}
            >
              <g transform={big ? "scale(1.15)" : undefined}>
                <rect className="device-ring" x="-62" y="-59" width="124" height="119" rx="29" />
                {/* A flat shadow: cheap to redraw while the view moves, unlike a filter. */}
                <rect className="device-shadow" x="-50" y="-43" width="104" height="99" rx="22" />
                <rect
                  className="device-tile"
                  x="-52"
                  y="-49"
                  width="104"
                  height="99"
                  rx="22"
                />
                <g transform="translate(0 -7) scale(0.84)">
                  <DeviceArt kind={d.kind} />
                </g>
                <text className="device-kind" y="38" textAnchor="middle">
                  {KIND_LABEL[d.kind]}
                </text>
                <circle
                  cx="42"
                  cy="-39"
                  r="5"
                  className={
                    d.interfaces.some((p) => p.enabled)
                      ? "device-led"
                      : "device-led off"
                  }
                />
                {/* The question's device, and the answers by the letter they have in the question. */}
                {(asking || answer) && (
                  <g className={asking && !answer ? "ask-badge" : "answer-badge"} transform="translate(-54 -52)" aria-hidden="true">
                    <circle r="17" />
                    <text y="6.5" textAnchor="middle">
                      {answer ? answer.letter : "?"}
                    </text>
                  </g>
                )}
              </g>
              {/* The experiment's one change, on the device it touches, as it is in the run shown. */}
              {isChanged &&
                (tagFits(d, changed!.text) ? (
                  <g className="changed-tag" transform={`translate(0 ${big ? -92 : -82})`} aria-hidden="true">
                    <rect x={-(changed!.text.length * 3.6 + 16)} y="-14" width={changed!.text.length * 7.2 + 32} height="26" rx="13" />
                    <text y="4.5" textAnchor="middle">
                      {changed!.text}
                    </text>
                  </g>
                ) : (
                  <g className="changed-tag is-compact" transform={`translate(${big ? 62 : 54} ${big ? -60 : -52})`}>
                    <title>{changed!.text}</title>
                    <circle r="15" />
                    <text y="6" textAnchor="middle">
                      !
                    </text>
                  </g>
                ))}
              {labels(d)}
            </g>
          );
        })}
        {/* What the acting device does at this step, under it: the step and the decision it recorded. */}
        {action && (() => {
          const at = place(action.device);
          if (!at) return null;
          const lines = [action.title, action.detail].filter((x): x is string => !!x);
          const w = Math.max(...lines.map((t, i) => t.length * (i ? 6.9 : 7.6))) + 24;
          // At least about 12 px text on screen, and kept inside the view.
          const k = Math.min(1.6, Math.max(1, 12 / (12.5 * unitPx)));
          const half = (w * k) / 2 + 4;
          const x = Math.min(Math.max(at.x, view.x + half), view.x + width - half);
          return (
            <g className={`action-tag${stopped ? " is-stopped" : ""}`} transform={`translate(${x} ${at.y + (stacked ? 106 : 122)}) scale(${k.toFixed(2)})`} aria-hidden="true">
              <rect x={-w / 2} y="0" width={w} height={lines.length > 1 ? 40 : 24} rx="8" />
              <text className="action-title" y="16.5" textAnchor="middle">
                {action.title}
              </text>
              {action.detail && (
                <text className="action-detail" y="33" textAnchor="middle">
                  {action.detail}
                </text>
              )}
            </g>
          );
        })()}
        {motion && (
          <PacketLayer
            motion={motion}
            eventId={event?.id ?? 0}
            place={place}
            cable={cable}
            stacked={stacked}
            name={(id) => network.devices.find((d) => d.id === id)?.name ?? id}
            onPacket={onPacket}
            scale={tokenScale}
            pad={pad}
          />
        )}
        {/* While a frame crosses a link, the two devices' names and addresses are drawn above it: on a short link of a
            crowded layout it passes behind their text rather than over it. */}
        {motion?.packet &&
          [motion.packet.from, motion.packet.to].map((id) => {
            const d = visibleDevices.find((x) => x.id === id);
            return d ? (
              <g key={`over ${id}`} className="labels-over" data-labels-for={id} transform={`translate(${d.x} ${d.y})`} aria-hidden="true">
                {labels(d)}
              </g>
            ) : null;
          })}
        {!network.devices.length && (
          <g className="empty-canvas">
            <text x={view.x + width / 2} y={view.y + height / 2 - 18} textAnchor="middle">
              Every network starts with a connection.
            </text>
            <text x={view.x + width / 2} y={view.y + height / 2 + 17} textAnchor="middle" className="small">
              Add a device from the tray above, then connect its ports.
            </text>
          </g>
        )}
        </g>
      </svg>
      <div className="canvas-foot">
        <span className="canvas-hint">
          <Move size={14} />{" "}
          {stacked ? "Arranged in rows for reading · drag to look around · select to configure" : "Drag devices · drag background to pan · select to configure"}
        </span>
        <span className="canvas-mode">
          <MousePointer2 size={13} /> Select & move
        </span>
      </div>
    </div>
  );
}

type Point = { x: number; y: number };
type Cable = { d: string; at: (t: number) => Point };
/** The cable between two devices: across in the learner's layout, down between rows (or arched within one) when stacked. */
function cableBetween(a: Point, b: Point, stacked: boolean): Cable {
  let c1: Point, c2: Point;
  if (stacked) {
    const my = Math.abs(a.y - b.y) < 1 ? a.y - 120 : (a.y + b.y) / 2;
    [c1, c2] = [{ x: a.x, y: my }, { x: b.x, y: my }];
  } else {
    const mx = (a.x + b.x) / 2;
    [c1, c2] = [{ x: mx, y: a.y }, { x: mx, y: b.y }];
  }
  return {
    d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
    at: (t) => {
      const u = 1 - t;
      return {
        x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x,
        y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y,
      };
    },
  };
}
/** Where the message rests at this step: at the receiver's end of its link (halfway if lost), with the path there,
 * or beside the device working on it. The path leaves and arrives clear of both devices' tiles and labels. */
function restingSpot(
  { packet, held }: Motion,
  place: (id: string) => Point | undefined,
  cable: (a: Point, b: Point) => Cable,
  stacked: boolean,
  pad = { x: 0, y: 0 },
): { at: Point; points?: Point[] } | null {
  if (packet) {
    const a = place(packet.from),
      b = place(packet.to);
    if (!a || !b) return null;
    const c = cable(a, b);
    // A device's tile and the name, address and action label under it.
    const below = stacked ? 150 : 120;
    const covers = (p: Point, d: Point) => Math.abs(p.x - d.x) < 64 + pad.x && p.y > d.y - 60 - pad.y && p.y < d.y + below + pad.y;
    let t0 = 0,
      t1 = 1;
    while (t0 < 0.5 && covers(c.at(t0), a)) t0 += 0.02;
    while (t1 > 0.5 && covers(c.at(t1), b)) t1 -= 0.02;
    // Devices too close for that (a crowded layout of the learner's own): leave and stop just off the tiles, except
    // on the side where a device's name and address are (below it): there the frame starts and rests on the tile's
    // edge instead, so it never sits on the text.
    if (t1 - t0 < 0.15) {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      t0 = Math.min(0.45, ((b.y - a.y) / len > 0.5 ? 40 : 70) / len);
      t1 = 1 - Math.min(0.45, ((a.y - b.y) / len > 0.5 ? 40 : 70) / len);
    }
    if (packet.lost) t1 = (t0 + t1) / 2;
    const points = Array.from({ length: 13 }, (_, i) => c.at(t0 + ((t1 - t0) * i) / 12));
    return { at: points.at(-1)!, points };
  }
  const at = held && place(held.device);
  // Beside the tile's top corner, which is drawn larger in the learner's own layout.
  return at ? { at: stacked ? { x: at.x + 44, y: at.y - 52 } : { x: at.x + 50, y: at.y - 60 } } : null;
}
const CAPSULE_H = 18;
const segWidth = (tag: string) => tag.length * 6.6 + 12;
const capsuleWidth = (c: Capsule | undefined, label: string) =>
  c?.segments.length ? c.segments.reduce((w, s) => w + segWidth(s.tag), 0) : segWidth(label);
/** A change note short enough for the diagram: "src 192.168.1.10:53000→203.0.113.2:62000" becomes "src → 203.0.113.2:62000". */
const brief = (note: string) => (note.length > 22 ? note.replace(/^(\S+(?: port)?) .*→(.*)$/, "$1 → $2") : note);
const reducedMotion = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** The message on the diagram: crossing its link once, held at the device working on it, or stopped. */
function PacketLayer({
  motion,
  eventId,
  place,
  cable,
  stacked,
  name,
  onPacket,
  scale = 1,
  pad,
}: {
  /** Drawn size of the message, so it stays easy to find on a small or zoomed-out diagram. */
  scale?: number;
  pad?: { x: number; y: number };
  motion: Motion & { ms: number; capsule?: Capsule };
  eventId: number;
  place: (id: string) => Point | undefined;
  cable: (a: Point, b: Point) => Cable;
  stacked: boolean;
  name: (id: string) => string;
  onPacket?: () => void;
}) {
  const { packet, held, halt } = motion;
  let token: ReactNode = null;
  const select = {
    role: "button",
    tabIndex: 0,
    "data-packet": "",
    onClick: onPacket,
    onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPacket?.();
    }
    },
  };
  const reduced = reducedMotion();
  // Layer changes take most of a held step, or the start of a hop (a frame is wrapped before it is sent).
  const changeMs = Math.round(Math.min(700, Math.max(250, motion.packet ? motion.ms * 0.35 : motion.ms * 0.8)));
  /** The message as its layers: one segment per layer, outermost first, as the headers sit on the wire. */
  const badge = (label: string, broadcast = false, moving = false) => {
    const c = motion.capsule;
    const segs = c?.segments.length ? c.segments : [{ tag: label, name: label, kind: "network" as const, mark: undefined }];
    const w = capsuleWidth(c, label);
    let x = -w / 2;
    const notes = (c?.notes ?? []).slice(0, 2).map(brief).join("  ");
    const nw = notes.length * 6.3 + 14;
    return (
      <g transform={scale === 1 ? undefined : `scale(${scale.toFixed(2)})`} style={{ "--change": `${changeMs}ms` } as React.CSSProperties}>
        {/* A short pulse as a hop begins, so the eye finds the frame that is about to move. */}
        {moving && <rect className="packet-locate" x={-w / 2 - 6} y={-CAPSULE_H / 2 - 6} width={w + 12} height={CAPSULE_H + 12} rx="12" />}
        {broadcast && <rect className="packet-broadcast" x={-w / 2 - 5} y={-CAPSULE_H / 2 - 5} width={w + 10} height={CAPSULE_H + 10} rx="11" />}
        <rect className="packet-shape" x={-w / 2} y={-CAPSULE_H / 2} width={w} height={CAPSULE_H} rx="6" />
        {/* A layer this step took off leaves from the outside of the packet. */}
        {!reduced &&
          (c?.gone ?? []).map((g) => {
            const gw = segWidth(g.tag);
            return (
              <g key={`gone ${g.name}`} className={`packet-seg layer-${g.kind} is-gone`} aria-hidden="true">
                <rect x={-w / 2 - gw} y={-CAPSULE_H / 2} width={gw} height={CAPSULE_H} rx="4" />
                <text x={-w / 2 - gw / 2} y="4" textAnchor="middle">
                  {g.tag}
                </text>
              </g>
            );
          })}
        {segs.map((s, i) => {
          const sw = segWidth(s.tag);
          const g = (
            <g key={s.name} className={`packet-seg layer-${s.kind}${s.mark ? ` is-${s.mark}` : ""}`}>
              <title>{`${s.tag}: ${s.name}${tagMeaning[s.tag] && tagMeaning[s.tag].stands !== s.tag ? ` (${tagMeaning[s.tag].stands})` : ""}`}</title>
              <rect x={x} y={-CAPSULE_H / 2} width={sw} height={CAPSULE_H} rx={i === 0 || i === segs.length - 1 ? 6 : 1} />
              <text className="packet-label" x={x + sw / 2} y="4" textAnchor="middle">
                {s.tag}
              </text>
            </g>
          );
          x += sw;
          return g;
        })}
        {notes && (
          <g className="packet-note" transform={`translate(0 ${-CAPSULE_H / 2 - 15})`}>
            <rect x={-nw / 2} y="-10" width={nw} height="18" rx="9" />
            <text y="3.5" textAnchor="middle">
              {notes}
            </text>
          </g>
        )}
      </g>
    );
  };
  const carrying = motion.capsule?.segments.map((s) => s.name).join(" carrying ");
  const spot = restingSpot(motion, place, cable, stacked, pad);
  if (packet && spot?.points) {
    const { at: end, points } = spot;
    const still = reducedMotion() || motion.ms <= 0;
    token = (
      <g
        key={eventId}
        className={`packet-token kind-${packet.kind}${packet.lost ? " is-lost" : ""}`}
        transform={still ? `translate(${end.x} ${end.y})` : undefined}
        aria-label={`${packet.label} ${packet.broadcast ? "broadcast " : ""}frame from ${name(packet.from)} to ${name(packet.to)}${packet.lost ? ", lost on this link" : ""}${carrying ? `: ${carrying}` : ""}. Inspect its headers`}
        {...select}
      >
        {!still && (
          <animateMotion
            ref={(el) => (el as SVGAnimationElement | null)?.beginElement()}
            begin="indefinite"
            dur={`${motion.ms}ms`}
            fill="freeze"
            values={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";")}
          />
        )}
        {badge(packet.label, packet.broadcast, !still)}
        {packet.lost && <path className="packet-cross" d="M-7 -7 L7 7 M7 -7 L-7 7" transform={`translate(0 ${-24 * scale}) scale(${scale})`} />}
      </g>
    );
  } else if (held && spot) {
    token = (
      <g
        className={`packet-token is-held kind-${held.kind}`}
        transform={`translate(${spot.at.x} ${spot.at.y})`}
        aria-label={`${held.label} message at ${name(held.device)}${carrying ? `: ${carrying}` : ""}. Inspect its headers`}
        {...select}
      >
        {badge(held.label)}
      </g>
    );
  }
  const stop = halt && place(halt.device);
  return (
    <>
      {token}
      {stop && (
        <g className={`packet-halt is-${halt!.kind}`} transform={`translate(${stop.x + (stacked ? 44 : 50)} ${stop.y - (stacked ? 52 : 60)})`} aria-hidden="true">
          <circle r="13" />
          <path d="M-5 -5 L5 5 M5 -5 L-5 5" />
          <text y="-19" textAnchor="middle">
            {halt!.kind === "stopped" ? "Stopped" : "Discarded"}
          </text>
        </g>
      )}
    </>
  );
}
