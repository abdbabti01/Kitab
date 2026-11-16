import { useId, useRef, type ReactNode } from "react";
import { Check } from "lucide-react";

/** A lesson's one progress indicator: where the learner is, in words and as a bar. */
export function LessonProgress({ label, value, max }: { label: string; value: number; max: number }) {
  const id = useId();
  return (
    <div className="lesson-progress">
      <span id={id} className="lesson-progress-label">{label}</span>
      <progress aria-labelledby={id} value={value} max={Math.max(1, max)} />
    </div>
  );
}

export type OutlineItem = {
  id: string;
  title: string;
  detail?: string;
  state: "current" | "done" | "todo";
  /** An in-page anchor, or a jump the lesson performs. */
  href?: string;
  onSelect?: () => void;
};

/**
 * A lesson's parts in order (chapters, concepts), folded under one line that says where the learner is. Choosing a
 * part jumps there: it is a map of the lesson, not a second way through it, so it never competes with Next.
 */
export function LessonOutline({ label, summary, items, doneLabel }: { label: string; summary: ReactNode; items: OutlineItem[]; doneLabel: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (details.current) details.current.open = false;
  };
  return (
    <details className="lesson-outline" ref={details}>
      <summary>
        <span className="lesson-outline-where">{summary}</span>
        <span className="lesson-outline-cue">Outline</span>
      </summary>
      <ol aria-label={label}>
        {items.map((item, index) => {
          const body = (
            <>
              <span className="outline-num" aria-hidden="true">{item.state === "done" ? <Check /> : index + 1}</span>
              <span className="outline-title">{item.title}{item.detail && <small>{item.detail}</small>}</span>
              {item.state === "done" && <span className="sr-only"> ({doneLabel})</span>}
            </>
          );
          const common = { className: `outline-item is-${item.state}`, "aria-current": item.state === "current" ? ("step" as const) : undefined };
          return (
            <li key={item.id}>
              {item.href
                ? <a href={item.href} {...common} onClick={close}>{body}</a>
                : <button type="button" {...common} onClick={() => { item.onSelect?.(); close(); }}>{body}</button>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
