// OAuth 2.0 grants without a browser sign-in, and the lifecycle of tokens: Client Credentials (RFC 6749 §4.4),
// the Device Authorization Grant (RFC 8628), refresh token rotation and reuse detection (RFC 6749 §6, RFC 9700
// §4.14), and opaque tokens with introspection (RFC 7662) and revocation (RFC 7009).
import { check, flow, type Scenario } from "../model.ts";
import { API, APP, ISSUER, actors, at, jwt, opaque, pick } from "./common.ts";

const clientAuth: Record<string, { label: string; headers: [string, string][]; params: [string, string][]; detail: string }> = {
  secret: { label: "client_secret_basic", headers: [["Authorization", "Basic YmlsbGluZzrigKLigKLigKI= (billing:secret, synthetic)"]], params: [], detail: "A shared secret, compared by the authorization server. Must be stored like a password and rotated." },
  "private-key-jwt": { label: "private_key_jwt", headers: [], params: [["client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"], ["client_assertion", "<JWT signed by billing's private key: iss=sub=billing, aud=token endpoint, exp in 60 s, unique jti>"]], detail: "A short-lived JWT signed with the client's private key; the server holds only the public key (RFC 7523, OIDC Core §9)." },
  mtls: { label: "tls_client_auth (mTLS)", headers: [], params: [["client_id", "billing"]], detail: "The TLS client certificate presented during the handshake identifies the client (RFC 8705)." },
};

export const clientCredentials: Scenario = {
  id: "client-credentials",
  title: "Service to service (Client Credentials)",
  summary: "A backend service gets an access token as itself, with no user and no browser, and calls another service's API.",
  standards: ["RFC 6749 §4.4", "RFC 7523 (JWT client authentication)", "RFC 8705 (mutual TLS)", "RFC 8707 (resource indicators)", "RFC 9068 (JWT access tokens)", "RFC 6750"],
  actors: pick("service", "idp", "api"),
  controls: [
    { id: "auth", label: "How the service authenticates", level: "basic", help: "Proving the client's identity at the token endpoint.", options: [
      { value: "secret", label: "Client secret" },
      { value: "private-key-jwt", label: "Signed JWT (private_key_jwt)" },
      { value: "mtls", label: "Mutual TLS certificate" },
    ] },
    { id: "scope", label: "Scope requested", level: "basic", help: "Billing is registered for orders.read only: least privilege.", options: [
      { value: "orders.read", label: "orders.read" },
      { value: "orders.write", label: "orders.write" },
    ] },
    { id: "renew", label: "Token reuse", level: "advanced", help: "Access tokens last 5 minutes here. A good client caches one and renews it shortly before it expires.", options: [
      { value: "cache", label: "Cache, renew before expiry" },
      { value: "late", label: "Keep using the cached token after expiry" },
    ] },
    { id: "fault", label: "Break something", level: "fault", help: "Inject one fault.", options: [
      { value: "none", label: "Nothing" },
      { value: "bad-credential", label: "Wrong client credential" },
      { value: "wrong-resource", label: "Token requested for another API" },
    ] },
  ],
  modelNote: "Modelled: requests, parameters and checks. Managed identities (a cloud platform issuing credentials to a workload) are explained in the lessons; they end in the same token request.",
  notModelled: ["TLS certificate validation details", "Vendor-specific token formats", "Network failures and retries"],
  run(c) {
    const f = flow();
    const auth = clientAuth[c.auth];
    const resource = c.fault === "wrong-resource" ? "https://hr.example" : API;
    const granted = c.scope === "orders.read";
    f.add({ from: "service", to: "service", kind: "action", channel: "internal", title: "Needs a token; cache is empty", purpose: "A nightly billing job must read orders. No user is involved, so no browser, redirect or consent." });
    f.add({ from: "service", to: "idp", kind: "request", channel: "back", title: "POST /token grant_type=client_credentials", method: "POST", endpoint: `${ISSUER}/token`,
      headers: [["Content-Type", "application/x-www-form-urlencoded"], ...auth.headers], params: [["grant_type", "client_credentials"], ["scope", c.scope], ["resource", resource], ...auth.params],
      purpose: "The service asks for a token as itself. resource (RFC 8707) names the API the token is for.", protects: `HTTPS, and ${auth.label}.` });
    f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: "Authenticates the client, checks what it may have",
      checks: [
        check("client-auth", `Client authenticated (${auth.label})`, c.fault !== "bad-credential", c.fault === "bad-credential" ? "The credential doesn't match the registration." : auth.detail, "RFC 6749 §2.3"),
        check("scope-allowed", "Requested scope is allowed for this client", granted, granted ? "billing may have orders.read." : "billing is registered for orders.read only; orders.write is not granted (least privilege).", "RFC 6749 §3.3"),
        check("resource", "The requested resource is one this client may call", resource === API, resource === API ? `${API}.` : `${resource} is not an API billing may call.`, "RFC 8707 §2"),
      ],
      purpose: "The client is the resource owner here: the authorization server decides from the client's registration alone.",
      ifFails: "401 invalid_client for bad credentials; 400 invalid_scope or invalid_target for permissions it doesn't have." },
      { from: "idp", to: "service", kind: "response", channel: "back", title: c.fault === "bad-credential" ? "401 invalid_client" : resource !== API ? "400 invalid_target" : "400 invalid_scope", status: c.fault === "bad-credential" ? 401 : 400, purpose: "No token is issued." });
    const token = jwt("access_token", "Access token", { iss: ISSUER, sub: "billing", client_id: "billing", aud: API, scope: c.scope, iat: at(0), exp: at(300), jti: "at-b1" });
    f.add({ from: "idp", to: "service", kind: "response", channel: "back", title: "200 access token (no refresh token)", status: 200, headers: [["Cache-Control", "no-store"]], tokens: [token],
      sets: [{ at: "service", key: "Token cache", value: "access token, expires in 300 s", token }],
      purpose: "sub is the client itself. No refresh token: the service can simply ask again (RFC 6749 §4.4.3)." });
    f.add({ from: "service", to: "api", kind: "request", channel: "back", title: "GET /orders?date=… (Bearer)", method: "GET", endpoint: `${API}/orders`, headers: [["Authorization", "Bearer <access token>"]], tokens: [token], purpose: "Calls the API with the token." });
    f.add({ from: "api", to: "api", kind: "action", channel: "internal", title: "Validates token, authorizes the service",
      checks: [
        check("at-sig", "Signature and issuer", true, "Trusted issuer, known key (modelled)."),
        check("at-aud", "aud is this API", true, API),
        check("at-exp", "Not expired", true, "300 s left."),
        check("at-scope", "scope includes orders.read", true, c.scope),
        check("machine", "Policy allows the billing service (a machine identity) to read orders", true, "Services are authorized as clients, with their own permissions, never as an imitation user."),
      ], purpose: "Same validation as for a user's token. The policy sees a client identity, not a person." });
    f.add({ from: "api", to: "service", kind: "response", channel: "back", title: "200 orders", status: 200, purpose: "The job gets its data." });
    f.wait(310);
    if (c.renew === "late") {
      f.add({ from: "service", to: "api", kind: "request", channel: "back", title: "GET /orders with the cached token", method: "GET", endpoint: `${API}/orders`, headers: [["Authorization", "Bearer <access token>"]], purpose: "310 s later, the service reuses its cached token without checking its expiry." });
      f.add({ from: "api", to: "api", kind: "action", channel: "internal", title: "Validates the token", checks: [check("at-exp-late", "Not expired", false, "exp passed 10 s ago.", "RFC 7519 §4.1.4")], purpose: "Expired tokens are refused, however valid they once were." },
        { from: "api", to: "service", kind: "response", channel: "back", title: "401 invalid_token", status: 401, headers: [["WWW-Authenticate", 'Bearer error="invalid_token", error_description="The access token expired"']], purpose: "The service must get a new token and retry once. Renewing shortly before expiry avoids this failed call." });
    } else {
      f.add({ from: "service", to: "idp", kind: "request", channel: "back", title: "POST /token again (renewal)", method: "POST", endpoint: `${ISSUER}/token`, params: [["grant_type", "client_credentials"], ["scope", c.scope], ["resource", API]],
        sets: [{ at: "service", key: "Token cache", value: "new access token, expires in 300 s" }], purpose: "Before the cached token expires, the service fetches a new one. Every service instance doing this at once is a load spike: cache per process and add jitter." });
      f.add({ from: "service", to: "api", kind: "request", channel: "back", title: "GET /orders (new token)", method: "GET", endpoint: `${API}/orders`, purpose: "Calls continue without a failed request." });
      f.add({ from: "api", to: "service", kind: "response", channel: "back", title: "200 orders", status: 200, purpose: "The job carries on with its new token." });
    }
    return f.events;
  },
};

export const deviceGrant: Scenario = {
  id: "device",
  title: "Sign in on a TV (Device Authorization)",
  summary: "A device with no browser shows a short code; the user approves it on their phone while the device polls the token endpoint.",
  standards: ["RFC 8628 (OAuth 2.0 Device Authorization Grant)"],
  actors: pick("device", "idp", "user", "phone"),
  controls: [
    { id: "user", label: "On the phone, the user", level: "basic", help: "What the user does at the verification page.", options: [
      { value: "approve", label: "Signs in and approves" },
      { value: "deny", label: "Denies" },
      { value: "never", label: "Never finishes (code expires)" },
    ] },
    { id: "interval", label: "Device polls every", level: "advanced", help: "The server said interval=5. Polling faster earns slow_down.", options: [
      { value: "5", label: "5 s (as told)" },
      { value: "2", label: "2 s (too fast)" },
    ] },
  ],
  modelNote: "Modelled: the device and token endpoint messages and the polling responses defined by RFC 8628 §3.5.",
  notModelled: ["Phishing that tricks a user into approving someone else's code (RFC 8628 §5.4): the verification page must show what is being approved"],
  run(c) {
    const f = flow();
    f.add({ from: "device", to: "idp", kind: "request", channel: "back", title: "POST /device_authorization", method: "POST", endpoint: `${ISSUER}/device_authorization`, params: [["client_id", "tv-app"], ["scope", "openid profile videos.read"]], purpose: "The TV can't show a sign-in page, so it asks for a code pair." });
    const deviceCode = opaque("device_code", "Device code", "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS-synthetic");
    f.add({ from: "idp", to: "device", kind: "response", channel: "back", title: "200 device_code, user_code", status: 200,
      body: '{ "device_code": "…", "user_code": "WDJB-MJHT", "verification_uri": "https://idp.example/device", "verification_uri_complete": "https://idp.example/device?user_code=WDJB-MJHT", "expires_in": 600, "interval": 5 }',
      tokens: [deviceCode], sets: [{ at: "device", key: "device_code", value: "secret, kept by the TV", token: deviceCode }, { at: "idp", key: "Pending authorization WDJB-MJHT", value: "waiting for the user, 600 s" }],
      purpose: "device_code is the TV's secret; user_code is short and typed by a human. The TV shows the code and URL (or a QR code)." });
    f.add({ from: "device", to: "user", kind: "action", channel: "internal", title: "Shows “Go to idp.example/device, enter WDJB-MJHT”", purpose: "The two devices are linked only through the user." });
    const poll = (label: string, error: string, why: string) => {
      f.wait(Number(c.interval));
      f.add({ from: "device", to: "idp", kind: "request", channel: "back", title: "POST /token (poll)", method: "POST", endpoint: `${ISSUER}/token`, params: [["grant_type", "urn:ietf:params:oauth:grant-type:device_code"], ["device_code", "…"], ["client_id", "tv-app"]], purpose: label });
      f.add({ from: "idp", to: "device", kind: "response", channel: "back", title: `400 ${error}`, status: 400, body: `{ "error": "${error}" }`, purpose: why });
    };
    poll("The TV polls at the interval it was given.", "authorization_pending", "The user hasn't finished yet: keep polling.");
    if (c.interval === "2") poll("Polling again after only 2 s.", "slow_down", "Too fast. RFC 8628 §3.5: the device MUST add 5 seconds to its interval from now on.");
    if (c.user === "never") {
      f.wait(600);
      f.add({ from: "device", to: "idp", kind: "request", channel: "back", title: "POST /token (poll)", method: "POST", endpoint: `${ISSUER}/token`, purpose: "Ten minutes later, still polling." });
      f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: "Checks the device code", checks: [check("device-expired", "device_code still valid", false, "expires_in (600 s) has passed.", "RFC 8628 §3.5")], purpose: "Codes expire so a forgotten TV prompt can't be approved hours later." },
        { from: "idp", to: "device", kind: "response", channel: "back", title: "400 expired_token", status: 400, purpose: "The TV must start again with a new code." });
      return f.events;
    }
    f.add({ from: "user", to: "phone", kind: "action", channel: "internal", title: "Opens idp.example/device on the phone", purpose: "A full browser, where passwords, MFA and passkeys all work." });
    f.add({ from: "phone", to: "idp", kind: "request", channel: "front", title: "Signs in, enters WDJB-MJHT", method: "POST", endpoint: `${ISSUER}/device`, params: [["user_code", "WDJB-MJHT"]], checks: [check("user-code", "user_code matches a pending request", true, "Found: tv-app wants openid profile videos.read.")], purpose: "The page should show which device and app is asking, so the user approves knowingly." });
    f.add({ from: "user", to: "idp", kind: "action", channel: "front", title: c.user === "deny" ? "Taps Deny" : "Taps Allow", sets: [{ at: "idp", key: "Pending authorization WDJB-MJHT", value: c.user === "deny" ? "denied" : "approved by alice" }], purpose: "The decision is recorded against the device code." });
    f.wait(Number(c.interval === "2" ? 7 : 5));
    f.add({ from: "device", to: "idp", kind: "request", channel: "back", title: "POST /token (poll)", method: "POST", endpoint: `${ISSUER}/token`, params: [["grant_type", "urn:ietf:params:oauth:grant-type:device_code"], ["device_code", "…"], ["client_id", "tv-app"]], purpose: "The next poll." });
    f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: "Checks the device code", checks: [check("device-approved", "The user approved this device code", c.user !== "deny", c.user === "deny" ? "Denied by the user." : "Approved by alice.", "RFC 8628 §3.5")], purpose: "The token is issued only once the user approves." },
      { from: "idp", to: "device", kind: "response", channel: "back", title: "400 access_denied", status: 400, purpose: "The TV stops polling and shows that sign-in was declined." });
    const token = jwt("access_token", "Access token", { iss: ISSUER, sub: "248289761001", client_id: "tv-app", aud: "https://videos.example", scope: "videos.read", exp: at(f.now + 3600), iat: at(f.now) });
    f.add({ from: "idp", to: "device", kind: "response", channel: "back", title: "200 tokens", status: 200, tokens: [token], sets: [{ at: "device", key: "Access token", value: "for videos.read", token }, { at: "device", key: "device_code", value: null }], purpose: "The TV is signed in as alice, without anyone typing a password on it." });
    return f.events;
  },
};

export const refreshRotation: Scenario = {
  id: "refresh",
  title: "Refresh tokens, rotation and reuse",
  summary: "An access token expires; the app refreshes it. With rotation, a stolen refresh token used twice is detected and the whole family is revoked.",
  standards: ["RFC 6749 §6", "RFC 9700 §2.2.2 and §4.14", "RFC 10017 §6.3.2"],
  actors: [{ ...actors.app, label: "Browser app", role: "A public client (single-page app) holding tokens in memory." }, actors.idp, actors.api, actors.attacker],
  controls: [
    { id: "rotation", label: "Refresh token rotation", level: "basic", help: "RFC 9700: refresh tokens for public clients MUST be sender-constrained or rotated.", options: [
      { value: "on", label: "On: each use returns a new refresh token" },
      { value: "off", label: "Off: the same refresh token works until it expires" },
    ] },
    { id: "theft", label: "Stolen refresh token", level: "basic", help: "An attacker obtained a copy of RT-1 (for example through an XSS bug).", options: [
      { value: "none", label: "No theft" },
      { value: "after", label: "Attacker uses RT-1 after the app has" },
      { value: "first", label: "Attacker uses RT-1 before the app does" },
    ] },
  ],
  modelNote: "Modelled: a reuse-detecting authorization server that revokes every token descended from a refresh token presented twice (one common implementation of RFC 9700 §4.14.2).",
  notModelled: ["Sender-constrained refresh tokens (DPoP, RFC 9449), the alternative to rotation", "Absolute and idle lifetimes for refresh tokens", "Concurrent refreshes from several tabs (the Engineering Lab practises single-flight refresh)"],
  run(c) {
    const f = flow();
    const rotate = c.rotation === "on";
    const rt1 = opaque("refresh_token", "Refresh token RT-1", "rt-1-synthetic");
    f.add({ from: "app", to: "app", kind: "action", channel: "internal", title: "Holds access token AT-1 and RT-1", sets: [{ at: "app", key: "Access token", value: "AT-1, expires in 300 s" }, { at: "app", key: "Refresh token", value: "RT-1", token: rt1 }, { at: "idp", key: "Token family F1", value: "RT-1 active" }], purpose: "After sign-in." });
    if (c.theft !== "none") f.add({ from: "attacker", to: "attacker", kind: "action", channel: "internal", title: "Has a copy of RT-1", sets: [{ at: "attacker", key: "Stolen", value: "RT-1" }], purpose: "Synthetic theft: refresh tokens are long-lived, so a leaked one is valuable." });
    const refreshBy = (who: "app" | "attacker", token: string, used: boolean, revoked: boolean) => {
      f.add({ from: who, to: "idp", kind: "request", channel: "back", title: `POST /token grant_type=refresh_token (${token})`, method: "POST", endpoint: `${ISSUER}/token`, params: [["grant_type", "refresh_token"], ["refresh_token", token], ["client_id", "app-spa"]], purpose: who === "app" ? "The app needs a new access token." : "The attacker tries to mint access tokens of their own." });
      const reused = rotate && used;
      const ok = !reused && !revoked;
      f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: "Checks the refresh token",
        checks: [check(`rt-${who}`, `${token} is valid and not used before`, ok, revoked ? `The family was revoked after reuse was detected.` : reused ? `${token} was already used once. Two parties hold it: revoke the whole family.` : rotate ? `${token} unused; issue a new one and retire this one.` : `${token} valid (no rotation: it stays valid).`, "RFC 9700 §4.14.2")],
        sets: reused ? [{ at: "idp", key: "Token family F1", value: "revoked (reuse detected)" }] : [],
        purpose: "Rotation makes a refresh token single use, so a second use reveals that a copy exists.",
        ifFails: "invalid_grant. The legitimate app's next refresh fails too, and the user signs in again: annoying, but the attacker is cut off." },
        { from: "idp", to: who, kind: "response", channel: "back", title: "400 invalid_grant", status: 400, purpose: "No new tokens." });
    };
    f.wait(300);
    f.add({ from: "app", to: "api", kind: "request", channel: "back", title: "GET /orders (AT-1, expired)", method: "GET", endpoint: `${API}/orders`, purpose: "Five minutes later." });
    f.add({ from: "api", to: "app", kind: "response", channel: "back", title: "401 invalid_token (expired)", status: 401, headers: [["WWW-Authenticate", 'Bearer error="invalid_token", error_description="The access token expired"']], purpose: "Access tokens are short-lived on purpose: a leaked one is useful for minutes, not days." });
    if (c.theft === "first") {
      refreshBy("attacker", "RT-1", false, false);
      f.add({ from: "idp", to: "attacker", kind: "response", channel: "back", title: rotate ? "200 AT-x, RT-2x" : "200 AT-x", status: 200, sets: [{ at: "attacker", key: "Access token", value: "AT-x (valid)" }, ...(rotate ? [{ at: "idp" as const, key: "Token family F1", value: "RT-2x active, RT-1 used" }] : [])], purpose: "The server can't tell the attacker from the app on first use." });
      refreshBy("app", "RT-1", true, false);
      if (f.stopped) {
        f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: "Family revoked: AT-x's refresh path is dead", sets: [{ at: "attacker", key: "Stolen", value: "RT-2x (now revoked)" }], purpose: "The attacker keeps AT-x until it expires (5 minutes) but can't renew it." });
        return f.events;
      }
      f.add({ from: "attacker", to: "api", kind: "request", channel: "back", title: "Keeps refreshing with RT-1", checks: [check("attacker-access", "Stolen refresh token stops working", false, "Without rotation, RT-1 keeps working for the attacker until it expires.", "RFC 9700 §2.2.2", "security")], purpose: "With rotation off nothing detects the copy." });
      return f.events;
    }
    refreshBy("app", "RT-1", false, false);
    f.add({ from: "idp", to: "app", kind: "response", channel: "back", title: rotate ? "200 AT-2, RT-2" : "200 AT-2", status: 200, sets: [{ at: "app", key: "Access token", value: "AT-2, expires in 300 s" }, ...(rotate ? [{ at: "app" as const, key: "Refresh token", value: "RT-2" }, { at: "idp" as const, key: "Token family F1", value: "RT-2 active, RT-1 used" }] : [])], purpose: rotate ? "A new refresh token replaces RT-1, which is now spent." : "The same refresh token remains valid." });
    f.add({ from: "app", to: "api", kind: "request", channel: "back", title: "Retries GET /orders (AT-2)", method: "GET", endpoint: `${API}/orders`, purpose: "Retry once with the new token." });
    f.add({ from: "api", to: "app", kind: "response", channel: "back", title: "200 orders", status: 200, purpose: "The user noticed nothing." });
    if (c.theft === "after") {
      refreshBy("attacker", "RT-1", true, false);
      if (!f.stopped) {
        f.add({ from: "idp", to: "attacker", kind: "response", channel: "back", title: "200 AT-x", status: 200, checks: [check("attacker-access", "Stolen refresh token stops working", false, "Without rotation the attacker gets fresh access tokens for as long as RT-1 lives.", "RFC 9700 §2.2.2", "security")], purpose: "Nothing ties the refresh token to the app that should hold it." });
        return f.events;
      }
      f.add({ from: "app", to: "idp", kind: "request", channel: "back", title: "Later: POST /token (RT-2)", method: "POST", endpoint: `${ISSUER}/token`, purpose: "The app's next refresh." });
      f.add({ from: "idp", to: "app", kind: "response", channel: "back", title: "400 invalid_grant: sign in again", status: 400, purpose: "RT-2 was revoked with its family. Expected after reuse detection: the user signs in again." });
    }
    return f.events;
  },
};

export const introspection: Scenario = {
  id: "introspection",
  title: "Opaque tokens, introspection and revocation",
  summary: "The API can't read an opaque token, so it asks the authorization server. Revocation takes effect at the next introspection, unless the API cached the answer.",
  standards: ["RFC 7662 (introspection)", "RFC 7009 (revocation)", "RFC 6750"],
  actors: [{ ...actors.app, origin: APP }, actors.idp, actors.api],
  controls: [
    { id: "revoke", label: "Between two API calls", level: "basic", help: "The user logs out and the app revokes the token (RFC 7009).", options: [
      { value: "no", label: "Nothing happens" },
      { value: "yes", label: "The app revokes the token" },
    ] },
    { id: "cache", label: "API caches introspection results", level: "basic", help: "Caching saves a call per request but delays revocation.", options: [
      { value: "off", label: "No: introspect every call" },
      { value: "60", label: "Yes, for 60 seconds" },
    ] },
  ],
  modelNote: "Modelled: the introspection and revocation endpoints' requests and responses.",
  notModelled: ["Signed introspection responses (RFC 9701)", "Token exchange (RFC 8693)"],
  run(c) {
    const f = flow();
    const token = opaque("access_token", "Opaque access token", "2YotnFZFEjr1zCsicMWpAA-synthetic");
    const callApi = (n: number) => {
      f.add({ from: "app", to: "api", kind: "request", channel: "back", title: `GET /orders (call ${n})`, method: "GET", endpoint: `${API}/orders`, headers: [["Authorization", "Bearer 2YotnFZFEjr1zCsicMWpAA-synthetic"]], tokens: [token], purpose: "An opaque token is a random reference: it carries no readable claims." });
    };
    const introspect = (active: boolean) => {
      f.add({ from: "api", to: "idp", kind: "request", channel: "back", title: "POST /introspect", method: "POST", endpoint: `${ISSUER}/introspect`, headers: [["Authorization", "Basic b3JkZXJzLWFwaTrigKI= (orders-api, synthetic)"]], params: [["token", "2YotnFZFEjr1zCsicMWpAA-synthetic"], ["token_type_hint", "access_token"]], purpose: "The API authenticates itself and asks about the token (RFC 7662 §2.1). The endpoint must be protected, or anyone could probe tokens." });
      f.add({ from: "idp", to: "api", kind: "response", channel: "back", title: active ? "200 active: true" : "200 active: false", status: 200, body: active ? '{ "active": true, "sub": "248289761001", "client_id": "app-web", "aud": "https://api.example", "scope": "orders.read", "exp": 1800000300 }' : '{ "active": false }', purpose: active ? "Live state from the authorization server." : "Revoked, expired or unknown: RFC 7662 deliberately doesn't say which." });
    };
    callApi(1);
    introspect(true);
    f.add({ from: "api", to: "api", kind: "action", channel: "internal", title: "Checks the answer", checks: [check("active-1", "active, aud is this API, scope orders.read", true, "All present.")], sets: c.cache === "60" ? [{ at: "api", key: "Introspection cache", value: "token → active, until t+60 s" }] : [], purpose: c.cache === "60" ? "Cached for 60 seconds." : "Not cached." });
    f.add({ from: "api", to: "app", kind: "response", channel: "back", title: "200 orders", status: 200, purpose: "Call 1 succeeds." });
    if (c.revoke === "yes") {
      f.wait(10);
      f.add({ from: "app", to: "idp", kind: "request", channel: "back", title: "POST /revoke", method: "POST", endpoint: `${ISSUER}/revoke`, params: [["token", "2YotnFZFEjr1zCsicMWpAA-synthetic"], ["token_type_hint", "access_token"]], sets: [{ at: "idp", key: "Token 2Yot…", value: "revoked" }], purpose: "The user logged out; the app tells the authorization server the token is no longer needed (RFC 7009)." });
      f.add({ from: "idp", to: "app", kind: "response", channel: "back", title: "200 (revoked)", status: 200, purpose: "RFC 7009 §2.2: 200 even for unknown tokens, so the response reveals nothing." });
    }
    f.wait(10);
    callApi(2);
    const cached = c.cache === "60";
    if (!cached) introspect(c.revoke !== "yes");
    const accepted = cached || c.revoke !== "yes";
    const checks = [check("active-2", "Token is active", accepted, cached ? "Cached 20 s ago: active." : accepted ? "active: true." : "active: false (revoked).")];
    if (c.revoke === "yes" && cached) checks.push(check("revocation", "A revoked token is refused", false, "The cache still says active: the revoked token works until the cache entry expires (up to 60 s).", "RFC 7009 §2.2", "security"));
    f.add({ from: "api", to: "api", kind: "action", channel: "internal", title: cached ? "Uses the cached answer" : "Checks the answer", checks, purpose: "The API is only as current as its last introspection.", ifFails: "Refuse with 401 invalid_token." },
      accepted ? { from: "api", to: "app", kind: "response", channel: "back", title: "200 orders (revoked token served)", status: 200, purpose: "The revocation hasn't reached this API yet. Shorter cache times or no cache close the gap, at the cost of more introspection calls." }
        : { from: "api", to: "app", kind: "response", channel: "back", title: "401 invalid_token", status: 401, headers: [["WWW-Authenticate", 'Bearer error="invalid_token"']], purpose: "Revocation took effect at the next introspection." });
    f.add({ from: "api", to: "app", kind: "response", channel: "back", title: "200 orders", status: 200, purpose: "Call 2 succeeds." });
    return f.events;
  },
};
