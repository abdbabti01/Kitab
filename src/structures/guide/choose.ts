// "Which structure would you use, and why?" Each scenario lists its requirements; every option is judged against
// them, so the feedback names the requirement that makes a choice good or poor. More than one choice can be good.
import type { GuideId } from "./content.ts";

export type Verdict = "good" | "workable" | "poor";
export type ChoiceOption = { id: string; label: string; verdict: Verdict; reason: string };
export type Scenario = { id: string; guide: GuideId; title: string; situation: string; requirements: string[]; options: ChoiceOption[] };

export const scenarios: Scenario[] = [
  {
    id: "user-lookup", guide: "hash-table", title: "Find a user by ID",
    situation: "A login service holds 2 million user records and looks one up by its user ID (a random string) on every request. Order never matters.",
    requirements: ["Fast lookup by an exact key", "Keys are random strings, not positions", "No ordering needed"],
    options: [
      { id: "hash", label: "Hash table (Dictionary / HashMap / dict)", verdict: "good", reason: "Exact-key lookup in expected O(1), and no ordering is needed, so nothing is lost." },
      { id: "tree", label: "Balanced search tree (SortedDictionary / TreeMap)", verdict: "workable", reason: "O(log n) is fast enough, but it pays to keep keys sorted, which nobody uses here." },
      { id: "array", label: "Array of users, scanned", verdict: "poor", reason: "Random-string IDs are not positions, so finding one is a linear scan: O(n) per request." },
      { id: "list", label: "Linked list", verdict: "poor", reason: "Same O(n) scan as the array, with worse cache behaviour." },
    ],
  },
  {
    id: "undo", guide: "stack", title: "Undo in an editor",
    situation: "Every edit can be undone, most recent first. Redo re-applies what was just undone.",
    requirements: ["Most recent first", "Only the newest item is needed", "O(1) per action"],
    options: [
      { id: "stack", label: "Two stacks (undo and redo)", verdict: "good", reason: "Undo pops the newest edit and pushes it onto the redo stack: LIFO is the requirement." },
      { id: "list", label: "Doubly linked list with a cursor", verdict: "workable", reason: "Moving a cursor back and forth works and keeps the full history, but is more code for the same behaviour." },
      { id: "queue", label: "Queue", verdict: "poor", reason: "A queue returns the oldest edit first, the opposite of undo." },
    ],
  },
  {
    id: "jobs", guide: "queue", title: "Background email jobs",
    situation: "A web server hands 'send email' jobs to a worker. Jobs must be sent in the order they were requested.",
    requirements: ["First in, first out", "O(1) add and remove", "No access to the middle"],
    options: [
      { id: "queue", label: "Queue (Queue<T> / ArrayDeque / deque)", verdict: "good", reason: "FIFO is exactly the requirement, with O(1) at both ends." },
      { id: "list-front", label: "Dynamic array, removing index 0", verdict: "poor", reason: "Each removal from the front shifts every other job: O(n) per job." },
      { id: "stack", label: "Stack", verdict: "poor", reason: "Newest first: an early job could wait forever while new ones arrive." },
    ],
  },
  {
    id: "leaderboard", guide: "binary-tree", title: "A live leaderboard",
    situation: "Scores change all day. The page shows the top 10 and 'everyone between 1000 and 2000 points'.",
    requirements: ["Frequent inserts and removals", "Sorted order", "Range queries"],
    options: [
      { id: "tree", label: "Balanced search tree (SortedSet / TreeMap)", verdict: "good", reason: "O(log n) updates while staying sorted; a range is a lower-bound search plus an in-order walk." },
      { id: "sorted-array", label: "Sorted dynamic array", verdict: "workable", reason: "Ranges are fast by binary search, but every score change shifts elements: O(n) per update." },
      { id: "hash", label: "Hash table", verdict: "poor", reason: "Keys are scattered: neither 'top 10' nor a range can be answered without sorting everything." },
      { id: "bst", label: "Hand-written BST without balancing", verdict: "poor", reason: "Scores often arrive in rising order, which turns it into an O(n) chain." },
    ],
  },
  {
    id: "readings", guide: "array", title: "Plot sensor readings",
    situation: "A million temperature readings are loaded once, then a chart reads them by position, over and over.",
    requirements: ["Read by position", "Sequential scans", "No inserts after loading"],
    options: [
      { id: "array", label: "Array / dynamic array", verdict: "good", reason: "O(1) access by index and the fastest sequential scan (contiguous, cache-friendly)." },
      { id: "list", label: "Linked list", verdict: "poor", reason: "Reading position i walks i nodes: O(n) per read." },
      { id: "hash", label: "Hash table keyed by position", verdict: "workable", reason: "It works, but hashing a key that is already a dense index wastes time and memory." },
    ],
  },
  {
    id: "lru", guide: "linked-list", title: "An LRU cache",
    situation: "A cache holds 10,000 entries. get(key) must be O(1); when full, the least recently used entry is evicted in O(1).",
    requirements: ["O(1) lookup by key", "O(1) 'move to most recent'", "O(1) eviction of the oldest"],
    options: [
      { id: "hash-list", label: "Hash map + doubly linked list", verdict: "good", reason: "The map finds a key's node in O(1); the list moves that node to the front and evicts the tail in O(1)." },
      { id: "hash", label: "Hash map alone", verdict: "poor", reason: "Lookup is O(1), but it records no recency, so finding the least recently used entry is a scan." },
      { id: "list", label: "Linked list alone", verdict: "poor", reason: "Keeps recency order, but finding a key is an O(n) walk." },
    ],
  },
  {
    id: "friends", guide: "graph", title: "Degrees of separation",
    situation: "A social network asks: how few friendship links connect two people?",
    requirements: ["Relationships between people", "Fewest hops (unweighted)", "Cycles exist"],
    options: [
      { id: "bfs", label: "Graph + breadth-first search", verdict: "good", reason: "On an unweighted graph BFS reaches each person by a shortest path in edges; the visited set handles cycles." },
      { id: "dfs", label: "Graph + depth-first search", verdict: "workable", reason: "Finds whether they are connected, but the first path it finds may be long." },
      { id: "tree", label: "Tree", verdict: "poor", reason: "Friendships form cycles and many-to-many links, which a tree cannot represent." },
    ],
  },
  {
    id: "folders", guide: "recursion", title: "Total size of a folder",
    situation: "Compute the size of a folder including every nested sub-folder. Some trees are thousands of levels deep.",
    requirements: ["Nested structure", "Visit everything once", "Deep inputs must not crash"],
    options: [
      { id: "stack", label: "Loop with an explicit stack", verdict: "good", reason: "Visits everything once and is limited only by heap memory, so very deep trees are safe." },
      { id: "recursion", label: "Recursive function", verdict: "workable", reason: "The clearest code, but thousands of nested calls can overflow the call stack in C#, Java or Python." },
      { id: "hash", label: "Hash table", verdict: "poor", reason: "It stores and finds items; it says nothing about how to walk a hierarchy." },
    ],
  },
];

export const verdictWords: Record<Verdict, string> = { good: "A good fit", workable: "Workable, with a cost", poor: "A poor fit" };

/** Feedback for one pick: its verdict and reason, plus every other option the requirements also justify. */
export function judge(scenario: Scenario, optionId: string) {
  const picked = scenario.options.find((option) => option.id === optionId);
  if (!picked) return null;
  return { picked, alsoGood: scenario.options.filter((option) => option.verdict === "good" && option.id !== optionId) };
}
