// Sign-in with OpenID Connect: the Authorization Code flow with PKCE (OIDC Core §3.1, RFC 6749 §4.1, RFC 7636),
// following RFC 9700 (exact redirect URI matching, PKCE, audience-restricted tokens) and RFC 10017 for the two
// client shapes: a server-side web app / backend-for-frontend (confidential client, tokens stay on the server) and a
// browser-based app (public client, tokens in JavaScript memory).
import { check, flow, type Config, type Scenario } from "../model.ts";
import { s256 } from "../sha256.ts";
import { API, APP, ISSUER, IDP_KEY, SESSION_COOKIE, at, jwt, opaque, pick, query } from "./common.ts";

export const STATE = "af0ifjsldkj-synthetic";
export const NONCE = "n-0S6_WzA2Mj-synthetic";
export const VERIFIER = "kitab-synthetic-verifier-7Qm2Xc9LpR4tVb8NwE1sHd6Kj3";
export const WRONG_VERIFIER = "kitab-synthetic-verifier-0000000000000000000000000";
export const CODE = "SplxlOBeZQQYbYS6WxSbIA-synthetic";
export const REDIRECT = `${APP}/callback`;
export const CLIENT = "app-web";

const redirects: Record<string, string> = { exact: REDIRECT, slash: `${REDIRECT}/`, other: "https://attacker.example/callback" };
const web = (c: Config) => c.client === "web";

export const oidcLogin: Scenario = {
  id: "oidc-login",
  title: "Sign in with OpenID Connect",
  summary: "Authorization Code with PKCE: the browser carries a short-lived code, the client exchanges it for tokens, validates the ID token and starts its own session.",
  standards: ["OpenID Connect Core 1.0 §3.1 (errata set 2)", "RFC 6749 §4.1", "RFC 7636 (PKCE)", "RFC 9700 (OAuth security BCP)", "RFC 10017 (browser-based apps)", "RFC 9207 (iss in the response)", "RFC 6750 (bearer tokens)"],
  actors: pick("user", "browser", "app", "idp", "api", "attacker"),
  controls: [
    { id: "client", label: "Client architecture", level: "basic", help: "Where the OAuth client runs and therefore where tokens live.", options: [
      { value: "web", label: "Server-side web app / BFF (confidential)" },
      { value: "spa", label: "Browser-based app (public, JavaScript)" },
    ] },
    { id: "idpSession", label: "Before signing in", level: "basic", help: "Whether the browser already holds a session cookie for the identity provider.", options: [
      { value: "none", label: "Not signed in at the identity provider" },
      { value: "active", label: "Already signed in at the identity provider" },
    ] },
    { id: "callApi", label: "After signing in", level: "basic", help: "Whether the application then calls the Orders API with the access token.", options: [
      { value: "yes", label: "Call the Orders API" },
      { value: "no", label: "Just sign in" },
    ] },
    { id: "pkce", label: "PKCE", level: "advanced", help: "RFC 9700: public clients MUST use PKCE; it is RECOMMENDED for confidential clients. Only S256 is acceptable.", options: [
      { value: "S256", label: "S256 code challenge" },
      { value: "off", label: "No PKCE" },
    ] },
    { id: "consent", label: "Consent", level: "advanced", help: "Whether the user has already allowed this client the requested scopes.", options: [
      { value: "remembered", label: "Given before (remembered)" },
      { value: "ask", label: "Ask the user" },
      { value: "deny", label: "User denies" },
    ] },
    { id: "redirect", label: "redirect_uri sent", level: "advanced", help: "The authorization server compares it with the registered value by exact string match (RFC 9700 §2.1).", options: [
      { value: "exact", label: `${REDIRECT} (registered)` },
      { value: "slash", label: `${REDIRECT}/ (one extra slash)` },
      { value: "other", label: "https://attacker.example/callback" },
    ] },
    { id: "fault", label: "Break something", level: "fault", help: "Inject one fault and watch which check catches it.", options: [
      { value: "none", label: "Nothing: the correct flow" },
      { value: "state", label: "Callback arrives with a different state (login CSRF)" },
      { value: "verifier", label: "Wrong code_verifier at the token endpoint", when: (c) => c.pkce === "S256" },
      { value: "code-reuse", label: "The authorization code is redeemed twice" },
      { value: "nonce", label: "ID token carries a different nonce (replay)" },
      { value: "idtoken-aud", label: "ID token issued to another client" },
      { value: "idtoken-expired", label: "ID token already expired" },
      { value: "idtoken-key", label: "ID token signed with an unknown key" },
      { value: "api-aud", label: "Access token issued for another API", when: (c) => c.callApi === "yes" },
      { value: "api-scope", label: "Access token lacks orders.read", when: (c) => c.callApi === "yes" },
      { value: "api-idtoken", label: "Client sends the ID token to the API", when: (c) => c.callApi === "yes" },
    ] },
  ],
  modelNote: "Modelled: every message, parameter and check follows the specifications listed; signatures are tracked by key id, not computed (real signature checks are in the Token Inspector). Identifiers are fixed synthetic values.",
  notModelled: ["TLS handshakes and DNS (see the Networking track)", "The identity provider's internal user store and password hashing", "Pushed authorization requests (RFC 9126) and DPoP (RFC 9449)", "Vendor-specific behaviour of any real identity provider"],
  run(c) {
    const f = flow();
    const client = web(c) ? CLIENT : "app-spa";
    const fault = c.fault;
    const challenge = s256(VERIFIER);
    const redirect = redirects[c.redirect];
    const scope = c.callApi === "yes" ? "openid profile orders.read" : "openid profile";
    const where = web(c) ? "the application's server" : "the browser app's JavaScript";

    f.add({ from: "user", to: "browser", kind: "action", channel: "internal", title: "Clicks “Sign in”", purpose: "The user asks to sign in. Nothing has been proved yet.", next: web(c) ? "The browser asks the application's /login route." : "The app's JavaScript prepares an authorization request." });
    if (web(c)) f.add({ from: "browser", to: "app", kind: "request", channel: "back", title: "GET /login", method: "GET", endpoint: `${APP}/login`, purpose: "Starts sign-in on the server, which acts as the OAuth client.", protects: "HTTPS." });

    const tx = [
      ["state", STATE, "Binds the callback to this browser's request (CSRF protection)."],
      ["nonce", NONCE, "Will be echoed inside the ID token, binding it to this request (replay protection)."],
      ...(c.pkce === "S256" ? [["code_verifier", VERIFIER, "A random secret kept by the client; never sent through the browser."], ["code_challenge", challenge, "BASE64URL(SHA-256(code_verifier)): computed here, really, with SHA-256."]] : []),
    ] as const;
    f.add({
      from: "app", to: "app", kind: "action", channel: "internal", title: "Generates state, nonce" + (c.pkce === "S256" ? " and PKCE" : ""),
      params: tx.map(([k, v]) => [k, v]),
      sets: tx.filter(([k]) => k !== "code_challenge").map(([key, value, note]) => ({ at: "app" as const, key, value, note })),
      purpose: `One-time values for this sign-in, kept by ${where}${web(c) ? " in a short-lived pre-login record tied to a cookie" : " (for example in sessionStorage for the redirect round trip)"}.`,
      protects: web(c) ? "They never leave the server, except state and the challenge, which are safe to expose." : "Only this origin's script can read them.",
    });
    {
      const authParams: [string, string][] = [["response_type", "code"], ["client_id", client], ["redirect_uri", redirect], ["scope", scope], ["state", STATE], ["nonce", NONCE], ...(c.pkce === "S256" ? ([["code_challenge", challenge], ["code_challenge_method", "S256"]] as [string, string][]) : [])];
      const url = `${ISSUER}/authorize?${query(authParams)}`;
      f.add({
        from: "app", to: "browser", kind: "redirect", channel: "front", title: web(c) ? "302 to the authorization endpoint" : "Navigates to the authorization endpoint",
        status: web(c) ? 302 : undefined, headers: [["Location", url], ...(web(c) ? ([["Set-Cookie", `__Host-login_tx=tx-71c2; ${SESSION_COOKIE}; Max-Age=600`]] as [string, string][]) : [])],
        params: authParams,
        sets: web(c) ? [{ at: "browser", key: "Cookie for app.example", value: "__Host-login_tx=tx-71c2", note: "Ties the callback to the pre-login record." }] : [],
        purpose: "Front channel: the request travels in the browser's address bar, so it carries nothing secret. The code_challenge can be public; the verifier stays with the client.",
        protects: "HTTPS; state and PKCE protect what comes back.",
      });
      f.add({ from: "browser", to: "idp", kind: "request", channel: "front", title: "GET /authorize", method: "GET", endpoint: url, params: authParams, purpose: "The browser follows the redirect to the identity provider." });
      const registered = redirect === REDIRECT;
      const pkceOk = c.pkce === "S256" || web(c);
      f.add({
        from: "idp", to: "idp", kind: "action", channel: "internal", title: "Validates the authorization request",
        checks: [
          check("client", "client_id is a registered client", true, `${client} is registered.`, "RFC 6749 §4.1.1"),
          check("redirect-uri", "redirect_uri exactly matches a registered one", registered, registered ? `${redirect} = registered value.` : `Received ${redirect}; registered: ${REDIRECT}. Exact string comparison, no prefix or pattern matching.`, "RFC 9700 §2.1"),
          check("pkce-required", web(c) ? "PKCE (recommended for confidential clients)" : "PKCE present (required for public clients)", pkceOk, c.pkce === "S256" ? "code_challenge with method S256." : web(c) ? "No PKCE. Allowed here for a confidential client, though RFC 9700 recommends it." : "A public client sent no code_challenge.", "RFC 9700 §2.1.1"),
          check("scope", "Requested scopes are allowed for this client", true, `${scope}.`),
        ],
        purpose: "Before showing any page, the identity provider checks who is asking and where the answer may go.",
        ifFails: "A bad redirect_uri gets an error page at the identity provider and MUST NOT redirect anywhere: otherwise it would deliver codes to an attacker (RFC 6749 §4.1.2.1). Missing PKCE from a public client is refused with invalid_request.",
      }, registered
        ? { from: "idp", to: "browser", kind: "redirect", channel: "front", title: "302 error=invalid_request", status: 302, headers: [["Location", `${REDIRECT}?error=invalid_request&error_description=PKCE%20required&state=${STATE}`]], purpose: "With a valid redirect URI, errors are returned to the client.", next: "The app shows a sign-in error." }
        : { from: "idp", to: "browser", kind: "response", channel: "front", title: "400 error page (no redirect)", status: 400, purpose: "The identity provider shows the error itself and never redirects to an unregistered URI.", next: "The user sees an error at the identity provider. Fix the registration or the client's redirect_uri." });

      if (c.idpSession === "active") {
        f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: "Recognises its session cookie", headers: [["Cookie", "idp_session=s-9f2e (for idp.example)"]],
          checks: [check("idp-session", "Identity provider session is valid", true, "Signed in 20 minutes ago with password; within its 8-hour lifetime.")],
          purpose: "The browser sends idp.example's cookie with this request. The identity provider already knows the user, so it can skip the password prompt: that is single sign-on.",
          protects: "The cookie is HttpOnly, Secure and scoped to idp.example: the application never sees it." });
      } else {
        f.add({ from: "idp", to: "browser", kind: "response", channel: "front", title: "200 sign-in page", status: 200, purpose: "No identity provider session, so the user must authenticate. The password is typed only at the identity provider, never into the application." });
        f.add({ from: "user", to: "browser", kind: "action", channel: "internal", title: "Enters username and password", purpose: "Synthetic credentials for the synthetic user alice@acme.example. Kitab never asks for a real password." });
        f.add({ from: "browser", to: "idp", kind: "request", channel: "front", title: "POST /login", method: "POST", endpoint: `${ISSUER}/login`, params: [["username", "alice@acme.example"], ["password", "•••••• (synthetic)"]],
          checks: [check("credentials", "Password matches the stored hash", true, "Argon2id hash comparison at the identity provider (modelled).", "OWASP Password Storage")],
          purpose: "The identity provider verifies the credentials against its user store.",
          ifFails: "Wrong password: the same page again with a generic error, and a failed-attempt counter for throttling." });
        f.add({ from: "idp", to: "browser", kind: "response", channel: "front", title: "Sets the identity provider's session cookie", headers: [["Set-Cookie", "idp_session=s-9f2e; Domain=idp.example; Path=/; Secure; HttpOnly; SameSite=Lax"]],
          sets: [{ at: "idp", key: "Session s-9f2e", value: "alice, password, authenticated now", note: "The identity provider's own session." }, { at: "browser", key: "Cookie for idp.example", value: "idp_session=s-9f2e" }],
          purpose: "The identity provider starts ITS session. Later requests from any application to this identity provider can reuse it." });
      }
      if (c.consent === "ask" || c.consent === "deny") {
        f.add({ from: "idp", to: "browser", kind: "response", channel: "front", title: "200 consent page", status: 200, purpose: `Asks whether ${client} may have: ${scope}. Consent is per client: approving one app says nothing about another.` });
        f.add({ from: "user", to: "idp", kind: "action", channel: "front", title: c.consent === "deny" ? "Denies access" : "Allows access",
          checks: [check("consent", "User consents to the requested scopes", c.consent !== "deny", c.consent === "deny" ? "The user pressed Deny." : "Recorded: alice allows these scopes for this client.")],
          sets: c.consent === "deny" ? [] : [{ at: "idp", key: `Consent ${client}`, value: scope }],
          purpose: "The user decides what this application may do on their behalf. Delegation, not authentication, is OAuth's job." },
          { from: "idp", to: "browser", kind: "redirect", channel: "front", title: "302 error=access_denied", status: 302, headers: [["Location", `${redirect}?error=access_denied&state=${STATE}&iss=${encodeURIComponent(ISSUER)}`]], purpose: "A denial goes back to the registered redirect URI with the error and the state.", next: "The app checks state, then shows that sign-in was cancelled." });
      }
      const codeToken = opaque("code", "Authorization code", CODE);
      f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: "Issues an authorization code",
        sets: [{ at: "idp", key: "Code", value: `for ${client}, alice, ${redirect}${c.pkce === "S256" ? ", challenge " + challenge.slice(0, 10) + "…" : ""}, nonce, expires in 60 s, single use`, token: codeToken }],
        purpose: "A short-lived, single-use code, bound to the client, the redirect URI, the PKCE challenge and the nonce. It is useless without the client's credentials or verifier." });
      const callback = [["code", CODE], ["state", fault === "state" ? "attacker-supplied-state" : STATE], ["iss", ISSUER]] as [string, string][];
      f.add({ from: "idp", to: "browser", kind: "redirect", channel: "front", title: "302 back to redirect_uri with the code", status: 302, headers: [["Location", `${redirect}?${query(callback)}`]], params: callback, tokens: [codeToken],
        purpose: "Front channel again: the code passes through the browser (history, logs), which is why it is short-lived, single use and PKCE-bound.",
        protects: "HTTPS; state; PKCE; the code's 60-second lifetime." });
      f.add({ from: "browser", to: "app", kind: "request", channel: web(c) ? "back" : "internal", title: "GET /callback?code&state&iss", method: "GET", endpoint: `${redirect}?${query(callback)}`, headers: web(c) ? [["Cookie", "__Host-login_tx=tx-71c2"]] : [], params: callback,
        purpose: web(c) ? "The browser delivers the code to the application's server, with the pre-login cookie." : "The browser loads the app at its redirect URI; the app's JavaScript reads the code from the URL." });
      f.add({ from: "app", to: "app", kind: "action", channel: "internal", title: "Checks state and issuer",
        checks: [
          check("state", "state equals the one this browser started with", fault !== "state", fault === "state" ? `Received attacker-supplied-state; expected ${STATE}. Someone else's callback was planted in this browser.` : `${STATE} matches.`, "RFC 6749 §10.12, RFC 9700 §2.1"),
          check("iss", "iss is the identity provider this client sent the user to", true, `${ISSUER} (mix-up defence).`, "RFC 9207"),
        ],
        sets: [{ at: "app", key: "state", value: null }],
        purpose: "Rejects callbacks this browser never asked for (login CSRF) and responses from the wrong identity provider (mix-up).",
        ifFails: "Stop: no token request is made. Otherwise an attacker could log the victim into the attacker's account." },
        { from: "app", to: "browser", kind: "response", channel: web(c) ? "back" : "internal", title: "400 sign-in failed", status: 400, purpose: "The callback is discarded. No code is redeemed." });

      const tokenParams: [string, string][] = [["grant_type", "authorization_code"], ["code", CODE], ["redirect_uri", redirect], ...(c.pkce === "S256" ? ([["code_verifier", fault === "verifier" ? WRONG_VERIFIER : VERIFIER]] as [string, string][]) : []), ...(web(c) ? [] : ([["client_id", client]] as [string, string][]))];
      f.add({ from: "app", to: "idp", kind: "request", channel: "back", title: "POST /token (code exchange)", method: "POST", endpoint: `${ISSUER}/token`,
        headers: [["Content-Type", "application/x-www-form-urlencoded"], ...(web(c) ? ([["Authorization", "Basic YXBwLXdlYjrigKLigKLigKI= (client_id:client_secret, synthetic)"]] as [string, string][]) : ([["Origin", APP]] as [string, string][]))],
        params: tokenParams,
        purpose: web(c) ? "Back channel: a direct HTTPS request from the application's server. The client authenticates itself, and the verifier proves it started this flow." : "A direct request from JavaScript (CORS). A public client has no secret; PKCE's verifier is what proves it started the flow.",
        protects: "HTTPS; client authentication (confidential client); code_verifier." });
      if (fault === "code-reuse") {
        f.add({ from: "attacker", to: "idp", kind: "request", channel: "back", title: "POST /token with the same code", method: "POST", endpoint: `${ISSUER}/token`, params: [["grant_type", "authorization_code"], ["code", CODE]],
          purpose: "A second redemption of the same code, as if it leaked from browser history or a log." });
      }
      const verified = c.pkce !== "S256" || s256(fault === "verifier" ? WRONG_VERIFIER : VERIFIER) === challenge;
      f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: "Validates the code exchange",
        checks: [
          check("client-auth", web(c) ? "Client authenticated (client_secret_basic)" : "Public client identified by client_id", true, web(c) ? "Secret matches the registered client." : "No secret: a public client can't keep one."),
          check("code", "Code is valid, unexpired, issued to this client and not used before", fault !== "code-reuse", fault === "code-reuse" ? "The code was already redeemed: invalid_grant. RFC 6749 §4.1.2 says the server SHOULD also revoke the tokens issued from it." : "Issued 2 s ago to this client; first use.", "RFC 6749 §4.1.3"),
          check("redirect-match", "redirect_uri equals the one in the authorization request", true, redirect),
          ...(c.pkce === "S256" ? [check("pkce", "SHA-256(code_verifier) equals the stored code_challenge", verified, verified ? `S256(verifier) = ${challenge}.` : `S256(${WRONG_VERIFIER.slice(0, 16)}…) = ${s256(WRONG_VERIFIER)} ≠ ${challenge}.`, "RFC 7636 §4.6")] : []),
        ],
        sets: [{ at: "idp", key: "Code", value: "redeemed" }],
        purpose: "Only the party that started the flow, and holds the verifier, can turn the code into tokens.",
        ifFails: "400 invalid_grant: no tokens. An intercepted code is worthless without the verifier." },
        { from: "idp", to: "app", kind: "response", channel: "back", title: "400 invalid_grant", status: 400, body: '{ "error": "invalid_grant" }', purpose: "The code exchange is refused; the client must start a new sign-in." });

      const idClaims = { iss: ISSUER, sub: "248289761001", aud: fault === "idtoken-aud" ? "another-client" : client, exp: at(fault === "idtoken-expired" ? -60 : 300), iat: at(fault === "idtoken-expired" ? -360 : 0), auth_time: at(c.idpSession === "active" ? -1200 : 0), nonce: fault === "nonce" ? "n-replayed-from-elsewhere" : NONCE, amr: ["pwd"], name: "Alice Example (synthetic)", email: "alice@acme.example" };
      const idToken = jwt("id_token", "ID token", idClaims, fault === "idtoken-key" ? "unknown-key-x9" : IDP_KEY);
      const atClaims = { iss: ISSUER, sub: "248289761001", aud: fault === "api-aud" ? "https://hr.example" : API, client_id: client, scope: fault === "api-scope" ? "openid profile" : scope, tenant: "acme", exp: at(300), iat: at(0), jti: "at-5a1" };
      const accessToken = jwt("access_token", "Access token", atClaims);
      const refresh = opaque("refresh_token", "Refresh token", "rt-1-synthetic");
      f.add({ from: "idp", to: "app", kind: "response", channel: "back", title: "200 tokens", status: 200, headers: [["Content-Type", "application/json"], ["Cache-Control", "no-store"]],
        body: '{ "token_type": "Bearer", "expires_in": 300, "access_token": "…", "id_token": "…", "refresh_token": "…" }',
        tokens: [idToken, accessToken, refresh],
        sets: [
          { at: "app", key: "ID token", value: "received, not yet validated", token: idToken },
          { at: "app", key: "Access token", value: `for ${String(atClaims.aud)}, ${atClaims.scope}`, token: accessToken },
          { at: "app", key: "Refresh token", value: web(c) ? "kept on the server" : "in memory, rotated on use (RFC 9700 §2.2.2)", token: refresh },
          { at: "app", key: "code_verifier", value: null },
        ],
        purpose: "The ID token says who signed in (for the client). The access token is for the API. Neither should ever be put in a URL.",
        protects: `HTTPS and Cache-Control: no-store. Tokens are held by ${where}.` });

      const knownKey = idToken.signedBy === IDP_KEY;
      f.add({ from: "app", to: "app", kind: "action", channel: "internal", title: "Validates the ID token",
        checks: [
          check("idt-signature", "Signature verifies with a key from the provider's JWKS (kid)", knownKey, knownKey ? `kid ${IDP_KEY} is in ${ISSUER}/jwks; RS256 (modelled).` : "kid unknown-key-x9 is not in the JWKS, even after refreshing it.", "OIDC Core §3.1.3.7 (6)"),
          check("idt-iss", "iss exactly equals the expected issuer", true, ISSUER, "OIDC Core §3.1.3.7 (2)"),
          check("idt-aud", "aud contains this client's client_id", idClaims.aud === client, `aud = ${idClaims.aud}; this client is ${client}.`, "OIDC Core §3.1.3.7 (3)"),
          check("idt-exp", "Current time is before exp", fault !== "idtoken-expired", fault === "idtoken-expired" ? "exp was 60 s ago." : "Expires in 300 s.", "OIDC Core §3.1.3.7 (9)"),
          check("idt-nonce", "nonce equals the one sent in the request", idClaims.nonce === NONCE, `Got ${idClaims.nonce}; sent ${NONCE}.`, "OIDC Core §3.1.3.7 (11)"),
        ],
        purpose: "The ID token is the client's proof of authentication. Decoding it isn't enough: each claim and the signature must be checked.",
        ifFails: "Reject the sign-in. Never fall back to trusting unverified claims." },
        { from: "app", to: "browser", kind: "response", channel: web(c) ? "back" : "internal", title: "Sign-in failed", status: 401, purpose: "No application session is created." });

      if (web(c)) {
        f.add({ from: "app", to: "browser", kind: "redirect", channel: "back", title: "302 / with the app's own session cookie", status: 302,
          headers: [["Location", "/"], ["Set-Cookie", `__Host-session=k8Fh2-synthetic; ${SESSION_COOKIE}; Max-Age=3600`], ["Set-Cookie", "__Host-login_tx=; Max-Age=0; Path=/; Secure"]],
          sets: [
            { at: "app", key: "Session k8Fh2", value: "alice (sub 248289761001), tokens attached, 1 h", note: "Server-side session store." },
            { at: "browser", key: "Cookie for app.example", value: "__Host-session=k8Fh2-synthetic", note: "A new identifier: never reuse the pre-login one (session fixation)." },
          ],
          purpose: "The application starts ITS OWN session, separate from the identity provider's. The browser gets only an opaque session id: tokens stay on the server.",
          protects: "HttpOnly (script can't read it), Secure (HTTPS only), SameSite=Lax (not sent on cross-site subrequests), __Host- prefix (this exact host, Path=/)." });
        f.add({ from: "browser", to: "app", kind: "request", channel: "back", title: "GET / (with session cookie)", method: "GET", endpoint: `${APP}/`, headers: [["Cookie", "__Host-session=k8Fh2-synthetic"]],
          checks: [check("session", "Session id maps to a live server-side session", true, "k8Fh2: alice, expires in 1 h.")], purpose: "Every later request is authenticated by the session cookie, not by re-checking the ID token." });
      } else {
        f.add({ from: "app", to: "app", kind: "action", channel: "internal", title: "Keeps tokens in memory",
          sets: [{ at: "browser", key: "App memory", value: "access token, refresh token, user profile", note: "Lost on reload; the app then refreshes or signs in silently." }],
          purpose: "The browser app's 'session' is its in-memory state. RFC 10017 §8 notes that any script running in the origin can use tokens held this way, which is why it recommends a backend-for-frontend for business applications." });
      }

      if (c.callApi === "yes") {
        const sent = fault === "api-idtoken" ? idToken : accessToken;
        f.add({ from: "app", to: "api", kind: "request", channel: "back", title: "GET /orders (Bearer token)", method: "GET", endpoint: `${API}/orders`, headers: [["Authorization", `Bearer <${sent.label.toLowerCase()}>`]], tokens: [sent],
          purpose: web(c) ? "The application's server calls the API on the user's behalf." : "JavaScript calls the API directly with the access token (CORS).",
          protects: "HTTPS. A bearer token works for whoever holds it, so it must never leak." });
        const claims = sent.claims!;
        const isAccess = sent.kind === "access_token";
        const scopes = String(claims.scope ?? "").split(" ");
        f.add({ from: "api", to: "api", kind: "action", channel: "internal", title: "Validates the access token, then authorizes",
          checks: [
            check("at-type", "It is an access token (typ at+jwt), not an ID token", isAccess, isAccess ? "typ = at+jwt." : "typ = JWT with aud = the client: this is an ID token, meant for the client, not for APIs.", "RFC 9068 §2.1"),
            check("at-signature", "Signature verifies with the issuer's key", true, `kid ${IDP_KEY} (modelled).`),
            check("at-iss", "iss is the trusted issuer", true, ISSUER),
            check("at-aud", "aud is this API", claims.aud === API, `aud = ${String(claims.aud)}; this API is ${API}.`, "RFC 9700 §2.3, RFC 9068 §4"),
            check("at-exp", "Not expired", true, "Expires in 300 s."),
            check("at-scope", "scope includes orders.read", scopes.includes("orders.read"), `scope = ${String(claims.scope ?? "(none)")}.`, "RFC 6750 §3.1"),
            check("at-owner", "Policy: alice may read these orders (her tenant, her orders)", true, "Object-level check per order, deny by default (see the Authorization Playground)."),
          ],
          purpose: "Authentication of the request (is this token genuine and for me?) then authorization (may this caller do this to this resource?). A valid token is necessary, not sufficient.",
          ifFails: "401 with WWW-Authenticate: Bearer error=\"invalid_token\" for a bad token; 403 error=\"insufficient_scope\" when the token is fine but lacks permission." },
          { from: "api", to: "app", kind: "response", channel: "back", title: claims.aud === API && isAccess ? "403 insufficient_scope" : "401 invalid_token", status: claims.aud === API && isAccess ? 403 : 401,
            headers: [["WWW-Authenticate", claims.aud === API && isAccess ? 'Bearer error="insufficient_scope", scope="orders.read"' : 'Bearer error="invalid_token"']], purpose: "The API refuses and says why, without leaking token contents." });
        f.add({ from: "api", to: "app", kind: "response", channel: "back", title: "200 orders", status: 200, body: '{ "orders": [{ "id": 123, "total": 120 }] }', purpose: "Only alice's orders in tenant acme." });
      }
      f.add({ from: "app", to: "browser", kind: "response", channel: web(c) ? "back" : "internal", title: "Shows the signed-in page", status: 200, purpose: c.callApi === "yes" ? "The user sees their orders." : "The user is signed in to the application." });
    }
    return f.events;
  },
};
