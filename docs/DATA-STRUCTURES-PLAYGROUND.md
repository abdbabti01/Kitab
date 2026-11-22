# Data Structures & Recursion Playground

`/practice/structures` runs any supported operation on the same deterministic engines the data-structures missions
use (`src/visual-engine/data-structures/model.ts`, `src/visual-engine/engines/execution/recursion-engine.ts`), through
the same adapters, scenes and playback (`usePlayback`, `PlaybackBar`). Each step is a stored snapshot, so Previous and
Restart restore the exact earlier state instead of reversing an animation. Free exploration records nothing: no
visit, no attempt, no mastery. A guided experiment opened with `?experiment=<id>` (predict, then test) keeps its own
small record in `kitab.experiments.v1`; see [GUIDED-EXPERIMENTS.md](GUIDED-EXPERIMENTS.md).

## Address

`?structure=<kind>&op=<operation>&value=<n>&index=<n>&values=<a,b,c>[&capacity=<1-16>]` or
`?structure=recursion&fn=factorial|sum&n=<1-6>&base=1|0&limit=<4-12>`, plus an optional `from=<same-site path>` that
adds "Back to your lesson". Unknown values fall back to the structure's defaults. `values=` (empty) is an empty
structure; no `values` is the missions' fixture. Guided experiments and the per-unit lesson links live in
`src/structures/experiments.ts`.

## Supported operations

| Structure | Operations | Fixture (default start) |
|---|---|---|
| Array | linear search, insert at index (with growth when full), delete at index | 8, 3, 12, 1, 6 · capacity 8 |
| Singly linked list | traverse to value, insert at position, delete value | 8 → 3 → 12 → 1 → 6 |
| Stack | push, pop, peek | 8, 3, 12, 1 (top 1) |
| Queue | enqueue, dequeue, inspect front | 8, 3, 12, 1 (front 8) |
| Hash table | find, insert, delete key | keys 10, 15, 23, 8 |
| Binary search tree | search, insert, delete (leaf, one child, two children) | 8, 3, 12, 1, 6, 10, 14 |
| Graph | breadth-first and depth-first search from vertex 1 | fixed graph with a cycle and isolated vertex 15 |
| Recursion | factorial(n) or sum(n), base case on/off, stack limit | factorial(4), limit 8 |

Starting values: up to 8 integers in −99…99 for every structure except the graph. Hash keys and BST values are
unique (repeats are dropped).

## What is modelled exactly

- Array insert/delete: every shift is its own step; writes = shifts + the value store + the length update (insert),
  or shifts + the length update (delete). Index ≤ length for insert and < length for delete; anything else is refused
  in a step of its own and nothing is written (never clamped).
- Array capacity: `capacity` (default 8, never below the starting length) is the block's slot count. Inserting into a
  full block: CHECK CAPACITY, ALLOCATE a block of twice the size at 0x2000, one READ + WRITE per element copied,
  WRITE REFERENCE (the array now refers to the new block; the old one is shown unreachable), then the usual shifts and
  write. Writes = copies + 1 reference + shifts + 2. Delete never shrinks the block. Every mission fixture has spare
  capacity, so mission counts and saved scenario keys are unchanged (`capacity` is only a parameter when given).
- Linked list: insert allocates the node, writes `new.next` first, then redirects `HEAD` or the predecessor (2 pointer
  writes at any position). Delete rewrites exactly one pointer; the unlinked node is shown apart, "not reachable from
  HEAD". Every other node keeps its address. Duplicates: the first match is used.
- Stack/queue: elements keep their identity; push/enqueue = value store + end-marker update; pop/dequeue = one marker
  update. Empty structures underflow with no change.
- Hash table: `bucket = key mod 7` (negative keys normalized into 0…6), separate chaining. Lookups stop at the
  matching key; inserting an existing key writes nothing.
- BST: nodes carry explicit child pointers and the snapshot names the root, so nodes keep their id and address. One
  comparison per node on the path; an absent value ends at the null branch where it would be inserted. Duplicates
  write nothing. A skewed tree really degrades to a linear walk; the height is reported. Delete: a leaf or a node
  with one child is one pointer write; a node with two children walks to its in-order successor (FIND SUCCESSOR
  reads), copies its value into the node (WRITE VALUE, the node keeps its identity) and unlinks the successor (one
  pointer write). Checked against a reference implementation on many random trees.
- BFS: a vertex is marked visited when enqueued; found, unreachable and absent are distinct results; a found vertex
  reports its distance in edges (BFS gives shortest paths in an unweighted graph).
- DFS: an explicit stack; a vertex is marked visited when popped and unvisited neighbours are pushed in reverse, so the
  visit order equals a recursive DFS (checked on random graphs). A vertex can be on the stack twice; the second copy is
  popped and skipped (POP + SKIP). Writes count pushes.
- Recursion: one frame per call, only the top frame runs, frames return in reverse order and each return value is
  passed to the waiting frame. Overflow happens when another frame would exceed the limit, with or without a base
  case (a base case can be too deep to reach), and is explained accordingly.

## Simplified educational models

- Addresses are illustrative (arrays: base 0x1000, 4-byte integers; nodes at spaced addresses). No real memory,
  allocator, cache or CPU is simulated, and JavaScript's own memory management is not modelled.
- Arrays grow by doubling (a teaching choice; .NET doubles List<T>, OpenJDK grows ArrayList by about 1.5×, CPython
  over-allocates differently) and never shrink. Stacks and queues do not show capacity growth or ring-buffer
  wrap-around (the C#, Java and Python examples do).
- Memory reclamation (garbage collection, `free`) is mentioned, not simulated.
- The hash table never resizes and stores keys only (no values).
- The BST never rebalances (no AVL or red-black rotations).
- The graph is fixed; traversals always start at vertex 1.
- The recursion stack limit (4–12 frames) is a teaching number; real runtimes allow thousands of frames.

## Structure guide

Below the run (and in each data-structures lesson under "Go deeper") the guide has five tabs. Content is reviewed data
in `src/structures/guide/`, separate from the engine and the UI, and lazy-loaded.

- **Memory**: this step's conceptual memory as a table (variables, slots, nodes, buckets, frames), derived only from
  the engine's snapshot (`memory.ts`), with the rows that changed since the previous step highlighted. Below it,
  what C#, Java or Python actually store, each fact marked *Guaranteed*, *Implementation detail* or *Concept*.
  Addresses are labelled "Invented teaching addresses" in every scene.
- **What & why**: what it is, why it exists, when to use and avoid it, how each operation works.
- **Code**: a standard-library example and a teaching implementation per structure, in C#, Java and Python, with
  their exact output and line-by-line notes. Teaching implementations are labelled as not being the runtime's source.
  `node --experimental-strip-types scripts/verify-code-examples.ts [csharp|java|python]` compiles, runs and compares
  every example (`dotnet run file.cs` needs the .NET 10 SDK; `java File.java`; `python3`/`py -3`); a missing
  toolchain is reported as NOT VERIFIED. Kitab never runs these languages in the browser; the Engineering Lab link
  (where there is one) runs JavaScript.
- **Cost**: best, typical (average/expected), worst and amortized cost, extra space and the assumptions behind them,
  plus the engine's counts for this run (operation counts, not time).
- **Choose**: eight requirement-driven scenarios ("which structure would you use?"); each option is judged against
  the requirements, and more than one can be a good fit. Nothing is recorded.

The chosen language is the only new stored state: `kitab.code-language.v1` holds `csharp`, `java` or `python`.
Anything else (corrupt, or from a newer version) reads as C# and is left in place; write failures keep the choice for
the page; other tabs follow changes. Changing tab or language never rebuilds the run.

## Fixed in this version (Data Structures Mastery)

- Array and list scans highlighted every element whose value had been visited, so repeated values lit up wrongly;
  the engine now records the exact elements (`visitedIds`).
- During array growth the reported length/capacity were the new block's; they are the array's until the switch.
- "Unreachable" steps said a collector "reclaims that memory later"; it becomes *eligible* for collection.
- Lesson text: a BST comparison discards a whole subtree ("half" only when balanced); the glossary's linked-list
  insert counts both reference writes.

## Fixed earlier (engine audit)

- Hash delete kept comparing after the match; inserting an existing key stored a duplicate.
- Queue, stack and hash entries were relabelled by position after each operation (and hash entries changed address).
- Out-of-range array and linked-list positions were silently clamped to the nearest valid one.
- Push/enqueue did not count the end-marker update that pop/dequeue counts; push was labelled "write at rear".
- A linked-list insert at the head counted one pointer write instead of two, and showed no intermediate steps.
- BST search for an absent value ended without a "reached null" step; empty structures were not handled.
- Recursion overflow said "no base case" even when the base case existed but was beyond the limit; returned values
  were reconstructed by division.
- The tree scene cut off any tree deeper than five levels.
