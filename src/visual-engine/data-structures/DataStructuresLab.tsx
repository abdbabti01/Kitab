import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Gauge,
  GitBranch,
  Hash,
  ListTree,
  Network,
  Pause,
  Play,
  RotateCcw,
  StepForward,
} from "lucide-react";
import {
  buildDataStructureSimulation,
  complexityTable,
  defaultConfig,
  structureInfo,
  structureKinds,
  type GraphEdge,
  type OperationKind,
  type SimulationConfig,
  type StructureItem,
  type StructureKind,
  type StructureSnapshot,
} from "./model";
import "./data-structures-lab.css";

type Depth = "beginner" | "mechanism" | "implementation";

const kindIcons = {
  array: Braces,
  "linked-list": GitBranch,
  stack: ListTree,
  queue: ArrowRight,
  "hash-table": Hash,
  "binary-tree": ListTree,
  graph: Network,
} satisfies Record<StructureKind, typeof Braces>;

const challenges: Record<StructureKind, { question: string; answers: string[]; correct: number; why: string }> = {
  array: {
    question: "What makes a middle insertion expensive?",
    answers: ["Hashing the value", "Shifting later elements", "Following pointers"],
    correct: 1,
    why: "Contiguous order leaves no gap, so later values must move.",
  },
  "linked-list": {
    question: "What usually dominates deleting a value?",
    answers: ["Finding its node", "Copying every value", "Rehashing the list"],
    correct: 0,
    why: "Unlinking is constant work once the node and predecessor are known; locating them is usually linear.",
  },
  stack: {
    question: "Which item can pop remove?",
    answers: ["The oldest item", "Any indexed item", "The current top"],
    correct: 2,
    why: "LIFO is the stack's contract: the newest live item leaves first.",
  },
  queue: {
    question: "Where does enqueue place new work?",
    answers: ["At the rear", "At the front", "At a hash bucket"],
    correct: 0,
    why: "FIFO order requires new work to join behind existing work.",
  },
  "hash-table": {
    question: "Why must keys still be compared after hashing?",
    answers: ["Hashes sort the keys", "Different keys can share a bucket", "Indexes begin at zero"],
    correct: 1,
    why: "A collision means the bucket alone cannot prove key equality.",
  },
  "binary-tree": {
    question: "What does one BST comparison eliminate?",
    answers: ["One unrelated subtree", "Only the current value", "Every leaf"],
    correct: 0,
    why: "The ordering invariant proves that one whole direction cannot contain the target.",
  },
  graph: {
    question: "Why mark a vertex visited when it is enqueued?",
    answers: ["To sort its edges", "To avoid duplicate work through cycles", "To delete the vertex"],
    correct: 1,
    why: "Multiple neighbors may point to the same vertex; early marking queues it only once.",
  },
};

const comparisonRow: Record<StructureKind, string> = {
  array: "Array",
  "linked-list": "Linked list",
  stack: "Stack / queue",
  queue: "Stack / queue",
  "hash-table": "Hash table",
  "binary-tree": "Balanced BST",
  graph: "Graph adjacency list",
};

function valuesLabel(snapshot: StructureSnapshot) {
  if (snapshot.buckets) {
    return snapshot.buckets
      .filter((bucket) => bucket.items.length)
      .map((bucket) => `${bucket.index}:[${bucket.items.map((item) => item.value).join(",")}]`)
      .join(" · ") || "All buckets empty";
  }
  if (snapshot.edges) {
    return `visited [${snapshot.visitedValues.join(", ") || "—"}] · queue [${snapshot.frontierValues.join(", ") || "—"}]`;
  }
  return `[${snapshot.items.map((item) => item.value).join(", ")}]`;
}

function focusClass(id: string, snapshot: StructureSnapshot) {
  return snapshot.focusIds.includes(id) ? "is-focus" : snapshot.visitedValues.some((value) => id.includes(`-${value}`)) ? "is-visited" : "";
}

function ArrayView({ snapshot, select }: { snapshot: StructureSnapshot; select: (item: StructureItem) => void }) {
  return <div className="ds-array-view" aria-label="Array memory slots">
    <div className="ds-memory-scale"><span>LOW ADDRESS</span><i /><span>HIGH ADDRESS</span></div>
    <div className="ds-array-row">
      {snapshot.items.map((item, index) => <button type="button" className={focusClass(item.id, snapshot)} onClick={() => select(item)} key={item.id}>
        <span>INDEX {index}</span><b>{item.value}</b><small>{item.address}</small>
      </button>)}
    </div>
    <p className="ds-formula"><code>address(i) = 0x1000 + i × 4 bytes</code><span>One calculation reaches any index.</span></p>
  </div>;
}

function LinkedListView({ snapshot, select }: { snapshot: StructureSnapshot; select: (item: StructureItem) => void }) {
  return <div className="ds-list-view">
    <div className="ds-head-pointer"><span>HEAD</span><ArrowRight /><b>{snapshot.items[0]?.address ?? "NULL"}</b></div>
    <div className="ds-node-chain">
      {snapshot.items.map((item, index) => <div className="ds-node-wrap" key={item.id}>
        <button type="button" className={focusClass(item.id, snapshot)} onClick={() => select(item)}>
          <span>{item.address}</span><b>{item.value}</b><small>NEXT</small><code>{item.next ?? "NULL"}</code>
        </button>
        {index < snapshot.items.length - 1 && <ArrowRight aria-hidden="true" />}
      </div>)}
      <div className="ds-null">NULL</div>
    </div>
    <p className="ds-stage-note">Addresses are deliberately non-contiguous. The next field—not physical proximity—defines order.</p>
  </div>;
}

function StackView({ snapshot, select }: { snapshot: StructureSnapshot; select: (item: StructureItem) => void }) {
  return <div className="ds-stack-view">
    <div className="ds-end-marker"><span>TOP</span><ArrowRight /><b>{snapshot.items.at(-1)?.value ?? "EMPTY"}</b></div>
    <div className="ds-stack-cells">
      {[...snapshot.items].reverse().map((item, reverseIndex) => <button type="button" className={focusClass(item.id, snapshot)} onClick={() => select(item)} key={item.id}>
        <span>{reverseIndex === 0 ? "TOP" : `DEPTH ${reverseIndex}`}</span><b>{item.value}</b><small>{item.address}</small>
      </button>)}
    </div>
    <p className="ds-stage-note">Push and pop touch the highlighted end only. Hidden lower items keep their relative order.</p>
  </div>;
}

function QueueView({ snapshot, select }: { snapshot: StructureSnapshot; select: (item: StructureItem) => void }) {
  return <div className="ds-queue-view">
    <div className="ds-queue-labels"><span>DEQUEUE ← FRONT</span><span>REAR ← ENQUEUE</span></div>
    <div className="ds-queue-track">
      {snapshot.items.map((item) => <button type="button" className={focusClass(item.id, snapshot)} onClick={() => select(item)} key={item.id}><b>{item.value}</b><small>{item.address}</small></button>)}
    </div>
    <div className="ds-order-arrow"><span>oldest</span><i /><span>newest</span></div>
  </div>;
}

function HashView({ snapshot, select }: { snapshot: StructureSnapshot; select: (item: StructureItem) => void }) {
  return <div className="ds-hash-view">
    <div className="ds-hash-rule"><Hash /><span><b>Bucket rule</b><code>index = key mod 7</code></span></div>
    <div className="ds-buckets">
      {snapshot.buckets?.map((bucket) => <div className="ds-bucket" key={bucket.index}>
        <span>BUCKET {bucket.index}</span>
        <div>{bucket.items.length ? bucket.items.map((item, index) => <span className="ds-chain-item" key={item.id}>
          {index > 0 && <ArrowRight aria-hidden="true" />}
          <button type="button" className={focusClass(item.id, snapshot)} onClick={() => select(item)}><b>{item.value}</b><small>key</small></button>
        </span>) : <em>empty</em>}</div>
      </div>)}
    </div>
  </div>;
}

type TreeNode = { item: StructureItem; left?: TreeNode; right?: TreeNode };

function treeLevels(source: StructureItem[]) {
  let root: TreeNode | undefined;
  source.forEach((item) => {
    if (!root) { root = { item }; return; }
    let node = root;
    while (true) {
      if (item.value < node.item.value) {
        if (!node.left) { node.left = { item }; break; }
        node = node.left;
      } else if (item.value > node.item.value) {
        if (!node.right) { node.right = { item }; break; }
        node = node.right;
      } else break;
    }
  });
  if (!root) return [];
  const levels: (TreeNode | null)[][] = [[root]];
  while (levels.length < 4) {
    const next = levels.at(-1)!.flatMap((node) => node ? [node.left ?? null, node.right ?? null] : [null, null]);
    if (next.every((node) => node === null)) break;
    levels.push(next);
  }
  return levels;
}

function TreeView({ snapshot, select }: { snapshot: StructureSnapshot; select: (item: StructureItem) => void }) {
  return <div className="ds-tree-view">
    {treeLevels(snapshot.items).map((level, levelIndex) => <div className="ds-tree-level" style={{ gridTemplateColumns: `repeat(${level.length}, minmax(0, 1fr))` }} key={levelIndex}>
      {level.map((node, index) => node ? <button type="button" className={focusClass(node.item.id, snapshot)} onClick={() => select(node.item)} key={node.item.id}><span>{levelIndex === 0 ? "ROOT" : `LEVEL ${levelIndex}`}</span><b>{node.item.value}</b><small>{snapshot.visitedValues.includes(node.item.value) ? "path visited" : "not inspected"}</small></button> : <i key={`empty-${index}`} />)}
    </div>)}
    <div className="ds-tree-legend"><span><i className="left" />smaller → left</span><span><i className="right" />larger → right</span></div>
  </div>;
}

function adjacent(value: number, edges: GraphEdge[]) {
  return edges.flatMap((edge) => edge.from === value ? [edge.to] : edge.to === value ? [edge.from] : []).sort((a, b) => a - b);
}

function GraphView({ snapshot, select }: { snapshot: StructureSnapshot; select: (item: StructureItem) => void }) {
  const edges = snapshot.edges ?? [];
  return <div className="ds-graph-view">
    <div className="ds-graph-nodes">
      {snapshot.items.map((item) => <button type="button" className={`${focusClass(item.id, snapshot)} ${snapshot.frontierValues.includes(item.value) ? "is-frontier" : ""}`} onClick={() => select(item)} key={item.id}><b>{item.value}</b><small>{snapshot.visitedValues.includes(item.value) ? "visited" : "unseen"}</small></button>)}
    </div>
    <div className="ds-adjacency"><header><b>Adjacency list</b><span>stored relationships</span></header>{snapshot.items.map((item) => <div key={item.id}><b>{item.value}</b><ArrowRight />{adjacent(item.value, edges).map((neighbor) => <span key={neighbor}>{neighbor}</span>)}</div>)}</div>
    <div className="ds-frontier"><span>BFS QUEUE</span><div>{snapshot.frontierValues.length ? snapshot.frontierValues.map((value) => <b key={value}>{value}</b>) : <em>empty</em>}</div></div>
  </div>;
}

function StructureView({ kind, snapshot, select }: { kind: StructureKind; snapshot: StructureSnapshot; select: (item: StructureItem) => void }) {
  if (kind === "array") return <ArrayView snapshot={snapshot} select={select} />;
  if (kind === "linked-list") return <LinkedListView snapshot={snapshot} select={select} />;
  if (kind === "stack") return <StackView snapshot={snapshot} select={select} />;
  if (kind === "queue") return <QueueView snapshot={snapshot} select={select} />;
  if (kind === "hash-table") return <HashView snapshot={snapshot} select={select} />;
  if (kind === "binary-tree") return <TreeView snapshot={snapshot} select={select} />;
  return <GraphView snapshot={snapshot} select={select} />;
}

export function DataStructuresLab({ close }: { close: () => void }) {
  const [draft, setDraft] = useState<SimulationConfig>(() => defaultConfig("array"));
  const [active, setActive] = useState<SimulationConfig>(() => defaultConfig("array"));
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [depth, setDepth] = useState<Depth>("mechanism");
  const [selected, setSelected] = useState<StructureItem | null>(null);
  const [answer, setAnswer] = useState<number | null>(null);
  const simulation = useMemo(() => buildDataStructureSimulation(active), [active]);
  const frame = simulation.frames[Math.min(frameIndex, simulation.frames.length - 1)];
  const before = simulation.frames[Math.max(0, frameIndex - 1)].snapshot;
  const info = structureInfo[active.kind];
  const challenge = challenges[active.kind];

  useEffect(() => {
    if (!playing) return;
    if (frameIndex >= simulation.frames.length - 1) { setPlaying(false); return; }
    const timeout = window.setTimeout(() => setFrameIndex((index) => index + 1), 1250);
    return () => window.clearTimeout(timeout);
  }, [playing, frameIndex, simulation.frames.length]);

  useEffect(() => {
    setSelected(null);
  }, [frameIndex, active.kind]);

  function chooseKind(kind: StructureKind) {
    const next = defaultConfig(kind);
    setDraft(next);
    setActive(next);
    setFrameIndex(0);
    setPlaying(false);
    setAnswer(null);
  }

  function chooseOperation(operation: OperationKind) {
    setDraft((current) => ({ ...current, operation }));
  }

  function run() {
    setActive({ ...draft });
    setFrameIndex(0);
    setPlaying(true);
    setSelected(null);
    setAnswer(null);
  }

  function reset() {
    const next = defaultConfig(active.kind);
    setDraft(next);
    setActive(next);
    setFrameIndex(0);
    setPlaying(false);
    setSelected(null);
    setAnswer(null);
  }

  function togglePlayback() {
    if (frameIndex >= simulation.frames.length - 1) {
      setFrameIndex(0);
      setPlaying(true);
      return;
    }
    setPlaying((value) => !value);
  }

  return <main className="ds-lab">
    <header className="ds-topbar">
      <button type="button" onClick={close}><ArrowLeft /><span>Library</span></button>
      <div><span>DATA STRUCTURES · REFERENCE LAB</span><h1>Choose by operation, not by habit</h1></div>
      <div className="ds-verified"><Check /><span>Deterministic model</span></div>
    </header>

    <section className="ds-intro">
      <div><p className="ds-kicker">ONE WORKLOAD · SEVEN MODELS</p><h2>See what the machine must touch.</h2><p>Run a real operation, inspect each state change and compare its cost. Every highlighted read, comparison, write and pointer update comes from Kitab's simulator.</p></div>
      <div className="ds-cycle"><span><b>1</b>Choose</span><ArrowRight /><span><b>2</b>Predict</span><ArrowRight /><span><b>3</b>Run</span><ArrowRight /><span><b>4</b>Explain</span></div>
    </section>

    <nav className="ds-kind-picker" aria-label="Choose a data structure">
      {structureKinds.map((kind) => {
        const Icon = kindIcons[kind];
        return <button type="button" className={active.kind === kind ? "active" : ""} onClick={() => chooseKind(kind)} key={kind}><Icon /><span><b>{structureInfo[kind].label}</b><small>{structureInfo[kind].short}</small></span></button>;
      })}
    </nav>

    <section className="ds-workbench">
      <header className="ds-frame-head">
        <div><span>STEP {frameIndex + 1} OF {simulation.frames.length}</span><h2>{frame.title}</h2><p>{frame.detail}</p></div>
        <dl><div><dt>Operation cost</dt><dd>{simulation.complexity}</dd></div><div><dt>State after step</dt><dd>{frame.state}</dd></div></dl>
      </header>

      <div className="ds-workspace">
        <section className="ds-stage" aria-live="polite" aria-label={`${info.label} visualization: ${frame.title}`}>
          <header><span><CircleDot />LIVE STRUCTURE</span><b>{frame.action}</b></header>
          <StructureView kind={active.kind} snapshot={frame.snapshot} select={setSelected} />
          <footer><span>BEFORE <b>{valuesLabel(before)}</b></span><ArrowRight /><span>AFTER <b>{valuesLabel(frame.snapshot)}</b></span></footer>
        </section>

        <aside className="ds-inspector">
          <div className="ds-depth-tabs" role="tablist" aria-label="Explanation depth">
            {(["beginner", "mechanism", "implementation"] as Depth[]).map((item) => <button type="button" role="tab" aria-selected={depth === item} className={depth === item ? "active" : ""} onClick={() => setDepth(item)} key={item}>{item}</button>)}
          </div>
          {selected ? <section className="ds-selected"><span>SELECTED COMPONENT</span><h3>Value {selected.value}</h3><dl><div><dt>Identity</dt><dd>{selected.id}</dd></div><div><dt>Address</dt><dd>{selected.address}</dd></div>{selected.next !== undefined && <div><dt>Next</dt><dd>{selected.next ?? "NULL"}</dd></div>}</dl><button type="button" onClick={() => setSelected(null)}>Return to step details</button></section> : <>
            {depth === "beginner" && <section><span>WHY THIS HAPPENS</span><h3>{frame.delta}</h3><p>{frame.detail}</p><div className="ds-mental"><BookOpen /><p>{info.mentalModel}</p></div></section>}
            {depth === "mechanism" && <section><span>INVARIANT</span><h3>The rule that must remain true</h3><p>{info.invariant}</p><div className="ds-delta"><b>Current change</b><p>{frame.delta}</p></div></section>}
            {depth === "implementation" && <section><span>IMPLEMENTATION VIEW</span><h3>Pseudocode for this step</h3><code>{frame.code}</code><div className="ds-metric-grid"><span><b>{frame.metrics.comparisons}</b>comparisons</span><span><b>{frame.metrics.reads}</b>reads</span><span><b>{frame.metrics.writes}</b>writes</span><span><b>{frame.metrics.pointerChanges}</b>pointer changes</span></div></section>}
          </>}
        </aside>
      </div>

      <nav className="ds-timeline" aria-label="Operation timeline">
        {simulation.frames.map((item, index) => <button type="button" className={index === frameIndex ? "active" : index < frameIndex ? "complete" : ""} onClick={() => { setPlaying(false); setFrameIndex(index); }} key={item.id}><span>{index < frameIndex ? <Check /> : index + 1}</span><b>{item.title}</b><small>{item.action}</small></button>)}
      </nav>

      <div className="ds-controls">
        <button type="button" onClick={reset}><RotateCcw />Reset</button>
        <button type="button" onClick={() => { setPlaying(false); setFrameIndex((index) => Math.max(0, index - 1)); }} disabled={frameIndex === 0}><ChevronLeft />Previous</button>
        <button type="button" className="primary" onClick={togglePlayback}>{playing ? <Pause /> : <Play />}{playing ? "Pause" : frameIndex === simulation.frames.length - 1 ? "Replay" : "Play"}</button>
        <button type="button" onClick={() => { setPlaying(false); setFrameIndex((index) => Math.min(simulation.frames.length - 1, index + 1)); }} disabled={frameIndex === simulation.frames.length - 1}>Next<ChevronRight /></button>
        <span><Gauge />{frame.metrics.reads + frame.metrics.writes} memory operations so far</span>
      </div>
    </section>

    <section className="ds-experiments">
      <div className="ds-config">
        <header><span>EXPERIMENT</span><h2>Change the operation</h2><p>The simulator rebuilds a valid event trace from your inputs.</p></header>
        <div className="ds-operation-buttons">{structureInfo[draft.kind].operations.map((operation) => <button type="button" className={draft.operation === operation.id ? "active" : ""} onClick={() => chooseOperation(operation.id)} key={operation.id}>{operation.label}</button>)}</div>
        <div className="ds-inputs">
          {!(["pop", "peek", "dequeue"] as OperationKind[]).includes(draft.operation) && <label><span>{draft.operation === "search" || draft.operation === "bfs" || draft.kind === "hash-table" || draft.kind === "binary-tree" ? "Target / key" : "New value"}</span><input type="number" min="-99" max="99" value={draft.value} onChange={(event) => setDraft((current) => ({ ...current, value: Math.max(-99, Math.min(99, Number(event.target.value))) }))} /></label>}
          {(draft.kind === "array" || draft.kind === "linked-list") && draft.operation !== "search" && <label><span>Index</span><input type="number" min="0" max="5" value={draft.index} onChange={(event) => setDraft((current) => ({ ...current, index: Math.max(0, Math.min(5, Number(event.target.value))) }))} /></label>}
          <button type="button" onClick={run}><StepForward />Run operation</button>
        </div>
        <p className="ds-result"><b>{frameIndex === simulation.frames.length - 1 ? "Operation result" : "Current state"}</b>{frameIndex === simulation.frames.length - 1 ? simulation.result : frame.state}</p>
      </div>

      <div className="ds-challenge">
        <header><span>PREDICT BEFORE YOU RUN</span><h2>{challenge.question}</h2></header>
        <div>{challenge.answers.map((item, index) => <button type="button" className={answer === index ? index === challenge.correct ? "correct" : "wrong" : ""} onClick={() => setAnswer(index)} key={item}><span>{String.fromCharCode(65 + index)}</span>{item}{answer === index && index === challenge.correct && <Check />}</button>)}</div>
        {answer !== null && <p className={answer === challenge.correct ? "correct" : "wrong"}><b>{answer === challenge.correct ? "Correct." : "Look at the highlighted state again."}</b> {challenge.why}</p>}
      </div>
    </section>

    <section className="ds-comparison">
      <header><div><span>DECISION TABLE</span><h2>No structure wins every operation</h2></div><p>Average or worst-case costs shown for the common implementation. *Linked-list insertion and removal are O(1) only after the position is known.</p></header>
      <div className="ds-table-wrap"><table><thead><tr><th>Structure</th><th>Direct access</th><th>Search</th><th>Insert</th><th>Remove</th></tr></thead><tbody>{complexityTable.map((row) => <tr className={row.structure === comparisonRow[active.kind] ? "active" : ""} key={row.structure}><th>{row.structure}</th><td>{row.access}</td><td>{row.search}</td><td>{row.insert}</td><td>{row.remove}</td></tr>)}</tbody></table></div>
    </section>
  </main>;
}
