import type { Chapter } from "../../curated";
import type {
  EngineKind,
  VisualActor,
  VisualLink,
  VisualizationSpec,
} from "../core/visualization-spec";

type Blueprint = {
  engine: EngineKind;
  title: string;
  actors: VisualActor[];
  links?: VisualLink[];
  route: [string, string][];
};

const actor = (id: string, label: string, role: string, group?: string): VisualActor => ({
  id,
  label,
  role,
  group,
});

const blueprints: Record<string, Blueprint> = {
  "web-request": {
    engine: "request",
    title: "A request from address bar to painted page",
    actors: [
      actor("browser", "Browser", "Parses the URL and renders the response", "client"),
      actor("dns", "DNS", "Resolves the hostname to an IP address", "network"),
      actor("edge", "Edge + TLS", "Connects, encrypts and routes HTTP", "network"),
      actor("app", "Application", "Validates the request and runs business logic", "server"),
      actor("database", "Database", "Reads or changes persistent records", "server"),
      actor("render", "Renderer", "Builds layout and paints pixels", "client"),
    ],
    route: [
      ["browser", "browser"], ["browser", "dns"], ["browser", "edge"],
      ["edge", "app"], ["app", "database"], ["app", "render"],
    ],
  },
  dns: {
    engine: "request",
    title: "DNS resolution through caches and authority",
    actors: [
      actor("browser", "Browser cache", "Checks a recently stored answer", "device"),
      actor("os", "OS resolver", "Checks the hosts file and operating-system cache", "device"),
      actor("recursive", "Recursive resolver", "Finds the final answer for the device", "resolver"),
      actor("root", "Root", "Refers the resolver to the correct TLD", "authority"),
      actor("tld", "TLD server", "Refers the resolver to the domain authority", "authority"),
      actor("authoritative", "Authoritative server", "Returns the domain record and TTL", "authority"),
    ],
    route: [
      ["browser", "browser"], ["browser", "os"], ["os", "recursive"],
      ["recursive", "root"], ["root", "tld"], ["tld", "authoritative"],
    ],
  },
  "data-structures": {
    engine: "memory",
    title: "Data structures compared by their operations",
    actors: [
      actor("goal", "Required operations", "Lookup · insert · delete · order · traverse", "reference"),
      actor("array", "Array", "Contiguous slots · direct indexed access", "model"),
      actor("linked", "Linked list", "Separately allocated nodes joined by pointers", "model"),
      actor("stackqueue", "Stack / queue", "LIFO or FIFO access-order contract", "model"),
      actor("hashmap", "Hash table", "Keys mapped into buckets with collision handling", "model"),
      actor("treegraph", "Tree / graph", "Explicit hierarchical or general relationships", "model"),
      actor("choice", "Chosen structure", "The model whose trade-offs fit the workload", "reference"),
    ],
    links: [
      { from: "goal", to: "array", label: "index" },
      { from: "goal", to: "linked", label: "relink" },
      { from: "goal", to: "stackqueue", label: "order" },
      { from: "goal", to: "hashmap", label: "key" },
      { from: "goal", to: "treegraph", label: "relationship" },
      { from: "array", to: "choice", label: "trade-off" },
      { from: "linked", to: "choice", label: "trade-off" },
      { from: "stackqueue", to: "choice", label: "trade-off" },
      { from: "hashmap", to: "choice", label: "trade-off" },
      { from: "treegraph", to: "choice", label: "trade-off" },
    ],
    route: [
      ["goal", "goal"],
      ["goal", "array"],
      ["goal", "linked"],
      ["goal", "stackqueue"],
      ["goal", "hashmap"],
      ["goal", "treegraph"],
      ["treegraph", "choice"],
    ],
  },
  arrays: {
    engine: "memory",
    title: "Contiguous array storage",
    actors: [
      actor("runtime", "Runtime", "Allocates and addresses the array", "owner"),
      actor("slot0", "[0] 12", "Address 0x1000", "array"),
      actor("slot1", "[1] 24", "Address 0x1004", "array"),
      actor("slot2", "[2] 31", "Address 0x1008", "array"),
      actor("slot3", "[3] 48", "Address 0x100C", "array"),
      actor("slot4", "[4] 55", "Address 0x1010", "array"),
    ],
    links: [
      { from: "slot0", to: "slot1" }, { from: "slot1", to: "slot2" },
      { from: "slot2", to: "slot3" }, { from: "slot3", to: "slot4" },
    ],
    route: [["runtime", "slot0"], ["runtime", "slot4"], ["runtime", "slot2"], ["slot4", "slot2"]],
  },
  "linked-lists": {
    engine: "memory",
    title: "Pointers through separately allocated nodes",
    actors: [
      actor("head", "HEAD", "Stores the first node address", "reference"),
      actor("a", "Node A", "0x1020 · value A · next 0x2090", "node"),
      actor("b", "Node B", "0x2090 · value B · next 0x31F0", "node"),
      actor("c", "Node C", "0x31F0 · value C · next null", "node"),
      actor("null", "NULL", "Marks the end of the list", "reference"),
    ],
    links: [
      { from: "head", to: "a", label: "points to" }, { from: "a", to: "b", label: "next" },
      { from: "b", to: "c", label: "next" }, { from: "c", to: "null", label: "next" },
    ],
    route: [["head", "a"], ["head", "a"], ["a", "c"], ["a", "c"]],
  },
  recursion: {
    engine: "execution",
    title: "Recursive calls and stack frames",
    actors: [
      actor("caller", "main()", "Waits for factorial(3)", "code"),
      actor("f3", "factorial(3)", "Local n=3 · waits for factorial(2)", "frame"),
      actor("f2", "factorial(2)", "Local n=2 · waits for factorial(1)", "frame"),
      actor("f1", "factorial(1)", "Base case returns 1", "frame"),
      actor("result", "result = 6", "Receives the unwound return value", "code"),
    ],
    route: [["caller", "f3"], ["f3", "f2"], ["f2", "f1"], ["f1", "f1"], ["f1", "result"]],
  },
  "hash-tables": {
    engine: "memory",
    title: "Hashing a key into an array bucket",
    actors: [
      actor("key", "Key: fox", "Input key", "input"),
      actor("hash", "hash(fox)", "Produces integer 4187", "function"),
      actor("b0", "Bucket 0", "empty", "bucket"),
      actor("b1", "Bucket 1", "cat → 92", "bucket"),
      actor("b2", "Bucket 2", "empty", "bucket"),
      actor("b3", "Bucket 3", "fox → 41", "bucket"),
    ],
    route: [["key", "hash"], ["hash", "b3"], ["b3", "b3"], ["b3", "key"]],
  },
  trees: {
    engine: "tree",
    title: "Binary-search-tree traversal",
    actors: [
      actor("n8", "8", "Root", "level-0"), actor("n4", "4", "Smaller than 8", "level-1"),
      actor("n12", "12", "Greater than 8", "level-1"), actor("n2", "2", "Left child of 4", "level-2"),
      actor("n7", "7", "Right child of 4 · target", "level-2"), actor("n10", "10", "Left child of 12", "level-2"),
      actor("n14", "14", "Right child of 12", "level-2"),
    ],
    links: [
      { from: "n8", to: "n4", label: "<" }, { from: "n8", to: "n12", label: ">" },
      { from: "n4", to: "n2", label: "<" }, { from: "n4", to: "n7", label: ">" },
      { from: "n12", to: "n10", label: "<" }, { from: "n12", to: "n14", label: ">" },
    ],
    route: [["n8", "n8"], ["n8", "n4"], ["n4", "n7"], ["n7", "n7"]],
  },
  "database-indexes": {
    engine: "tree",
    title: "B-tree index seek to a table row",
    actors: [
      actor("query", "WHERE id = 73", "Search predicate", "level-0"),
      actor("root", "Root page", "Separates broad key ranges", "level-1"),
      actor("branchA", "Keys 1–50", "Discarded range", "level-2"),
      actor("branchB", "Keys 51–100", "Chosen range", "level-2"),
      actor("leaf", "Leaf: key 73", "Stores a row locator", "level-3"),
      actor("row", "Data row", "Requested record", "level-4"),
    ],
    links: [
      { from: "query", to: "root" }, { from: "root", to: "branchA" },
      { from: "root", to: "branchB" }, { from: "branchB", to: "leaf" }, { from: "leaf", to: "row" },
    ],
    route: [["query", "query"], ["query", "root"], ["root", "leaf"], ["leaf", "row"]],
  },
  "processes-threads": {
    engine: "concurrency",
    title: "Threads competing for CPU time",
    actors: [
      actor("process", "Process memory", "Shared code, heap and handles", "shared"),
      actor("threadA", "Thread A", "Own stack and registers", "thread"),
      actor("threadB", "Thread B", "Own stack and registers", "thread"),
      actor("threadC", "Thread C", "Own stack and registers", "thread"),
      actor("scheduler", "Scheduler", "Chooses the next runnable thread", "os"),
      actor("cpu", "CPU core", "Executes one selected thread", "hardware"),
    ],
    route: [["scheduler", "process"], ["process", "threadA"], ["scheduler", "cpu"], ["cpu", "threadB"]],
  },
  "message-queues": {
    engine: "distributed",
    title: "Durable event delivery through a message broker",
    actors: [
      actor("producer", "Producer", "Creates and publishes an immutable event", "application"),
      actor("broker", "Message broker", "Accepts, persists and routes events", "infrastructure"),
      actor("queue", "Topic / queue", "Keeps ordered durable event records", "storage"),
      actor("consumer", "Consumer", "Processes events from its subscription", "application"),
      actor("database", "Consumer database", "Stores the idempotent business result", "storage"),
      actor("deadletter", "Dead-letter queue", "Isolates repeatedly failing events", "recovery"),
    ],
    links: [
      { from: "producer", to: "broker", label: "publish" },
      { from: "broker", to: "queue", label: "persist" },
      { from: "queue", to: "consumer", label: "deliver" },
      { from: "consumer", to: "database", label: "write" },
      { from: "consumer", to: "broker", label: "ack" },
      { from: "broker", to: "deadletter", label: "isolate" },
    ],
    route: [
      ["producer", "broker"], ["broker", "queue"], ["queue", "consumer"],
      ["consumer", "database"], ["consumer", "broker"], ["broker", "deadletter"],
    ],
  },
  "state-machines": {
    engine: "state-machine",
    title: "A guarded event-driven lifecycle",
    actors: [
      actor("idle", "Idle", "Waiting for a submit event", "state"),
      actor("validating", "Validating", "Checks whether the transition is allowed", "state"),
      actor("processing", "Processing", "Runs the accepted transition action", "state"),
      actor("complete", "Complete", "Terminal success state", "state"),
      actor("failed", "Rejected", "Keeps invalid input out of the success path", "state"),
    ],
    links: [
      { from: "idle", to: "validating", label: "submit" },
      { from: "validating", to: "processing", label: "valid" },
      { from: "validating", to: "failed", label: "invalid" },
      { from: "processing", to: "complete", label: "succeeded" },
      { from: "failed", to: "idle", label: "retry" },
    ],
    route: [
      ["idle", "idle"], ["idle", "validating"], ["validating", "processing"],
      ["processing", "processing"], ["processing", "complete"],
    ],
  },
  tcp: {
    engine: "protocol",
    title: "TCP end-to-end transport",
    actors: [
      actor("client", "Client", "Creates bytes and TCP state", "endpoint"),
      actor("network", "Network", "Forwards IP packets", "path"),
      actor("server", "Server", "Acknowledges and delivers bytes", "endpoint"),
    ],
    route: [["client", "client"], ["client", "server"]],
  },
};

export function visualizationForChapter(chapter: Chapter): VisualizationSpec {
  const blueprint = blueprints[chapter.slug] ?? blueprints["web-request"];
  const route = chapter.steps.map((_, index) => blueprint.route[index] ?? blueprint.route.at(-1)!);
  return {
    engine: blueprint.engine,
    title: blueprint.title,
    actors: blueprint.actors,
    links: blueprint.links ?? route.map(([from, to]) => ({ from, to })),
    events: chapter.steps.map((step, index) => ({
      id: `${chapter.slug}-${index + 1}`,
      from: route[index][0],
      to: route[index][1],
      label: step.title,
      detail: step.detail,
      state: step.state,
    })),
  };
}
