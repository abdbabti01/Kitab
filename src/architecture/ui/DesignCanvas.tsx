import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { components, ruleFor, type Design, type DesignNode } from "../model.ts";
import { slotLimits, type Fold } from "../metrics.ts";
import type { Dispatch } from "../editor.ts";
import { kindIcon } from "./kinds.tsx";

export const NODE_W = 160;
export const NODE_H = 62;

export type Selection = { kind: "node" | "edge"; id: string } | null;
export type Highlight = { nodes: string[]; edges: string[] };
type View = { x: number; y: number; k: number };

type Props = {
  design: Design;
  dispatch?: Dispatch;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  fold?: Fold | null;
  /** Components with validation errors. */
  issues?: Set<string>;
  locked?: string[];
  highlight?: Highlight | null;
  label: string;
  /** Changing it fits the diagram to the view again (a different design was opened). */
  fitKey: string;
};

/** Where the line from a's centre towards b's centre leaves a's box. */
function boxExit(a: DesignNode, b: DesignNode) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!dx && !dy) return { x: a.x, y: a.y };
  const sx = dx ? NODE_W / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? NODE_H / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: a.x + dx * s, y: a.y + dy * s };
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The architecture diagram: components, typed connections and, during a run, what the fold says is happening. */
export function DesignCanvas({ design, dispatch, selection, onSelect, fold, issues, locked = [], highlight, label, fitKey }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [connecting, setConnecting] = useState<{ from: string; x: number; y: number } | null>(null);
  const drag = useRef<{ mode: "node" | "pan" | "connect"; id?: string; dx: number; dy: number; startX: number; startY: number; moved: boolean; view: View } | null>(null);
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const editable = Boolean(dispatch);

  const fit = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    if (!width || !height) return;
    if (!design.nodes.length) return setView({ x: width / 2 - 300, y: height / 2 - 200, k: 1 });
    const xs = design.nodes.map((n) => n.x);
    const ys = design.nodes.map((n) => n.y);
    const minX = Math.min(...xs) - NODE_W / 2 - 30;
    const maxX = Math.max(...xs) + NODE_W / 2 + 30;
    const minY = Math.min(...ys) - NODE_H / 2 - 40;
    const maxY = Math.max(...ys) + NODE_H / 2 + 40;
    const k = Math.max(0.3, Math.min(1.25, Math.min(width / (maxX - minX), height / (maxY - minY))));
    setView({ k, x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k });
  };
  // Fit once the canvas has a size, and again when a different design is opened.
  useLayoutEffect(fit, [fitKey]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) fit();
      first = false;
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [fitKey]);

  const zoom = (factor: number, cx?: number, cy?: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = cx ?? rect.width / 2;
    const py = cy ?? rect.height / 2;
    setView((v) => {
      const k = Math.max(0.25, Math.min(2.5, v.k * factor));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms; a plain wheel keeps scrolling the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  };
  const nodeAt = (x: number, y: number) => design.nodes.find((n) => Math.abs(n.x - x) <= NODE_W / 2 && Math.abs(n.y - y) <= NODE_H / 2);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const target = (event.target as Element).closest("[data-node],[data-port],[data-edge]");
    const p = toWorld(event.clientX, event.clientY);
    const base = { startX: event.clientX, startY: event.clientY, moved: false, view };
    if (target?.hasAttribute("data-port") && editable) {
      const id = target.getAttribute("data-port")!;
      drag.current = { mode: "connect", id, dx: 0, dy: 0, ...base };
      setConnecting({ from: id, x: p.x, y: p.y });
    } else if (target?.hasAttribute("data-node")) {
      const node = byId.get(target.getAttribute("data-node")!)!;
      onSelect({ kind: "node", id: node.id });
      drag.current = { mode: "node", id: node.id, dx: p.x - node.x, dy: p.y - node.y, ...base };
    } else if (target?.hasAttribute("data-edge")) {
      onSelect({ kind: "edge", id: target.getAttribute("data-edge")! });
      return;
    } else drag.current = { mode: "pan", dx: 0, dy: 0, ...base };
    svgRef.current!.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(event.clientX - d.startX) + Math.abs(event.clientY - d.startY) > 3) d.moved = true;
    if (!d.moved) return;
    const p = toWorld(event.clientX, event.clientY);
    if (d.mode === "pan") setView({ ...d.view, x: d.view.x + event.clientX - d.startX, y: d.view.y + event.clientY - d.startY });
    else if (d.mode === "node" && dispatch) dispatch({ type: "move-node", id: d.id!, x: p.x - d.dx, y: p.y - d.dy });
    else if (d.mode === "connect") setConnecting({ from: d.id!, x: p.x, y: p.y });
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === "pan" && !d.moved) onSelect(null);
    if (d.mode === "node") dispatch?.({ type: "settle" });
    if (d.mode === "connect") {
      const p = toWorld(event.clientX, event.clientY);
      const target = nodeAt(p.x, p.y);
      if (target && target.id !== d.id) dispatch?.({ type: "connect", from: d.id!, to: target.id });
      setConnecting(null);
    }
  };

  const onNodeKey = (event: KeyboardEvent, node: DesignNode) => {
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect({ kind: "node", id: node.id });
    } else if (moves[event.key] && dispatch) {
      event.preventDefault();
      onSelect({ kind: "node", id: node.id });
      dispatch({ type: "move-node", id: node.id, x: node.x + moves[event.key][0], y: node.y + moves[event.key][1] });
    } else if ((event.key === "Delete" || event.key === "Backspace") && dispatch && !locked.includes(node.id)) {
      event.preventDefault();
      dispatch({ type: "remove-node", id: node.id });
      onSelect(null);
    } else if (event.key === "Escape") onSelect(null);
  };

  const connectFrom = connecting ? byId.get(connecting.from) : undefined;
  const lit = (kind: "nodes" | "edges", id: string) => highlight?.[kind].includes(id) ?? false;
  const motion = !reducedMotion();

  return (
    <div className="arch-canvas">
      <svg
        ref={svgRef}
        role="group"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => ((drag.current = null), setConnecting(null))}
      >
        <defs>
          {(["request", "async", "replication"] as const).map((kind) => (
            <marker key={kind} id={`arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`arrow-${kind}`} />
            </marker>
          ))}
          <pattern id="arch-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" className="grid-dot" />
          </pattern>
        </defs>
        <rect className="arch-backdrop" x="0" y="0" width="100%" height="100%" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#arch-grid)" pointerEvents="none" />
          {design.edges.map((edge) => {
            const a = byId.get(edge.from);
            const b = byId.get(edge.to);
            if (!a || !b) return null;
            const p = boxExit(a, b);
            const q = boxExit(b, a);
            const busy = fold?.transit.some((t) => t.edge === edge.id);
            const selected = selection?.kind === "edge" && selection.id === edge.id;
            return (
              <g key={edge.id} className={`arch-edge is-${edge.kind}${selected ? " is-selected" : ""}${busy ? " is-busy" : ""}${lit("edges", edge.id) ? " is-lit" : ""}`}>
                <line className="edge-hit" data-edge={edge.id} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
                <line className="edge-line" x1={p.x} y1={p.y} x2={q.x} y2={q.y} markerEnd={`url(#arrow-${edge.kind})`} />
              </g>
            );
          })}
          {connectFrom && connecting && <line className="edge-draft" x1={connectFrom.x} y1={connectFrom.y} x2={connecting.x} y2={connecting.y} />}
          {fold && motion &&
            fold.transit.slice(-240).map((t, i) => {
              const a = byId.get(t.from);
              const b = byId.get(t.to);
              if (!a || !b) return null;
              const f = Math.max(0, Math.min(1, (fold.t - t.since) / Math.max(1, t.until - t.since)));
              const p = boxExit(a, b);
              const q = boxExit(b, a);
              return <circle key={i} className={`dot dot-${t.type}${t.ok === false ? " is-failed" : ""}`} r={4.5} cx={p.x + (q.x - p.x) * f} cy={p.y + (q.y - p.y) * f} />;
            })}
          {design.nodes.map((node) => {
            const Icon = kindIcon[node.kind];
            const state = fold?.nodes[node.id];
            const limits = slotLimits(design, node.id);
            const busy = state ? state.busy.reduce((a, b) => a + b, 0) : 0;
            const limit = limits.reduce((a, b) => a + b, 0);
            const waiting = state ? state.waiting.reduce((a, b) => a + b, 0) : 0;
            const load = limit ? busy / limit : 0;
            const selected = selection?.kind === "node" && selection.id === node.id;
            const validTarget = connectFrom && connectFrom.id !== node.id && ruleFor(connectFrom.kind, node.kind) && !design.edges.some((e) => e.from === connectFrom.id && e.to === node.id);
            const status = state?.down ? "down" : waiting ? "waiting" : load >= 0.9 ? "full" : "";
            const describe = [
              `${node.label}, ${components[node.kind].name}`,
              state?.down ? "down" : "",
              state && limit ? `${busy} of ${limit} slots in use${waiting ? `, ${waiting} waiting` : ""}` : "",
              state && node.kind === "queue" ? `${state.depth} messages waiting` : "",
              issues?.has(node.id) ? "has a problem" : "",
              locked.includes(node.id) ? "fixed by the challenge" : "",
            ].filter(Boolean).join(", ");
            return (
              <g
                key={node.id}
                className={`arch-node kind-${node.kind}${selected ? " is-selected" : ""}${status ? ` is-${status}` : ""}${validTarget ? " is-target" : ""}${lit("nodes", node.id) ? " is-lit" : ""}`}
                transform={`translate(${node.x - NODE_W / 2} ${node.y - NODE_H / 2})`}
                data-node={node.id}
                tabIndex={0}
                role="button"
                aria-pressed={selected}
                aria-label={describe}
                onKeyDown={(event) => onNodeKey(event, node)}
                onKeyUp={(event) => event.key.startsWith("Arrow") && dispatch?.({ type: "settle" })}
              >
                <rect className="node-box" width={NODE_W} height={NODE_H} rx={12} />
                {limit > 0 && state && <rect className="node-load" x={0} y={NODE_H - 5} width={NODE_W * Math.min(1, load)} height={5} rx={2} />}
                <g transform="translate(12 17)" className="node-icon"><Icon width={26} height={26} aria-hidden="true" /></g>
                <text className="node-label" x={48} y={27}>{node.label.length > 17 ? `${node.label.slice(0, 16)}…` : node.label}</text>
                <text className="node-kind" x={48} y={45}>
                  {state?.down ? "DOWN" : state && limit ? `${busy}/${limit} busy${waiting ? ` · ${waiting} waiting` : ""}` : state && node.kind === "queue" ? `${state.depth} queued` : state && (node.kind === "cache" || node.kind === "cdn") && state.hits + state.misses ? `${Math.round((state.hits / (state.hits + state.misses)) * 100)}% hits` : components[node.kind].name}
                </text>
                {issues?.has(node.id) && <circle className="node-issue" cx={NODE_W - 10} cy={10} r={6} />}
                {editable && <circle className="node-port" data-port={node.id} cx={NODE_W} cy={NODE_H / 2} r={8}><title>Drag to connect</title></circle>}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="canvas-tools" role="group" aria-label="Diagram view">
        <button type="button" onClick={() => zoom(1.2)} aria-label="Zoom in"><ZoomIn aria-hidden="true" /></button>
        <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out"><ZoomOut aria-hidden="true" /></button>
        <button type="button" onClick={fit} aria-label="Fit the diagram to the view"><Maximize2 aria-hidden="true" /></button>
        <button type="button" onClick={() => setView({ x: 40, y: 40, k: 1 })} aria-label="Reset zoom to 100%"><RotateCcw aria-hidden="true" /></button>
      </div>
    </div>
  );
}

