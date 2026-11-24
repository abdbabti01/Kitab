// The views of one protocol run. Every one of them reads the run's event stream (or its fold, stateAt), so the
// sequence, the message inspector, the state panel and the outcome can never disagree.
import { useEffect, useRef, useState } from "react";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, CircleCheck, CircleX, Pause, Play, ShieldAlert } from "lucide-react";
import { outcomeOf, stateAt, type Actor, type ActorId, type FlowEvent, type FlowRun, type Token } from "../model.ts";

const shortLabel: Partial<Record<ActorId, string>> = { idp: "IdP", authenticator: "Authenticator" };
const short = (a: Actor) => shortLabel[a.id] && a.label === "Identity provider" ? shortLabel[a.id]! : a.label.replace(/ \(.*\)$/, "");
const channelLabel = { front: "front channel (through the browser)", back: "back channel (direct HTTPS)", internal: "inside one party" };

/** The actors this run actually uses, in the scenario's order. */
export const usedActors = (run: FlowRun) => run.actors.filter((a) => run.events.some((e) => e.from === a.id || e.to === a.id));
const actorName = (run: FlowRun, id: ActorId) => run.actors.find((a) => a.id === id)?.label ?? id;

export function describeEvent(run: FlowRun, e: FlowEvent) {
  const failedCheck = e.checks?.find((c) => !c.ok);
  const route = e.from === e.to ? actorName(run, e.from) : `${actorName(run, e.from)} to ${actorName(run, e.to)}`;
  return `Step ${e.step + 1}: ${route}, ${e.title}${failedCheck ? `. Failed check: ${failedCheck.label}` : ""}`;
}

/** Playback over a run: a position, play and pause. Position 0 shows the first event. Reset when the run changes. */
export function usePlayback(run: FlowRun, key: string, enabled = true) {
  const [state, setState] = useState({ key, at: 0, playing: false });
  const at = state.key === key ? state.at : 0;
  const playing = state.key === key && state.playing && enabled;
  const last = run.events.length - 1;
  const go = (to: number, keepPlaying = false) => setState({ key, at: Math.max(0, Math.min(last, to)), playing: keepPlaying });
  useEffect(() => {
    if (!playing) return;
    if (at >= last) return void setState((s) => ({ ...s, playing: false }));
    const timer = setTimeout(() => setState((s) => (s.key === key ? { ...s, at: Math.min(last, s.at + 1) } : s)), 1100);
    return () => clearTimeout(timer);
  }, [playing, at, last, key]);
  return { at, playing, last, go, play: () => setState({ key, at: at >= last ? 0 : at, playing: true }), pause: () => setState((s) => ({ ...s, playing: false })) };
}
export type Playback = ReturnType<typeof usePlayback>;

export function PlaybackBar({ playback, run }: { playback: Playback; run: FlowRun }) {
  const { at, last, playing, go, play, pause } = playback;
  return (
    <div className="id-playback" role="group" aria-label="Playback">
      <button type="button" className="icon-button" onClick={() => go(0)} disabled={at === 0} aria-label="Restart: first step" title="Restart"><ChevronFirst aria-hidden="true" /></button>
      <button type="button" className="icon-button" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous step" title="Previous"><ChevronLeft aria-hidden="true" /></button>
      {playing ? (
        <button type="button" className="button" onClick={pause}><Pause aria-hidden="true" /> Pause</button>
      ) : (
        <button type="button" className="button primary" onClick={play}><Play aria-hidden="true" /> {at >= last ? "Replay" : at === 0 ? "Start" : "Play"}</button>
      )}
      <button type="button" className="icon-button" onClick={() => go(at + 1)} disabled={at >= last} aria-label="Next step" title="Next"><ChevronRight aria-hidden="true" /></button>
      <button type="button" className="icon-button" onClick={() => go(last)} disabled={at >= last} aria-label="Last step" title="Last step"><ChevronLast aria-hidden="true" /></button>
      <span className="id-position" aria-live="polite">Step {at + 1} of {run.events.length}</span>
    </div>
  );
}

/**
 * The sequence diagram: one column per party, one row per message, an arrow from sender to receiver. Only the
 * steps up to the current one are drawn, so a prediction is never given away by steps not yet reached.
 */
export function Sequence({ run, at, onSelect, revealAll = false, plain = false, label = "Messages in this run" }: { run: FlowRun; at: number; onSelect?: (step: number) => void; revealAll?: boolean; /** Hide pass/fail flags (diagnosis challenges). */ plain?: boolean; label?: string }) {
  const actors = usedActors(run);
  const column = (id: ActorId) => actors.findIndex((a) => a.id === id);
  const shown = revealAll ? run.events : run.events.slice(0, at + 1);
  const current = useRef<HTMLLIElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const mounted = useRef(false);
  // Keep the current message visible inside the list as the learner moves; never scroll the page, never on arrival.
  useEffect(() => {
    if (!mounted.current) return void (mounted.current = true);
    const l = list.current, c = current.current;
    if (!l || !c) return;
    if (c.offsetTop < l.scrollTop) l.scrollTop = c.offsetTop;
    else if (c.offsetTop + c.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = c.offsetTop + c.offsetHeight - l.clientHeight;
  }, [at]);
  return (
    <div className="id-sequence" style={{ ["--cols" as string]: actors.length }}>
      <ol className="id-actors" aria-hidden="true">
        {actors.map((a) => <li key={a.id} title={a.role}>{short(a)}</li>)}
      </ol>
      <ol ref={list} className="id-events" aria-label={label}>
        {shown.map((e) => {
          const a = column(e.from);
          const b = column(e.to);
          const left = Math.min(a, b);
          const span = Math.abs(b - a);
          const failed = e.checks?.find((c) => !c.ok);
          const passed = e.checks?.filter((c) => c.ok).length ?? 0;
          const cls = ["id-event", `is-${e.channel}`, e.step === at ? "is-current" : "", failed && !plain ? (failed.kind === "security" ? "is-breach" : "is-failed") : ""].join(" ");
          const body = (
            <>
              <span className="id-lane" aria-hidden="true">
                {actors.map((x) => <i key={x.id} />)}
                {span === 0 ? (
                  <b className="id-self" style={{ left: `calc(${(a + 0.5) / actors.length} * 100%)` }} />
                ) : (
                  <b className={`id-arrow ${b > a ? "to-right" : "to-left"}`} style={{ left: `calc(${(left + 0.5) / actors.length} * 100%)`, width: `calc(${span / actors.length} * 100%)` }} />
                )}
              </span>
              <span className="id-event-text">
                <span className="id-step">{e.step + 1}</span>
                <span className="id-route">{e.from === e.to ? short(actors[a]) : `${short(actors[a])} → ${short(actors[b])}`}</span>
                <span className="id-title">{e.title}</span>
                {plain ? null : failed ? (
                  <span className="id-flag is-bad">{failed.kind === "security" ? <ShieldAlert aria-hidden="true" /> : <CircleX aria-hidden="true" />}{failed.label}</span>
                ) : passed > 0 ? (
                  <span className="id-flag is-good"><CircleCheck aria-hidden="true" />{passed} {passed === 1 ? "check" : "checks"}</span>
                ) : null}
              </span>
            </>
          );
          return (
            <li key={e.step} ref={e.step === at ? current : undefined} className={cls}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(e.step)} aria-current={e.step === at ? "step" : undefined} aria-label={plain ? `Step ${e.step + 1}: ${e.title}` : describeEvent(run, e)}>{body}</button>
              ) : <div aria-label={describeEvent(run, e)}>{body}</div>}
            </li>
          );
        })}
      </ol>
      {!revealAll && at < run.events.length - 1 && <p className="id-more">{run.events.length - at - 1} more {run.events.length - at - 1 === 1 ? "step" : "steps"}: press Next.</p>}
    </div>
  );
}

const Pairs = ({ rows, caption }: { rows: [string, string][]; caption: string }) => (
  <table className="id-pairs">
    <caption>{caption}</caption>
    <tbody>{rows.map(([k, v], i) => <tr key={`${k}-${i}`}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody>
  </table>
);

export function TokenView({ token }: { token: Token }) {
  return (
    <details className="id-token">
      <summary><b>{token.label}</b> <span className="muted">· {token.format === "jwt" ? "JWT" : token.format === "xml" ? "XML" : token.format}{token.signedBy ? ` · signed with ${token.signedBy} (modelled)` : ""}</span></summary>
      {token.header && <><h4>Header</h4><pre>{JSON.stringify(token.header, null, 2)}</pre></>}
      {token.claims && <><h4>Claims</h4><pre>{JSON.stringify(token.claims, null, 2)}</pre></>}
      {!token.header && <pre>{token.value}</pre>}
      <p className="muted">Synthetic. {token.format === "jwt" ? "The signature is tracked by key id here; verify real signatures in the Token Inspector." : ""}</p>
    </details>
  );
}

/** Everything about one message: what, who, why, what protects it, what was checked, and what happens next. */
export function EventInspector({ run, event }: { run: FlowRun; event: FlowEvent }) {
  const from = actorName(run, event.from);
  const to = actorName(run, event.to);
  return (
    <article className="id-inspector" aria-labelledby="id-inspector-title">
      <p className="eyebrow">Step {event.step + 1} · {event.kind === "action" ? "action" : event.kind} · {channelLabel[event.channel]}</p>
      <h3 id="id-inspector-title">{event.title}</h3>
      <p className="id-parties">{event.from === event.to ? <><b>{from}</b>, on its own</> : <><b>{from}</b> → <b>{to}</b></>}{event.t > 0 && <span className="muted"> · t + {event.t} s</span>}</p>
      {(event.method || event.endpoint || event.status) && (
        <p className="id-request"><code>{[event.method, event.endpoint].filter(Boolean).join(" ")}{event.status ? `${event.method ? " → " : ""}HTTP ${event.status}` : ""}</code></p>
      )}
      <h4>Why</h4>
      <p>{event.purpose}</p>
      {event.protects && <><h4>What protects it</h4><p>{event.protects}</p></>}
      {event.checks && event.checks.length > 0 && (
        <>
          <h4>Checks</h4>
          <ul className="id-checks">
            {event.checks.map((c) => (
              <li key={c.id} className={c.ok ? "is-good" : "is-bad"}>
                {c.ok ? <CircleCheck aria-hidden="true" /> : c.kind === "security" ? <ShieldAlert aria-hidden="true" /> : <CircleX aria-hidden="true" />}
                <span><b>{c.ok ? "Passed" : "Failed"}: {c.label}.</b> {c.detail}{c.rule && <small> ({c.rule})</small>}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {event.ifFails && <><h4>If a check fails</h4><p>{event.ifFails}</p></>}
      {event.headers && event.headers.length > 0 && <Pairs rows={event.headers} caption="Headers" />}
      {event.params && event.params.length > 0 && <Pairs rows={event.params} caption="Parameters" />}
      {event.body && <><h4>Body</h4><pre className="id-body">{event.body}</pre></>}
      {event.tokens?.map((t) => <TokenView key={t.label} token={t} />)}
      {event.next && <p className="muted"><b>Next:</b> {event.next}</p>}
    </article>
  );
}

const placeLabel: Partial<Record<ActorId, string>> = { browser: "Browser (cookies are kept per site)" };

/** What each party holds after the current step: a fold of the events, nothing else. */
export function StatePanel({ run, at }: { run: FlowRun; at: number }) {
  const world = stateAt(run, at);
  const places = run.actors.filter((a) => world[a.id] && Object.keys(world[a.id]!).length);
  return (
    <section className="id-state" aria-labelledby="id-state-title">
      <h3 id="id-state-title">State after step {at + 1}</h3>
      {places.length === 0 && <p className="muted">Nothing is held yet.</p>}
      {places.map((a) => (
        <div key={a.id} className="id-place">
          <h4>{placeLabel[a.id] ?? a.label}</h4>
          <dl>
            {Object.entries(world[a.id]!).map(([key, held]) => (
              <div key={key} className={held.since === at ? "is-new" : undefined}>
                <dt>{key}{held.since === at && <span className="sr-only"> (changed in this step)</span>}</dt>
                <dd>{held.value}{held.note && <small> {held.note}</small>}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}

/** The run's result, shown once the last step is reached. */
export function OutcomeBanner({ run }: { run: FlowRun }) {
  const out = outcomeOf(run);
  const security = out.check?.kind === "security";
  return (
    <p className={`id-outcome ${out.ok ? "is-good" : security ? "is-breach" : "is-bad"}`} role="status">
      {out.ok ? <CircleCheck aria-hidden="true" /> : security ? <ShieldAlert aria-hidden="true" /> : <CircleX aria-hidden="true" />}
      <span><b>{out.ok ? "Completed." : security ? "An attacker succeeded." : "The flow stopped."}</b> {out.ok ? "Every check passed." : `${out.check!.label}: ${out.check!.detail}`}</span>
    </p>
  );
}

type Tab = "sequence" | "message" | "state";

/** The three views of one run; on narrow screens they become tabs. */
export function Workbench({ run, playback, locked = false }: { run: FlowRun; playback: Playback; locked?: boolean }) {
  const [tab, setTab] = useState<Tab>("sequence");
  const event = run.events[playback.at];
  if (locked) return <section className="id-workbench is-locked"><p className="id-locked">Commit a prediction to run the scenario. The messages appear here, step by step.</p></section>;
  const tabs: { id: Tab; label: string }[] = [{ id: "sequence", label: "Sequence" }, { id: "message", label: "Message" }, { id: "state", label: "State" }];
  return (
    <section className="id-workbench" aria-label="Run">
      <PlaybackBar playback={playback} run={run} />
      {playback.at === playback.last && <OutcomeBanner run={run} />}
      <div className="id-tabs" role="tablist" aria-label="Views">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`id-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`id-panel-${t.id}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="id-panes">
        <div id="id-panel-sequence" role="tabpanel" aria-labelledby="id-tab-sequence" className={`id-pane is-sequence${tab === "sequence" ? " is-active" : ""}`}>
          <Sequence run={run} at={playback.at} onSelect={(step) => { playback.go(step); }} />
        </div>
        <div id="id-panel-message" role="tabpanel" aria-labelledby="id-tab-message" className={`id-pane is-message${tab === "message" ? " is-active" : ""}`}>
          {event && <EventInspector run={run} event={event} />}
        </div>
        <div id="id-panel-state" role="tabpanel" aria-labelledby="id-tab-state" className={`id-pane is-state${tab === "state" ? " is-active" : ""}`}>
          <StatePanel run={run} at={playback.at} />
        </div>
      </div>
    </section>
  );
}

