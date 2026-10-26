import type { GuideMood } from "../learning/guide.ts";
import "./kitab-avatar.css";

export const moodLabels: Record<GuideMood, string> = {
  idle: "watching",
  welcoming: "welcoming you",
  thinking: "thinking",
  explaining: "explaining",
  pointing: "pointing something out",
  encouraging: "encouraging you",
  celebrating: "celebrating",
  unavailable: "offline — using reviewed notes",
};

/**
 * Kitab: an open cobalt book whose spread forms a face. The ribbon bookmark
 * is the pointer. Each mood changes posture, eyes, mouth and accents; CSS
 * animates them, and reduced motion keeps the static pose.
 */
export function KitabAvatar({ mood, size = 72 }: { mood: GuideMood; size?: number }) {
  return (
    <svg className={`kitab-avatar mood-${mood}`} width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <ellipse className="k-shadow" cx="48" cy="90" rx="26" ry="3.5" />
      <g className="k-body">
        <g className="k-ribbon">
          <path d="M45.5 31 L45.5 9 L48 12.5 L50.5 9 L50.5 31 Z" />
        </g>
        <path className="k-cover" d="M48 35 C38 29 20 29 7 33 L7 77 C20 73 38 73 48 79 C58 73 76 73 89 77 L89 33 C76 29 58 29 48 35 Z" />
        <g className="k-page-left">
          <path className="k-page" d="M48 31 C38 25 22 25 12 29 L12 71 C22 67 38 67 48 73 Z" />
          <path className="k-line" d="M19 62 C26 60 34 60 41 62" />
        </g>
        <g className="k-page-right">
          <path className="k-page" d="M48 31 C58 25 74 25 84 29 L84 71 C74 67 58 67 48 73 Z" />
          <path className="k-line" d="M55 62 C62 60 70 60 77 62" />
        </g>
        <path className="k-spine" d="M48 31 L48 73" />
        <g className="k-eyes">
          <ellipse className="k-eye" cx="31" cy="45" rx="4" ry="5.5" />
          <ellipse className="k-eye" cx="65" cy="45" rx="4" ry="5.5" />
          <circle className="k-glint" cx="32.4" cy="43" r="1.3" />
          <circle className="k-glint" cx="66.4" cy="43" r="1.3" />
        </g>
        <path className="k-mouth k-smile" d="M41 55 Q48 61 55 55" />
        <path className="k-mouth k-flat" d="M42 57 L54 57" />
        <circle className="k-mouth k-o" cx="48" cy="57" r="2.6" />
        <circle className="k-cheek" cx="22" cy="53" r="3" />
        <circle className="k-cheek" cx="74" cy="53" r="3" />
      </g>
      <g className="k-dots">
        <circle cx="74" cy="16" r="2.4" />
        <circle cx="81" cy="12" r="2.4" />
        <circle cx="88" cy="8" r="2.4" />
      </g>
      <g className="k-sparkles">
        <path d="M14 14 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" />
        <path d="M80 18 l1.5 3.5 l3.5 1.5 l-3.5 1.5 l-1.5 3.5 l-1.5 -3.5 l-3.5 -1.5 l3.5 -1.5 z" />
        <path d="M86 50 l1.2 2.8 l2.8 1.2 l-2.8 1.2 l-1.2 2.8 l-1.2 -2.8 l-2.8 -1.2 l2.8 -1.2 z" />
      </g>
      <g className="k-alert">
        <circle cx="82" cy="20" r="8" />
        <path d="M82 15 L82 21 M82 24.5 L82 25" />
      </g>
    </svg>
  );
}
