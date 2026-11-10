import { useRef, useState, useEffect, useLayoutEffect, type PointerEvent, type ReactNode } from "react";
import { Maximize, Minus, Plus, Move, MousePointer2 } from "lucide-react";
import { DeviceArt } from "./DeviceArt.tsx";
import { effectiveInterface } from "./network/engine.ts";
import type {
  Network,
  Session,
  TraceEvent,
  DeviceKind,
} from "./network/model.ts";
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
  children,
}: {
  /** Overlays drawn on the canvas, such as the first-run start button. */
  children?: ReactNode;
  network: Network;
  session: Session;
  event?: TraceEvent;
  selected: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onAdd: (kind: DeviceKind, x: number, y: number) => void;
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
  const bounds = () => {
    const xs = network.devices.map((d) => d.x),
      ys = network.devices.map((d) => d.y);
    return {
      x: Math.min(0, ...xs.map((x) => x - 100)),
      y: Math.max(0, Math.min(0, ...ys.map((y) => y - 120))),
      width: Math.max(800, ...xs.map((x) => x + 130)),
      height: Math.max(530, ...ys.map((y) => y + 130)),
    };
  };
  const [extent, setExtent] = useState(bounds);
  useEffect(() => {
    setExtent(bounds());
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [network.name, network.devices.length]);
  const cameraZoom = follow ? Math.max(1.7, zoom) : zoom;
  let width = extent.width / cameraZoom,
    height = extent.height / cameraZoom;
  const center =
    follow && event
      ? network.devices.find((d) => d.id === event.actor)
      : undefined;
  let view = {
    x: center ? Math.max(0, center.x - width / 2) : pan.x,
    y: center ? Math.max(0, center.y - height / 2) : pan.y,
  };
  // Following the journey frames the current stage's devices, so they stay legible on small screens.
  const framed = follow && focus
    ? network.devices.filter((d) => focus.devices.includes(d.id) || focus.hops.some((h) => h.from === d.id || h.to === d.id))
    : [];
  if (framed.length) {
    let [x0, x1] = [Math.min(...framed.map((d) => d.x)) - 110, Math.max(...framed.map((d) => d.x)) + 110],
      [y0, y1] = [Math.min(...framed.map((d) => d.y)) - 110, Math.max(...framed.map((d) => d.y)) + 140];
    if (x1 - x0 < 420) [x0, x1] = [(x0 + x1) / 2 - 210, (x0 + x1) / 2 + 210];
    if (y1 - y0 < 300) [y0, y1] = [(y0 + y1) / 2 - 150, (y0 + y1) / 2 + 150];
    [width, height, view] = [x1 - x0, y1 - y0, { x: x0, y: y0 }];
  }
  function point(clientX: number, clientY: number) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  }
  function down(e: PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const target = (e.target as Element).closest("[data-device]");
    const id = target?.getAttribute("data-device") ?? "";
    const p = point(e.clientX, e.clientY);
    const d = network.devices.find((d) => d.id === id);
    if (d) onSelect(id);
    gesture.current = {
      id,
      x: p.x,
      y: p.y,
      ox: d?.x ?? view.x,
      oy: d?.y ?? view.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g) return;
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
  const devices = network.devices.map((d) =>
    drag?.id === d.id ? { ...d, x: drag.x, y: drag.y } : d,
  );
  const internetIds = new Set(
    devices
      .filter((d) => /^(ISP|Internet services)/.test(d.group))
      .map((d) => d.id),
  );
  const cloud = { x: 1060, y: 290 };
  const displayPosition = (d: (typeof devices)[number]) =>
    collapsedInternet && internetIds.has(d.id) ? { ...d, ...cloud } : d;
  const visibleDevices = collapsedInternet
    ? devices.filter((d) => !internetIds.has(d.id))
    : devices;
  const groups = [
    ...new Set(visibleDevices.map((d) => d.group).filter(Boolean)),
  ];
  const wrap = useRef<HTMLDivElement>(null),
    reported = useRef("");
  // Report where each device is drawn, after layout and whenever the view or size changes.
  useLayoutEffect(() => {
    const report = () => {
      const m = svg.current?.getScreenCTM(),
        box = wrap.current?.getBoundingClientRect();
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
  const onPath = new Set(focus?.hops.map((h) => h.link));
  const involved = focus && new Set([...focus.devices, ...focus.hops.flatMap((h) => [h.from, h.to])]);
  const cable = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) =>
    `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`;
  return (
    <div
      ref={wrap}
      className="network-canvas"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData("kitab/device") as DeviceKind;
        if (
          ["pc", "phone", "switch", "router", "ap", "server"].includes(kind)
        ) {
          const p = point(e.clientX, e.clientY);
          onAdd(kind, p.x, p.y);
        }
      }}
    >
      <div className="canvas-caption">
        <span className="live-dot" /> YOUR NETWORK{" "}
        <span>
          {network.devices.length} devices · {network.links.length} links
        </span>
      </div>
      <svg
        ref={svg}
        viewBox={`${view.x} ${view.y} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
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
            h = Math.max(...list.map((d) => d.y)) - y + 103;
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
            (collapsedInternet &&
              internetIds.has(a.id) &&
              internetIds.has(b.id))
          )
            return null;
          const pa = displayPosition(a),
            pb = displayPosition(b);
          const path = cable(pa, pb),
            active = event?.hop?.link === l.id;
          return (
            <g key={l.id}>
              <path
                d={path}
                className={`network-wire ${l.medium} ${active ? "active" : ""} ${onPath.has(l.id) ? "in-path" : ""}`}
              />
              <text
                className="link-label"
                x={(pa.x + pb.x) / 2}
                y={(pa.y + pb.y) / 2 - 12}
              >
                {l.medium === "wifi" ? "Wi-Fi" : "Ethernet"}
              </text>
              {active && (
                <g>
                  <circle r="8" className="traveling-packet">
                    <animateMotion
                      key={event?.id}
                      dur="1.4s"
                      repeatCount="indefinite"
                      path={event.hop?.from === a.id ? path : cable(pb, pa)}
                    />
                  </circle>
                  <circle
                    cx={(pa.x + pb.x) / 2}
                    cy={(pa.y + pb.y) / 2}
                    r="7"
                    className="static-packet"
                  />
                </g>
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
          const mx = (pa.x + pb.x) / 2 - uy * 11,
            my = (pa.y + pb.y) / 2 + ux * 11;
          return (
            <path
              key={`${h.link}>${h.from}`}
              className="path-arrow"
              d={`M ${mx - ux * 9 - uy * 6} ${my - uy * 9 + ux * 6} L ${mx + ux * 7} ${my + uy * 7} L ${mx - ux * 9 + uy * 6} ${my - uy * 9 - ux * 6}`}
            />
          );
        })}
        {collapsedInternet && internetIds.size > 0 && (
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
        {visibleDevices.map((d) => {
          const p = d.interfaces
            .map((p) => effectiveInterface(d, p, session))
            .find((p) => p.ip);
          const active = event?.actor === d.id;
          return (
            <g
              key={d.id}
              transform={`translate(${d.x} ${d.y})`}
              className={`network-device ${selected === d.id ? "selected" : ""} ${active ? "is-active" : ""} ${event?.hop?.from === d.id ? "is-sender" : ""} ${event?.hop?.to === d.id ? "is-receiver" : ""} ${involved && !involved.has(d.id) ? "is-dimmed" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`Select ${d.name}`}
              data-device={d.id}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(d.id);
                }
                if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    e.key,
                  )
                ) {
                  e.preventDefault();
                  onMove(
                    d.id,
                    Math.max(
                      60,
                      Math.min(
                        2940,
                        d.x +
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
                        d.y +
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
              <rect
                className="device-tile"
                x="-52"
                y="-49"
                width="104"
                height="99"
                rx="22"
                filter="url(#device-shadow)"
              />
              <DeviceArt kind={d.kind} />
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
              <text className="device-name" y="72" textAnchor="middle">
                {d.name.length > 24 ? `${d.name.slice(0, 22)}…` : d.name}
              </text>
              <text className="device-ip" y="91" textAnchor="middle">
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
        {!network.devices.length && (
          <g className="empty-canvas">
            <text x="750" y="255" textAnchor="middle">
              Every network starts with a connection.
            </text>
            <text x="750" y="290" textAnchor="middle" className="small">
              Add a device from the tray above, then connect its ports.
            </text>
          </g>
        )}
      </svg>
      <div className="canvas-hint">
        <Move size={14} /> Drag devices · drag background to pan · select to
        configure
      </div>
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
          }}
        >
          <Maximize size={16} />
        </button>
      </div>
      {internetIds.size > 0 && (
        <button
          className="internet-toggle"
          onClick={() => setCollapsedInternet((v) => !v)}
        >
          {collapsedInternet ? "Expand Internet" : "Collapse Internet"}
        </button>
      )}
      {children}
      <span className="canvas-mode">
        <MousePointer2 size={13} /> Select & move
      </span>
    </div>
  );
}
