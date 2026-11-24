import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleMinus, CircleX, FileKey2, ShieldAlert } from "lucide-react";
import { linkProps } from "../../app/router.ts";
import { AUDIENCE, ISSUER, decode, generateKey, samples, sign, tamper, validate, type Decoded, type KeyPair, type Sample, type Validation } from "../jwt.ts";
import { IDENTITY_PLAYGROUND } from "../catalog.ts";
import "./identity.css";

type Keys = { current: KeyPair; next: KeyPair; attacker: KeyPair; rsa: KeyPair };
const SKEW = 60;

function Segments({ token }: { token: string }) {
  const [h, p, s] = token.split(".");
  return (
    <p className="ti-segments" aria-label="The token's three parts">
      <span className="is-header">{h}</span>.<span className="is-payload">{p ?? ""}</span>.<span className="is-signature">{s ?? ""}</span>
    </p>
  );
}

const icon = { pass: CircleCheck, fail: CircleX, skipped: CircleMinus };

/**
 * The Token Inspector: synthetic JWTs signed in this page with keys generated for this visit, decoded, then really
 * verified (Web Crypto) and validated step by step. Nothing typed or generated here is sent anywhere or stored.
 */
export function TokenInspector() {
  const [keys, setKeys] = useState<Keys | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [list, setList] = useState<Sample[]>([]);
  const [selected, setSelected] = useState("valid");
  const [token, setToken] = useState("");
  const [rotated, setRotated] = useState(false);
  const [result, setResult] = useState<Validation | null>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    document.title = "Token Inspector — Kitab";
    let live = true;
    (async () => {
      try {
        const k = { current: await generateKey("kitab-demo-1"), next: await generateKey("kitab-demo-2"), attacker: await generateKey("attacker-1"), rsa: await generateKey("kitab-demo-rsa", "RS256") };
        const made = await samples(now, k);
        if (!live) return;
        setKeys(k);
        setList(made);
        setToken(made[0].token);
      } catch (error) {
        setFailed(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const jwks = useMemo(() => (keys ? [keys.current.publicJwk, keys.rsa.publicJwk, ...(rotated ? [keys.next.publicJwk] : [])] : []), [keys, rotated]);
  useEffect(() => {
    if (!keys || !token) return;
    let live = true;
    validate(token, { issuer: ISSUER, audience: AUDIENCE, now, skew: SKEW, jwks, required: ["sub", "exp", "iss", "aud"] }).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [token, jwks, keys]);

  const decoded = useMemo(() => { const d = decode(token); return "error" in d ? null : d; }, [token]);
  useEffect(() => {
    if (decoded) setDraft(JSON.stringify(decoded.payload, null, 2));
  }, [token]);

  const pick = (s: Sample) => {
    setSelected(s.id);
    setToken(s.token);
    setDraftError("");
  };
  const edited = (): Record<string, unknown> | null => {
    try {
      const value = JSON.parse(draft);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The payload must be a JSON object.");
      setDraftError("");
      return value;
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  const sample = list.find((s) => s.id === selected);
  const verdict = result && (result.valid ? "valid" : "invalid");

  return (
    <main id="main" className="page lab-page token-inspector lab-theme">
      <header className="playground-heading">
        <div className="playground-title">
          <FileKey2 className="playground-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Identity &amp; security · Playground</p>
            <h1>Token Inspector</h1>
            <p>Decode a JSON Web Token, then really verify its signature and validate its claims, step by step. Decoding shows what a token says; only verification shows whether to believe it.</p>
          </div>
        </div>
        <p className="heading-links"><a {...linkProps("/learn/identity/tokens")}>Learn: JWTs and token security</a> · <a {...linkProps(IDENTITY_PLAYGROUND)}>Identity Playground</a> · <a {...linkProps("/lab/identity/jwks-verify")}>Lab: verify a signature yourself</a></p>
      </header>
      <section className="ti-notice" aria-label="About these tokens">
        <p><span className="mode-chip">Real cryptography</span> Every token here is synthetic: signed in this page by keys generated for this visit (ES256 and RS256, Web Crypto). Verification really runs <code>crypto.subtle.verify</code>. Nothing is sent to a server or saved.</p>
        <p className="ti-warning"><ShieldAlert aria-hidden="true" /> Never paste a real access token, ID token or session cookie into any website, this one included.</p>
      </section>
      {failed && <p className="inline-issue is-warning">This browser couldn't generate keys ({failed}). Web Crypto needs a secure context (https or localhost).</p>}
      {!keys && !failed && <p role="status">Generating keys…</p>}
      {keys && (
        <div className="ti-layout">
          <aside className="ti-side" aria-label="Choose a token">
            <h2>Tokens</h2>
            <ul className="id-scenarios">
              {list.map((s) => (
                <li key={s.id}><button type="button" aria-pressed={s.id === selected} onClick={() => pick(s)}><b>{s.label}</b><small>{s.teaches}</small></button></li>
              ))}
            </ul>
            <h2>The verifier trusts</h2>
            <dl className="ti-expect">
              <div><dt>Issuer</dt><dd><code>{ISSUER}</code></dd></div>
              <div><dt>Audience</dt><dd><code>{AUDIENCE}</code></dd></div>
              <div><dt>Algorithms</dt><dd>ES256, RS256</dd></div>
              <div><dt>Clock skew</dt><dd>{SKEW} s</dd></div>
              <div><dt>JWKS keys</dt><dd>{jwks.map((k) => k.kid).join(", ")}</dd></div>
            </dl>
            <label className="id-check-toggle"><input type="checkbox" checked={rotated} onChange={(e) => setRotated(e.target.checked)} /> The issuer has published kitab-demo-2 (key rotation)</label>
            <details>
              <summary>Public keys (JWKS)</summary>
              <pre className="id-body">{JSON.stringify({ keys: jwks }, null, 2)}</pre>
            </details>
          </aside>
          <section className="ti-main" aria-label="Inspect">
            <div className="ti-columns">
              <article className="ti-panel" aria-labelledby="decode-title">
                <h2 id="decode-title">1 · Decode</h2>
                <p className="muted">Base64url-decoding needs no key. Anyone holding the token can do this, and it proves nothing.</p>
                <Segments token={token} />
                {decoded ? (
                  <>
                    <h3>Header</h3>
                    <pre className="ti-json">{JSON.stringify(decoded.header, null, 2)}</pre>
                    <h3>Payload (claims)</h3>
                    <pre className="ti-json">{JSON.stringify(decoded.payload, null, 2)}</pre>
                    <Times decoded={decoded} now={now} />
                    <h3>Signature</h3>
                    <p className="muted">{decoded.signature.length} bytes{decoded.signature.length === 0 ? ": none at all" : ""}.</p>
                  </>
                ) : <p className="inline-issue is-warning">{(decode(token) as { error: string }).error}</p>}
              </article>
              <article className="ti-panel" aria-labelledby="verify-title">
                <h2 id="verify-title">2 · Verify and validate</h2>
                {result && (
                  <>
                    <p className={`id-outcome ${result.valid ? "is-good" : "is-bad"}`} role="status">
                      {result.valid ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
                      <span><b>{verdict === "valid" ? "Valid: accept it." : "Invalid: reject it."}</b> {result.valid ? "The signature verified with a trusted key and every claim holds." : `Stopped at: ${result.steps.find((s) => s.status === "fail")?.label}.`}</span>
                    </p>
                    <ol className="ti-steps">
                      {result.steps.map((s) => {
                        const Icon = icon[s.status];
                        return (
                          <li key={s.id} className={`is-${s.status}`}>
                            <Icon aria-hidden="true" />
                            <span><b>{s.label}</b> <span className="sr-only">{s.status === "pass" ? "passed" : s.status === "fail" ? "failed" : "skipped"}</span><br />{s.detail} <small>({s.rule})</small></span>
                          </li>
                        );
                      })}
                    </ol>
                  </>
                )}
                {sample && sample.token === token && <p className="muted"><b>This sample teaches:</b> {sample.teaches}</p>}
              </article>
            </div>
            <section className="ti-panel" aria-labelledby="edit-title">
              <h2 id="edit-title">3 · Change the claims</h2>
              <p className="muted">Edit the payload, then either keep the original signature (what a tamperer can do) or have the issuer's key sign it again (what only the issuer can do).</p>
              <label className="id-field">
                <span>Payload JSON</span>
                <textarea rows={10} spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={draftError ? true : undefined} aria-describedby="draft-error" />
              </label>
              {draftError && <p id="draft-error" className="inline-issue is-warning">{draftError}</p>}
              <div className="actions">
                <button type="button" className="button" disabled={!decoded} onClick={() => { const p = edited(); if (p && decoded) setToken(tamper(token, decoded.header, p)); }}>Keep the old signature</button>
                <button type="button" className="button primary" disabled={!decoded} onClick={async () => { const p = edited(); if (p) setToken(await sign({ alg: "ES256", typ: "at+jwt", kid: keys.current.kid }, p, keys.current)); }}>Sign again with kitab-demo-1</button>
              </div>
            </section>
            <PasteBox onUse={(t) => { setSelected(""); setToken(t); }} />
          </section>
        </div>
      )}
    </main>
  );
}

function Times({ decoded, now }: { decoded: Decoded; now: number }) {
  const rows = (["iat", "nbf", "exp"] as const).filter((k) => typeof decoded.payload[k] === "number");
  if (!rows.length) return null;
  return (
    <dl className="ti-expect">
      {rows.map((k) => {
        const t = decoded.payload[k] as number;
        const delta = t - now;
        return <div key={k}><dt>{k}</dt><dd>{new Date(t * 1000).toISOString()} ({delta >= 0 ? `in ${delta} s` : `${-delta} s ago`})</dd></div>;
      })}
    </dl>
  );
}

/** Free-form input, local only: decoded and validated in this page, never sent, logged or stored. */
function PasteBox({ onUse }: { onUse: (token: string) => void }) {
  const [text, setText] = useState("");
  return (
    <details className="ti-panel ti-paste">
      <summary>Paste a token of your own (local only)</summary>
      <p className="ti-warning"><ShieldAlert aria-hidden="true" /> Don't paste real credentials. A live token is a password for as long as it lasts. This box is processed in this page only: never sent, logged or saved, and cleared when you leave. It can only verify tokens signed by this page's demo keys.</p>
      <label className="id-field">
        <span>Token</span>
        <textarea rows={3} spellCheck={false} autoComplete="off" value={text} onChange={(e) => setText(e.target.value.slice(0, 16_384))} />
      </label>
      <button type="button" className="button" disabled={!text.trim()} onClick={() => onUse(text.trim())}>Inspect</button>
    </details>
  );
}
