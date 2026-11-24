import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, KeyRound, RotateCcw } from "lucide-react";
import { linkProps } from "../../app/router.ts";
import { ExploreGuide } from "../../ui/ExploreGuide.tsx";
import { CyclePanel, useCycle } from "../../ui/PredictCycle.tsx";
import { cyclesFor } from "../../learning/cycle-catalog.ts";
import { safeStorage } from "../../learning/progress.ts";
import { parseConfig, runScenario, type Config, type FlowRun, type Scenario } from "../model.ts";
import { findScenario, scenarios } from "../flows/index.ts";
import { findIdentityCycle, type FlowSetup } from "../cycles.ts";
import { loadIdentityProgress, savePlayground } from "../progress.ts";
import { AUTHZ_PLAYGROUND, TOKEN_INSPECTOR } from "../catalog.ts";
import { Workbench, usePlayback } from "./Trace.tsx";
import type { Cycle } from "../../learning/cycle.ts";
import "./identity.css";

/** Only same-site paths under /learn may be "back" links. */
const safeReturn = (value: string | null) => (value && /^\/learn\/[\w\-/#]*$/.test(value) ? value : null);

function readQuery(): { scenario: Scenario; config: Config } {
  const query = new URLSearchParams(window.location.search);
  let scenario = findScenario(query.get("scenario") ?? "");
  let raw: Record<string, string | undefined> = Object.fromEntries(query);
  if (!scenario) {
    const saved = loadIdentityProgress(safeStorage()).prefs.playground;
    scenario = findScenario(saved?.scenario ?? "") ?? scenarios[0];
    raw = saved?.config ?? {};
  }
  return { scenario, config: parseConfig(scenario, raw) };
}

const pathFor = (scenario: Scenario, config: Config, from: string | null) => {
  const query = new URLSearchParams({ scenario: scenario.id });
  for (const control of scenario.controls) if (config[control.id] !== control.options[0].value) query.set(control.id, config[control.id]);
  if (from) query.set("from", from);
  return `/practice/identity?${query}`;
};

function Controls({ scenario, config, onChange }: { scenario: Scenario; config: Config; onChange: (config: Config) => void }) {
  const field = (level: "basic" | "advanced" | "fault") =>
    scenario.controls.filter((c) => c.level === level).map((control) => (
      <label key={control.id} className="id-field">
        <span>{control.label}</span>
        <select value={config[control.id]} onChange={(e) => onChange(parseConfig(scenario, { ...config, [control.id]: e.target.value }))} aria-describedby={`help-${control.id}`}>
          {control.options.map((o) => <option key={o.value} value={o.value} disabled={o.when ? !o.when(config) : false}>{o.label}</option>)}
        </select>
        <small id={`help-${control.id}`}>{control.help}</small>
      </label>
    ));
  const advanced = field("advanced");
  const faults = field("fault");
  return (
    <div className="id-controls">
      {field("basic")}
      {advanced.length > 0 && <details className="id-more-settings"><summary>More settings</summary>{advanced}</details>}
      {faults}
    </div>
  );
}

function GuidedIdentity({ cycle, onLeave }: { cycle: Cycle<FlowSetup, FlowRun>; onLeave: () => void }) {
  const c = useCycle(cycle);
  const setup = c.trial.setup;
  const run = useMemo(() => c.run ?? runScenario(findScenario(setup.scenario)!, setup.config), [c.run, setup]);
  const playback = usePlayback(run, `${c.state.attempt}:${c.state.trial}`, !c.locked);
  return (
    <>
      <div className="guided-banner" role="region" aria-label="Mode">
        <p><b>Guided experiment.</b> The setup is fixed while you predict and test it.</p>
        <button type="button" className="button" onClick={onLeave}>Leave and explore freely</button>
      </div>
      <div className="id-layout is-guided">
        <div className="id-side"><CyclePanel c={c} onShow={(at) => playback.go(at)} /></div>
        <Workbench run={run} playback={playback} locked={c.locked} />
      </div>
    </>
  );
}

/**
 * The Identity Playground: choose a scenario and its settings, then follow every message. Free exploration records
 * nothing except the last scenario and settings (to reopen them); a guided experiment (?experiment=) keeps its own
 * small record (cycle-progress.ts).
 */
export function IdentityPlayground() {
  const [{ scenario, config }, setState] = useState(readQuery);
  const [guided, setGuided] = useState(() => findIdentityCycle(new URLSearchParams(window.location.search).get("experiment"))?.id ?? null);
  const cycle = findIdentityCycle(guided) as Cycle<FlowSetup, FlowRun> | undefined;
  const from = useMemo(() => safeReturn(new URLSearchParams(window.location.search).get("from")), []);
  const key = `${scenario.id}:${JSON.stringify(config)}`;
  const run = useMemo(() => runScenario(scenario, config), [key]);
  const playback = usePlayback(run, key);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    document.title = "Identity Playground — Kitab";
  }, []);
  useEffect(() => {
    window.history.replaceState(null, "", cycle ? `/practice/identity?experiment=${cycle.id}` : pathFor(scenario, config, from));
    if (!cycle) setSaveFailed(!savePlayground(safeStorage(), scenario.id, config).saved);
  }, [key, cycle]);

  const choose = (next: Scenario) => setState({ scenario: next, config: parseConfig(next, {}) });
  const leave = () => {
    const s = findScenario(cycle!.base.setup.scenario)!;
    setState({ scenario: s, config: parseConfig(s, cycle!.base.setup.config) });
    setGuided(null);
  };

  return (
    <main id="main" className="page lab-page identity-playground lab-theme">
      <header className="playground-heading">
        <div className="playground-title">
          <KeyRound className="playground-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Identity &amp; security · Playground</p>
            <h1>Identity Playground</h1>
            <p>Run a sign-in, single sign-on, a service-to-service call or a SAML login, and follow every redirect, request, token and check. Each step is computed by Kitab's deterministic protocol model, with synthetic users and tokens.</p>
          </div>
        </div>
        <p className="heading-links">
          {from && <><a {...linkProps(from)}><ArrowLeft aria-hidden="true" /> Back to your lesson</a> · </>}
          <a {...linkProps("/learn/identity")}>Identity track</a> · <a {...linkProps(TOKEN_INSPECTOR)}>Token Inspector</a> · <a {...linkProps(AUTHZ_PLAYGROUND)}>Authorization Playground</a> · <a {...linkProps("/practice?track=identity")}>Challenges</a>
        </p>
      </header>
      {cycle ? (
        <GuidedIdentity key={cycle.id} cycle={cycle} onLeave={leave} />
      ) : (
        <>
          <ExploreGuide
            build="Pick a scenario, keep the defaults for the correct flow, then change one setting or break one thing and run it again. Step through with Next, or press Start to play it. Select any message to inspect it."
            tryThis={[
              "In “Sign in with OpenID Connect”, step to the token request and compare what travels in the front channel with what travels in the back channel.",
              "Break something: give the callback a different state, then a wrong code_verifier. Which party catches each, and at which step?",
              "In “Single sign-on”, choose “Log out of the Portal only” and look at the State tab: which sessions are left?",
              "In “MFA factors and a phishing proxy”, sign in through the proxy with a code, then with a passkey.",
            ]}
            controls={[
              { name: "Scenario", does: "Which protocol or flow runs. Each lists the standards it follows and what it leaves out." },
              { name: "Settings", does: "Only the settings that matter for that scenario. More settings holds the advanced ones." },
              { name: "Break something", does: "Injects one fault, such as a wrong state, verifier, audience or key, so you can see which check stops it." },
              { name: "Start, Pause, Previous, Next", does: "Move through the messages. Later messages appear only when you reach them." },
              { name: "Sequence, Message, State", does: "The diagram of who sent what; everything about the selected message; and what each party holds after it." },
            ]}
            guided={<>To predict first, open a guided experiment: {cyclesFor("identity").map((c, i) => <span key={c.id}>{i > 0 && ", "}<a {...linkProps(c.path)}>{c.title}</a></span>)}.</>}
          />
          {saveFailed && <p className="inline-issue is-warning">This browser isn't keeping your last scenario; everything still works on this page.</p>}
          <div className="id-layout">
            <aside className="id-side" aria-label="Scenario and settings">
              <h2 className="id-side-title">Scenario</h2>
              <ul className="id-scenarios">
                {scenarios.map((s) => (
                  <li key={s.id}><button type="button" aria-pressed={s.id === scenario.id} onClick={() => choose(s)}><b>{s.title}</b></button></li>
                ))}
                <li><a {...linkProps(TOKEN_INSPECTOR)}><b>JWT validation</b><small>Token Inspector · real signatures</small></a></li>
                <li><a {...linkProps(AUTHZ_PLAYGROUND)}><b>RBAC, ABAC and tenants</b><small>Authorization Playground</small></a></li>
              </ul>
              <p className="id-summary">{scenario.summary}</p>
              <Controls scenario={scenario} config={config} onChange={(next) => setState({ scenario, config: next })} />
              <button type="button" className="text-button" onClick={() => setState({ scenario, config: parseConfig(scenario, {}) })}><RotateCcw aria-hidden="true" className="inline-icon" /> Reset settings</button>
              <details className="id-about">
                <summary>Standards and limits</summary>
                <p><b>Follows:</b> {scenario.standards.join("; ")}.</p>
                <p>{scenario.modelNote}</p>
                <p><b>Not modelled:</b></p>
                <ul>{scenario.notModelled.map((n) => <li key={n}>{n}</li>)}</ul>
              </details>
            </aside>
            <Workbench run={run} playback={playback} />
          </div>
        </>
      )}
    </main>
  );
}
