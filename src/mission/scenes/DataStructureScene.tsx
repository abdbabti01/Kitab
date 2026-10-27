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
  return (
    <SceneSection label="Nodes and next pointers">
      <p className="scene-caption">HEAD → <code>{s.items[0]?.address ?? "NULL"}</code></p>
      <ol className="ds-row ds-list">
        {s.items.map((item) => (
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

type TreeNode = { item: StructureItem; left?: TreeNode; right?: TreeNode };

function treeLevels(source: StructureItem[]) {
  let root: TreeNode | undefined;
  for (const item of source) {
    if (!root) { root = { item }; continue; }
    let node = root;
    while (true) {
      if (item.value === node.item.value) break;
      const side = item.value < node.item.value ? "left" : "right";
      if (!node[side]) { node[side] = { item }; break; }
      node = node[side]!;
    }
  }
  if (!root) return [];
  const levels: (TreeNode | null)[][] = [[root]];
  while (levels.length < 5) {
    const next = levels.at(-1)!.flatMap((node) => (node ? [node.left ?? null, node.right ?? null] : [null, null]));
    if (next.every((node) => node === null)) break;
    levels.push(next);
  }
  return levels;
}

function TreeView({ props }: { props: Props }) {
  const s = props.frame.data.frame.snapshot;
  return (
    <SceneSection label="Binary search tree (smaller left, larger right)">
      <div className="ds-tree">
        {treeLevels(s.items).map((level, depth) => (
          <div className="ds-tree-level" style={{ gridTemplateColumns: `repeat(${level.length}, minmax(0, 1fr))` }} key={depth}>
            {level.map((node, index) => node ? (
              <button {...entity(node.item.id, props, `Node ${node.item.value} at depth ${depth}${s.visitedValues.includes(node.item.value) ? ", on the search path" : ""}`, `ds-chip ${visited(s, node.item.value)}`, node.item.id)} key={node.item.id}>{node.item.value}</button>
            ) : <span key={`empty-${index}`} aria-hidden="true" />)}
          </div>
        ))}
      </div>
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
