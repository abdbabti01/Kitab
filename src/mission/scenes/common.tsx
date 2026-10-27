import type { ComponentType, ReactNode } from "react";
import type { LearningFrame, Trace } from "../../learning/types.ts";

export type SceneProps<TData = unknown> = {
  frame: LearningFrame<TData>;
  trace: Trace<TData>;
  selected: string | null;
  attention: string | null;
  onSelect: (entityId: string) => void;
};

export type SceneModule<TData = unknown> = {
  Scene: ComponentType<SceneProps<TData>>;
  /** Optional reference material for the inspector (e.g. a complexity table). */
  Reference?: ComponentType<{ trace: Trace<TData> }>;
};

/** Props for any selectable semantic object in a scene. */
export function entity(id: string, props: Pick<SceneProps, "frame" | "selected" | "attention" | "onSelect">, label: string, className = "", flip?: string) {
  const classes = [
    className,
    props.frame.focus.includes(id) ? "is-focus" : "",
    props.selected === id ? "is-selected" : "",
    props.attention === id ? "is-attention" : "",
  ].filter(Boolean).join(" ");
  return {
    type: "button" as const,
    "data-entity": id,
    ...(flip ? { "data-flip": flip } : {}),
    className: classes,
    "aria-pressed": props.selected === id,
    "aria-label": label,
    onClick: () => props.onSelect(id),
  };
}

export function SceneSection({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section className={`scene-section ${className}`} aria-label={label}>
      <h3 className="scene-label">{label}</h3>
      {children}
    </section>
  );
}
