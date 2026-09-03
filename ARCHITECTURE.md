# Kitab visualization architecture

## Design rule

Explanations and simulations are separate surfaces. Text participates in normal document layout; graph geometry stays inside a bounded visualization container. A graph must never determine the minimum width of the explanation panel.

## Component boundaries

- `App` owns navigation, search, and which chapter is open.
- `CuratedChapter` owns lesson controls: depth, step, playback, and experiment state.
- Each visualization engine renders one mechanism family only: journey, cells, stack, linked list, tree, or scheduler.
- Opening another chapter remounts the chapter by `slug`. This prevents animation state and DOM nodes from a previous engine appearing in the next one.
- AI lesson data remains declarative. It describes actors, events, labels, and states; it does not provide HTML, CSS, coordinates, or executable code.

## Responsive contract

- Every grid track containing a visualization uses `minmax(0, 1fr)`.
- Every direct grid child uses `min-width: 0`.
- The chapter responds to its own width with container queries, not only the browser width.
- At narrow widths, the explanation moves below the graph and interactive nodes reflow.
- Long prose and generated labels wrap; simulation regions may scroll internally as a final safety net.
- Controls wrap and keep touch-sized targets.

## Recommended next evolution

Move each engine from `curated.tsx` into `src/visualizations/<engine>/` with a shared typed interface:

```ts
type VisualizationProps = {
  step: number;
  changed: boolean;
  reducedMotion: boolean;
};
```

Use an engine registry keyed by visualization type. For free-form node/edge diagrams, use SVG with a `viewBox` and a layout adapter (ELK for layered graphs, D3 for trees). Keep HTML for controls and explanations so text remains accessible and wraps naturally.

## Release checks

For every chapter and AI visualization type, test at 1440, 1024, 768, and 390 CSS pixels and at 200% text zoom. A release fails if:

- the page gains unintended horizontal scrolling;
- any explanation is clipped or hidden;
- controls overlap or become unreachable;
- labels leave the visualization bounds;
- changing chapters preserves nodes or state from the previous chapter;
- keyboard focus cannot reach every interactive control.
