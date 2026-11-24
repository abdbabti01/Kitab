import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleMinus, CircleX, ShieldCheck } from "lucide-react";
import { linkProps } from "../../app/router.ts";
import { ExploreGuide } from "../../ui/ExploreGuide.tsx";
import { CyclePanel, useCycle } from "../../ui/PredictCycle.tsx";
import { TableScroll } from "../../ui/TableScroll.tsx";
import type { Cycle } from "../../learning/cycle.ts";
import { RULES, audit, compare, describe, orders, people, ruleInfo, securePolicy, type AccessRequest, type Action, type Credential, type Decision, type Rule } from "../authz.ts";
import { findIdentityCycle, type AuthzSetup } from "../cycles.ts";
import { IDENTITY_PLAYGROUND } from "../catalog.ts";
import "./identity.css";

const actions: { value: Action; label: string }[] = [{ value: "read", label: "Read the order" }, { value: "refund", label: "Refund the order" }, { value: "delete", label: "Delete the order" }];
const credentials: { value: Credential; label: string }[] = [
  { value: "valid", label: "Valid access token for this API" },
  { value: "missing", label: "No token" },
  { value: "expired", label: "Expired token" },
  { value: "wrong-audience", label: "Token issued for another API" },
  { value: "no-scope", label: "Token without the orders scopes" },
];
const resultIcon = { pass: CircleCheck, fail: CircleX, "not-checked": CircleMinus };

/** The API's decision, step by step, in the order a resource server checks. */
export function DecisionView({ decision, secure }: { decision: Decision; secure?: Decision }) {
  const verdict = secure ? (decision.allow === secure.allow ? "agrees" : decision.allow ? "too-permissive" : "too-strict") : null;
  return (
    <section className="az-decision" aria-label="The API's decision">
      <ol className="ti-steps">
        {decision.steps.map((s, i) => {
          const Icon = resultIcon[s.result];
          return (
            <li key={s.id} className={`is-${s.result === "not-checked" ? "skipped" : s.result}`}>
              <Icon aria-hidden="true" />
              <span><b>{i + 1}. {s.question}</b> {s.result === "pass" ? "Yes." : s.result === "fail" ? "No." : "Not checked."}<br />{s.detail}</span>
            </li>
          );
        })}
      </ol>
      <p className={`id-outcome ${decision.allow ? "is-good" : "is-bad"}`} role="status">
        {decision.allow ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
        <span><b>{decision.allow ? `Allowed (${decision.status})` : `Refused (${decision.status})`}.</b> {decision.reason}</span>
      </p>
      {verdict && verdict !== "agrees" && (
        <p className={`id-outcome ${verdict === "too-permissive" ? "is-breach" : "is-warn"}`}>
          <span><b>{verdict === "too-permissive" ? "Unauthorized access." : "Legitimate access blocked."}</b> A secure policy would {secure!.allow ? "allow" : "refuse"} this request ({secure!.reason})</span>
        </p>
      )}
    </section>
  );
}

function Guided({ cycle, onLeave }: { cycle: Cycle<AuthzSetup, Decision>; onLeave: () => void }) {
  const c = useCycle(cycle);
  return (
    <>
      <div className="guided-banner" role="region" aria-label="Mode">
        <p><b>Guided experiment.</b> The request and rules are fixed while you predict and test.</p>
        <button type="button" className="button" onClick={onLeave}>Leave and explore freely</button>
      </div>
      <div className="id-layout is-guided">
        <div className="id-side"><CyclePanel c={c} /></div>
        <section className="id-workbench">{c.run ? <DecisionView decision={c.run} /> : <p className="id-locked">Commit a prediction to see the API's decision.</p>}</section>
      </div>
    </>
  );
}

/** RBAC, ABAC, relationships and tenants on one orders API. Free exploration records nothing. */
export function AuthorizationPlayground() {
  const [request, setRequest] = useState<AccessRequest>({ subject: "alice", action: "read", order: "124", credential: "valid" });
  const [rules, setRules] = useState<Rule[]>(["audience", "scope", "role"]);
  const [guided, setGuided] = useState(() => findIdentityCycle(new URLSearchParams(window.location.search).get("experiment"))?.id ?? null);
  const cycle = findIdentityCycle(guided) as Cycle<AuthzSetup, Decision> | undefined;
  const result = useMemo(() => compare(request, rules), [request, rules]);
  const table = useMemo(() => audit(rules), [rules]);
  useEffect(() => {
    document.title = "Authorization Playground — Kitab";
  }, []);
  const set = (patch: Partial<AccessRequest>) => setRequest((r) => ({ ...r, ...patch }));
  const toggle = (rule: Rule, on: boolean) => setRules((list) => (on ? RULES.filter((r) => list.includes(r) || r === rule) : list.filter((r) => r !== rule)));
  const leave = () => {
    setRequest(cycle!.base.setup.request);
    setRules(cycle!.base.setup.rules);
    setGuided(null);
    window.history.replaceState(null, "", "/practice/identity/authorization");
  };

  return (
    <main id="main" className="page lab-page authz-playground lab-theme">
      <header className="playground-heading">
        <div className="playground-title">
          <ShieldCheck className="playground-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Identity &amp; security · Playground</p>
            <h1>Authorization Playground</h1>
            <p>An orders API serving two companies. Choose who calls it, with which token, and which rules the API enforces, then watch it decide, one check at a time. Deny by default: nothing is allowed unless a rule grants it.</p>
          </div>
        </div>
        <p className="heading-links"><a {...linkProps("/learn/identity/authorization")}>Learn: authorization architecture</a> · <a {...linkProps(IDENTITY_PLAYGROUND)}>Identity Playground</a> · <a {...linkProps("/practice/identity/challenges/fix-api-policy")}>Challenge: fix an API policy</a></p>
      </header>
      {cycle ? <Guided key={cycle.id} cycle={cycle} onLeave={leave} /> : (
        <>
          <ExploreGuide
            build="Pick a caller, an action, an order and a token, then switch the API's rules on and off. The decision shows every step; the table below runs a fixed set of requests and marks where your rules disagree with a secure policy."
            tryThis={["Alice reads order 124 (Frank's) with only role checks on. Then turn on ownership.", "Dave, a Globex admin, reads order 123. Which rule stops him?", "Turn every rule off: what does deny by default do?", "Turn on “Only admins” and look at the table: who did it lock out?"]}
            controls={[{ name: "Request", does: "Who calls, what they do, which order, and what token they present." }, { name: "Rules", does: "The checks the API enforces. Authentication (signature and expiry) is always on." }, { name: "Every request", does: "A fixed suite of requests judged against a secure policy: too permissive means unauthorized access, too strict means real users are blocked." }]}
            guided={<>To predict first: <a {...linkProps("/practice/identity/authorization?experiment=id-tenant")} onClick={(e) => { e.preventDefault(); setGuided("id-tenant"); window.history.replaceState(null, "", "/practice/identity/authorization?experiment=id-tenant"); }}>An admin from another tenant</a>.</>}
          />
          <div className="az-layout">
            <section className="az-panel" aria-labelledby="request-title">
              <h2 id="request-title">Request</h2>
              <label className="id-field"><span>Caller</span>
                <select aria-label="Caller" value={request.subject} onChange={(e) => set({ subject: e.target.value })}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}: {p.role}{p.department ? `, ${p.department}` : ""} at {p.tenant}</option>)}
                </select>
              </label>
              <label className="id-field"><span>Action</span>
                <select aria-label="Action" value={request.action} onChange={(e) => set({ action: e.target.value as Action })}>{actions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
              </label>
              <label className="id-field"><span>Order</span>
                <select aria-label="Order" value={request.order} onChange={(e) => set({ order: e.target.value })}>
                  {orders.map((o) => <option key={o.id} value={o.id}>#{o.id}: {o.tenant}, owner {o.owner}, {o.amount}, {o.status}</option>)}
                </select>
              </label>
              <label className="id-field"><span>Token</span>
                <select aria-label="Token" value={request.credential} onChange={(e) => set({ credential: e.target.value as Credential })}>{credentials.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
              </label>
              <p className="id-request"><code>{describe(request)}</code></p>
              <h2>Rules the API enforces</h2>
              <p className="muted"><CircleCheck aria-hidden="true" className="inline-icon" /> Always: token signature, issuer and expiry.</p>
              <fieldset className="az-rules">
                <legend className="sr-only">Rules</legend>
                {RULES.map((rule) => (
                  <label key={rule} className="id-check-toggle">
                    <input type="checkbox" checked={rules.includes(rule)} onChange={(e) => toggle(rule, e.target.checked)} />
                    <span><b>{ruleInfo[rule].label}</b><small>{ruleInfo[rule].help}</small></span>
                  </label>
                ))}
              </fieldset>
              <div className="actions">
                <button type="button" className="text-button" onClick={() => setRules([...securePolicy])}>Use the secure policy</button>
                <button type="button" className="text-button" onClick={() => setRules([])}>Turn every rule off</button>
              </div>
            </section>
            <section className="az-panel" aria-labelledby="decision-title">
              <h2 id="decision-title">Decision</h2>
              <DecisionView decision={result.got} secure={result.want} />
            </section>
          </div>
          <section className="az-panel" aria-labelledby="suite-title">
            <h2 id="suite-title">Every request, under these rules</h2>
            <p role="status">{table.tooPermissive === 0 && table.tooStrict === 0 ? "These rules match a secure policy on every request." : `${table.tooPermissive} unauthorized ${table.tooPermissive === 1 ? "request" : "requests"} allowed, ${table.tooStrict} legitimate ${table.tooStrict === 1 ? "request" : "requests"} blocked.`}</p>
            <TableScroll label="Every request under these rules">
              <table className="az-table">
                <thead><tr><th scope="col">Request</th><th scope="col">Your API</th><th scope="col">Secure policy</th><th scope="col">Verdict</th></tr></thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.label} className={`is-${r.verdict}`}>
                      <th scope="row"><button type="button" className="text-button" onClick={() => setRequest(r.request)}>{r.label}</button></th>
                      <td>{r.got.allow ? "Allowed" : "Refused"} ({r.got.status})</td>
                      <td>{r.want.allow ? "Allowed" : "Refused"} ({r.want.status})</td>
                      <td>{r.verdict === "agrees" ? "Correct" : r.verdict === "too-permissive" ? "Unauthorized access" : "Wrongly blocked"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>
        </>
      )}
    </main>
  );
}
