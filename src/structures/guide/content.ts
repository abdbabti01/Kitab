// Reviewed teaching content for each data structure: what it is, why it exists, when to use and avoid it, its
// conceptual memory model, what C#, Java and Python actually store, and what each operation costs. Data only.
//
// Accuracy rules (see docs/DATA-STRUCTURES-PLAYGROUND.md): runtime facts say whether they are guaranteed by the
// language/library or an implementation detail of one runtime; no fixed byte sizes for Python objects; no claim that
// value types always live on the stack; no claim that a garbage collector has run when only reachability changed.
import type { StructureKind } from "../../visual-engine/data-structures/model.ts";

export type GuideId = StructureKind | "recursion";
export type Lang = "csharp" | "java" | "python";

export const languages: { id: Lang; label: string }[] = [
  { id: "csharp", label: "C#" },
  { id: "java", label: "Java" },
  { id: "python", label: "Python" },
];

/** One operation's cost. `typical` is the average or expected case; `amortized` only where it applies. */
export type Cost = {
  operation: string;
  best: string;
  typical: string;
  worst: string;
  amortized?: string;
  /** Extra memory the operation itself needs, beyond the structure. */
  extra: string;
  why: string;
  /** What must be true for the stated costs. */
  assumes?: string;
};

/** A runtime fact, marked by how far it can be relied on. */
export type RuntimeFact = { text: string; basis: "guaranteed" | "implementation" | "concept" };

export type Guide = {
  id: GuideId;
  title: string;
  what: string;
  why: string;
  use: { title: string; detail: string }[];
  avoid: { title: string; instead: string }[];
  how: string[];
  memory: { summary: string; points: string[] };
  runtime: Record<Lang, { types: string; facts: RuntimeFact[] }>;
  storage: string;
  costs: Cost[];
  tradeoffs: string[];
};

export const guides: Record<GuideId, Guide> = {
  array: {
    id: "array",
    title: "Arrays and dynamic arrays",
    what: "An array stores elements in one block of equal-size slots, one after another. Each element is identified by its index: its position counted from 0. A dynamic array (C# List<T>, Java ArrayList, Python list) is an array that can grow: it keeps a block with some spare slots and moves to a bigger block when they run out.",
    why: "Because every slot has the same size and the slots are adjacent, the address of index i is base + i × slot size: one calculation reaches any index, however long the array is. Adjacent slots also suit the processor's cache, so walking through an array in order is usually very fast in practice.",
    use: [
      { title: "A catalogue shown page by page", detail: "Products loaded once and read by position (item 0–19 for page 1, 20–39 for page 2): indexed reads are O(1) and a sequential scan is cache-friendly." },
      { title: "Collecting results, then processing them in order", detail: "Appending to a dynamic array is amortized O(1), and the finished list is read front to back." },
      { title: "Lookup tables indexed by a small integer", detail: "Days of the month, pixels in a row, buckets in a hash table: the index is the key, so no search is needed." },
    ],
    avoid: [
      { title: "Frequent inserts or removals at the front or middle of a large collection", instead: "Every later element shifts. Use a deque for both ends, or a linked list when you already hold a reference to the neighbouring node." },
      { title: "Finding items by a key that is not their position", instead: "A linear search is O(n). Use a hash table (dictionary) for exact keys, or a balanced tree for sorted keys and ranges." },
    ],
    how: [
      "Indexing: check that 0 ≤ i < length (C#, Java and Python all reject other indexes), then read the slot at base + i × size.",
      "Insert at index i: if length = capacity, grow first; then shift elements i … length − 1 one slot right (from the end backwards), write the new value, and add 1 to the length.",
      "Delete at index i: shift elements i + 1 … length − 1 one slot left, then subtract 1 from the length. The capacity does not shrink.",
      "Grow: allocate a larger block (Kitab doubles it), copy every element, then point the array at the new block. The old block becomes unreachable.",
    ],
    memory: {
      summary: "One contiguous block of slots, plus two numbers: the length (how many slots hold elements) and the capacity (how many slots the block has). Slots beyond the length are reserved but are not part of the array.",
      points: [
        "Length ≤ capacity. Indexes 0 … length − 1 are valid; spare slots exist only to make appends cheap.",
        "Growing never resizes the block in place: a new block is allocated and every element is copied. References to the old block's memory are then stale.",
        "A slot holds either the value itself (an array of ints in C# or Java) or a reference to an object stored elsewhere (an array of strings, Java's ArrayList<Integer>, every Python list).",
        "The addresses in Kitab are invented for teaching. Real addresses are chosen by the runtime's allocator and differ from run to run.",
      ],
    },
    runtime: {
      csharp: {
        types: "int[], List<T>",
        facts: [
          { basis: "guaranteed", text: "int[] is a fixed-length array object; its elements are stored inline in the array, which lives on the managed heap. Every index is bounds-checked (IndexOutOfRangeException)." },
          { basis: "guaranteed", text: "List<T> wraps a T[] backing array plus a Count. Add is amortized O(1); Insert and RemoveAt shift later elements with Array.Copy, O(n)." },
          { basis: "guaranteed", text: "Generics are specialized for value types, so List<int> stores ints directly in its backing array, with no boxing. A List<string> stores references to string objects." },
          { basis: "implementation", text: "Current .NET grows a List<T> to double its capacity (4 slots on the first Add). The exact policy is not part of the contract; read Capacity rather than assume it." },
          { basis: "concept", text: "Value types are not 'always on the stack': an int inside an array or object lives inside that array or object on the heap." },
        ],
      },
      java: {
        types: "int[], ArrayList<E>",
        facts: [
          { basis: "guaranteed", text: "int[] stores primitive ints inside the array object; arrays are fixed-length and bounds-checked (ArrayIndexOutOfBoundsException)." },
          { basis: "guaranteed", text: "ArrayList<Integer> cannot hold primitive ints: its backing Object[] holds references to Integer objects. Adding an int boxes it (Integer.valueOf caches −128 … 127)." },
          { basis: "guaranteed", text: "add(e) is amortized constant time; add(i, e) and remove(i) shift later elements, O(n). list.remove(0) removes index 0; list.remove(Integer.valueOf(0)) removes the value 0." },
          { basis: "implementation", text: "OpenJDK grows an ArrayList by about 1.5× (newCapacity = old + old/2). Capacity is not observable through the List API." },
        ],
      },
      python: {
        types: "list, array.array",
        facts: [
          { basis: "concept", text: "A list holds references to Python objects, never raw integers. [8, 3, 12] is a block of three references to three int objects." },
          { basis: "implementation", text: "CPython's list is a dynamic array of object pointers that over-allocates on append, so append is amortized O(1) while insert(0, x) and pop(0) are O(n). Other runtimes may differ (PyPy can store a list of small ints unboxed)." },
          { basis: "guaranteed", text: "array.array('i', ...) and bytes store raw numbers in one buffer; use them (or NumPy) when compact numeric storage matters." },
          { basis: "concept", text: "Python does not expose addresses or capacity; id() is an identity number, and in CPython happens to be an address, but programs must not rely on that." },
        ],
      },
    },
    storage: "O(n) for the elements, plus up to (capacity − length) spare slots in a dynamic array.",
    costs: [
      { operation: "Read or write by index", best: "O(1)", typical: "O(1)", worst: "O(1)", extra: "O(1)", why: "One address calculation and one memory access, whatever the length." },
      { operation: "Append (insert at the end)", best: "O(1)", typical: "O(1)", worst: "O(n)", amortized: "O(1)", extra: "O(n) during growth", why: "Usually a spare slot is filled. When the block is full, all n elements are copied into a bigger block; doubling makes that rare enough that n appends cost O(n) in total.", assumes: "The capacity grows by a constant factor (×2 in Kitab), not by a fixed number of slots." },
      { operation: "Insert or delete at index i", best: "O(1) at the end", typical: "O(n)", worst: "O(n)", extra: "O(1)", why: "The n − i elements after the position shift by one slot each." },
      { operation: "Search for a value", best: "O(1)", typical: "O(n)", worst: "O(n)", extra: "O(1)", why: "Without ordering, every element may need a comparison. A sorted array allows binary search in O(log n)." },
    ],
    tradeoffs: ["Fastest random access and iteration of any structure here.", "Insert and delete in the middle cost shifts.", "Growth occasionally copies everything; the spare capacity costs memory."],
  },

  "linked-list": {
    id: "linked-list",
    title: "Linked lists",
    what: "A linked list is a chain of nodes. Each node stores a value and a reference (pointer) to the next node; a doubly linked list also stores a reference to the previous node. The list itself only remembers the first node (HEAD) and often the last (tail).",
    why: "Nodes are separate objects, so inserting or removing next to a node you already have changes only a couple of references: nothing shifts. That makes a linked list useful when a program keeps references to nodes and reorders them often.",
    use: [
      { title: "An LRU (least recently used) cache", detail: "A hash map finds a key's node in O(1); a doubly linked list keeps the nodes in recency order, so moving a node to the front or evicting the tail is O(1)." },
      { title: "Editors and schedulers that splice sequences", detail: "Moving a block of items to another position is a few reference writes once both positions are known." },
    ],
    avoid: [
      { title: "Reading the i-th element, or scanning large collections", instead: "Reaching index i walks i nodes, and nodes scattered in memory defeat the cache. A dynamic array is faster for both, often even for insertions in practice." },
      { title: "Insert 'at index i' when you don't already hold a node", instead: "Finding the position is O(n) first: the O(1) relink only helps when the node is already known." },
    ],
    how: [
      "Traverse: start at HEAD and follow next until the node is found or next is null.",
      "Insert after a node: allocate the new node, set new.next = node.next, then set node.next = new (in that order, so nothing becomes unreachable). At the head: new.next = HEAD, then HEAD = new.",
      "Delete: find the predecessor, then set predecessor.next = target.next. The target is no longer reachable from HEAD.",
    ],
    memory: {
      summary: "Each node is its own object, wherever the allocator put it. The only order is the order of the references: HEAD → node → node → null.",
      points: [
        "Every node pays for its value plus one reference (two for a doubly linked list), plus the object overhead of the runtime.",
        "No node ever moves when the list changes: inserting and deleting only rewrite references.",
        "An unlinked node is unreachable. In .NET, Java and Python it becomes eligible for garbage collection; when (or whether) it is reclaimed is up to the runtime. In C it would be freed explicitly.",
      ],
    },
    runtime: {
      csharp: {
        types: "LinkedList<T>, LinkedListNode<T>",
        facts: [
          { basis: "guaranteed", text: "LinkedList<T> is doubly linked. AddFirst, AddLast, AddBefore/AddAfter(node) and Remove(node) are O(1); Find(value) is O(n)." },
          { basis: "guaranteed", text: "Each LinkedListNode<T> is a separate heap object holding the value and references to the list, next and previous nodes." },
          { basis: "concept", text: "A custom class Node { int Value; Node? Next; } is a reference type: a variable of type Node holds a reference, and two variables can refer to the same node." },
        ],
      },
      java: {
        types: "LinkedList<E>",
        facts: [
          { basis: "guaranteed", text: "LinkedList<E> is doubly linked and also implements Deque. get(i) walks from the nearer end, O(n)." },
          { basis: "guaranteed", text: "A ListIterator gives O(1) add and remove at its cursor, which is how to splice without re-walking." },
          { basis: "concept", text: "Each node is an object holding references to the element and to its neighbours; a LinkedList<Integer> adds an Integer object per element on top." },
          { basis: "implementation", text: "ArrayDeque is usually faster than LinkedList for stack and queue use: it is array-backed and cache-friendly." },
        ],
      },
      python: {
        types: "custom Node class, collections.deque",
        facts: [
          { basis: "guaranteed", text: "Python has no general linked list type. A class with value and next attributes builds one; each node is an object." },
          { basis: "guaranteed", text: "collections.deque gives O(1) appends and pops at both ends; indexing in the middle is O(n)." },
          { basis: "implementation", text: "CPython's deque is a doubly linked list of fixed-size blocks of references, not one node per element." },
        ],
      },
    },
    storage: "O(n) nodes, each with one (singly) or two (doubly) references besides the value.",
    costs: [
      { operation: "Access the i-th element", best: "O(1) at the head", typical: "O(n)", worst: "O(n)", extra: "O(1)", why: "There is no address arithmetic: reaching position i follows i references." },
      { operation: "Insert or delete next to a known node", best: "O(1)", typical: "O(1)", worst: "O(1)", extra: "O(1)", why: "Two reference writes to insert, one to unlink (singly linked, given the predecessor)." },
      { operation: "Insert at the head; append with a tail reference", best: "O(1)", typical: "O(1)", worst: "O(1)", extra: "O(1)", why: "The end is already known.", assumes: "Appending is O(n) if the list keeps no tail reference." },
      { operation: "Insert or delete by position or value", best: "O(1)", typical: "O(n)", worst: "O(n)", extra: "O(1)", why: "The walk to find the place dominates; the relink itself is O(1)." },
    ],
    tradeoffs: ["Cheap relinking when you hold the node.", "Slow access by position and poor cache locality.", "More memory per element than an array."],
  },

  stack: {
    id: "stack",
    title: "Stacks",
    what: "A stack is a collection with one rule: the last element pushed is the first one popped (LIFO, last in, first out). You can only push onto the top, pop from the top, or peek at the top.",
    why: "Many problems are naturally 'most recent first': undoing the latest change, matching the latest open bracket, returning to the place you came from. The restriction makes those programs simpler and every operation O(1).",
    use: [
      { title: "Undo history", detail: "Each edit is pushed; Undo pops the most recent one." },
      { title: "Checking brackets or evaluating expressions", detail: "Push each opening bracket; a closing bracket must match the top." },
      { title: "Depth-first traversal without recursion", detail: "An explicit stack replaces the call stack, so a deep tree cannot overflow it." },
    ],
    avoid: [
      { title: "Work that must be handled in arrival order", instead: "A stack serves the newest first, so old work can wait forever. Use a queue." },
      { title: "Searching or reading the middle", instead: "Only the top is accessible; use an array or a hash table if you need more." },
    ],
    how: [
      "Push: write the value into the slot above TOP, then move TOP up (array-backed), or link a new node in front of the top (linked).",
      "Pop: read the top value, then move TOP down. Popping an empty stack is an underflow: C# and Java throw, Python's list.pop raises IndexError.",
      "The abstract stack is not the call stack: Stack<T> or a Python list is an ordinary object on the heap, while the call stack holds the frames of running function calls.",
    ],
    memory: {
      summary: "Kitab draws an array-backed stack: elements in slots from the bottom up, plus a TOP marker. A linked stack is a chain whose head is the top.",
      points: ["Push and pop never move other elements.", "An array-backed stack grows like a dynamic array (amortized O(1) push); Kitab does not show that growth."],
    },
    runtime: {
      csharp: {
        types: "Stack<T>",
        facts: [
          { basis: "guaranteed", text: "Stack<T> is array-backed: Push is amortized O(1), Pop and Peek O(1). Pop or Peek on an empty stack throws InvalidOperationException; TryPop and TryPeek do not." },
          { basis: "concept", text: "Stack<T> lives on the managed heap like any other object. It is unrelated to the thread's call stack." },
        ],
      },
      java: {
        types: "ArrayDeque<E> (as a stack)",
        facts: [
          { basis: "guaranteed", text: "Use Deque<E> stack = new ArrayDeque<>(): push, pop and peek work on the first element. pop() on an empty deque throws NoSuchElementException; poll() and peek() return null." },
          { basis: "guaranteed", text: "The legacy java.util.Stack extends Vector (synchronized); the Java documentation recommends Deque instead. ArrayDeque does not accept null elements." },
        ],
      },
      python: {
        types: "list (as a stack)",
        facts: [
          { basis: "guaranteed", text: "A list is the usual stack: append to push, pop() to pop, items[-1] to peek. pop() on an empty list raises IndexError." },
          { basis: "implementation", text: "In CPython, append and pop() at the end are amortized O(1); pop(0) would be O(n)." },
        ],
      },
    },
    storage: "O(n).",
    costs: [
      { operation: "Push", best: "O(1)", typical: "O(1)", worst: "O(n) when an array-backed stack grows", amortized: "O(1)", extra: "O(1)", why: "One write and a marker update; growth copies occasionally." },
      { operation: "Pop / peek", best: "O(1)", typical: "O(1)", worst: "O(1)", extra: "O(1)", why: "The top is always known." },
      { operation: "Search", best: "O(1)", typical: "O(n)", worst: "O(n)", extra: "O(1)", why: "A stack is not built for search; finding a value means looking through it." },
    ],
    tradeoffs: ["Every operation O(1).", "Only the newest element is accessible."],
  },

  queue: {
    id: "queue",
    title: "Queues",
    what: "A queue serves elements in the order they arrived: the first element enqueued is the first one dequeued (FIFO, first in, first out). New elements join at the rear; they leave from the front.",
    why: "Fairness and order: jobs, requests and messages should be handled in the order they came in. Breadth-first search relies on the same property to visit vertices in order of distance.",
    use: [
      { title: "Background jobs", detail: "A web server enqueues 'send email' jobs; a worker dequeues and runs them in order." },
      { title: "Breadth-first search", detail: "Vertices wait in a queue so that all vertices one edge away are visited before any two edges away." },
      { title: "Buffering between a producer and a consumer", detail: "A fixed-size ring buffer smooths out bursts (keyboard input, audio samples)." },
    ],
    avoid: [
      { title: "Most-recent-first processing", instead: "Use a stack." },
      { title: "Serving the most urgent item first", instead: "Use a priority queue (a heap: PriorityQueue in C# and Java, heapq in Python)." },
    ],
    how: [
      "Enqueue: write at the rear and advance REAR. Dequeue: read at the front and advance FRONT. Nothing in between moves.",
      "Shifting every element left on each dequeue would make it O(n). Array-backed queues avoid that with a ring buffer: FRONT and REAR wrap around to slot 0 when they reach the end of the block.",
      "A linked queue keeps head and tail references: enqueue links after the tail, dequeue moves the head.",
      "A queue in memory is not a message broker. Broker queues (RabbitMQ, SQS, Kafka) add durability, acknowledgements, redelivery and multiple consumers; the FIFO idea is only the start.",
    ],
    memory: {
      summary: "Kitab draws an array-backed queue with FRONT and REAR markers. A dequeue moves FRONT; it does not shift the remaining elements.",
      points: ["Kitab does not show wrap-around or growth; the C#, Java and Python examples below include a ring buffer that does."],
    },
    runtime: {
      csharp: {
        types: "Queue<T>",
        facts: [
          { basis: "guaranteed", text: "Queue<T> is a circular array: Enqueue amortized O(1), Dequeue and Peek O(1). Dequeue on an empty queue throws InvalidOperationException; TryDequeue does not." },
          { basis: "guaranteed", text: "PriorityQueue<TElement, TPriority> (since .NET 6) is a heap, not a FIFO queue." },
        ],
      },
      java: {
        types: "ArrayDeque<E> (as a queue)",
        facts: [
          { basis: "guaranteed", text: "Queue<E> q = new ArrayDeque<>(): offer adds at the tail, poll removes from the head (null when empty), peek reads it. ArrayDeque is a resizable circular array." },
          { basis: "guaranteed", text: "LinkedList also implements Queue, but allocates a node per element." },
        ],
      },
      python: {
        types: "collections.deque",
        facts: [
          { basis: "guaranteed", text: "deque.append and deque.popleft are O(1). list.pop(0) is O(n) because every remaining reference shifts." },
          { basis: "guaranteed", text: "queue.Queue adds locking for threads; asyncio.Queue for coroutines. Both are FIFO wrappers, not separate algorithms." },
        ],
      },
    },
    storage: "O(n); a fixed ring buffer reserves its capacity up front.",
    costs: [
      { operation: "Enqueue", best: "O(1)", typical: "O(1)", worst: "O(n) when an array-backed queue grows", amortized: "O(1)", extra: "O(1)", why: "One write at REAR; growth copies occasionally." },
      { operation: "Dequeue / peek", best: "O(1)", typical: "O(1)", worst: "O(1)", extra: "O(1)", why: "FRONT moves; nothing shifts.", assumes: "A ring buffer or linked queue. A plain array that shifts on dequeue costs O(n)." },
    ],
    tradeoffs: ["O(1) at both ends, order preserved.", "No access to the middle."],
  },

  "hash-table": {
    id: "hash-table",
    title: "Hash tables (dictionaries and sets)",
    what: "A hash table stores keys (and usually a value for each key) in an array of buckets. A hash function turns the key into a number; that number, reduced to the bucket count, picks the bucket. Dictionaries and maps store key → value pairs; sets store keys only.",
    why: "Finding a key does not need a search through every element: compute the bucket, then compare only the few keys that landed there. With a good hash function and a controlled load factor that takes expected O(1) time.",
    use: [
      { title: "Find a user by ID", detail: "users[id] in a dictionary is one hash and a few comparisons, however many users there are." },
      { title: "Caching", detail: "Store computed results by their input; check the cache before recomputing." },
      { title: "Removing duplicates", detail: "Add every item to a set; an item already present is a duplicate." },
    ],
    avoid: [
      { title: "When you need sorted order or ranges (all prices from 10 to 20)", instead: "A hash table scatters keys. Use a balanced tree (SortedDictionary, TreeMap) or sort the keys." },
      { title: "When keys are small dense integers (0 … n − 1)", instead: "A plain array indexed by the key is simpler and faster." },
    ],
    how: [
      "Hash: compute the key's hash code. Equal keys must give equal hash codes; different keys may collide.",
      "Pick a bucket: reduce the hash to 0 … buckets − 1 (Kitab uses key mod 7).",
      "Resolve collisions: separate chaining keeps a list per bucket (Kitab's model); open addressing probes other slots of the same array instead.",
      "Compare keys with equality inside the bucket: the hash only narrows the search.",
      "Resize: when the load factor (keys ÷ buckets) passes a threshold, real tables allocate more buckets and re-insert every key (rehash). Kitab's table never resizes.",
    ],
    memory: {
      summary: "An array of buckets; in Kitab each bucket holds a chain of keys. The load factor is keys ÷ buckets.",
      points: [
        "Kitab's rule (key mod 7, chaining, no resize) is a teaching model. .NET, Java and CPython each use a different hash spreading, bucket count and collision strategy.",
        "Mutating a key after inserting it (so its hash changes) leaves it in the wrong bucket: lookups stop finding it.",
        "Negative keys: C# and Java's % can return a negative result, so real code normalizes it (Java Math.floorMod); Python's % is never negative for a positive divisor.",
      ],
    },
    runtime: {
      csharp: {
        types: "Dictionary<TKey, TValue>, HashSet<T>",
        facts: [
          { basis: "guaranteed", text: "Keys are compared with GetHashCode and Equals (or a supplied IEqualityComparer). Overriding one without the other breaks lookups; records generate both." },
          { basis: "guaranteed", text: "Lookup, add and remove approach O(1) when the hash spreads keys well; TryGetValue avoids a second lookup." },
          { basis: "implementation", text: "Current .NET uses chaining through arrays: a bucket array of indexes into an entries array whose entries link to the next entry with the same bucket. Bucket counts are primes and it resizes when the entries array is full." },
          { basis: "guaranteed", text: "Enumeration order of a Dictionary is not defined; do not rely on it. SortedDictionary is a red-black tree when order matters." },
        ],
      },
      java: {
        types: "HashMap<K, V>, HashSet<E>",
        facts: [
          { basis: "guaranteed", text: "Keys use hashCode and equals; the contract requires equal objects to have equal hash codes. Records and String implement both." },
          { basis: "guaranteed", text: "Default load factor 0.75: when size exceeds capacity × 0.75 the table doubles and every entry is redistributed." },
          { basis: "implementation", text: "OpenJDK's HashMap chains entries per bin and converts a bin that grows past a threshold (8 entries) into a red-black tree once the table has at least 64 bins, bounding the worst case near O(log n) for comparable keys." },
          { basis: "guaranteed", text: "HashSet is backed by a HashMap. Iteration order is unspecified; LinkedHashMap keeps insertion order." },
        ],
      },
      python: {
        types: "dict, set",
        facts: [
          { basis: "guaranteed", text: "dict keys must be hashable; a == b must imply hash(a) == hash(b). Mutable built-ins (list, dict, set) are not hashable." },
          { basis: "guaranteed", text: "Since Python 3.7 a dict preserves insertion order; a set does not promise any order." },
          { basis: "implementation", text: "CPython uses open addressing (probing), not chaining: a compact index table pointing into a dense array of entries, resized to keep it at most about two-thirds full." },
          { basis: "implementation", text: "str and bytes hashes are randomized per process (PYTHONHASHSEED), so set order can differ between runs." },
        ],
      },
    },
    storage: "O(n) entries plus the bucket array, which is kept larger than n to hold the load factor down.",
    costs: [
      { operation: "Find, insert, delete", best: "O(1)", typical: "O(1) expected", worst: "O(n)", extra: "O(1)", why: "Expected O(1): the hash spreads keys so each bucket holds a few. Worst case: every key collides into one bucket and the chain is scanned.", assumes: "A hash function that spreads the keys and a bounded load factor." },
      { operation: "Insert that triggers a resize", best: "—", typical: "O(n)", worst: "O(n)", amortized: "O(1)", extra: "O(n)", why: "Every key is re-hashed into the bigger bucket array; growing by a constant factor keeps the average per insert constant." },
      { operation: "List keys in sorted order", best: "O(n log n)", typical: "O(n log n)", worst: "O(n log n)", extra: "O(n)", why: "The table keeps no order, so the keys must be sorted separately." },
    ],
    tradeoffs: ["Fastest lookup by exact key on average.", "No ordering, no range queries.", "Needs a good hash and correct equality."],
  },

  "binary-tree": {
    id: "binary-tree",
    title: "Trees and binary search trees",
    what: "A tree is a hierarchy of nodes: one root, and every other node has exactly one parent. In a binary tree each node has at most a left and a right child. A binary search tree (BST) adds an ordering rule: everything in a node's left subtree is smaller than it, everything in its right subtree larger.",
    why: "The ordering rule lets every comparison discard a whole subtree. In a balanced tree that halves the remaining nodes at each step, so search, insert and delete take O(log n), and an in-order walk lists the keys in sorted order — which a hash table cannot do.",
    use: [
      { title: "A sorted collection that changes often", detail: "A leaderboard or a price index: insert and delete in O(log n) while keeping everything in order." },
      { title: "Range queries", detail: "All orders between two dates: find the lower bound, then walk in order until the upper bound." },
      { title: "Hierarchies", detail: "File systems, the HTML DOM, organization charts and parsed expressions are trees (not necessarily binary or ordered)." },
    ],
    avoid: [
      { title: "Exact-key lookup only, order irrelevant", instead: "A hash table is O(1) expected instead of O(log n)." },
      { title: "A hand-written BST fed sorted or nearly sorted input", instead: "It degenerates into a chain with O(n) operations. Use the library's self-balancing tree." },
    ],
    how: [
      "Search: compare with the current node; go left if smaller, right if larger; stop at a match or at a null branch.",
      "Insert: search for the value; the null branch where the search ends is where the new node is attached.",
      "Delete a leaf: set its parent's pointer to null. One child: point the parent at that child. Two children: copy the in-order successor's value (the smallest value in the right subtree) into the node, then delete the successor, which has at most one child.",
      "Balance: AVL and red-black trees rotate subtrees after inserts and deletes to keep the height O(log n). Kitab's tree never rebalances, so you can see what happens without it.",
    ],
    memory: {
      summary: "Each node is a separate object holding a value and two child references; the tree remembers only its root. Height (edges on the longest root-to-leaf path) bounds every operation.",
      points: [
        "Nodes never move in memory: inserting and deleting rewrite child references (and, for a node with two children, one value).",
        "A database B-tree is a different structure: each node holds many keys and many children so the tree is very shallow and each node fills a disk page. Same idea (ordered search), different trade-offs.",
      ],
    },
    runtime: {
      csharp: {
        types: "SortedSet<T>, SortedDictionary<TKey, TValue>",
        facts: [
          { basis: "guaranteed", text: "SortedSet<T> and SortedDictionary are self-balancing (red-black) trees: Add, Remove and Contains are O(log n), enumeration is in sorted order." },
          { basis: "guaranteed", text: "SortedSet.GetViewBetween(lower, upper) gives a range view; Min and Max are available directly." },
          { basis: "guaranteed", text: "SortedList<TKey, TValue> is not a tree: it is two sorted arrays, with O(n) insertion." },
        ],
      },
      java: {
        types: "TreeSet<E>, TreeMap<K, V>",
        facts: [
          { basis: "guaranteed", text: "TreeMap and TreeSet are red-black trees with guaranteed O(log n) get, put and remove." },
          { basis: "guaranteed", text: "Navigation methods: floor, ceiling, subSet/subMap, headSet, tailSet, first, last." },
          { basis: "guaranteed", text: "Keys are ordered by Comparable or a Comparator, which must be consistent with equals for Set semantics to hold." },
        ],
      },
      python: {
        types: "bisect on a sorted list; custom Node class",
        facts: [
          { basis: "guaranteed", text: "The standard library has no balanced search tree. bisect finds positions in a sorted list in O(log n), but bisect.insort still shifts elements, O(n)." },
          { basis: "concept", text: "For a large, frequently changing sorted collection, a third-party library (for example sortedcontainers) or a database index is the usual choice." },
          { basis: "implementation", text: "A recursive tree walk in CPython is limited by sys.getrecursionlimit() (1000 by default), so very deep, unbalanced trees need an iterative walk." },
        ],
      },
    },
    storage: "O(n) nodes, each with two child references (plus balance data in AVL or red-black trees).",
    costs: [
      { operation: "Search, insert, delete", best: "O(1)", typical: "O(log n) balanced", worst: "O(n) unbalanced", extra: "O(1) iterative, O(h) recursive", why: "One comparison per level: the cost is the height h. Balanced trees keep h ≈ log₂ n; sorted insertion into a plain BST makes h = n − 1.", assumes: "O(log n) worst case only for self-balancing trees (AVL, red-black)." },
      { operation: "Minimum / maximum", best: "O(1)", typical: "O(log n)", worst: "O(h)", extra: "O(1)", why: "Follow left (or right) pointers to the end." },
      { operation: "In-order traversal (sorted output)", best: "O(n)", typical: "O(n)", worst: "O(n)", extra: "O(h)", why: "Every node is visited once; the recursion or explicit stack holds one entry per level." },
    ],
    tradeoffs: ["Keeps keys sorted with O(log n) updates when balanced.", "Slower than hashing for exact lookups.", "An unbalanced BST can be as slow as a list."],
  },

  graph: {
    id: "graph",
    title: "Graphs",
    what: "A graph is a set of vertices (nodes) joined by edges. Edges can be directed (one way: A follows B) or undirected (both ways: A is friends with B), and weighted (a distance or cost) or unweighted. Trees and linked lists are special kinds of graph.",
    why: "Many real problems are about relationships rather than collections: which computers can reach each other, which package depends on which, the fewest hops between two people. Graph traversals answer those questions systematically.",
    use: [
      { title: "Dependency order", detail: "Build systems and package managers traverse a directed graph of dependencies (a topological order) before building anything." },
      { title: "Reachability in a network", detail: "Can host A reach host B? A BFS or DFS from A answers it in O(V + E)." },
      { title: "Fewest hops", detail: "Degrees of separation, minimum number of transfers: BFS on an unweighted graph gives shortest paths in edges." },
    ],
    avoid: [
      { title: "Shortest paths when edges have different weights", instead: "BFS counts edges, not distance. Use Dijkstra's algorithm (non-negative weights) or Bellman-Ford." },
      { title: "Dense graphs stored as adjacency lists when you constantly ask 'is there an edge from u to v?'", instead: "An adjacency matrix answers that in O(1), at O(V²) memory." },
    ],
    how: [
      "Representation: an adjacency list maps each vertex to its neighbours (O(V + E) memory); an adjacency matrix has a V × V grid of edge flags (O(V²)).",
      "Breadth-first search: a queue of vertices to visit; mark a vertex visited when it is enqueued so it is never enqueued twice. Vertices come out in order of distance in edges.",
      "Depth-first search: a stack (or recursion) instead of a queue, so the search follows one path as deep as it can before backtracking.",
      "The visited set is what stops a cycle from looping forever.",
    ],
    memory: {
      summary: "Kitab stores the graph as an adjacency list. During a traversal there are two more structures: the visited set and the frontier (BFS's queue or DFS's stack).",
      points: ["Kitab's graph is fixed and undirected with one cycle and one isolated vertex; every traversal starts at vertex 1."],
    },
    runtime: {
      csharp: {
        types: "Dictionary<int, List<int>>, Queue<T>, Stack<T>, HashSet<T>",
        facts: [
          { basis: "guaranteed", text: "There is no general graph type in the base library; an adjacency list is a Dictionary from vertex to a List of neighbours." },
          { basis: "guaranteed", text: "PriorityQueue<TElement, TPriority> (since .NET 6) is the usual heap for Dijkstra's algorithm." },
        ],
      },
      java: {
        types: "Map<Integer, List<Integer>>, ArrayDeque<E>, HashSet<E>",
        facts: [
          { basis: "guaranteed", text: "No graph type in the JDK; build an adjacency list from Map and List. ArrayDeque serves as both the BFS queue and the DFS stack." },
          { basis: "concept", text: "Map<Integer, List<Integer>> boxes every vertex number; for very large graphs, int arrays (compressed adjacency) save memory." },
        ],
      },
      python: {
        types: "dict of lists or sets, collections.deque",
        facts: [
          { basis: "guaranteed", text: "An adjacency list is a dict mapping each vertex to a list (or set) of neighbours; deque is the BFS queue, a list the DFS stack." },
          { basis: "implementation", text: "A recursive DFS in CPython hits RecursionError on paths deeper than the recursion limit (1000 by default); the iterative version does not." },
        ],
      },
    },
    storage: "O(V + E) as an adjacency list; O(V²) as an adjacency matrix.",
    costs: [
      { operation: "BFS or DFS over the reachable part", best: "O(1) if the start is the target", typical: "O(V + E)", worst: "O(V + E)", extra: "O(V) for the visited set and frontier", why: "Each vertex is visited at most once and each edge examined at most twice (once from each end, undirected).", assumes: "An adjacency list. With a matrix, finding neighbours costs O(V) per vertex: O(V²) total." },
      { operation: "Is there an edge u–v?", best: "O(1)", typical: "O(degree of u)", worst: "O(V)", extra: "O(1)", why: "Scan u's neighbour list; a matrix or a set of neighbours makes it O(1)." },
    ],
    tradeoffs: ["Models arbitrary relationships.", "Algorithms depend on the question: BFS for fewest edges, Dijkstra for weighted distance, topological sort for dependencies."],
  },

  recursion: {
    id: "recursion",
    title: "Recursion and the call stack",
    what: "A recursive function solves a problem by calling itself on a smaller version of the same problem. Every recursion needs a base case: an input small enough to answer directly, without another call.",
    why: "Problems whose structure is recursive — a tree is a node plus smaller trees, a folder contains folders — are often clearest when the code follows the same shape.",
    use: [
      { title: "Tree and folder traversal", detail: "Total size of a folder = its own files + the total size of each sub-folder." },
      { title: "Parsing nested input", detail: "A JSON value can contain arrays and objects that contain JSON values: a recursive-descent parser mirrors that." },
      { title: "Divide and conquer", detail: "Merge sort and quicksort split the input, sort the halves recursively, then combine." },
    ],
    avoid: [
      { title: "Very deep recursion (deep chains, long lists)", instead: "Each pending call keeps a frame; thousands of levels can overflow the stack. Use a loop or an explicit stack." },
      { title: "Recursion that recomputes the same subproblems", instead: "Naive recursive Fibonacci is exponential; memoize results or iterate." },
    ],
    how: [
      "Call: the runtime pushes a frame holding the arguments, local variables and where to resume in the caller (the return address).",
      "Only the top frame runs; every frame below it is suspended, waiting for the call it made to return.",
      "Base case: the deepest call returns without calling again, and the stack stops growing.",
      "Unwind: each frame finishes its work with the returned value and returns to its caller, in reverse order of the calls.",
      "Stack overflow: if the base case is missing or too deep, the runtime runs out of stack and stops the program.",
    ],
    memory: {
      summary: "Kitab draws one frame per call with its argument n and its status (running, waiting, returning). Real frames also hold saved registers and other bookkeeping whose layout depends on the runtime and the compiler.",
      points: [
        "Frames are conceptually on the call stack, but compilers may keep values in registers, inline calls, or (in some languages) reuse a frame for a tail call. None of that changes the logical order of calls and returns.",
        "Objects created inside a call can outlive it: a frame holds a reference, the object lives on the heap and stays alive while something still refers to it.",
        "Recursion is not free in memory: n pending calls means n frames, O(n) space even when each frame is small.",
      ],
    },
    runtime: {
      csharp: {
        types: "methods, local functions",
        facts: [
          { basis: "implementation", text: "Each thread has a fixed-size stack (commonly 1 MB for the main thread on Windows). Exceeding it raises a StackOverflowException, which cannot be caught: the process ends." },
          { basis: "guaranteed", text: "The C# compiler does not guarantee tail-call elimination; do not rely on the JIT turning recursion into a loop." },
          { basis: "concept", text: "Locals of value types often live in the frame or in registers, but a local captured by a lambda, or kept across an await or a yield, is stored in a compiler-generated object instead." },
        ],
      },
      java: {
        types: "methods",
        facts: [
          { basis: "guaranteed", text: "Each thread has its own JVM stack of frames (locals and operand stack). Running out throws StackOverflowError." },
          { basis: "implementation", text: "HotSpot does not perform tail-call elimination; stack size is set with -Xss or per Thread." },
        ],
      },
      python: {
        types: "functions",
        facts: [
          { basis: "guaranteed", text: "sys.getrecursionlimit() caps the depth of Python calls (1000 by default in CPython); exceeding it raises RecursionError, which can be caught." },
          { basis: "guaranteed", text: "CPython deliberately does not eliminate tail calls, so tail recursion still uses one frame per call." },
          { basis: "implementation", text: "Python frames hold references to their locals; the int objects themselves are heap objects like everything else." },
        ],
      },
    },
    storage: "O(depth) frames on the call stack.",
    costs: [
      { operation: "factorial(n) recursively", best: "O(n)", typical: "O(n)", worst: "O(n)", extra: "O(n) stack frames", why: "n calls, each doing O(1) work, all pending at the deepest point." },
      { operation: "factorial(n) with a loop", best: "O(n)", typical: "O(n)", worst: "O(n)", extra: "O(1)", why: "Same work, one frame." },
      { operation: "Recursive traversal of a tree of height h", best: "O(n)", typical: "O(n)", worst: "O(n)", extra: "O(h)", why: "Each node once; at most h + 1 frames pending. A skewed tree makes h ≈ n." },
    ],
    tradeoffs: ["Mirrors recursive problem structure; often the clearest code.", "Uses stack space per pending call; deep inputs can overflow."],
  },
};

export const guideOrder: GuideId[] = ["array", "linked-list", "stack", "queue", "hash-table", "binary-tree", "graph", "recursion"];
