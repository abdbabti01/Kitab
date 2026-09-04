import { useEffect, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  X,
  Zap,
} from "lucide-react";
import { LessonEngine } from "./lesson-engines";
import { LearningStudio } from "./learning-studio";

export type ChapterMode =
  | "network"
  | "request"
  | "dns"
  | "array"
  | "list"
  | "stack"
  | "hash"
  | "tree"
  | "index"
  | "scheduler"
  | "distributed"
  | "state";
export type Chapter = {
  slug: string;
  title: string;
  family: string;
  mode: ChapterMode;
  summary: string;
  analogy: string;
  steps: { title: string; detail: string; state: string }[];
  experiment: string;
  normal: string;
  changed: string;
};

export const chapters: Chapter[] = [
  {
    slug: "tcp",
    title: "TCP & transport protocols",
    family: "Networks",
    mode: "network",
    summary:
      "Watch application data become a TCP segment, an IP packet and an Ethernet frame—then cross the network and climb the receiving computer.",
    analogy:
      "Like placing a letter inside successively addressed envelopes, then opening them in reverse order.",
    experiment: "Drop a packet",
    normal: "The receiver acknowledges the next expected byte.",
    changed:
      "Segment 2 disappears. Duplicate ACKs reveal the gap and TCP retransmits it.",
    steps: [
      {
        title: "Choose endpoints",
        detail:
          "The client opens a temporary source port and targets the server's listening port. The two IP addresses and two ports identify this conversation.",
        state: "Socket pair selected",
      },
      {
        title: "Send SYN",
        detail:
          "The client proposes an initial sequence number and asks the server to create TCP connection state.",
        state: "SYN seq=1000",
      },
      {
        title: "Complete the handshake",
        detail:
          "SYN-ACK confirms the client's sequence and introduces the server's sequence. The final ACK confirms both directions.",
        state: "Connection established",
      },
      {
        title: "Application creates bytes",
        detail:
          "The browser creates HTTP request bytes. TCP does not understand the meaning; it receives an ordered byte stream.",
        state: "HTTP data ready",
      },
      {
        title: "TCP adds reliability",
        detail:
          "TCP adds ports, sequence numbers and flags. The result is a segment.",
        state: "Segment seq=1001",
      },
      {
        title: "IP adds addresses",
        detail:
          "IP adds source and destination addresses so routers can forward the packet.",
        state: "Packet addressed",
      },
      {
        title: "Link frames the packet",
        detail:
          "Ethernet or Wi-Fi adds local-link addresses and an error check.",
        state: "Frame ready",
      },
      {
        title: "Network forwards it",
        detail:
          "Each router removes the old link frame, examines the IP destination and creates a new frame for the next hop.",
        state: "In transit",
      },
      {
        title: "Receiver unwraps the frame",
        detail:
          "The receiver checks and removes headers in reverse order, acknowledges the bytes and delivers them to the server.",
        state: "Bytes delivered",
      },
      {
        title: "Acknowledge bytes",
        detail:
          "The receiver sends a cumulative ACK containing the sequence number of the next byte it expects.",
        state: "ACK 2461 returned",
      },
      {
        title: "Recover a lost segment",
        detail:
          "Duplicate acknowledgements or a timeout reveal a gap. TCP retransmits the missing byte range rather than restarting the request.",
        state: "Missing segment retransmitted",
      },
      {
        title: "Control receiver flow",
        detail:
          "The advertised receive window limits unacknowledged data so a fast sender cannot overflow the receiver's buffer.",
        state: "Receive window respected",
      },
      {
        title: "Control congestion",
        detail:
          "The congestion window grows while delivery succeeds and shrinks when loss suggests the path is crowded.",
        state: "Send rate adapted",
      },
      {
        title: "Close both directions",
        detail:
          "FIN and ACK close each direction independently. TIME_WAIT protects a new connection from delayed packets belonging to the old one.",
        state: "Connection closed safely",
      },
    ],
  },
  {
    slug: "web-request",
    title: "Life cycle of a web request",
    family: "Web",
    mode: "request",
    summary:
      "Follow a URL from the browser through DNS, connection setup, encryption, server code, database work and rendering.",
    analogy:
      "A restaurant order passes through a host, waiter, kitchen and pantry before the finished plate returns.",
    experiment: "Slow the database",
    normal: "The response returns quickly and the browser renders the page.",
    changed:
      "The server waits on the database; total request time rises even though the network is fast.",
    steps: [
      {
        title: "Parse the URL",
        detail:
          "The browser separates scheme, hostname, port, path and query parameters.",
        state: "Destination understood",
      },
      {
        title: "Resolve DNS",
        detail:
          "The hostname is translated into an IP address, often from a nearby cache.",
        state: "IP found",
      },
      {
        title: "Connect securely",
        detail:
          "TCP or QUIC creates transport state and TLS authenticates the server and negotiates encryption keys.",
        state: "Encrypted channel",
      },
      {
        title: "Send HTTP",
        detail: "The browser sends method, path, headers and optional body.",
        state: "Request in flight",
      },
      {
        title: "Run server code",
        detail:
          "A reverse proxy routes the request; application code validates it and may query a database.",
        state: "Response created",
      },
      {
        title: "Render",
        detail:
          "The browser parses HTML, discovers assets, builds layout and paints pixels.",
        state: "Page visible",
      },
    ],
  },
  {
    slug: "dns",
    title: "DNS resolution",
    family: "Networks",
    mode: "dns",
    summary:
      "See how a domain name is resolved through caches, a recursive resolver, root, TLD and authoritative name servers.",
    analogy:
      "Instead of memorizing everyone’s number, you ask a directory service that knows which directory to ask next.",
    experiment: "Clear every cache",
    normal: "A cached answer may return in one short trip.",
    changed:
      "With empty caches, the resolver must visit the DNS hierarchy before answering.",
    steps: [
      {
        title: "Browser cache",
        detail:
          "The browser checks whether it recently resolved this hostname.",
        state: "Local lookup",
      },
      {
        title: "Operating-system cache",
        detail: "The OS checks its DNS cache and hosts file.",
        state: "Device lookup",
      },
      {
        title: "Recursive resolver",
        detail:
          "Your configured resolver takes responsibility for finding the final answer.",
        state: "Recursive query",
      },
      {
        title: "Root referral",
        detail:
          "A root server points toward the name servers for the top-level domain.",
        state: "Ask .ca servers",
      },
      {
        title: "TLD referral",
        detail:
          "The TLD server identifies the authoritative server for the domain.",
        state: "Authority found",
      },
      {
        title: "Authoritative answer",
        detail:
          "The authoritative server returns the record and its TTL; caches store it temporarily.",
        state: "IP returned",
      },
    ],
  },
  {
    slug: "data-structures",
    title: "Data structures: choosing the right model",
    family: "Data structures",
    mode: "array",
    summary:
      "Compare the main ways programs organize values, then choose a structure from the operations the program must perform—not from its name or theme.",
    analogy:
      "A toolbox has different tools because no single tool is best at every job; data structures make the same trade-off for operations on data.",
    experiment: "Change the dominant operation",
    normal:
      "When indexed lookup dominates, an array offers direct access with compact contiguous storage.",
    changed:
      "When insertion order, key lookup, priority or relationships dominate, a list, queue, hash table, heap, tree or graph can be the better model.",
    steps: [
      {
        title: "Start with the operations",
        detail:
          "A data structure is a concrete organization of values and relationships. Its layout determines the cost of lookup, insertion, deletion, ordering and traversal.",
        state: "Requirements identified",
      },
      {
        title: "Use an array for indexes",
        detail:
          "An array keeps equal-size elements in contiguous slots. Address arithmetic makes indexed access O(1), while a middle insertion usually shifts O(n) elements.",
        state: "Fast indexed access",
      },
      {
        title: "Use links for local changes",
        detail:
          "A linked list stores each value in a node with a pointer to the next node. Traversal is O(n), but a known neighboring node can be relinked without shifting every value.",
        state: "Pointers connect nodes",
      },
      {
        title: "Restrict access with stacks and queues",
        detail:
          "A stack exposes the newest item first (LIFO). A queue exposes the oldest item first (FIFO). Those rules make order part of the structure's contract.",
        state: "Access order defined",
      },
      {
        title: "Map keys with a hash table",
        detail:
          "A hash function maps a key to a bucket. Lookup is O(1) on average when collisions and load factor are controlled, but the keys are not automatically sorted.",
        state: "Key mapped to bucket",
      },
      {
        title: "Represent relationships",
        detail:
          "Trees represent hierarchy and ordered search paths. Graphs represent general relationships through vertices and edges. Traversal follows those explicit connections.",
        state: "Relationships modeled",
      },
      {
        title: "Choose the trade-off",
        detail:
          "Select the structure whose common operations are cheap and whose ordering, memory and update guarantees match the problem. Big-O describes growth, not the whole design decision.",
        state: "Structure selected",
      },
    ],
  },
  {
    slug: "arrays",
    title: "Arrays & memory",
    family: "Data structures",
    mode: "array",
    summary:
      "Explore why array access is fast, why insertion can be expensive and how contiguous memory enables address calculation.",
    analogy:
      "Numbered lockers stand side by side, so locker 7 can be located without opening lockers 0–6.",
    experiment: "Insert at index 2",
    normal: "Reading index 2 requires one address calculation.",
    changed:
      "Insertion shifts every later element one position to preserve order.",
    steps: [
      {
        title: "Allocate contiguous memory",
        detail: "The runtime reserves adjacent slots of equal size.",
        state: "5 slots reserved",
      },
      {
        title: "Store values",
        detail: "Each value occupies one indexed slot.",
        state: "Values written",
      },
      {
        title: "Calculate an address",
        detail: "Address = base + index × element size.",
        state: "Direct access O(1)",
      },
      {
        title: "Insert in the middle",
        detail: "Later elements move right before the new value fits.",
        state: "Several writes O(n)",
      },
    ],
  },
  {
    slug: "linked-lists",
    title: "Linked lists",
    family: "Data structures",
    mode: "list",
    summary:
      "Follow pointers between separately allocated nodes and compare traversal with insertion.",
    analogy:
      "A treasure hunt where each clue tells you where the next clue is hidden.",
    experiment: "Remove the middle node",
    normal: "Traversal follows every next pointer in order.",
    changed:
      "One pointer is redirected around the removed node; its memory can then be released.",
    steps: [
      {
        title: "Create nodes",
        detail: "Each node stores a value and a reference to the next node.",
        state: "Separate allocations",
      },
      {
        title: "Start at head",
        detail: "Only the first node is directly known.",
        state: "Head selected",
      },
      {
        title: "Follow next",
        detail: "Reaching index 3 requires visiting indexes 0, 1 and 2 first.",
        state: "Traversal O(n)",
      },
      {
        title: "Relink",
        detail:
          "Insertion or removal changes neighboring references instead of shifting all values.",
        state: "Pointers updated",
      },
    ],
  },
  {
    slug: "recursion",
    title: "Stacks, recursion & calls",
    family: "Programming",
    mode: "stack",
    summary:
      "Step through recursive calls as stack frames are pushed, paused and returned in reverse order.",
    analogy:
      "You place a new note on top of a pile for every unfinished task, then finish them from the top downward.",
    experiment: "Set a missing base case",
    normal: "The base case stops new calls and frames return normally.",
    changed:
      "Without a reachable base case, frames keep growing until stack overflow.",
    steps: [
      {
        title: "Call factorial(3)",
        detail: "A frame stores n=3 and the return location.",
        state: "Depth 1",
      },
      {
        title: "Call factorial(2)",
        detail: "The first call pauses while a second frame is pushed.",
        state: "Depth 2",
      },
      {
        title: "Call factorial(1)",
        detail: "Another frame is pushed with its own local variable.",
        state: "Depth 3",
      },
      {
        title: "Reach base case",
        detail: "factorial(1) returns 1 without another recursive call.",
        state: "Growth stops",
      },
      {
        title: "Unwind",
        detail: "Frames pop in reverse order: 2×1, then 3×2.",
        state: "Result 6",
      },
    ],
  },
  {
    slug: "hash-tables",
    title: "Hash tables",
    family: "Data structures",
    mode: "hash",
    summary:
      "Turn keys into bucket indexes, observe collisions and see why capacity and load factor matter.",
    analogy:
      "A mailroom uses a rule to choose a pigeonhole, but two names may still point to the same hole.",
    experiment: "Force a collision",
    normal: "The key maps to an empty bucket and is stored immediately.",
    changed:
      "Two keys map to bucket 3, so the table must chain entries or probe another bucket.",
    steps: [
      {
        title: "Hash the key",
        detail: "A deterministic function turns the key into an integer.",
        state: "Hash 4187",
      },
      {
        title: "Choose a bucket",
        detail: "The table reduces the hash to a valid array index.",
        state: "Index 3",
      },
      {
        title: "Check the key",
        detail:
          "The bucket’s stored key is compared to handle collisions safely.",
        state: "Key verified",
      },
      {
        title: "Read the value",
        detail: "With a controlled load factor, lookup is O(1) on average.",
        state: "Value returned",
      },
    ],
  },
  {
    slug: "trees",
    title: "Trees & binary search",
    family: "Data structures",
    mode: "tree",
    summary:
      "Traverse a binary search tree by using ordering to discard half of the remaining direction at each node.",
    analogy:
      "A choose-your-own-path directory: smaller names go left and larger names go right.",
    experiment: "Make the tree unbalanced",
    normal:
      "A balanced tree keeps paths short, giving approximately O(log n) search.",
    changed:
      "Sorted insertion creates a long chain; search degrades toward O(n).",
    steps: [
      {
        title: "Begin at root",
        detail: "Compare the target 7 with root value 8.",
        state: "7 < 8",
      },
      {
        title: "Move left",
        detail: "Every value in the right subtree can be ignored.",
        state: "Half discarded",
      },
      {
        title: "Compare with 4",
        detail: "Since 7 is larger, move to the right child.",
        state: "7 > 4",
      },
      {
        title: "Find 7",
        detail: "The target matches the current node.",
        state: "Search complete",
      },
    ],
  },
  {
    slug: "database-indexes",
    title: "Database indexes",
    family: "Databases",
    mode: "index",
    summary:
      "Compare scanning every table row with traversing a B-tree index and fetching only the matching data page.",
    analogy:
      "A book index sends you to the right page instead of forcing you to read every page from the beginning.",
    experiment: "Remove the index",
    normal:
      "The B-tree narrows the search through a few index pages, then reads the matching table page.",
    changed:
      "Without the index, the database scans every table page and tests every row.",
    steps: [
      {
        title: "Parse the query",
        detail: "SQL is converted into an internal representation.",
        state: "Query understood",
      },
      {
        title: "Choose a plan",
        detail:
          "The optimizer estimates whether an index seek or table scan costs less.",
        state: "Index seek selected",
      },
      {
        title: "Traverse the B-tree",
        detail: "Root and branch pages narrow the key range.",
        state: "Leaf page found",
      },
      {
        title: "Fetch the row",
        detail:
          "The leaf entry points to the matching row or contains requested columns.",
        state: "Minimal page reads",
      },
    ],
  },
  {
    slug: "processes-threads",
    title: "Processes, threads & scheduling",
    family: "Operating systems",
    mode: "scheduler",
    summary:
      "Watch runnable threads share CPU time while processes isolate memory and resources.",
    analogy:
      "Several cooks share one cutting board; a coordinator gives each cook a short turn.",
    experiment: "Shrink the time slice",
    normal:
      "Each runnable thread receives a useful interval before the scheduler switches.",
    changed:
      "Very short slices improve responsiveness but spend more time saving and restoring context.",
    steps: [
      {
        title: "Create a process",
        detail:
          "The OS creates an isolated virtual address space and resource handles.",
        state: "Process ready",
      },
      {
        title: "Create threads",
        detail:
          "Threads share process memory but have separate stacks and registers.",
        state: "Three runnable threads",
      },
      {
        title: "Dispatch",
        detail:
          "The scheduler selects a runnable thread and restores its CPU context.",
        state: "Thread A running",
      },
      {
        title: "Preempt",
        detail:
          "When the time slice expires, registers are saved and another thread runs.",
        state: "Context switched",
      },
    ],
  },
  {
    slug: "message-queues",
    title: "Message queues & event-driven systems",
    family: "Distributed systems",
    mode: "distributed",
    summary:
      "Follow an event from a producer into a durable broker, through delivery and acknowledgement, including what happens when a consumer fails.",
    analogy:
      "A registered-mail desk holds each envelope until the correct recipient collects it and signs a receipt.",
    experiment: "Crash the consumer before acknowledgement",
    normal:
      "The consumer finishes its work and acknowledges the event, so the broker advances its delivery position.",
    changed:
      "Without an acknowledgement, the broker makes the event available again; repeated failures can move it to a dead-letter queue.",
    steps: [
      {
        title: "Publish an event",
        detail:
          "The producer writes a small immutable event containing an identifier, type and payload.",
        state: "Event created",
      },
      {
        title: "Persist in the broker",
        detail:
          "The broker stores the event before confirming publication, so a process restart does not silently erase it.",
        state: "Event durable",
      },
      {
        title: "Route to a subscription",
        detail:
          "Topic and subscription rules decide which consumer group should receive the event.",
        state: "Delivery assigned",
      },
      {
        title: "Consumer handles the event",
        detail:
          "A consumer reads the payload and performs an idempotent operation because delivery may happen more than once.",
        state: "Work in progress",
      },
      {
        title: "Acknowledge completion",
        detail:
          "Only after the work succeeds does the consumer acknowledge the event to the broker.",
        state: "Offset committed",
      },
      {
        title: "Retry or dead-letter",
        detail:
          "A failed delivery is retried. After the configured attempt limit, the event is isolated for investigation.",
        state: "Failure contained",
      },
    ],
  },
  {
    slug: "state-machines",
    title: "State machines & lifecycles",
    family: "Software design",
    mode: "state",
    summary:
      "Model a system as named states and permitted event-driven transitions, with guards that reject impossible changes.",
    analogy:
      "A traffic light cannot jump to any color it wants; each signal moves through a controlled set of valid states.",
    experiment: "Send an invalid event",
    normal:
      "A valid event follows a declared transition and produces one predictable next state.",
    changed:
      "An event with no valid transition is rejected, leaving the state unchanged instead of corrupting the lifecycle.",
    steps: [
      {
        title: "Enter the initial state",
        detail:
          "Every machine starts in one explicitly defined state rather than an ambiguous combination of flags.",
        state: "Idle",
      },
      {
        title: "Receive an event",
        detail:
          "An external input such as submit requests a transition from the current state.",
        state: "Submit received",
      },
      {
        title: "Evaluate the guard",
        detail:
          "The transition proceeds only when its condition is true; invalid data follows the failure path.",
        state: "Input valid",
      },
      {
        title: "Run the transition action",
        detail:
          "The machine performs the controlled side effect associated with the accepted transition.",
        state: "Processing",
      },
      {
        title: "Enter the next state",
        detail:
          "Completion produces one named state with a known set of allowed future events.",
        state: "Complete",
      },
    ],
  },
];

export function findChapter(value: string) {
  const q = value.toLowerCase().trim();
  return chapters.find(
    (c) =>
      c.slug === q ||
      c.title.toLowerCase() === q ||
      c.title.toLowerCase().includes(q) ||
      (
        {
          "transport layer": "tcp",
          arrays: "arrays",
          "linked lists": "linked-lists",
          "stacks & queues": "recursion",
          "hash tables": "hash-tables",
          trees: "trees",
          "dns resolution": "dns",
          "http lifecycle": "web-request",
          "processes & threads": "processes-threads",
          "databases & indexes": "database-indexes",
          "message queues": "message-queues",
          "distributed systems": "message-queues",
          "state machines": "state-machines",
          "data structure": "data-structures",
          "data structures": "data-structures",
        } as Record<string, string>
      )[q] === c.slug,
  );
}

export function CuratedChapter({chapter,close}:{chapter:Chapter;close:()=>void}) {
  return <LearningStudio chapter={chapter} close={close}/>;
}

function LegacyCuratedChapter({
  chapter,
  close,
}: {
  chapter: Chapter;
  close: () => void;
}) {
  const [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false),
    [experiment, setExperiment] = useState(false),
    [level, setLevel] = useState<"simple" | "mechanism" | "deep">("mechanism");
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(
      () =>
        setStep((s) =>
          s >= chapter.steps.length - 1 ? (setPlaying(false), s) : s + 1,
        ),
      1400,
    );
    return () => clearInterval(t);
  }, [playing, chapter.steps.length]);
  const current = chapter.steps[step];
  return (
    <section id="curated-chapter" className="curated-chapter">
      <div className="chapter-header">
        <div>
          <span>{chapter.family} · HANDCRAFTED CHAPTER</span>
          <h2>{chapter.title}</h2>
          <p>{chapter.summary}</p>
        </div>
        <button aria-label="Close chapter" onClick={close}>
          <X />
        </button>
      </div>
      <div className="chapter-tabs">
        {(["simple", "mechanism", "deep"] as const).map((x) => (
          <button
            className={level === x ? "active" : ""}
            onClick={() => setLevel(x)}
            key={x}
          >
            {x}
          </button>
        ))}
      </div>
      <div className="chapter-layout">
        <div className="chapter-canvas">
          <div className="canvas-bar">
            <span>LIVE MECHANISM</span>
            <b>{current.state}</b>
          </div>
          <LessonEngine chapter={chapter} step={step} changed={experiment} />
          <div className="chapter-controls">
            <button
              onClick={() => {
                setPlaying(false);
                setStep(0);
              }}
            >
              <RotateCcw />
              Reset
            </button>
            <button
              className="play"
              onClick={() => {
                if (step === chapter.steps.length - 1) setStep(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause /> : <Play />}
              {playing ? "Pause" : "Play"}
            </button>
            <button
              onClick={() =>
                setStep((s) => Math.min(chapter.steps.length - 1, s + 1))
              }
            >
              Next step <ChevronRight />
            </button>
          </div>
        </div>
        <aside className="chapter-notes">
          <span>
            STEP {step + 1} / {chapter.steps.length}
          </span>
          <h3>{current.title}</h3>
          <p>{level === "simple" ? chapter.analogy : current.detail}</p>
          {level === "deep" && (
            <div className="deep-note">
              <b>Technical consequence</b>
              <p>
                {current.state}. The important question is not only what moved,
                but which component owns the new state.
              </p>
            </div>
          )}
          <button
            className={experiment ? "experiment active" : "experiment"}
            onClick={() => setExperiment((v) => !v)}
          >
            <Zap />
            <span>
              <b>{chapter.experiment}</b>
              <small>{experiment ? chapter.changed : chapter.normal}</small>
            </span>
          </button>
        </aside>
      </div>
      <div className="chapter-timeline">
        {chapter.steps.map((s, i) => (
          <button
            className={i === step ? "active" : ""}
            onClick={() => {
              setPlaying(false);
              setStep(i);
            }}
            key={s.title}
          >
            <span>{i + 1}</span>
            <b>{s.title}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

function Mechanism({
  mode,
  step,
  changed,
}: {
  mode: ChapterMode;
  step: number;
  changed: boolean;
}) {
  if (mode === "array" || mode === "hash" || mode === "index")
    return (
      <div className={`viz cells ${mode} ${changed ? "changed" : ""}`}>
        {Array.from({ length: 8 }, (_, i) => (
          <div className={i === Math.min(step + 1, 7) ? "active" : ""} key={i}>
            <small>{mode === "index" ? `page ${i}` : `[${i}]`}</small>
            <b>
              {mode === "hash"
                ? i === 3
                  ? changed
                    ? "fox + cat"
                    : "fox"
                  : "—"
                : mode === "index"
                  ? i === 0
                    ? "ROOT"
                    : i < 3
                      ? "BRANCH"
                      : "ROWS"
                  : [12, 24, 31, 48, 55, 67, 79, 91][i]}
            </b>
          </div>
        ))}
      </div>
    );
  if (mode === "stack")
    return (
      <div className={`viz stack-frames ${changed ? "changed" : ""}`}>
        {Array.from(
          { length: changed ? Math.max(7, step + 2) : Math.min(step + 1, 3) },
          (_, i) => (
            <div className={i === Math.min(step, 2) ? "active" : ""} key={i}>
              <span>frame {i + 1}</span>
              <b>factorial({3 - i > 0 ? 3 - i : "…"})</b>
              <small>return address · local n</small>
            </div>
          ),
        )}
      </div>
    );
  if (mode === "tree")
    return (
      <div className={`viz tree-viz ${changed ? "changed" : ""}`}>
        {[8, 4, 12, 2, 7, 10, 14].map((n, i) => (
          <div
            className={
              i === Math.min(step === 0 ? 0 : step === 1 ? 1 : 4, 4)
                ? "active"
                : ""
            }
            key={n}
            style={changed ? undefined : ({ "--i": i } as React.CSSProperties)}
          >
            {n}
          </div>
        ))}
      </div>
    );
  if (mode === "list")
    return (
      <div className={`viz linked ${changed ? "changed" : ""}`}>
        {["HEAD", "A", "B", "C", "NULL"].map((x, i) => (
          <div className={i === Math.min(step, 4) ? "active" : ""} key={x}>
            <b>{x}</b>
            {i < 4 && <ChevronRight />}
          </div>
        ))}
      </div>
    );
  if (mode === "scheduler")
    return (
      <div className={`viz scheduler ${changed ? "changed" : ""}`}>
        <div className="cpu">
          <small>CPU CORE</small>
          <b>Thread {String.fromCharCode(65 + (step % 3))}</b>
        </div>
        <div className="runqueue">
          {["A", "B", "C"].map((x, i) => (
            <span className={i === step % 3 ? "active" : ""} key={x}>
              Thread {x}
            </span>
          ))}
        </div>
        <p>{changed ? "many context switches" : "time slice: 10 ms"}</p>
      </div>
    );
  const labels =
    mode === "network"
      ? ["APP", "TCP", "IP", "LINK", "ROUTER", "LINK", "IP", "TCP", "APP"]
      : mode === "dns"
        ? ["BROWSER", "OS", "RESOLVER", "ROOT", ".CA", "AUTHORITY"]
        : ["URL", "DNS", "TCP/TLS", "HTTP", "SERVER", "DATABASE", "BROWSER"];
  return (
    <div className={`viz journey ${mode} ${changed ? "changed" : ""}`}>
      {labels.map((x, i) => (
        <div
          className={i === Math.min(step, labels.length - 1) ? "active" : ""}
          key={x}
        >
          <span>{i + 1}</span>
          <b>{x}</b>
          {i < labels.length - 1 && <i>→</i>}
        </div>
      ))}
      <div
        className="journey-token"
        style={
          {
            "--step": Math.min(step, labels.length - 1),
            "--count": labels.length - 1,
          } as React.CSSProperties
        }
      >
        <Zap />
      </div>
    </div>
  );
}
