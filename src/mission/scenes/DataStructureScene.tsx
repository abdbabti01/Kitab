import { ArrowRight, Hash } from "lucide-react";
import { complexityTable, structureInfo, type StructureItem, type StructureSnapshot } from "../../visual-engine/data-structures/model.ts";
import type { DataStructureFrameData } from "../../learning/engines/data-structures.ts";
import type { Trace } from "../../learning/types.ts";
import { entity, SceneSection, type SceneProps } from "./common.tsx";

type Props = SceneProps<DataStructureFrameData>;

/** Identity for a value chip: the same value glides to its new slot instead of re-rendering in place. */
function valueKeys(items: StructureItem[]) {
  const seen = new Map<number, number>();
  return items.map((item) => {
    const count = seen.get(item.value) ?? 0;
    seen.set(item.value, count + 1);
    return `value-${item.value}-${count}`;
  });
}

function visited(snapshot: StructureSnapshot, value: number) {
  return snapshot.visitedValues.includes(value) ? "is-visited" : "";
}

function ArrayView({ props }: { props: Props }) {
  const s = props.frame.data.frame.snapshot;
  const keys = valueKeys(s.items);
  return (
    <SceneSection label="Array memory (4-byte slots)">
      <ol className="ds-row ds-array">
        {s.items.map((item, index) => (
          <li key={item.id}>
            <button {...entity(item.id, props, `Index ${index} at ${item.address}, value ${item.value}`, `ds-cell ${visited(s, item.value)}`)}>
              <span className="ds-cell-index">[{index}]</span>
              <b data-flip={keys[index]}>{item.value}</b>
              <small>{item.address}</small>
            </button>
          </li>
        ))}
      </ol>
      <p className="scene-caption"><code>address(i) = 0x1000 + i × 4</code> — one calculation reaches any index.</p>
    </SceneSection>
  );
}

function LinkedListView({ props }: { props: Props }) {
  const s = props.frame.data.frame.snapshot;
  const live = s.items.filter((item) => !item.detached);
  const detached = s.items.filter((item) => item.detached);
  return (
    <SceneSection label="Nodes and next pointers">
      <p className="scene-caption">HEAD → <code>{live[0]?.address ?? "NULL"}</code></p>
      <ol className="ds-row ds-list">
        {live.map((item) => (
          <li key={item.id} data-flip={item.id}>
            <button {...entity(item.id, props, `Node ${item.value} at ${item.address}, next ${item.next ?? "null"}`, `ds-node ${visited(s, item.value)}`)}>
              <small>{item.address}</small>
              <b>{item.value}</b>
              <code>next {item.next ?? "NULL"}</code>
            </button>
            <ArrowRight aria-hidden="true" />
          </li>
        ))}
        <li className="ds-null">NULL</li>
      </ol>
      {detached.length > 0 && (
        <div className="ds-detached">
          <p className="scene-caption">Not reachable from HEAD</p>
          {detached.map((item) => (
            <button {...entity(item.id, props, `Unlinked node ${item.value} at ${item.address}, next ${item.next ?? "null"}`, "ds-node is-detached", item.id)} key={item.id}>
              <small>{item.address}</small>
              <b>{item.value}</b>
              <code>next {item.next ?? "NULL"}</code>
            </button>
          ))}
        </div>
      )}
    </SceneSection>
  );
}

function EndView({ props, kind }: { props: Props; kind: "stack" | "queue" }) {
  const s = props.frame.data.frame.snapshot;
  const keys = valueKeys(s.items);
  const items = s.items.map((item, index) => ({ item, key: keys[index], index }));
  const ordered = kind === "stack" ? [...items].reverse() : items;
  return (
    <SceneSection label={kind === "stack" ? "Stack (top first)" : "Queue (front → rear)"}>
      <ol className={`ds-row ds-${kind}`}>
        {ordered.map(({ item, key, index }) => (
          <li key={item.id}>
            <button {...entity(item.id, props, `${kind === "stack" ? (index === s.items.length - 1 ? "Top" : `Depth ${s.items.length - 1 - index}`) : index === 0 ? "Front" : index === s.items.length - 1 ? "Rear" : `Position ${index}`}, value ${item.value}`, "ds-cell")}>
              <span className="ds-cell-index">{kind === "stack" ? (index === s.items.length - 1 ? "TOP" : "") : index === 0 ? "FRONT" : index === s.items.length - 1 ? "REAR" : ""}</span>
              <b data-flip={key}>{item.value}</b>
            </button>
          </li>
        ))}
        {!s.items.length && <li className="ds-null">empty</li>}
      </ol>
    </SceneSection>
  );
}

function HashView({ props }: { props: Props }) {
  const s = props.frame.data.frame.snapshot;
  return (
    <SceneSection label="Buckets (index = key mod 7)">
      <p className="scene-caption"><Hash aria-hidden="true" /> A key lives in exactly one bucket; colliding keys form a chain.</p>
      <ol className="ds-buckets">
        {s.buckets?.map((bucket) => (
          <li key={bucket.index}>
            <span className="ds-bucket-index">{bucket.index}</span>
            <span className="ds-chain">
              {bucket.items.length ? bucket.items.map((item) => (
                <button {...entity(item.id, props, `Key ${item.value} in bucket ${bucket.index}`, `ds-chip ${visited(s, item.value)}`, item.id)} key={item.id}>{item.value}</button>
              )) : <em>empty</em>}
            </span>
          </li>
        ))}
      </ol>
    </SceneSection>
  );
}

type Placed = { item: StructureItem; depth: number; column: number; parent?: Placed };

/** BST nodes in insertion order, placed by in-order position (x) and depth (y): any shape fits, skewed included. */
function placeTree(source: StructureItem[]) {
  type Node = { item: StructureItem; depth: number; parent?: Node; left?: Node; right?: Node };
  let root: Node | undefined;
  for (const item of source) {
    if (!root) { root = { item, depth: 0 }; continue; }
    let node = root;
    while (item.value !== node.item.value) {
      const side = item.value < node.item.value ? "left" : "right";
      if (!node[side]) { node[side] = { item, depth: node.depth + 1, parent: node }; break; }
      node = node[side]!;
    }
  }
  const placed: Placed[] = [];
  const parents = new Map<StructureItem, StructureItem | undefined>();
  const walk = (node?: Node) => {
    if (!node) return;
    walk(node.left);
    parents.set(node.item, node.parent?.item);
    placed.push({ item: node.item, depth: node.depth, column: placed.length });
    walk(node.right);
  };
  walk(root);
  // A parent is placed after its left subtree, so links are resolved once every node has a column.
  const at = new Map(placed.map((entry) => [entry.item, entry]));
  for (const entry of placed) entry.parent = at.get(parents.get(entry.item)!);
  return placed;
}

const ROW = 64;

function TreeView({ props }: { props: Props }) {
  const s = props.frame.data.frame.snapshot;
  const placed = placeTree(s.items);
  const depth = Math.max(0, ...placed.map((entry) => entry.depth));
  const x = (entry: Placed) => ((entry.column + 0.5) / placed.length) * 100;
  const y = (entry: Placed) => entry.depth * ROW + 22;
  return (
    <SceneSection label="Binary search tree (smaller left, larger right)">
      {placed.length ? (
        <div className="ds-tree" style={{ height: (depth + 1) * ROW }}>
          <svg className="ds-tree-edges" aria-hidden="true" width="100%" height="100%">
            {placed.filter((entry) => entry.parent).map((entry) => (
              <line key={entry.item.id} x1={`${x(entry.parent!)}%`} y1={y(entry.parent!)} x2={`${x(entry)}%`} y2={y(entry)} className={s.visitedValues.includes(entry.item.value) && s.visitedValues.includes(entry.parent!.item.value) ? "is-path" : ""} />
            ))}
          </svg>
          {placed.map((entry) => (
            <button
              {...entity(entry.item.id, props, `Node ${entry.item.value} at depth ${entry.depth}${s.visitedValues.includes(entry.item.value) ? ", on the search path" : ""}`, `ds-chip ds-tree-node ${visited(s, entry.item.value)}`, entry.item.id)}
              key={entry.item.id}
              style={{ left: `${x(entry)}%`, top: y(entry) }}
            >{entry.item.value}</button>
          ))}
        </div>
      ) : <p className="ds-null">root → null (empty tree)</p>}
    </SceneSection>
  );
}

function GraphView({ props }: { props: Props }) {
  const s = props.frame.data.frame.snapshot;
  const edges = s.edges ?? [];
  const neighbors = (value: number) => edges.flatMap((edge) => (edge.from === value ? [edge.to] : edge.to === value ? [edge.from] : [])).sort((a, b) => a - b);
  return (
    <div className="ds-graph">
      <SceneSection label="Vertices and adjacency">
        <ul className="ds-adjacency">
          {s.items.map((item) => (
            <li key={item.id}>
              <button {...entity(item.id, props, `Vertex ${item.value}, ${s.visitedValues.includes(item.value) ? "visited" : "not visited"}${s.frontierValues.includes(item.value) ? ", queued" : ""}`, `ds-chip ${visited(s, item.value)} ${s.frontierValues.includes(item.value) ? "is-frontier" : ""}`)}>{item.value}</button>
              <ArrowRight aria-hidden="true" />
              <span>{neighbors(item.value).join(", ") || "no edges"}</span>
            </li>
          ))}
        </ul>
      </SceneSection>
      <SceneSection label="BFS queue (front → rear)">
        <ol className="ds-row ds-queue-tokens">
          {s.frontierValues.map((value) => <li key={value} data-flip={`queued-${value}`} className="ds-token">{value}</li>)}
          {!s.frontierValues.length && <li className="ds-null">empty</li>}
        </ol>
        <p className="scene-caption">Visited: {s.visitedValues.join(", ") || "none"}</p>
      </SceneSection>
    </div>
  );
}

function Scene(props: Props) {
  const { kind } = props.frame.data;
  return (
    <div className={`ds-scene kind-${kind}`}>
      <p className="scene-caption ds-model">{structureInfo[kind].mentalModel}</p>
      {kind === "array" && <ArrayView props={props} />}
      {kind === "linked-list" && <LinkedListView props={props} />}
      {(kind === "stack" || kind === "queue") && <EndView props={props} kind={kind} />}
      {kind === "hash-table" && <HashView props={props} />}
      {kind === "binary-tree" && <TreeView props={props} />}
      {kind === "graph" && <GraphView props={props} />}
      <dl className="scene-chips" aria-label="Operation counters">
        <div><dt>Comparisons</dt><dd>{props.frame.data.frame.metrics.comparisons}</dd></div>
        <div><dt>Reads</dt><dd>{props.frame.data.frame.metrics.reads}</dd></div>
        <div><dt>Writes</dt><dd>{props.frame.data.frame.metrics.writes}</dd></div>
        <div><dt>Pointer changes</dt><dd>{props.frame.data.frame.metrics.pointerChanges}</dd></div>
      </dl>
    </div>
  );
}

function Reference({ trace }: { trace: Trace<DataStructureFrameData> }) {
  const kind = trace.frames[0].data.kind;
  const row = { array: "Array", "linked-list": "Linked list", stack: "Stack / queue", queue: "Stack / queue", "hash-table": "Hash table", "binary-tree": "Balanced BST", graph: "Graph adjacency list" }[kind];
  return (
    <div className="table-wrap">
      <table className="complexity">
        <caption>Typical costs. Linked-list insert/remove are O(1) only once the position is known.</caption>
        <thead><tr><th scope="col">Structure</th><th scope="col">Access</th><th scope="col">Search</th><th scope="col">Insert</th><th scope="col">Remove</th></tr></thead>
        <tbody>
          {complexityTable.map((item) => (
            <tr className={item.structure === row ? "is-current" : ""} key={item.structure}>
              <th scope="row">{item.structure}</th><td>{item.access}</td><td>{item.search}</td><td>{item.insert}</td><td>{item.remove}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const dataStructureScene = { Scene, Reference };
