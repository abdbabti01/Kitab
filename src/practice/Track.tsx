// The track under the diagram: the timeline, the stages and the protocol exchange in one. A stage band over the run
// with the timeline's slider; under it, one lane per device and one arrow per recorded link crossing, for the stage
// being played (a window, so long runs stay readable); then every step, and the full exchange table on request.
// It has no playback state of its own: it reads the journey's position and moves it only through journey.step().
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { StepsList } from "./Journey.tsx";
import { trackOf, windowOf, type TrackArrow } from "./network/track.ts";
import { stageAt } from "./network/stages.ts";
import type { Journey } from "./useJourney.ts";
import type { Network } from "./network/model.ts";

export function Track({
  journey: j,
  network,
  onDevice,
  onInspect,
  onPickStep,
}: {
  journey: Journey;
  network: Network;
  /** A lane's device was chosen. */
  onDevice: (id: string) => void;
  /** Open the current message's headers. */
  onInspect: () => void;
  /** A step was chosen from the list (the playground then shows Now). */
  onPickStep?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  // The list of every step is built only while it is open: a long run has thousands.
  const [listOpen, setListOpen] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW((old) => (Math.round(el.clientWidth) === old ? old : Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const trace = j.trace;
  const last = (trace?.events.length ?? 1) - 1;
  // Until the run's result may be shown, the track shows only what has happened so far: the lanes fill in as it plays.
  const until = trace ? (j.revealed ? last : j.index) : -1;
  const seen = useMemo(() => (trace ? trackOf(trace.events.slice(0, until + 1), network) : null), [trace, until, network]);
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const narrow = w > 0 && w < 560;
  const labelW = narrow ? 92 : 112,
    laneH = narrow ? 28 : 24,
    spacing = narrow ? 13 : 10;
  const plotW = Math.max(120, w - labelW - 2);
  const [a, b] = trace ? windowOf(j.stages, j.index, last, (plotW - 16) / spacing) : [0, 0];
  const step = (plotW - 16) / (b - a + 1);
  const x = (i: number) => 8 + (i - a + 0.5) * step;
  const inWindow = (i: number) => i >= a && i <= b && i <= until;
  const arrows = (seen?.arrows ?? []).filter((r) => inWindow(r.index));
  const marks = (seen?.marks ?? []).filter((m) => inWindow(m.index));
  const ticks = trace ? trace.events.slice(a, Math.min(b, until) + 1).map((e, k) => ({ i: a + k, actor: e.actor, hop: !!e.hop })) : [];
  // A lane for every device the run has reached so far, in the order it reached them: the lanes stay put while the
  // window moves, so the track keeps its height and the learner's eye keeps its place.
  const lanes = seen?.lanes ?? [];
  const y = (d: string) => 6 + lanes.indexOf(d) * laneH + laneH / 2;
  const h = Math.max(1, lanes.length) * laneH + 12;
  // Keys move between link crossings of the whole (possibly gated) trace: moving on shows the next one, as the slider does.
  const hops = useMemo(() => (trace ? trace.events.flatMap((e, i) => (e.hop && e.packet ? [i] : [])) : []), [trace]);
  const pick = (i: number) => j.step(Math.max(0, Math.min(last, i)));
  function onPointer(e: PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    pick(Math.round((e.clientX - r.left - 8) / step - 0.5) + a);
  }
  function onKey(e: KeyboardEvent) {
    const move = (to: number | undefined) => {
      e.preventDefault();
      if (to !== undefined) pick(to);
    };
    if (e.key === "ArrowRight") move(hops.find((i) => i > j.index));
    else if (e.key === "ArrowLeft") move([...hops].reverse().find((i) => i < j.index));
    else if (e.key === "Home") move(a);
    else if (e.key === "End") move(b);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onInspect();
    }
  }
  const current = arrows.find((r) => r.index === j.index);
  const describe = (r: TrackArrow) =>
    `${r.lost ? "Lost: " : ""}${r.retransmit ? "resent " : ""}${r.broadcast ? "broadcast " : ""}${r.kind === "ip" ? "IP" : r.kind.toUpperCase()} frame, ${name(r.from)} ${r.forwarded ? "forwards it" : "sends it"} to ${name(r.to)}`;
  const k = stageAt(j.stages, j.index);
  const shownStages = j.stages.filter((s) => j.revealed || s.start <= until);
  const kindOfStage = (s: (typeof j.stages)[number]) =>
    s.error ? "stop" : (seen?.arrows ?? []).find((r) => r.index >= s.start && r.index <= s.end)?.kind ?? "none";
  // The step list and its stages, up to what has been shown.
  const listTrace = trace && until < last ? { ...trace, events: trace.events.slice(0, until + 1) } : trace;
  return (
    <div className="track" ref={box}>
      <input
        className="timeline-slider"
        type="range"
        aria-label="Journey timeline"
        min={0}
        max={Math.max(1, last)}
        value={j.index}
        disabled={!trace}
        aria-valuetext={trace ? (j.gated ? `Step ${j.index + 1}, later steps hidden` : `Event ${j.index + 1} of ${last + 1}`) : undefined}
        onChange={(e) => j.step(Math.min(last, Number(e.target.value)))}
      />
      {trace && (
        <>
          {/* Stages over the whole run, aligned with the slider: each is a band you can tap to go to it. */}
          <div className="track-band" aria-hidden="true">
            {j.stages.map((s, i) => {
              const known = shownStages.includes(s);
              return (
                <span
                  key={s.start}
                  className={`track-stage kind-${known ? kindOfStage(s) : "none"}${i === k ? " is-current" : ""}${s.end < j.index ? " is-past" : ""}`}
                  style={{ flexGrow: s.end - s.start + 1 }}
                  title={known ? s.title : undefined}
                  onClick={() => j.step(s.end)}
                >
                  {/* Named where there is room for a word; the title and the Now card name every stage. */}
                  {known && ((s.end - s.start + 1) / (last + 1)) * w > 56 && <b>{s.title.replace(/ · .*$/, "")}</b>}
                </span>
              );
            })}
          </div>
          <div className="track-lanes">
            <ul className="track-names" aria-label="Devices in this part of the run" style={{ width: labelW }}>
              {lanes.map((d) => (
                <li key={d} style={{ height: laneH }}>
                  <button className={d === trace.events[j.index]?.actor ? "is-active" : ""} onClick={() => onDevice(d)} title={name(d)}>
                    {name(d)}
                  </button>
                </li>
              ))}
            </ul>
            <div
              className="track-plot"
              role="group"
              tabIndex={0}
              aria-label={`Messages, events ${a + 1} to ${Math.min(b, until) + 1}${current ? `. Selected: ${describe(current)}` : ""}. Left and right arrows move between messages; Enter opens the packet.`}
              onKeyDown={onKey}
            >
              <svg width={plotW} height={h} viewBox={`0 0 ${plotW} ${h}`} onPointerDown={onPointer} aria-hidden="true">
                <defs>
                  <pattern id="track-hidden" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="8" className="track-hatch" />
                  </pattern>
                </defs>
                {lanes.map((d) => (
                  <line key={d} className="track-lane" x1="0" x2={plotW} y1={y(d)} y2={y(d)} />
                ))}
                {/* What has not happened yet: hidden until a prediction, or not reached on the first playthrough. */}
                {b > until && <rect className={j.gated ? "track-gate" : "track-ahead"} x={x(until) + step / 2} y="0" width={plotW - x(until) - step / 2} height={h} />}
                {j.gated && b >= until && (
                  <text className="track-gate-text" x={Math.min(plotW - 6, x(until) + step / 2 + 8)} y={h / 2 + 4}>
                    Hidden until you predict
                  </text>
                )}
                {ticks.filter((t) => !t.hop).map((t) => (
                  <circle key={`t${t.i}`} className="track-tick" cx={x(t.i)} cy={y(t.actor)} r={t.i === j.index ? 4.5 : 2} />
                ))}
                {arrows.map((r) => {
                  const ya = y(r.from),
                    yb = y(r.to),
                    dir = Math.sign(yb - ya) || 1,
                    xi = x(r.index),
                    end = r.lost ? (ya + yb) / 2 : yb - dir * 6;
                  return (
                    <g
                      key={r.index}
                      className={`track-arrow kind-${r.kind}${r.broadcast ? " is-broadcast" : ""}${r.lost ? " is-lost" : ""}${r.forwarded ? " is-forwarded" : ""}${r.index === j.index ? " is-current" : ""}`}
                      data-index={r.index}
                      data-from={r.from}
                      data-to={r.to}
                    >
                      <title>{`Event ${r.index + 1}: ${describe(r)}`}</title>
                      <line x1={xi} x2={xi} y1={ya} y2={end} />
                      {!r.lost && <path d={`M${xi - 4} ${yb - dir * 10} L${xi} ${yb - dir * 3} L${xi + 4} ${yb - dir * 10}Z`} />}
                      {/* Who put it on the link: filled for the device that created it, hollow for one sending it on. */}
                      <circle className="track-origin" cx={xi} cy={ya} r="3.5" />
                      {r.lost && <path className="track-lost" d={`M${xi - 5} ${end - 5} L${xi + 5} ${end + 5} M${xi + 5} ${end - 5} L${xi - 5} ${end + 5}`} />}
                      {r.retransmit && (
                        <text className="track-resent" x={xi + 5} y={ya - 5}>
                          ↻
                        </text>
                      )}
                    </g>
                  );
                })}
                {marks.map((m) => (
                  <g key={`${m.how}${m.index}${m.device}`} className={`track-mark is-${m.how}`} transform={`translate(${x(m.index)} ${y(m.device)})`}>
                    <title>{`Event ${m.index + 1}: ${m.how === "delivered" ? "delivered to" : m.how === "discarded" ? "discarded at" : "delivery stopped at"} ${name(m.device)}`}</title>
                    <circle r="6" />
                    <path d={m.how === "delivered" ? "M-3 0 L-1 2.5 L3.5 -2.5" : "M-2.5 -2.5 L2.5 2.5 M2.5 -2.5 L-2.5 2.5"} />
                  </g>
                ))}
                {j.index >= a && j.index <= b && <line className="track-playhead" x1={x(j.index)} x2={x(j.index)} y1="0" y2={h} />}
              </svg>
            </div>
          </div>
          <div className="track-foot">
            <span className="track-range">
              {b - a < last ? `${j.gated ? "Steps" : "Events"} ${a + 1}–${Math.min(b, until) + 1}${j.gated ? "" : ` of ${last + 1}`}` : ""}
            </span>
            <span className="track-key" aria-hidden="true">
              <i className="k-send" /> sends <i className="k-fwd" /> forwards <i className="k-bc" /> broadcast <b className="k-lost">✕</b> lost <b>↻</b> resent{" "}
              <b className="k-ok">✓</b> delivered
            </span>
            <button className="text-button" aria-expanded={j.fullExchange} onClick={() => j.setFullExchange(!j.fullExchange)}>
              {j.fullExchange ? "Close full exchange" : "Open full exchange"}
            </button>
          </div>
          <details className="track-steps" onToggle={(e) => setListOpen(e.currentTarget.open)}>
            <summary>All steps ({until + 1})</summary>
            {listOpen && listTrace && (
              <StepsList
                trace={listTrace}
                stages={j.stages.filter((s) => s.start <= until).map((s) => ({ ...s, end: Math.min(s.end, until) }))}
                index={j.index}
                mode={j.mode}
                network={network}
                onStep={(i) => {
                  j.step(i);
                  onPickStep?.();
                }}
              />
            )}
          </details>
        </>
      )}
    </div>
  );
}
