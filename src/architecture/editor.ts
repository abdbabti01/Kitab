// Editing a design: one reducer for every change, with undo and redo. Pure; the canvas, inspector and keyboard
// all dispatch the same actions. Locked components (a challenge's client) can be edited only where allowed.
import { configFor, nextLabel, nextNodeId, ruleFor, workloadSchema, type ComponentKind, type Design, type Fault, type Workload } from "./model.ts";

export type EditAction =
  | { type: "add-node"; kind: ComponentKind; x: number; y: number }
  | { type: "move-node"; id: string; x: number; y: number }
  | { type: "remove-node"; id: string }
  | { type: "rename-node"; id: string; label: string }
  | { type: "set-config"; id: string; field: string; value: number | string | boolean }
  | { type: "connect"; from: string; to: string }
  | { type: "disconnect"; id: string }
  | { type: "set-workload"; field: keyof Workload; value: number | string }
  | { type: "add-fault"; node: string }
  | { type: "set-fault"; index: number; fault: Fault }
  | { type: "remove-fault"; index: number }
  | { type: "rename-design"; name: string };

export type EditorState = {
  design: Design;
  past: Design[];
  future: Design[];
  /** The last change's merge key: repeated changes with the same key (dragging, typing) are one undo step. */
  coalesce: string | null;
  locked: string[];
  /** The id of a node just added, so the UI can select it. */
  added: string | null;
};

/** settle: a run of merged changes ended (a drag ended, a field lost focus); the next change is a new undo step. */
export type EditorAction = EditAction | { type: "undo" } | { type: "redo" } | { type: "settle" } | { type: "load"; design: Design; locked?: string[] };
export type Dispatch = (action: EditorAction) => void;

const HISTORY = 100;

export const initEditor = (design: Design, locked: string[] = []): EditorState => ({ design, past: [], future: [], coalesce: null, locked, added: null });

/** A free spot near (x, y), so added components never land on top of each other. */
export function freeSpot(design: Design, x: number, y: number) {
  for (let ring = 0; ring < 40; ring++) {
    const cx = x + (ring % 5) * 40;
    const cy = y + Math.floor(ring / 5) * 70;
    if (!design.nodes.some((n) => Math.abs(n.x - cx) < 150 && Math.abs(n.y - cy) < 60)) return { x: cx, y: cy };
  }
  return { x, y };
}

/** Apply one change; returns the same design object when nothing changes (so no undo step is recorded). */
export function applyEdit(design: Design, action: EditAction, locked: string[] = []): Design {
  switch (action.type) {
    case "add-node": {
      if (design.nodes.length >= 40) return design;
      const id = nextNodeId(design, action.kind);
      const spot = freeSpot(design, Math.round(action.x), Math.round(action.y));
      return { ...design, nodes: [...design.nodes, { id, kind: action.kind, label: nextLabel(design, action.kind), x: spot.x, y: spot.y, config: configFor(action.kind) }] };
    }
    case "move-node": {
      const x = Math.max(-5000, Math.min(5000, Math.round(action.x)));
      const y = Math.max(-5000, Math.min(5000, Math.round(action.y)));
      return { ...design, nodes: design.nodes.map((n) => (n.id === action.id ? { ...n, x, y } : n)) };
    }
    case "remove-node":
      if (locked.includes(action.id)) return design;
      return {
        ...design,
        nodes: design.nodes.filter((n) => n.id !== action.id),
        edges: design.edges.filter((e) => e.from !== action.id && e.to !== action.id),
        faults: design.faults.filter((f) => f.node !== action.id),
      };
    case "rename-node": {
      const label = action.label.slice(0, 40);
      if (!label.trim()) return design;
      return { ...design, nodes: design.nodes.map((n) => (n.id === action.id ? { ...n, label } : n)) };
    }
    case "set-config": {
      const node = design.nodes.find((n) => n.id === action.id);
      if (!node) return design;
      const parsed = tryConfig(node.kind, { ...node.config, [action.field]: action.value });
      if (!parsed) return design;
      return { ...design, nodes: design.nodes.map((n) => (n.id === action.id ? { ...n, config: parsed } : n)) };
    }
    case "connect": {
      const from = design.nodes.find((n) => n.id === action.from);
      const to = design.nodes.find((n) => n.id === action.to);
      if (!from || !to || from === to) return design;
      const rule = ruleFor(from.kind, to.kind);
      if (!rule || design.edges.some((e) => e.from === from.id && e.to === to.id) || design.edges.length >= 80) return design;
      return { ...design, edges: [...design.edges, { id: `${from.id}--${to.id}`, from: from.id, to: to.id, kind: rule.kind }] };
    }
    case "disconnect":
      return { ...design, edges: design.edges.filter((e) => e.id !== action.id) };
    case "set-workload": {
      const parsed = workloadSchema.safeParse({ ...design.workload, [action.field]: action.value });
      return parsed.success ? { ...design, workload: parsed.data } : design;
    }
    case "add-fault":
      if (design.faults.length >= 10 || !design.nodes.some((n) => n.id === action.node)) return design;
      return { ...design, faults: [...design.faults, { node: action.node, fromS: Math.min(2, design.workload.durationS), toS: Math.min(4, design.workload.durationS + 2) }] };
    case "set-fault": {
      const { fromS, toS } = action.fault;
      if (!(fromS >= 0 && fromS <= 60 && toS >= 0 && toS <= 120)) return design;
      return { ...design, faults: design.faults.map((f, i) => (i === action.index ? action.fault : f)) };
    }
    case "remove-fault":
      return { ...design, faults: design.faults.filter((_, i) => i !== action.index) };
    case "rename-design": {
      const name = action.name.slice(0, 80);
      return name.trim() ? { ...design, name } : design;
    }
  }
}

function tryConfig(kind: ComponentKind, config: unknown) {
  try {
    return configFor(kind, config);
  } catch {
    return null;
  }
}

const mergeKey = (action: EditAction) => {
  if (action.type === "move-node") return `move:${action.id}`;
  if (action.type === "rename-node") return `rename:${action.id}`;
  if (action.type === "set-config") return `config:${action.id}:${action.field}`;
  if (action.type === "set-workload") return `workload:${action.field}`;
  if (action.type === "set-fault") return `fault:${action.index}`;
  if (action.type === "rename-design") return "rename-design";
  return null;
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === "load") return initEditor(action.design, action.locked ?? state.locked);
  if (action.type === "settle") return state.coalesce ? { ...state, coalesce: null } : state;
  if (action.type === "undo") {
    if (!state.past.length) return state;
    return { ...state, design: state.past.at(-1)!, past: state.past.slice(0, -1), future: [state.design, ...state.future], coalesce: null, added: null };
  }
  if (action.type === "redo") {
    if (!state.future.length) return state;
    return { ...state, design: state.future[0], past: [...state.past, state.design], future: state.future.slice(1), coalesce: null, added: null };
  }
  const design = applyEdit(state.design, action, state.locked);
  if (design === state.design) return state;
  const key = mergeKey(action);
  const merge = key !== null && key === state.coalesce;
  return {
    ...state,
    design,
    past: merge ? state.past : [...state.past, state.design].slice(-HISTORY),
    future: [],
    coalesce: key,
    added: action.type === "add-node" ? design.nodes.at(-1)!.id : null,
  };
}
