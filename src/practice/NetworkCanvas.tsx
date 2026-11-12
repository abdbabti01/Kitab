import { useRef, useState, useEffect, useLayoutEffect, useMemo, type PointerEvent, type ReactNode } from "react";
import { Maximize, Minus, Plus, Move, MousePointer2, Rows3, Shapes } from "lucide-react";
import { DeviceArt } from "./DeviceArt.tsx";
import { effectiveInterface } from "./network/engine.ts";
import { actionAt, type Motion } from "./network/motion.ts";
import { stackedLayout } from "./network/layout.ts";
import type {
  Network,
  Session,
  TraceEvent,
  DeviceKind,
} from "./network/model.ts";

/** Below this canvas width the learner's own layout cannot be drawn readably, so the stacked layout is used. */
const NARROW = 640;
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
  onPositions,
  motion,
  onPacket,
  children,
}: {
  /** What moves at this step, read from the trace (see motion.ts), and how long a hop takes in ms. */
  motion?: Motion & { ms: number };
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
  /** Device centres in pixels inside the canvas, for anchoring the journey card. */
  onPositions?: (positions: Record<string, { x: number; y: number }>, scale: number) => void;
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
  // The drawing area in pixels, and on a narrow one whether the learner asked for their own layout instead.
  const [area, setArea] = useState({ w: 0, h: 0 }),
    [own, setOwn] = useState(false);
  const narrow = area.w > 0 && area.w < NARROW;
  const stacked = narrow && !own;
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
  // Screen pixels per diagram unit, to size touch areas and the message in pixels.
  const [unitPx, setUnitPx] = useState(1);
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
  // The stacked layout: a fixed, readable scale and a camera over it. Two columns fill a phone's width.
  const scale = Math.min(1.15, Math.max(0.8, area.w / 430)) * zoom;
  const camW = area.w / scale || 430,
    camH = area.h / scale || 600;
  const clampCam = (c: { x: number; y: number }) => ({
    x: layout.width <= camW ? (layout.width - camW) / 2 : Math.min(layout.width - camW, Math.max(0, c.x)),
    y: layout.height <= camH ? (layout.height - camH) / 2 : Math.min(layout.height - camH, Math.max(0, c.y)),
  });
  const [cam, setCam] = useState({ x: 0, y: 0 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const glide = useRef(0);
  function moveCam(target: { x: number; y: number }, animate: boolean) {
    cancelAnimationFrame(glide.current);
    const to = clampCam(target),
      from = camRef.current;
    if (!animate || reducedMotion() || (Math.abs(to.x - from.x) < 1 && Math.abs(to.y - from.y) < 1)) return setCam(to);
    const start = performance.now();
    const stepCam = (now: number) => {
      const k = Math.min(1, (now - start) / 420),
        e = 1 - (1 - k) ** 3;
      setCam({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (k < 1) glide.current = requestAnimationFrame(stepCam);
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
  const watched = event ? [event.actor, event.hop?.from, event.hop?.to].filter((x): x is string => !!x) : [];
  const watchKey = watched.join(" ");
  /** Moves the camera to show these devices, only if they are not already well inside the view. */
  function reveal(ids: string[]) {
    const ps = ids.map((id) => layout.pos[id]).filter(Boolean);
    if (!ps.length) return;
    const [x0, x1] = [Math.min(...ps.map((p) => p.x)) - 80, Math.max(...ps.map((p) => p.x)) + 80],
      [y0, y1] = [Math.min(...ps.map((p) => p.y)) - 90, Math.max(...ps.map((p) => p.y)) + 160];
    const c = camRef.current,
      mx = camW * 0.08,
      my = camH * 0.12;
    const inside = x0 >= c.x + mx && x1 <= c.x + camW - mx && y0 >= c.y + my && y1 <= c.y + camH - my;
    if (!inside) moveCam({ x: (x0 + x1) / 2 - camW / 2, y: (y0 + y1) / 2 - camH / 2 }, true);
  }
  useEffect(() => {
    if (stacked && follow && watched.length) reveal(watched);
  }, [watchKey, stacked, follow, layout, camW, camH]);
  if (stacked) {
    const c = clampCam(cam);
    [width, height, view] = [camW, camH, c];
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
    if (d) onSelect(id);
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
    if (stacked) return setCam(clampCam({ x: g.ox - (e.clientX - g.x) / scale, y: g.oy - (e.clientY - g.y) / scale }));
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
  const wrap = useRef<HTMLDivElement>(null),
    reported = useRef("");
  // Report where each device is drawn, after layout and whenever the view or size changes.
  useLayoutEffect(() => {
    const report = () => {
      const r = svg.current?.getBoundingClientRect();
      if (r && (Math.round(r.width) !== area.w || Math.round(r.height) !== area.h)) setArea({ w: Math.round(r.width), h: Math.round(r.height) });
      const m = svg.current?.getScreenCTM(),
        box = wrap.current?.getBoundingClientRect();
      if (m && m.a !== unitPx) setUnitPx(m.a);
      if (!m || !box || !onPositions) return;
      const out: Record<string, { x: number; y: number }> = {};
      for (const d of devices) {
        const p = new DOMPoint(displayPosition(d).x, displayPosition(d).y).matrixTransform(m);
        out[d.id] = { x: Math.round(p.x - box.left), y: Math.round(p.y - box.top) };
      }
      const key = JSON.stringify([out, m.a]);
      if (key !== reported.current) {
        reported.current = key;
        onPositions(out, m.a);
      }
    };
    report();
    const observer = new ResizeObserver(report);
    if (wrap.current) observer.observe(wrap.current);
    return () => observer.disconnect();
  });
  const place = (id: string) => {
    const d = devices.find((x) => x.id === id);
    return d && displayPosition(d);
  };
  const onPath = new Set(focus?.hops.map((h) => h.link));
  // The message is about 26 px tall on screen however far the diagram is zoomed out, without outgrowing the devices.
  const tokenScale = Math.min(2.2, Math.max(1, 26 / (20 * unitPx)));
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
          {narrow && network.devices.length > 0 && (
            <button className="canvas-layout" aria-pressed={stacked} onClick={() => setOwn(!own)} title={stacked ? "Show the layout you arranged" : "Arrange the devices in rows that fit this screen"}>
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
          <filter
            id="device-shadow"
            x="-30%"
            y="-30%"
            width="160%"
            height="180%"
          >
            <feDropShadow
              dx="0"
              dy="5"
              stdDeviation="8"
              floodColor="#193a2d"
              floodOpacity=".08"
            />
          </filter>
        </defs>
        <rect
          x={view.x}
          y={view.y}
          width={width}
          height={height}
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
            aria-label="Expand simulated Internet"
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
          </g>
        )}
        {/* The message's touch area: about 44 px wherever it rests, drawn under the devices so a device still
            gets taps on its own tile. At least about 44 px, and always 16 px beyond the drawn frame. */}
        {motion && (() => {
          const spot = restingSpot(motion, place, cable, stacked);
          return (
            spot && (
              <circle
                className="packet-hit"
                cx={spot.at.x}
                cy={spot.at.y}
                r={Math.max(Math.min(60, Math.max(26, 22 / unitPx)), 10 * tokenScale + 16 / unitPx)}
                data-packet=""
                aria-hidden="true"
                onClick={onPacket}
              />
            )
          );
        })()}
        {visibleDevices.map((d) => {
          const p = d.interfaces
            .map((p) => effectiveInterface(d, p, session))
            .find((p) => p.ip);
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
          const name = stacked ? 21 : 24;
          // In the learner's own layout the tile is drawn larger, the labels move down with it.
          const big = !stacked;
          return (
            <g
              key={d.id}
              transform={`translate(${d.x} ${d.y})`}
              className={`network-device kind-${d.kind} ${selected === d.id ? "selected" : ""} ${active ? "is-active" : ""} ${state} ${involved && !involved.has(d.id) ? "is-dimmed" : ""}`}
              // A frame arrives when its hop ends: the receiver lights up then, not before.
              style={receiver && motion ? ({ "--arrive": `${motion.ms}ms` } as React.CSSProperties) : undefined}
              role="button"
              tabIndex={0}
              aria-label={`Select ${d.name}`}
              data-device={d.id}
              // A device reached with the keyboard is brought into view.
              onFocus={() => stacked && reveal([d.id])}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(d.id);
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
                <rect
                  className="device-tile"
                  x="-52"
                  y="-49"
                  width="104"
                  height="99"
                  rx="22"
                  filter="url(#device-shadow)"
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
              </g>
              <text className="device-name" y={big ? 92 : 76} textAnchor="middle">
                {d.name.length > name ? `${d.name.slice(0, name - 2)}…` : d.name}
              </text>
              <text className="device-ip" y={big ? 112 : 96} textAnchor="middle">
                {p?.ip ??
                  (d.kind === "phone"
                    ? "DHCP · awaiting address"
                    : d.kind === "switch"
                      ? "MAC forwarding"
                      : d.kind === "ap"
                        ? d.ssid
                        : "Unconfigured")}
              </text>
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
          />
        )}
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
      </svg>
      <div className="canvas-foot">
        <span className="canvas-hint">
          <Move size={14} />{" "}
          {stacked ? "Arranged in rows for this screen · drag to look around · select to configure" : "Drag devices · drag background to pan · select to configure"}
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
): { at: Point; points?: Point[] } | null {
  if (packet) {
    const a = place(packet.from),
      b = place(packet.to);
    if (!a || !b) return null;
    const c = cable(a, b);
    // A device's tile and the name, address and action label under it.
    const below = stacked ? 150 : 120;
    const covers = (p: Point, d: Point) => Math.abs(p.x - d.x) < 64 && p.y > d.y - 60 && p.y < d.y + below;
    let t0 = 0,
      t1 = 1;
    while (t0 < 0.5 && covers(c.at(t0), a)) t0 += 0.02;
    while (t1 > 0.5 && covers(c.at(t1), b)) t1 -= 0.02;
    // Devices too close for that: leave and stop just off the tiles, as before.
    if (t1 - t0 < 0.15) {
      t0 = Math.min(0.45, 70 / (Math.hypot(b.x - a.x, b.y - a.y) || 1));
      t1 = 1 - t0;
    }
    if (packet.lost) t1 = (t0 + t1) / 2;
    const points = Array.from({ length: 13 }, (_, i) => c.at(t0 + ((t1 - t0) * i) / 12));
    return { at: points.at(-1)!, points };
  }
  const at = held && place(held.device);
  // Beside the tile's top corner, which is drawn larger in the learner's own layout.
  return at ? { at: stacked ? { x: at.x + 44, y: at.y - 52 } : { x: at.x + 50, y: at.y - 60 } } : null;
}
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
}: {
  /** Drawn size of the message, so it stays easy to find on a small or zoomed-out diagram. */
  scale?: number;
  motion: Motion & { ms: number };
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
  const badge = (kind: string, label: string, broadcast = false, moving = false) => {
    const w = label.length * 7 + 18;
    return (
    <g transform={scale === 1 ? undefined : `scale(${scale.toFixed(2)})`}>
      {/* A short pulse as a hop begins, so the eye finds the frame that is about to move. */}
      {moving && <rect className="packet-locate" x={-w / 2 - 6} y="-16" width={w + 12} height="32" rx="16" />}
      {broadcast && <rect className="packet-broadcast" x={-w / 2 - 5} y="-15" width={w + 10} height="30" rx="15" />}
      <rect className="packet-shape" x={-w / 2} y="-10" width={w} height="20" rx={kind === "ip" ? 10 : kind === "arp" ? 2 : 6} />
      <text className="packet-label" y="4" textAnchor="middle">
        {label}
      </text>
    </g>
    );
  };
  const spot = restingSpot(motion, place, cable, stacked);
  if (packet && spot?.points) {
    const { at: end, points } = spot;
    const still = reducedMotion() || motion.ms <= 0;
    token = (
      <g
        key={eventId}
        className={`packet-token kind-${packet.kind}${packet.lost ? " is-lost" : ""}`}
        transform={still ? `translate(${end.x} ${end.y})` : undefined}
        aria-label={`${packet.label} ${packet.broadcast ? "broadcast " : ""}frame from ${name(packet.from)} to ${name(packet.to)}${packet.lost ? ", lost on this link" : ""}. Inspect its headers`}
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
        {badge(packet.kind, packet.label, packet.broadcast, !still)}
        {packet.lost && <path className="packet-cross" d="M-7 -7 L7 7 M7 -7 L-7 7" transform={`translate(0 ${-24 * scale}) scale(${scale})`} />}
      </g>
    );
  } else if (held && spot) {
    token = (
      <g
        className={`packet-token is-held kind-${held.kind}`}
        transform={`translate(${spot.at.x} ${spot.at.y})`}
        aria-label={`${held.label} message at ${name(held.device)}. Inspect its headers`}
        {...select}
      >
        {badge(held.kind, held.label)}
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
