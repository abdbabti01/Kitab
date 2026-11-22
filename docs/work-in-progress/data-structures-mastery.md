# Data Structures Mastery: work in progress

Branch `feature/data-structures-mastery` from `origin/main` 6c8cc97. Not merged, not deployed.

Resume instruction: “Resume the Kitab Data Structures Mastery project from docs/work-in-progress/data-structures-mastery.md
and continue autonomously until completion.”

## Decisions

1. **One engine, extended.** `src/visual-engine/data-structures/model.ts` stays the single source of truth. New
   behaviour is added there and exposed only after tests: array capacity + growth (allocate, copy, switch reference),
   BST delete (leaf / one child / two children via in-order successor, explicit child pointers and root id), graph
   DFS (explicit stack, mark on pop, same order as recursive DFS), BFS distance.
2. **Mission compatibility.** Default capacity is 8, so every mission fixture (≤ 5 values) never grows and every
   saved scenario key is unchanged (`capacity` is only added to params when given, like `values`).
3. **Conceptual vs runtime memory.** The scene and the step memory table show the engine's conceptual model with
   an "Invented teaching addresses" label. Language runtime facts (C#, Java, Python) live in reviewed content, kept
   separate and labelled by what is guaranteed vs implementation detail.
4. **Content lives apart from engine and UI**: `src/structures/guide/` (content, code examples, chooser, memory rows),
   lazy-loaded by the Playground and the data-structures concept pages.
5. **Persistence**: only the chosen code language (`kitab.code-language.v1`, a plain string, validated, cross-tab).

## Correctness matrix (engine)

| Structure | Operation | Checked by |
|---|---|---|
| Array | search, insert (shift, growth), delete (capacity kept), invalid index | ds-correctness, ds-mastery-engine |
| Linked list | traverse, insert (2 pointer writes), delete (1), reachability | ds-correctness, ds-mastery-engine (visited ids) |
| Stack / queue | push/pop/peek, enqueue/dequeue/peek, underflow | ds-correctness |
| Hash table | find/insert/delete, chain, duplicate, negative keys | ds-correctness |
| BST | search, insert, delete (all cases vs reference), height, ids kept | ds-mastery-engine |
| Graph | BFS (visited on enqueue, distance), DFS (vs recursive order) | domain-correctness, ds-mastery-engine |
| Recursion | push/base/return/overflow | ds-correctness, structures-playground |

## Confirmed issues fixed

- Array/list scans highlighted every element equal to a visited value (wrong with repeats): now exact ids.
- Linked-list "unreachable" step said a GC "reclaims that memory later": now "eligible for collection".
- No capacity model: arrays always had a free slot. Now length vs capacity and real growth.
- During array growth the memory table and facts reported the new block's fill count as the array's length.
- Lesson text: BST "half discarded" (only when balanced), "memory can then be released", glossary relink count.

## Milestones

- [x] 1–3 Audit, rules, engine fixes and extensions (+ tests)
- [x] 4–9 Guide content, memory panel, code examples (C#/Java/Python) + verification script, complexity, chooser
- [x] 10–11 Playground controls (capacity, new ops/experiments), concept-page integration, Engineering Lab links
- [x] 12–14 Tests (unit 755, e2e ds-mastery.spec.ts), responsive checks at 1440/1024/768/390/320
- [x] 15–16 Docs (DATA-STRUCTURES-PLAYGROUND.md), commits, push

## Verification

- Unit: `npm test` all pass. Typecheck: all three projects clean.
- Code examples: `scripts/verify-code-examples.ts` 48/48 (dotnet 10.0.401, Java 17.0.12, Python 3.13.15).
- Bundle: initial index chunk +9.4 kB raw / +3.2 kB gzip (shared engine and lesson text, loaded eagerly by missions);
  StructuresPlayground +5.7 kB; new lazy StructureGuide chunk 116 kB raw / 34 kB gzip, loaded only by the Playground
  and data-structures lessons.

## Status

Complete on the branch; awaiting PR review (not merged, not deployed).
