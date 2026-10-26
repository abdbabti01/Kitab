import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * FLIP animation between authoritative frames. Elements carrying the same
 * `data-flip` id glide from their previous position to the new one, even when
 * React remounts them in a different parent (a packet moving between layers).
 * New ids fade in. Animation is a projection only: it never changes state.
 * Changing `resetKey` (a new attempt or scenario) cancels in-flight motion and
 * forgets previous positions, so nothing glides between unrelated runs.
 */
export function useFlip(container: RefObject<HTMLElement | null>, frameKey: string, resetKey: string, durationMs: number, disabled: boolean) {
  const positions = useRef(new Map<string, DOMRect>());
  const lastReset = useRef(resetKey);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const elements = [...root.querySelectorAll<HTMLElement>("[data-flip]")];
    for (const element of elements) element.getAnimations?.().forEach((animation) => animation.cancel());
    const reset = lastReset.current !== resetKey;
    lastReset.current = resetKey;
    const origin = root.getBoundingClientRect();
    const next = new Map<string, DOMRect>();
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      next.set(element.dataset.flip!, new DOMRect(rect.left - origin.left, rect.top - origin.top, rect.width, rect.height));
    }
    if (!disabled && !reset && typeof root.animate === "function") {
      for (const element of elements) {
        const id = element.dataset.flip!;
        const before = positions.current.get(id);
        const after = next.get(id)!;
        if (!before) {
          if (positions.current.size) element.animate([{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }], { duration: Math.min(320, durationMs), easing: "ease-out" });
          continue;
        }
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: durationMs, easing: "cubic-bezier(.2,.7,.2,1)" });
      }
    }
    positions.current = next;
  }, [container, frameKey, resetKey, durationMs, disabled]);
}
