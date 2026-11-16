import type { ReactNode } from "react";

/**
 * A wide table's own horizontal scroller. The table keeps its natural width and readable cells; when it is wider
 * than the space it is given, only this box scrolls, never the page. It is a labelled, focusable region so the
 * last columns can be reached with the keyboard (arrow keys scroll it once focused) as well as by touch or mouse.
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
