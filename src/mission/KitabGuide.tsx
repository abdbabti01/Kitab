import { ChevronDown, ChevronUp, Crosshair, HelpCircle, Lightbulb, MessageCircleQuestion } from "lucide-react";
import { memo } from "react";
import type { GuideState } from "../learning/guide.ts";
import { KitabAvatar, moodLabels } from "./KitabAvatar.tsx";

export type GuideAction = "hint" | "explain-step" | "why-wrong";

/** Memoised: it re-renders when Kitab's state changes, not at every playback step. */
export const KitabGuide = memo(function KitabGuide({
  guide,
  busy,
  canAskWhyWrong,
  canExplainStep,
  targetLabel,
  onAction,
  onShowTarget,
  onToggle,
}: {
  guide: GuideState;
  busy: boolean;
  canAskWhyWrong: boolean;
  canExplainStep: boolean;
  targetLabel: string | null;
  onAction: (action: GuideAction) => void;
  onShowTarget: () => void;
  onToggle: () => void;
}) {
  const collapsed = guide.collapsed;
  return (
    <aside className={`guide ${collapsed ? "is-collapsed" : ""}`} aria-label="Kitab, your guide">
      <div className="guide-head">
        <KitabAvatar mood={guide.mood} size={collapsed ? 44 : 64} />
        <div className="guide-title">
          <b>Kitab</b>
          <small>{moodLabels[guide.mood]}</small>
        </div>
        <button type="button" className="icon-button" onClick={onToggle} aria-expanded={!collapsed} aria-controls="guide-body" aria-label={collapsed ? "Open Kitab's guidance" : "Collapse Kitab's guidance"}>
          {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
        </button>
      </div>
      {/* One polite live region, keyed by seq, so each new message is announced once. */}
      <p className="sr-only" aria-live="polite" key={guide.seq}>{guide.message ? `Kitab: ${guide.message}` : ""}</p>
      <div id="guide-body" hidden={collapsed}>
        {guide.message && <p className="guide-message">{guide.message}</p>}
        {guide.detail && (
          <details className="guide-detail">
            <summary>More detail</summary>
            <p>{guide.detail}</p>
          </details>
        )}
        {guide.source === "ai" && <p className="guide-source">AI explanation, checked against this trace. It can still be imperfect.</p>}
        {guide.source === "fallback" && <p className="guide-source">Reviewed explanation.</p>}
        {targetLabel && (
          <button type="button" className="text-button" onClick={onShowTarget}>
            <Crosshair aria-hidden="true" /> Show {targetLabel}
          </button>
        )}
        <div className="guide-actions" role="group" aria-label="Ask Kitab">
          <button type="button" onClick={() => onAction("hint")} disabled={busy}>
            <Lightbulb aria-hidden="true" /> Give me a hint
          </button>
          <button type="button" onClick={() => onAction("explain-step")} disabled={busy || !canExplainStep}>
            <HelpCircle aria-hidden="true" /> Explain this step
          </button>
          {canAskWhyWrong && (
            <button type="button" onClick={() => onAction("why-wrong")} disabled={busy}>
              <MessageCircleQuestion aria-hidden="true" /> Why was my prediction wrong?
            </button>
          )}
        </div>
      </div>
    </aside>
  );
});
