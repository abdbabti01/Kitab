// The Exchange view: the run as a sequence diagram. One row per message, an arrow from the device that created
// it to the devices it reached, synchronized with the Journey. Loaded only when the learner picks this view.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { activeMessage, exchangeOf, type Message, type Reach } from "./network/exchange.ts";
import type { Network, Trace } from "./network/model.ts";
import "./exchange.css";

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
/** "so-far": the run is shown only up to now (Predict as you go), so a message on its way is not stopped. */
type How = Reach["how"] | "so-far";
const reachWords: Record<How, string> = {
  "so-far": "has so far reached",
  delivered: "delivered to",
  received: "received by",
  discarded: "discarded by",
  "no-further": "went no further than",
};
// Steps shown at first when a message is opened; the rest are one button away.
const FIRST_STEPS = 8;

export default function ExchangeView({
  trace,
  index,
  network,
  onSelect,
  onInspect,
  partial = false,
}: {
  /** Later events are hidden: describe what happened so far, not how messages ended. */
  partial?: boolean;
  trace: Trace;
  index: number;
  network: Network;
  /** Moves the Journey to this event and shows its packet. */
  onSelect: (event: number) => void;
  /** Opens the packet details (and brings them into view on narrow screens). */
  onInspect: () => void;
}) {
  const events = trace.events;
  const x = useMemo(() => {
    const whole = exchangeOf(events, network);
    if (!partial) return whole;
    const reached = (r: Reach) => (r.how === "no-further" ? { ...r, how: "so-far" as unknown as Reach["how"] } : r);
    return { ...whole, messages: whole.messages.map((m) => ({ ...m, reached: m.reached.map(reached) })) };
  }, [events, network, partial]);
  const active = activeMessage(x, events, index);
  const [all, setAll] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const n = x.participants.length;
  const col = (id: string) => x.participants.indexOf(id);
  const pct = (c: number) => ((c + 0.5) / n) * 100;
  const position = (m: Message) => x.messages.indexOf(m) + 1;
  const go = (m: Message) => onSelect(m.sent ?? m.first);
  // A label sits over its arrow: from the arrow's left end when that is in the left half, else up to its right end.
  const side = (lo: number, hi: number): CSSProperties =>
    lo < n / 2 ? { marginLeft: `${(lo / n) * 100}%` } : { marginRight: `${((n - 1 - hi) / n) * 100}%`, textAlign: "right" };

  // Keep the active message in view inside the diagram's own scroll area (never scrolls the page).
  useEffect(() => {
    const box = scroller.current,
      row = box?.querySelector<HTMLElement>(".exchange-row[aria-current]");
    if (!box || !row) return;
    const head = box.querySelector<HTMLElement>(".exchange-heads")?.offsetHeight ?? 0;
    const offset = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    // The message and its opened steps, or at least its row when both do not fit.
    const top = offset - head,
      bottom = offset + (row.parentElement?.offsetHeight ?? row.offsetHeight);
    if (top < box.scrollTop || bottom - top > box.clientHeight - head) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [active?.id]);

  function said(m: Message) {
    const what = `${m.broadcast ? "broadcast " : ""}${m.label} from ${name(m.from)}`;
    const ends = (["delivered", "received", "discarded", "no-further", "so-far"] as const).flatMap((how) => {
      const at = m.reached.filter((r) => (r.how as How) === how).map((r) => name(r.device));
      return at.length ? [`${reachWords[how]} ${list(at)}`] : [];
    });
    const fate = m.lost
      ? `lost on the link from ${name(m.lost.from)} to ${name(m.lost.to)}`
      : m.hops.length
        ? ends.join("; ")
        : partial
          ? "created, not sent yet"
          : "created but not sent";
    const via = m.via.length ? `, sent on by ${list(m.via.map(name))}` : "";
    const again = m.resends ? `. It resends message ${position(x.messages.find((o) => o.id === m.resends)!)}, which was lost` : "";
    return `Message ${position(m)} of ${x.messages.length}: ${what}, ${fate}${via}${again}.`;
  }

  /** The recorded steps of one message: each transmission, and where it ended. */
  function steps(m: Message) {
    const out = [
      ...m.hops.map((i) => {
        const { from, to } = events[i].hop!;
        const text = !events[i].frame
          ? `Lost on the link from ${name(from)} to ${name(to)}`
          : from === m.from
            ? `${name(from)} sent it to ${name(to)}`
            : `${name(from)} sent it on to ${name(to)}`;
        return { at: i, text, kind: events[i].frame ? "hop" : "lost" };
      }),
      ...m.reached.map((r) => ({
        at: r.at,
        text: (r.how as How) === "so-far" ? `It has reached ${name(r.device)} so far` : r.how === "no-further" ? `It went no further than ${name(r.device)}` : `${name(r.device)} ${r.how === "delivered" ? "delivered it" : r.how === "received" ? "received it" : "discarded it: it was not addressed to it"}`,
        kind: r.how,
      })),
    ];
    return out.sort((a, b) => a.at - b.at);
  }

  function arrow(m: Message) {
    const f = col(m.from);
    const ends = m.reached.map((r) => ({ c: col(r.device), how: r.how as string }));
    if (m.lost) ends.push({ c: (f + col(m.lost.to)) / 2, how: "lost" });
    const cs = [f, ...ends.map((e) => e.c)];
    const lo = Math.min(...cs),
      hi = Math.max(...cs);
    return (
      <span className="exchange-arrow" aria-hidden="true">
        {hi > lo && <span className={`exchange-line${m.lost ? " is-lost" : ""}`} style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />}
        <span className="exchange-origin" style={{ left: `${pct(f)}%` }} />
        {ends.map((e, k) => (
          <span key={k} className={`exchange-head is-${e.how} ${e.c < f ? "to-left" : "to-right"}`} style={{ left: `${pct(e.c)}%` }} />
        ))}
      </span>
    );
  }

  function row(m: Message) {
    const lo = Math.min(col(m.from), ...m.reached.map((r) => col(r.device)), m.lost ? col(m.lost.to) : n);
    const hi = Math.max(col(m.from), ...m.reached.map((r) => col(r.device)), m.lost ? col(m.lost.to) : -1);
    const tags = [
      m.broadcast && "broadcast",
      m.flooded && "flooded",
      m.lost && "lost",
      m.resends && "resent",
      m.loops && "loop",
      !m.hops.length && (partial ? "not sent yet" : "not sent"),
      m.reached.some((r) => r.how === "no-further") && "went no further",
    ].filter(Boolean) as string[];
    const isActive = m === active;
    const detail = isActive ? steps(m) : [];
    const shown = all === m.id ? detail : detail.slice(0, FIRST_STEPS);
    const resent = x.messages.find((o) => o.resends === m.id);
    return (
      <li key={m.id} className={isActive ? "is-active" : ""}>
        <button
          className={`exchange-row proto-${m.protocol.toLowerCase()}${m.lost || m.reached.some((r) => r.how === "no-further") ? " is-failed" : ""}`}
          aria-current={isActive ? "step" : undefined}
          aria-label={said(m)}
          onClick={() => go(m)}
        >
          <span className="exchange-label" style={side(lo, hi)}>
            <b>{m.label}</b> {m.detail && <small>{m.detail}</small>}
            {tags.map((t) => (
              <em key={t} className={`exchange-tag tag-${t.replace(/ /g, "-")}`}>
                {t}
              </em>
            ))}
          </span>
          {arrow(m)}
        </button>
        {isActive && (
          <div className="exchange-detail">
            {m.via.length > 0 && <p>Sent on by {list(m.via.map(name))}. {m.hops.length} {m.hops.length === 1 ? "link" : "links"} crossed.</p>}
            {m.broadcast && <p>Broadcast: addressed to every device on the LAN, so each one gets its own copy.</p>}
            {m.flooded && <p>Flooded: a switch did not know where the destination MAC was, so it sent copies out of its other ports.</p>}
            {m.loops && <p>It crossed the same link in the same direction more than once: the routers sent it round a loop.</p>}
            {m.resends && (
              <p>
                This resends a segment that was lost.{" "}
                <button className="text-button" onClick={() => go(x.messages.find((o) => o.id === m.resends)!)}>
                  Show the lost one
                </button>
              </p>
            )}
            {resent && (
              <p>
                TCP sent this segment again later.{" "}
                <button className="text-button" onClick={() => go(resent)}>
                  Show the retransmission
                </button>
              </p>
            )}
            {detail.length > 0 && (
              <ol className="exchange-steps" aria-label={`Steps of message ${position(m)}`}>
                {shown.map((s) => (
                  <li key={s.at}>
                    <button className={`text-button step-${s.kind}`} aria-current={s.at === index ? "step" : undefined} onClick={() => onSelect(s.at)}>
                      {s.text}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {detail.length > shown.length && (
              <button className="text-button" onClick={() => setAll(m.id)}>
                Show all {detail.length} steps
              </button>
            )}
            <button className="text-button" onClick={onInspect}>
              Packet details
            </button>
          </div>
        )}
      </li>
    );
  }

  // Up and Down move between messages; Enter or Space selects one.
  function keys(e: KeyboardEvent<HTMLOListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".exchange-row, .exchange-stop")];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))].focus();
  }

  const lanes: CSSProperties = {
    backgroundImage: x.participants.map(() => "linear-gradient(var(--exchange-lane), var(--exchange-lane))").join(", "),
    backgroundPosition: x.participants.map((_, c) => `${pct(c)}% 0`).join(", "),
  };
  return (
    <section className="exchange" aria-label="Protocol exchange">
      <p className="exchange-intro">
        {x.messages.length
          ? `${x.messages.length} ${x.messages.length === 1 ? "message" : "messages"} between ${n} devices, in the order they were sent. Each arrow runs from the device that created the message to the devices it reached. Select one to follow it on the diagram.`
          : partial
            ? "No message has been sent yet."
            : "No message was sent in this run."}
      </p>
      <div className="exchange-scroll" ref={scroller} style={{ "--cols": n } as CSSProperties}>
        <ol className="exchange-heads" aria-hidden="true">
          {x.participants.map((d) => (
            <li key={d}>{name(d)}</li>
          ))}
        </ol>
        <ol className="exchange-rows" style={lanes} onKeyDown={keys}>
          {x.messages.map(row)}
          {x.stop && (
            <li>
              <button
                className={`exchange-stop${index === x.stop.at ? " is-current" : ""}`}
                aria-current={index === x.stop.at ? "step" : undefined}
                onClick={() => onSelect(x.stop!.at)}
              >
                <span className="exchange-label" style={side(col(x.stop.device), col(x.stop.device))}>
                  <b>Delivery stopped at {name(x.stop.device)}</b>
                </span>
                <span className="exchange-arrow" aria-hidden="true">
                  <span className="exchange-halt" style={{ left: `${pct(col(x.stop.device))}%` }}>
                    ✕
                  </span>
                </span>
              </button>
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}
