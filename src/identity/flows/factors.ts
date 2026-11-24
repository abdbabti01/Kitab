// Authentication factors and phishing resistance, the WebAuthn ceremonies behind passkeys (W3C WebAuthn Level 3,
// Recommendation of 25 August 2026), and signing-key rotation with JWKS refresh (RFC 7517, OIDC Core §10.1.1).
// The WebAuthn scenario is a conceptual walkthrough of the real ceremony: Kitab never calls
// navigator.credentials and never asks to create a passkey.
import { check, flow, type Scenario } from "../model.ts";
import { API, IDP_KEY, IDP_KEY_NEXT, ISSUER, actors, at, jwt } from "./common.ts";

const PHISH = "https://idp-example.co";

export const phishing: Scenario = {
  id: "mfa",
  title: "MFA factors and a phishing proxy",
  summary: "Sign in with a password plus a second factor, on the real site or through a look-alike proxy that relays everything. Only a passkey's origin binding stops the relay.",
  standards: ["NIST SP 800-63B (authenticator assurance, phishing resistance)", "W3C WebAuthn Level 3 §13.4 (origin binding)", "OWASP Multifactor Authentication Cheat Sheet"],
  actors: [actors.user, actors.browser, actors.phone, { ...actors.attacker, label: "Phishing proxy", role: "A look-alike site that relays traffic to the real identity provider.", origin: PHISH }, actors.idp, actors.authenticator],
  controls: [
    { id: "factor", label: "Second factor", level: "basic", help: "What the user proves besides the password.", options: [
      { value: "otp", label: "Authenticator app code (TOTP)" },
      { value: "sms", label: "Code by SMS" },
      { value: "push", label: "Push approval with number matching" },
      { value: "passkey", label: "Passkey (WebAuthn) instead of password and code" },
    ] },
    { id: "site", label: "The user signs in at", level: "basic", help: "A phishing email sends the user to a look-alike domain that forwards everything to the real identity provider (an adversary-in-the-middle).", options: [
      { value: "real", label: "https://idp.example (the real site)" },
      { value: "phish", label: `${PHISH} (phishing proxy)` },
    ] },
  ],
  modelNote: "Modelled: what each factor proves and what a relaying proxy can forward. The outcome for each factor follows from where its secret is bound: to nothing (codes), to the user's attention (push), or to the origin (passkeys).",
  notModelled: ["SIM swapping and SS7 interception of SMS (another weakness of SMS codes)", "Malware on the user's device, which defeats every factor", "Recovery flows, often the weakest path into an account"],
  run(c) {
    const f = flow();
    const phish = c.site === "phish";
    const via = phish ? "attacker" : "idp";
    const origin = phish ? PHISH : ISSUER;
    f.add({ from: "user", to: "browser", kind: "action", channel: "internal", title: `Opens ${origin}/login`, purpose: phish ? "The link in a convincing email points to idp-example.co. The page looks identical: the proxy fetches it from the real site." : "The real sign-in page." });
    if (phish) f.add({ from: "attacker", to: "idp", kind: "request", channel: "back", title: "Relays the page and every request", purpose: "The proxy is a man in the middle at the application layer: it has its own valid TLS certificate for idp-example.co, so the padlock shows." });
    if (c.factor === "passkey") {
      f.add({ from: via, to: "browser", kind: "response", channel: "front", title: "Requests a passkey assertion", body: `navigator.credentials.get({ publicKey: { challenge, rpId: "idp.example", userVerification: "required" } })`, purpose: phish ? "The proxy relays the real site's challenge and asks for rpId idp.example." : "The identity provider sends a fresh challenge for rpId idp.example." });
      f.add({ from: "browser", to: "browser", kind: "action", channel: "internal", title: "Compares rpId with the page's origin",
        checks: [check("rp-id", "rpId is the page's domain or a registrable suffix of it", !phish, phish ? `The page's origin is ${PHISH}. idp.example is not a suffix of idp-example.co, so the browser throws SecurityError: the passkey for idp.example can't even be asked.` : "idp.example matches the origin https://idp.example.", "WebAuthn L3 §5.1.4.1 step 8")],
        purpose: "The browser, not the user, enforces which site a passkey belongs to. A look-alike domain can't use the real site's passkey, however convincing the page.",
        ifFails: "The ceremony fails before the authenticator is involved. If the proxy asks for its own rpId instead, no credential exists for it. The attacker gets nothing to relay." },
        { from: "attacker", to: "attacker", kind: "action", channel: "internal", title: "Proxy has nothing to forward", purpose: "Phishing-resistant: the signature, had one been made, would also contain the origin (clientDataJSON.origin), which the real server checks." });
      f.add({ from: "authenticator", to: "browser", kind: "response", channel: "internal", title: "User verifies; signs the challenge", checks: [check("uv", "User verified on the device (PIN or biometric)", true, "The biometric never leaves the device.")], purpose: "The private key never leaves the authenticator." });
      f.add({ from: "browser", to: "idp", kind: "request", channel: "front", title: "POST assertion", checks: [check("passkey", "Signature, challenge, origin and rpIdHash verify", true, "Origin https://idp.example, fresh challenge, flags UP and UV set.")], sets: [{ at: "idp", key: "Session", value: "alice, amr hwk+user (passkey)" }, { at: "browser", key: "Cookie for idp.example", value: "idp_session=s-pk1" }], purpose: "One gesture, two factors (possession of the device, plus the PIN or biometric)." });
      return f.events;
    }
    f.add({ from: "user", to: via, kind: "action", channel: "front", title: "Types username and password", purpose: phish ? "Captured by the proxy and forwarded to the real site." : "Checked by the identity provider." });
    if (phish) f.add({ from: "attacker", to: "idp", kind: "request", channel: "back", title: "Forwards the password", checks: [check("pwd", "Password correct", true, "The real site sees a correct password.")], purpose: "The attacker now knows the password too." });
    const factorTitle = { otp: "Enters the 6-digit code from the app", sms: "Enters the code from the SMS", push: "Approves the push; the number on screen matches" }[c.factor as "otp" | "sms" | "push"];
    f.add({ from: "idp", to: c.factor === "push" ? "phone" : "user", kind: "response", channel: "back", title: c.factor === "sms" ? "Sends an SMS code" : c.factor === "push" ? "Sends a push with number 47" : "Asks for the TOTP code", purpose: c.factor === "push" ? "Number matching: the user must type or match the number shown on the sign-in page, which stops blind approval of unexpected pushes." : "A one-time code proves possession of the phone or app." });
    f.add({ from: "user", to: via, kind: "action", channel: "front", title: factorTitle, purpose: phish ? "The sign-in page (the proxy's copy) shows the number or asks for the code, so the user complies." : "Completes the second factor." });
    f.add({ from: via, to: "idp", kind: "request", channel: "back", title: phish ? "Forwards the code / approval in time" : "Verifies the factor", checks: [check("factor", "Second factor valid", true, "Within its time window.")], purpose: "Codes and approvals aren't tied to a site, so the real site can't tell they came through a proxy." });
    f.add({ from: "idp", to: via, kind: "response", channel: "front", title: "Session cookie issued", sets: [{ at: phish ? "attacker" : "browser", key: "Cookie for idp.example", value: "idp_session=s-mfa1" }], purpose: phish ? "The session cookie goes to the proxy, which keeps it." : "Signed in, with two factors.",
      checks: phish ? [check("phished", "The attacker does not obtain a session", false, `The proxy holds a valid session cookie for alice. ${c.factor === "push" ? "Number matching stops push fatigue, not a proxy that shows the right number." : "One-time codes are phishable: they can be relayed within their time window."}`, "NIST SP 800-63B §5.2.5", "security")] : [] });
    return f.events;
  },
};

export const webauthn: Scenario = {
  id: "webauthn",
  title: "Passkeys: the WebAuthn ceremonies",
  summary: "Register a passkey (a key pair scoped to one site), then sign in by signing a fresh challenge. A conceptual walkthrough: Kitab never creates a real passkey.",
  standards: ["W3C Web Authentication Level 3 (Recommendation, 25 August 2026) §7.1 and §7.2", "FIDO2 CTAP 2.2"],
  actors: [actors.user, actors.browser, actors.authenticator, { ...actors.app, label: "Relying party server", role: "The website's server: stores credential IDs and public keys." }],
  controls: [
    { id: "ceremony", label: "Ceremony", level: "basic", help: "Registration creates the credential; authentication uses it.", options: [
      { value: "register", label: "Registration (create a passkey)" },
      { value: "authenticate", label: "Authentication (sign in)" },
    ] },
    { id: "fault", label: "Break something", level: "fault", help: "Inject one fault and see which verification step catches it.", options: [
      { value: "none", label: "Nothing" },
      { value: "origin", label: "Response comes from another origin" },
      { value: "challenge", label: "A challenge is reused" },
      { value: "uv", label: "User verification required but not performed" },
      { value: "unknown", label: "Unknown credential ID", when: (c) => c.ceremony === "authenticate" },
    ] },
  ],
  modelNote: "Conceptual walkthrough of the real ceremony's data and checks. Signatures are not computed here; the Engineering Lab's challenge-response lab signs and verifies with real P-256 keys in the browser.",
  notModelled: ["Attestation verification and metadata (most relying parties request attestation: none)", "Cross-device authentication (hybrid transport, QR code)", "Passkey sync between devices, and account recovery"],
  run(c) {
    const f = flow();
    const reg = c.ceremony === "register";
    const origin = c.fault === "origin" ? "https://app-example.co" : "https://app.example";
    f.add({ from: "browser", to: "app", kind: "request", channel: "back", title: reg ? "POST /passkeys/register/options" : "POST /passkeys/login/options", method: "POST", purpose: reg ? "A signed-in user asks to add a passkey." : "The user chooses “Sign in with a passkey”." });
    f.add({ from: "app", to: "browser", kind: "response", channel: "back", title: reg ? "Creation options + challenge" : "Request options + challenge", status: 200,
      body: reg ? `{ "rp": { "id": "app.example", "name": "App" }, "user": { "id": "<random handle>", "name": "alice@acme.example" }, "challenge": "<32 random bytes>", "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }, { "type": "public-key", "alg": -257 }], "authenticatorSelection": { "residentKey": "required", "userVerification": "required" }, "attestation": "none" }` : `{ "rpId": "app.example", "challenge": "<32 random bytes>", "userVerification": "required", "allowCredentials": [] }`,
      sets: [{ at: "app", key: "Pending challenge", value: c.fault === "challenge" ? "ch-1 (already used once)" : "ch-2, single use, expires in 5 min" }],
      purpose: "The challenge is random and single use: it is what makes every signature fresh. -7 is ES256, -257 RS256 (COSE algorithm ids)." });
    f.add({ from: "browser", to: "authenticator", kind: "request", channel: "internal", title: reg ? "navigator.credentials.create()" : "navigator.credentials.get()", purpose: "The browser checks rpId against the page's origin, builds clientDataJSON { type, challenge, origin } and hashes it for the authenticator." });
    f.add({ from: "user", to: "authenticator", kind: "action", channel: "internal", title: c.fault === "uv" ? "Touches the key (no PIN)" : "Unlocks with fingerprint or PIN", purpose: "User presence (UP) and user verification (UV). The biometric is checked on the device and never sent anywhere." });
    if (reg) {
      f.add({ from: "authenticator", to: "browser", kind: "response", channel: "internal", title: "New key pair; attestation object", sets: [{ at: "authenticator", key: "Private key for app.example", value: "never leaves the authenticator" }],
        body: "authenticatorData: rpIdHash = SHA-256(\"app.example\"), flags UP, " + (c.fault === "uv" ? "" : "UV, ") + "BE, BS, AT; signCount 0; credentialId; credentialPublicKey (COSE)", purpose: "A new key pair, scoped to rpId app.example. Only the public key is returned." });
    } else {
      f.add({ from: "authenticator", to: "browser", kind: "response", channel: "internal", title: "Signs authenticatorData ‖ SHA-256(clientDataJSON)", body: "authenticatorData: rpIdHash, flags UP" + (c.fault === "uv" ? "" : " UV") + ", signCount; signature; userHandle; credentialId " + (c.fault === "unknown" ? "cred-UNKNOWN" : "cred-7f3a"), purpose: "The signature covers the challenge and origin (inside clientDataJSON) and the rpIdHash." });
    }
    f.add({ from: "browser", to: "app", kind: "request", channel: "back", title: reg ? "POST /passkeys/register" : "POST /passkeys/login", method: "POST", body: `clientDataJSON: { "type": "webauthn.${reg ? "create" : "get"}", "challenge": "${c.fault === "challenge" ? "ch-1" : "ch-2"}", "origin": "${origin}" }`, purpose: "The server verifies everything; the browser's word isn't enough." });
    f.add({ from: "app", to: "app", kind: "action", channel: "internal", title: reg ? "Verifies the registration" : "Verifies the assertion",
      checks: [
        check("type", `clientDataJSON.type is webauthn.${reg ? "create" : "get"}`, true, "Matches the ceremony.", reg ? "WebAuthn L3 §7.1" : "WebAuthn L3 §7.2"),
        check("challenge", "challenge equals the pending one, unused", c.fault !== "challenge", c.fault === "challenge" ? "ch-1 was already used: a replayed response." : "ch-2, now consumed."),
        check("origin", "origin is an expected origin of this site", c.fault !== "origin", `origin = ${origin}.`),
        check("rpid", "rpIdHash = SHA-256(\"app.example\")", true, "Matches."),
        check("uv", "Flags show user presence and user verification", c.fault !== "uv", c.fault === "uv" ? "UV flag not set, but the policy requires it." : "UP and UV set."),
        ...(reg ? [] : [check("credential", "credentialId is registered for a user", c.fault !== "unknown", c.fault === "unknown" ? "cred-UNKNOWN isn't in the credential store." : "cred-7f3a belongs to alice."), check("signature", "Signature verifies with the stored public key", c.fault !== "unknown", "ES256 over authenticatorData ‖ SHA-256(clientDataJSON) (modelled).")]),
      ],
      sets: reg ? [{ at: "app", key: "Credential cred-7f3a", value: "alice, public key, signCount 0, backup eligible" }] : [{ at: "app", key: "Session", value: "alice, passkey sign-in" }],
      purpose: reg ? "Store the credential ID and public key. Nothing secret is stored on the server: a database breach leaks no passkeys." : "Proof that the person holds the private key for this site, now.",
      ifFails: "Reject. The private key is never exposed, so a failed ceremony leaks nothing." },
      { from: "app", to: "browser", kind: "response", channel: "back", title: "400 verification failed", status: 400, purpose: "No credential stored, no session." });
    f.add({ from: "app", to: "browser", kind: "response", channel: "back", title: reg ? "201 passkey added" : "200 signed in", status: reg ? 201 : 200, purpose: reg ? "Next time, sign in with the passkey." : "Signed in with a phishing-resistant credential." });
    return f.events;
  },
};

export const keyRotation: Scenario = {
  id: "key-rotation",
  title: "Signing key rotation and JWKS refresh",
  summary: "The identity provider moves to a new signing key. The API, which caches the JWKS, must find the new key without accepting unknown ones.",
  standards: ["RFC 7517 (JWK Set)", "OIDC Core §10.1.1 (rotation of asymmetric signing keys)", "RFC 8414 / OIDC Discovery (jwks_uri)"],
  actors: [actors.app, actors.idp, actors.api, actors.attacker],
  controls: [
    { id: "rollover", label: "The identity provider", level: "basic", help: "Graceful: publish the new key first, sign with it later, retire the old one after its tokens expire.", options: [
      { value: "graceful", label: "Publishes the new key, then switches" },
      { value: "abrupt", label: "Switches and removes the old key at once" },
    ] },
    { id: "refresh", label: "When the API sees an unknown kid", level: "basic", help: "Cached JWKS: refetch (rate-limited) or never.", options: [
      { value: "refetch", label: "Refetches the JWKS (at most once a minute)" },
      { value: "never", label: "Never refetches (key pinned at startup)" },
    ] },
    { id: "attacker", label: "Attacker", level: "advanced", help: "A token signed by the attacker's own key, with a made-up kid.", options: [
      { value: "no", label: "No attacker" },
      { value: "yes", label: "Sends a token with kid attacker-1" },
    ] },
  ],
  modelNote: "Modelled: key ids, the cached key set and the API's lookup. Signatures are tracked by key id.",
  notModelled: ["HTTP cache headers on the JWKS response", "Symmetric (HS256) keys, which can't be published"],
  run(c) {
    const f = flow();
    const cache = new Set([IDP_KEY]);
    const published = new Set([IDP_KEY]);
    let lastFetch = -999;
    f.add({ from: "api", to: "idp", kind: "request", channel: "back", title: "GET /jwks (at startup)", method: "GET", endpoint: `${ISSUER}/jwks`, sets: [{ at: "api", key: "JWKS cache", value: IDP_KEY }, { at: "idp", key: "Published keys", value: IDP_KEY }, { at: "idp", key: "Signing with", value: IDP_KEY }], purpose: "The API downloads the public keys from jwks_uri (found in the discovery document) and caches them." });
    const call = (label: string, kid: string, issued: number) => {
      const token = jwt("access_token", label, { iss: ISSUER, aud: API, sub: "248289761001", scope: "orders.read", iat: at(issued), exp: at(issued + 300) }, kid);
      f.add({ from: kid === "attacker-1" ? "attacker" : "app", to: "api", kind: "request", channel: "back", title: `GET /orders (${label}, kid ${kid})`, method: "GET", endpoint: `${API}/orders`, tokens: [token], purpose: kid === "attacker-1" ? "A forged token: the attacker signed it with their own key." : `A token issued ${f.now - issued} s ago.` });
      if (!cache.has(kid) && c.refresh === "refetch") {
        const allowed = f.now - lastFetch >= 60;
        if (allowed) {
          lastFetch = f.now;
          [...published].forEach((k) => cache.add(k));
          for (const k of [...cache]) if (!published.has(k)) cache.delete(k);
          f.add({ from: "api", to: "idp", kind: "request", channel: "back", title: "Unknown kid: GET /jwks again", method: "GET", endpoint: `${ISSUER}/jwks`, sets: [{ at: "api", key: "JWKS cache", value: [...cache].join(", ") }], purpose: "One refetch, rate-limited so a stream of junk kids can't turn the API into a load generator against the identity provider." });
        } else f.add({ from: "api", to: "api", kind: "action", channel: "internal", title: "Refetch skipped (rate limit)", purpose: "Fetched less than a minute ago." });
      }
      const found = cache.has(kid);
      f.add({ from: "api", to: "api", kind: "action", channel: "internal", title: "Looks up kid, verifies",
        checks: [check(kid === "attacker-1" ? "forged" : `kid-${label}`, `kid ${kid} is a key the API trusts`, found, found ? `${kid} is in the cached JWKS.` : kid === "attacker-1" ? "attacker-1 isn't published by the issuer: reject. Never fetch keys from a URL inside the token (jku/x5u) without an allowlist." : c.refresh === "never" ? `${kid} isn't in the pinned key set, and the API never refreshes it.` : `${kid} isn't published any more: the old key was removed while its tokens were still valid.`, "RFC 7515 §4.1.4")],
        purpose: "Keys are chosen by kid from the issuer's published set, never from the token itself." },
        { from: "api", to: kid === "attacker-1" ? "attacker" : "app", kind: "response", channel: "back", title: "401 invalid_token", status: 401, purpose: kid === "attacker-1" ? "Correctly refused." : "Users are signed out or see errors until they get new tokens." });
      if (found) f.add({ from: "api", to: "app", kind: "response", channel: "back", title: "200", status: 200, purpose: "Signature valid; the request goes on to authorization." });
    };
    call("token 1", IDP_KEY, 0);
    if (c.rollover === "graceful") {
      f.wait(120);
      published.add(IDP_KEY_NEXT);
      f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: `Publishes ${IDP_KEY_NEXT} (still signs with ${IDP_KEY})`, sets: [{ at: "idp", key: "Published keys", value: `${IDP_KEY}, ${IDP_KEY_NEXT}` }], purpose: "Step 1: publish before use, so caches can pick it up." });
    }
    f.wait(c.rollover === "graceful" ? 600 : 200);
    if (c.rollover === "abrupt") {
      published.delete(IDP_KEY);
      published.add(IDP_KEY_NEXT);
    }
    f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: `Starts signing with ${IDP_KEY_NEXT}`, sets: [{ at: "idp", key: "Signing with", value: IDP_KEY_NEXT }, { at: "idp", key: "Published keys", value: [...published].join(", ") }], purpose: c.rollover === "graceful" ? `Step 2: switch. ${IDP_KEY} stays published until every token it signed has expired.` : `${IDP_KEY} is removed immediately, although tokens it signed are valid for up to 5 more minutes.` });
    call("token 2", IDP_KEY_NEXT, f.now);
    f.wait(70);
    call("token 1b", IDP_KEY, f.now - 250);
    if (c.attacker === "yes") {
      f.wait(5);
      call("forged token", "attacker-1", f.now);
    }
    return f.events;
  },
};
