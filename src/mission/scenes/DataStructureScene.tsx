import { ArrowRight, Hash } from "lucide-react";
import { complexityTable, structureInfo, type StructureItem, type StructureSnapshot } from "../../visual-engine/data-structures/model.ts";
import type { DataStructureFrameData } from "../../learning/engines/data-structures.ts";
import type { Trace } from "../../learning/types.ts";
import { TableScroll } from "../../ui/TableScroll.tsx";
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

/** Exact ids when the engine gives them (values can repeat in arrays and lists), otherwise values. */
function visited(snapshot: StructureSnapshot, item: StructureItem) {
  const seen = snapshot.visitedIds ? snapshot.visitedIds.includes(item.id) : snapshot.visitedValues.includes(item.value);
  return seen ? "is-visited" : "";
}

/** Addresses in every scene are invented for teaching; this says so wherever they appear. */
const TeachingAddresses = () => <span className="ds-invented" title="Real programs never choose addresses: the runtime's allocator does, and they differ from run to run.">Invented teaching addresses</span>;

/** The reserved slots after the last element: part of the block, not of the array. */
function SpareSlots({ count, from, label }: { count: number; from: number; label: string }) {
  if (count <= 0) return null;
  return (
    <ol className="ds-row ds-spare" aria-label={label}>
      {Array.from({ length: count }, (_, i) => <li key={i} className="ds-cell is-spare"><span className="ds-cell-index">[{from + i}]</span><b aria-hidden="true">·</b><small>spare</small></li>)}
    </ol>
  );
}

function ArrayView({ props }: { props: Props }) {
  const s = props.frame.data.frame.snapshot;
  const keys = valueKeys(s.items);
  const old = s.oldBlock;
  const block = s.block;
  // While growing, the new block is filled before the array refers to it.
  const refersTo = old?.reachable ? old.base : block?.base ?? "0x1000";
  return (
    <SceneSection label="Array memory (4-byte slots)">
      <p className="scene-caption ds-block-line">
        array → <code>{refersTo}</code>{block && !old && <> · length {s.items.length} · capacity {block.capacity}</>} <TeachingAddresses />
      </p>
      {old && (
        <div className={`ds-block ds-old-block${old.reachable ? "" : " is-unreachable"}`}>
          <p className="scene-caption">Old block at <code>{old.base}</code> · capacity {old.capacity} · {old.reachable ? "the array still refers to it" : "unreachable: nothing refers to it"}</p>
          <ol className="ds-row ds-array-old">
            {old.items.map((item, index) => (
              <li key={item.id} className="ds-cell is-old"><span className="ds-cell-index">[{index}]</span><b>{item.value}</b><small>{item.address}</small></li>
            ))}
          </ol>
        </div>
      )}
      <div className="ds-block">
        {old && <p className="scene-caption">New block at <code>{block!.base}</code> · capacity {block!.capacity} · {old.reachable ? "being filled" : "the array refers to it"}</p>}
        <div className="ds-slots">
          <ol className="ds-row ds-array">
            {s.items.map((item, index) => (
              <li key={item.id}>
                <button {...entity(item.id, props, `Index ${index} at ${item.address}, value ${item.value}`, `ds-cell ${visited(s, item)}`)}>
                  <span className="ds-cell-index">[{index}]</span>
                  <b data-flip={old ? undefined : keys[index]}>{item.value}</b>
                  <small>{item.address}</small>
                </button>
              </li>
            ))}
          </ol>
          {block && <SpareSlots count={block.capacity - s.items.length} from={s.items.length} label={old ? "Empty slots of the new block" : "Spare capacity: reserved slots that are not part of the array"} />}
        </div>
      </div>
      <p className="scene-caption"><code>address(i) = base + i × 4</code> — one calculation reaches any index. Length counts the elements; capacity counts the slots reserved for them.</p>
    </SceneSection>
  );
}

function LinkedListView({ props }: { props: Props }) {
  const s = props.frame.data.frame.snapshot;
  const live = s.items.filter((item) => !item.detached);
  const detached = s.items.filter((item) => item.detached);
  return (
    <SceneSection label="Nodes and next pointers">
      <p className="scene-caption">HEAD → <code>{live[0]?.address ?? "NULL"}</code> <TeachingAddresses /></p>
      <ol className="ds-row ds-list">
        {live.map((item) => (
          <li key={item.id} data-flip={item.id}>
            <button {...entity(item.id, props, `Node ${item.value} at ${item.address}, next ${item.next ?? "null"}`, `ds-node ${visited(s, item)}`)}>
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

function loadFactor(s: StructureSnapshot) {
  const keys = s.buckets?.reduce((sum, bucket) => sum + bucket.items.length, 0) ?? 0;
  const buckets = s.buckets?.length || 1;
  return `${keys} keys ÷ ${buckets} buckets = ${(keys / buckets).toFixed(2)}`;
}

function HashView({ props }: { props: Props }) {
  const s = props.frame.data.frame.snapshot;
  return (
    <SceneSection label="Buckets (index = key mod 7)">
      <p className="scene-caption"><Hash aria-hidden="true" /> A key lives in exactly one bucket; colliding keys form a chain. Load factor: {loadFactor(s)}.</p>
      <ol className="ds-buckets">
        {s.buckets?.map((bucket) => (
          <li key={bucket.index}>
            <span className="ds-bucket-index">{bucket.index}</span>
            <span className="ds-chain">
              {bucket.items.length ? bucket.items.map((item) => (
                <button {...entity(item.id, props, `Key ${item.value} in bucket ${bucket.index}`, `ds-chip ${visited(s, item)}`, item.id)} key={item.id}>{item.value}</button>
              )) : <em>empty</em>}
            </span>
          </li>
        ))}
      </ol>
    </SceneSection>
  );
}

type Placed = { item: StructureItem; depth: number; column: number; parent?: Placed };

/**
 * BST nodes placed by in-order position (x) and depth (y), following the engine's own child pointers from its root,
 * so any shape fits (skewed included) and a mid-delete state with a repeated value is drawn exactly as it is.
 */
function placeTree(source: StructureItem[], rootId: string | null | undefined) {
  const byId = new Map(source.map((item) => [item.id, item]));
  const placed: Placed[] = [];
  const walk = (id: string | null | undefined, depth: number, parent?: Placed) => {
    const item = id ? byId.get(id) : undefined;
    if (!item) return;
    const entry: Placed = { item, depth, column: -1, parent };
    walk(item.left, depth + 1, entry);
    entry.column = placed.length;
    placed.push(entry);
    walk(item.right, depth + 1, entry);
  };
  walk(rootId, 0);
  return placed;
}

const ROW = 64;

function TreeView({ props }: { props: Props }) {
  const s = props.frame.data.frame.snapshot;
  const placed = placeTree(s.items, s.root);
  const onPath = (entry: Placed) => (s.visitedIds ? s.visitedIds.includes(entry.item.id) : s.visitedValues.includes(entry.item.value));
  const depth = Math.max(0, ...placed.map((entry) => entry.depth));
  const x = (entry: Placed) => ((entry.column + 0.5) / placed.length) * 100;
  const y = (entry: Placed) => entry.depth * ROW + 22;
  return (
    <SceneSection label="Binary search tree (smaller left, larger right)">
      {placed.length ? (
        <div className="ds-tree" style={{ height: (depth + 1) * ROW }}>
          <svg className="ds-tree-edges" aria-hidden="true" width="100%" height="100%">
            {placed.filter((entry) => entry.parent).map((entry) => (
              <line key={entry.item.id} x1={`${x(entry.parent!)}%`} y1={y(entry.parent!)} x2={`${x(entry)}%`} y2={y(entry)} className={onPath(entry) && onPath(entry.parent!) ? "is-path" : ""} />
            ))}
          </svg>
          {placed.map((entry) => (
            <button
              {...entity(entry.item.id, props, `Node ${entry.item.value} at depth ${entry.depth}${onPath(entry) ? ", on the path" : ""}`, `ds-chip ds-tree-node ${visited(s, entry.item)}`, entry.item.id)}
              key={entry.item.id}
              style={{ left: `${x(entry)}%`, top: y(entry) }}
            >{entry.item.value}</button>
          ))}
        </div>
      ) : <p className="ds-null">root → null (empty tree)</p>}
      {placed.length > 0 && <p className="scene-caption">Height {depth} (longest root-to-leaf path: {depth + 1} {depth ? "nodes" : "node"}). A search makes at most {depth + 1} comparisons.</p>}
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
              <button {...entity(item.id, props, `Vertex ${item.value}, ${s.visitedValues.includes(item.value) ? "visited" : "not visited"}${s.frontierValues.includes(item.value) ? (s.frontier === "stack" ? ", on the stack" : ", queued") : ""}`, `ds-chip ${visited(s, item)} ${s.frontierValues.includes(item.value) ? "is-frontier" : ""}`)}>{item.value}</button>
              <ArrowRight aria-hidden="true" />
              <span>{neighbors(item.value).join(", ") || "no edges"}</span>
            </li>
          ))}
        </ul>
      </SceneSection>
      <SceneSection label={s.frontier === "stack" ? "DFS stack (bottom → top)" : "BFS queue (front → rear)"}>
        <ol className="ds-row ds-queue-tokens">
          {/* A DFS stack can hold the same vertex twice, so the position is part of the key. */}
          {s.frontierValues.map((value, i) => <li key={s.frontier === "stack" ? `${value}-${i}` : value} data-flip={s.frontier === "stack" ? undefined : `queued-${value}`} className="ds-token">{value}</li>)}
          {!s.frontierValues.length && <li className="ds-null">empty</li>}
        </ol>
        <p className="scene-caption">{s.frontier === "stack" ? "Visited, in order" : "Visited"}: {s.visitedValues.join(s.frontier === "stack" ? " → " : ", ") || "none"}</p>
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
  const row = { array: "Array", "linked-list": "Linked list", stack: "Stack / queue", queue: "Stack / queue", "hash-table": "Hash table", "binary-tree": "Unbalanced BST", graph: "Graph adjacency list" }[kind];
  // The footnote sits outside the table: a caption is as wide as the table, so it would scroll out of view with it.
  return (
    <>
      <TableScroll label="Complexity of each structure">
        <table className="complexity">
          <caption>Typical cost of each operation</caption>
          <thead><tr><th scope="col">Structure</th><th scope="col">Access</th><th scope="col">Search</th><th scope="col">Insert</th><th scope="col">Remove</th></tr></thead>
          <tbody>
            {complexityTable.map((item) => (
              <tr className={item.structure === row ? "is-current" : ""} key={item.structure}>
                <th scope="row">{item.structure}</th><td>{item.access}</td><td>{item.search}</td><td>{item.insert}</td><td>{item.remove}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="complexity-note">* Linked-list insert and remove are O(1) only once the position is known; finding it is O(n).</p>
      <p className="complexity-note">† Appending to a dynamic array is amortized O(1): usually a spare slot, occasionally a full copy into a bigger block.</p>
      <p className="complexity-note">‡ Amortized for an array-backed stack or queue (growth copies); O(1) every time for a linked one. h = tree height.</p>
    </>
  );
}

export const dataStructureScene = { Scene, Reference };
