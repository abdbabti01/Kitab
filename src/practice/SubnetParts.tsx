// Pieces of Explore subnets that lessons reuse: the bit rows, the block facts and the prediction card. Every value comes
// from the shared IPv4 helper; nothing here stores anything.
import type { HTMLAttributes, ReactNode } from "react";
import { block } from "../net/ipv4.ts";
import { kindNote, type Question } from "../net/subnet-practice.ts";
import "./subnets.css";

const count = (n: number) => n.toLocaleString("en");

type BitInfo = { bit: string; i: number; k: number; o: number; part: "network" | "host"; className: string };
/**
 * Four octets of bits, network bits and host bits coloured, with an optional decimal value under each octet. Read-only
 * spans unless renderBit draws each bit (the explorer's toggle buttons).
 */
export function BitRows({ bits, prefix, values, renderBit, className = "", ...rest }: { bits: string; prefix: number; values?: string[]; renderBit?: (info: BitInfo) => ReactNode; className?: string } & Omit<HTMLAttributes<HTMLDivElement>, "className" | "prefix">) {
  return (
    <div className={`subnet-bits ${className}`.trim()} {...rest}>
      {[0, 1, 2, 3].map((o) => (
        <div className="subnet-octet" key={o}>
          <div className="subnet-octet-bits">
            {[...bits.slice(o * 8, o * 8 + 8)].map((bit, k) => {
              const i = o * 8 + k,
                part = i < prefix ? "network" : "host",
                info: BitInfo = { bit, i, k, o, part, className: `subnet-bit is-${part}${i === prefix ? " is-edge" : ""}` };
              return renderBit ? renderBit(info) : <span key={i} className={info.className}>{bit}</span>;
            })}
          </div>
          {values && <b className="subnet-octet-value" aria-hidden="true">{values[o]}</b>}
        </div>
      ))}
    </div>
  );
}

/** The block's facts, worded for its kind: /0, /31 and /32 never show a network or broadcast address. */
export function BlockFacts({ address, prefix }: { address: string; prefix: number }) {
  const b = block(address, prefix),
    note = kindNote(b);
  const fact = (label: string, value: ReactNode) => (
    <div className="subnet-fact" key={label}><span>{label}</span><code>{value}</code></div>
  );
  return (
    <>
      <div className="subnet-facts">
        {prefix === 0
          ? [
              fact("Address block", b.cidr),
              fact("Block size", <>2<sup>32</sup> = {count(b.size)}</>),
              fact("Used as", "The default route"),
              fact("Usable hosts", "Not a host setting"),
            ]
          : b.kind === "normal"
          ? [
              fact("Network address", b.network!),
              fact("Broadcast address", b.broadcast!),
              fact("Usable host range", `${b.firstUsable} – ${b.lastUsable}`),
              fact("Usable hosts", count(b.usable)),
              fact("Block", b.cidr),
              fact("Block size", <>2<sup>{32 - prefix}</sup> = {count(b.size)}</>),
            ]
          : [
              fact("Address block", b.cidr),
              fact(b.usable === 1 ? "Usable address" : "Usable addresses", b.usable === 1 ? b.firstUsable : `${b.firstUsable} and ${b.lastUsable}`),
              fact("Usable count", String(b.usable)),
              fact("Block size", String(b.size)),
            ]}
      </div>
      {note && <p className="subnet-kind">{note}</p>}
    </>
  );
}

/**
 * A prediction question with specific feedback for each wrong choice, retry, and "Show the answer". It keeps no score and
 * records nothing: the caller owns the attempt.
 */
export function PredictionCard({ question: q, attempt, revealed, onTry, onShow, id = "subnet" }: { question: Question; attempt: { tried: number[]; shown: boolean }; revealed: boolean; onTry: (choice: number) => void; onShow: () => void; id?: string }) {
  const right = q.choices.findIndex((c) => c.correct),
    solved = attempt.tried.includes(right),
    last = attempt.tried.at(-1);
  return (
    <div className="subnet-question">
      <p className="subnet-prompt" id={`${id}-prompt`}>{q.prompt}</p>
      <ul className="subnet-choices" aria-labelledby={`${id}-prompt`}>
        {q.choices.map((c, i) => {
          const tried = attempt.tried.includes(i),
            state = tried || (revealed && c.correct) ? (c.correct ? "is-right" : "is-wrong") : "";
          return (
            <li key={c.label}>
              <button type="button" className={state} disabled={revealed || tried} onClick={() => onTry(i)}
                aria-describedby={tried && i === last ? `${id}-feedback` : undefined}>
                <code>{c.label}</code>
                {tried && <span className="sr-only">{c.correct ? " (right)" : " (not right)"}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="subnet-feedback" id={`${id}-feedback`} role="status">
        {solved ? (
          <p><b>Right.</b> {q.answer}</p>
        ) : attempt.shown ? (
          <p><b>Answer shown.</b> {q.answer}</p>
        ) : last !== undefined ? (
          <p><b>Not quite.</b> {q.choices[last].feedback} Try another choice, or show the answer.</p>
        ) : null}
      </div>
      {!revealed && (
        <button type="button" className="button subnet-show" onClick={onShow}>Show the answer</button>
      )}
    </div>
  );
}
