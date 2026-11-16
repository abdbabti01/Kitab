# Data Structures & Recursion Playground

`/practice/structures` runs any supported operation on the same deterministic engines the data-structures missions
use (`src/visual-engine/data-structures/model.ts`, `src/visual-engine/engines/execution/recursion-engine.ts`), through
the same adapters, scenes and playback (`usePlayback`, `PlaybackBar`). Each step is a stored snapshot, so Previous and
Restart restore the exact earlier state instead of reversing an animation. The Playground records nothing: no visit,
no attempt, no mastery.

## Address

`?structure=<kind>&op=<operation>&value=<n>&index=<n>&values=<a,b,c>` or
`?structure=recursion&fn=factorial|sum&n=<1-6>&base=1|0&limit=<4-12>`, plus an optional `from=<same-site path>` that
adds "Back to your lesson". Unknown values fall back to the structure's defaults. `values=` (empty) is an empty
structure; no `values` is the missions' fixture. Guided experiments and the per-unit lesson links live in
`src/structures/experiments.ts`.

## Supported operations

| Structure | Operations | Fixture (default start) |
|---|---|---|
| Array | linear search, insert at index, delete at index | 8, 3, 12, 1, 6 |
| Singly linked list | traverse to value, insert at position, delete value | 8 → 3 → 12 → 1 → 6 |
| Stack | push, pop, peek | 8, 3, 12, 1 (top 1) |
| Queue | enqueue, dequeue, inspect front | 8, 3, 12, 1 (front 8) |
| Hash table | find, insert, delete key | keys 10, 15, 23, 8 |
| Binary search tree | search, insert | 8, 3, 12, 1, 6, 10, 14 |
| Graph | breadth-first search from vertex 1 | fixed graph with a cycle and isolated vertex 15 |
| Recursion | factorial(n) or sum(n), base case on/off, stack limit | factorial(4), limit 8 |

Starting values: up to 8 integers in −99…99 for every structure except the graph. Hash keys and BST values are
unique (repeats are dropped).

## What is modelled exactly

- Array insert/delete: every shift is its own step; writes = shifts + the value store + the length update (insert),
  or shifts + the length update (delete). Index ≤ length for insert and < length for delete; anything else is refused
  in a step of its own and nothing is written (never clamped).
- Linked list: insert allocates the node, writes `new.next` first, then redirects `HEAD` or the predecessor (2 pointer
  writes at any position). Delete rewrites exactly one pointer; the unlinked node is shown apart, "not reachable from
  HEAD". Every other node keeps its address. Duplicates: the first match is used.
- Stack/queue: elements keep their identity; push/enqueue = value store + end-marker update; pop/dequeue = one marker
  update. Empty structures underflow with no change.
- Hash table: `bucket = key mod 7` (negative keys normalized into 0…6), separate chaining. Lookups stop at the
  matching key; inserting an existing key writes nothing.
- BST: one comparison per node on the path; an absent value ends at the null branch where it would be inserted.
  Duplicates write nothing. A skewed tree really degrades to a linear walk.
- BFS: a vertex is marked visited when enqueued; found, unreachable and absent are distinct results.
- Recursion: one frame per call, only the top frame runs, frames return in reverse order and each return value is
  passed to the waiting frame. Overflow happens when another frame would exceed the limit, with or without a base
  case (a base case can be too deep to reach), and is explained accordingly.

## Simplified educational models

- Addresses are illustrative (arrays: base 0x1000, 4-byte integers; nodes at spaced addresses). No real memory,
  allocator, cache or CPU is simulated, and JavaScript's own memory management is not modelled.
- Dynamic arrays always have a spare slot; reallocation into a larger block is not shown. Stacks and queues do not
  show capacity growth or ring-buffer wrap-around.
- Memory reclamation (garbage collection, `free`) is mentioned, not simulated.
- The hash table never resizes and stores keys only (no values).
- The BST never rebalances; delete is not offered.
- The graph is fixed; BFS always starts at vertex 1.
- The recursion stack limit (4–12 frames) is a teaching number; real runtimes allow thousands of frames.

## Fixed in this version (engine audit)

- Hash delete kept comparing after the match; inserting an existing key stored a duplicate.
- Queue, stack and hash entries were relabelled by position after each operation (and hash entries changed address).
- Out-of-range array and linked-list positions were silently clamped to the nearest valid one.
- Push/enqueue did not count the end-marker update that pop/dequeue counts; push was labelled "write at rear".
- A linked-list insert at the head counted one pointer write instead of two, and showed no intermediate steps.
- BST search for an absent value ended without a "reached null" step; empty structures were not handled.
- Recursion overflow said "no base case" even when the base case existed but was beyond the limit; returned values
  were reconstructed by division.
- The tree scene cut off any tree deeper than five levels.
