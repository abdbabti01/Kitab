// Single sign-on across two relying parties that trust one OpenID Provider, then logout. Three separate sessions:
// the identity provider's (cookie on idp.example) and each application's (cookies on their own sites). Follows
// OIDC Core §3.1 and §3.1.2.1 (prompt, max_age, acr_values), OIDC RP-Initiated Logout 1.0 and OIDC Back-Channel
// Logout 1.0. The first sign-in is condensed; "Sign in with OpenID Connect" shows every parameter.
import { check, flow, type Scenario } from "../model.ts";
import { FINANCE, ISSUER, IDP_KEY, PORTAL, SESSION_COOKIE, actors, at, jwt } from "./common.ts";

const portal = { ...actors.app, label: "Portal (App A)", role: "Employee Portal: a relying party.", origin: PORTAL };
const finance = { ...actors["app-b"], label: "Finance (App B)", role: "Finance application: a second relying party.", origin: FINANCE };

export const sso: Scenario = {
  id: "sso",
  title: "Single sign-on across two applications",
  summary: "Sign in to the Portal, then open Finance: the identity provider's session lets Finance sign the user in without another password, but each application keeps its own session.",
  standards: ["OpenID Connect Core 1.0 §3.1", "OIDC RP-Initiated Logout 1.0", "OIDC Back-Channel Logout 1.0", "RFC 6265bis (cookies)"],
  actors: [actors.user, actors.browser, portal, actors.idp, finance],
  controls: [
    { id: "idpAtB", label: "When Finance is opened", level: "basic", help: "The identity provider's session lasts 8 hours here; after that it must authenticate again.", options: [
      { value: "active", label: "Identity provider session still valid" },
      { value: "expired", label: "Identity provider session expired" },
    ] },
    { id: "bMfa", label: "Finance requires MFA", level: "basic", help: "Finance asks for a second factor (acr_values). The session from the Portal sign-in used only a password.", options: [
      { value: "no", label: "No" },
      { value: "yes", label: "Yes" },
    ] },
    { id: "after", label: "Then", level: "basic", help: "What happens after both applications are signed in.", options: [
      { value: "nothing", label: "Nothing" },
      { value: "logout-a", label: "Log out of the Portal only" },
      { value: "logout-idp", label: "Log out at the identity provider (from the Portal)" },
      { value: "a-expires", label: "The Portal's session expires, user returns" },
    ] },
    { id: "bScopes", label: "Finance asks for", level: "advanced", help: "Consent is recorded per client: SSO skips the password, not consent for new permissions.", options: [
      { value: "same", label: "openid profile (as the Portal)" },
      { value: "more", label: "openid profile invoices.read (new)" },
    ] },
    { id: "backchannel", label: "Back-channel logout", level: "advanced", help: "Whether Finance registered a backchannel_logout_uri, so the identity provider can tell it about logouts.", options: [
      { value: "off", label: "Not registered" },
      { value: "on", label: "Registered", when: (c) => c.after === "logout-idp" },
    ] },
    { id: "fault", label: "Break something", level: "fault", help: "Inject one fault.", options: [
      { value: "none", label: "Nothing" },
      { value: "reuse-idtoken", label: "Finance is handed the Portal's ID token" },
    ] },
  ],
  modelNote: "Modelled: sessions, cookies per site and the messages that cross between them. Code exchanges for the second application are condensed into fewer events than the full sign-in scenario.",
  notModelled: ["Front-channel logout (iframes), which third-party cookie restrictions often break", "OIDC Session Management (check_session_iframe), unreliable for the same reason", "Browser privacy features beyond cookie scoping; silent prompt=none renewals in iframes are often blocked by third-party cookie restrictions"],
  run(c) {
    const f = flow();
    const bScope = c.bScopes === "more" ? "openid profile invoices.read" : "openid profile";
    const portalId = jwt("id_token", "Portal ID token", { iss: ISSUER, sub: "248289761001", aud: "portal", exp: at(300), iat: at(0), nonce: "n-portal", sid: "sid-9f2e", amr: ["pwd"] });

    // ---- Sign in at the Portal (condensed) ----
    f.add({ from: "user", to: "browser", kind: "action", channel: "internal", title: "Opens portal.example", purpose: "The user starts at Application A." });
    f.add({ from: "browser", to: "app", kind: "request", channel: "back", title: "GET / (no cookie)", method: "GET", endpoint: `${PORTAL}/`, checks: [check("a-session", "Looks up a Portal session", true, "None yet, so the Portal starts sign-in (not a failure).")], purpose: "No Portal session cookie, so the Portal redirects to the identity provider." });
    f.add({ from: "app", to: "browser", kind: "redirect", channel: "front", title: "302 /authorize (client_id=portal)", status: 302, headers: [["Location", `${ISSUER}/authorize?response_type=code&client_id=portal&redirect_uri=${encodeURIComponent(PORTAL + "/callback")}&scope=openid%20profile&state=…&nonce=…&code_challenge=…&code_challenge_method=S256`]], purpose: "A normal Authorization Code + PKCE request." });
    f.add({ from: "browser", to: "idp", kind: "request", channel: "front", title: "GET /authorize (no idp cookie)", method: "GET", endpoint: `${ISSUER}/authorize`, purpose: "The browser has no idp.example cookie yet." });
    f.add({ from: "user", to: "idp", kind: "action", channel: "front", title: "Authenticates with password", checks: [check("credentials", "Password verified", true, "Synthetic user alice.")], purpose: "The only password prompt in this scenario, unless the identity provider's session expires." });
    f.add({ from: "idp", to: "browser", kind: "redirect", channel: "front", title: "Session cookie + 302 code to the Portal", status: 302,
      headers: [["Set-Cookie", "idp_session=s-9f2e; Domain=idp.example; Secure; HttpOnly; SameSite=Lax"], ["Location", `${PORTAL}/callback?code=…&state=…&iss=${encodeURIComponent(ISSUER)}`]],
      sets: [{ at: "idp", key: "IdP session s-9f2e", value: "alice, amr pwd, 8 h", note: "Shared by every application that trusts this identity provider." }, { at: "browser", key: "Cookie for idp.example", value: "idp_session=s-9f2e" }],
      purpose: "The identity provider starts its session and sends a code to the Portal." });
    f.add({ from: "app", to: "idp", kind: "request", channel: "back", title: "POST /token, then validate ID token", method: "POST", endpoint: `${ISSUER}/token`, tokens: [portalId],
      checks: [check("a-idtoken", "Portal validates its ID token (iss, aud=portal, exp, nonce, signature)", true, `aud = portal, signed with ${IDP_KEY}.`)], purpose: "The back-channel exchange and validation, as in the full sign-in scenario." });
    f.add({ from: "app", to: "browser", kind: "response", channel: "back", title: "Portal session cookie", headers: [["Set-Cookie", `__Host-portal=pa-11; ${SESSION_COOKIE}`]],
      sets: [{ at: "app", key: "Portal session pa-11", value: "alice, sid-9f2e, 1 h" }, { at: "browser", key: "Cookie for portal.example", value: "__Host-portal=pa-11" }],
      purpose: "Session one of three: the Portal's own." });

    // ---- Open Finance ----
    f.wait(c.idpAtB === "expired" ? 9 * 3600 : 600);
    f.add({ from: "user", to: "browser", kind: "action", channel: "internal", title: "Opens finance.example", purpose: c.idpAtB === "expired" ? "Nine hours later: past the identity provider's 8-hour session." : "Ten minutes later." });
    f.add({ from: "browser", to: "app-b", kind: "request", channel: "back", title: "GET / (no Finance cookie)", method: "GET", endpoint: `${FINANCE}/`, headers: [],
      checks: [check("b-session", "Looks up a Finance session", true, "None. The Portal's cookie belongs to portal.example and is never sent to finance.example: cookies are scoped to their site.")],
      purpose: "Finance can't see the Portal's session. It must ask the identity provider itself." });
    f.add({ from: "app-b", to: "browser", kind: "redirect", channel: "front", title: "302 /authorize (client_id=finance)", status: 302,
      headers: [["Location", `${ISSUER}/authorize?response_type=code&client_id=finance&scope=${encodeURIComponent(bScope)}${c.bMfa === "yes" ? "&acr_values=mfa" : ""}&state=…&nonce=…&code_challenge=…`]],
      purpose: `Finance starts its own sign-in, with its own client_id, state, nonce and PKCE.${c.bMfa === "yes" ? " acr_values=mfa asks for multi-factor authentication." : ""}` });
    const active = c.idpAtB === "active";
    f.add({ from: "browser", to: "idp", kind: "request", channel: "front", title: "GET /authorize + idp cookie", method: "GET", endpoint: `${ISSUER}/authorize`, headers: [["Cookie", "idp_session=s-9f2e"]],
      checks: [check("idp-session", "Checks the identity provider session", true, active ? "s-9f2e is 10 minutes old (8-hour limit): no password needed." : "s-9f2e is 9 hours old: expired. The identity provider must authenticate the user again (not an error).")],
      purpose: "The browser sends idp.example's cookie because this request goes to idp.example. This is where single sign-on happens." });
    let amr = ["pwd"];
    if (!active) {
      f.add({ from: "user", to: "idp", kind: "action", channel: "front", title: "Enters password again", purpose: "The identity provider's session expired, so SSO can't skip the prompt.", sets: [{ at: "idp", key: "IdP session s-9f2e", value: null }, { at: "idp", key: "IdP session s-a713", value: "alice, amr pwd, 8 h" }, { at: "browser", key: "Cookie for idp.example", value: "idp_session=s-a713" }] });
    }
    if (c.bMfa === "yes") {
      f.add({ from: "idp", to: "browser", kind: "response", channel: "front", title: "Asks for a second factor (step-up)", status: 200, purpose: "The session only proves a password. Finance asked for MFA, so the identity provider steps up instead of reusing the session as is." });
      f.add({ from: "user", to: "idp", kind: "action", channel: "front", title: "Enters a one-time code", checks: [check("otp", "TOTP code valid", true, "Synthetic code, 30-second window.")],
        sets: [{ at: "idp", key: active ? "IdP session s-9f2e" : "IdP session s-a713", value: "alice, amr pwd+otp, 8 h" }], purpose: "The session now records both factors." });
      amr = ["pwd", "otp"];
    }
    if (c.bScopes === "more") {
      f.add({ from: "user", to: "idp", kind: "action", channel: "front", title: "Consents to invoices.read for Finance", sets: [{ at: "idp", key: "Consent finance", value: bScope }], purpose: "Consent is per client and per scope. Signing in once doesn't grant Finance new permissions." });
    }
    const financeId = jwt("id_token", "Finance ID token", { iss: ISSUER, sub: "248289761001", aud: "finance", exp: at(f.now + 300), iat: at(f.now), nonce: "n-finance", sid: active ? "sid-9f2e" : "sid-a713", amr, ...(c.bMfa === "yes" ? { acr: "mfa" } : {}) });
    const handed = c.fault === "reuse-idtoken" ? portalId : financeId;
    f.add({ from: "idp", to: "browser", kind: "redirect", channel: "front", title: active && c.bMfa === "no" && c.bScopes === "same" ? "302 code to Finance, no prompt" : "302 code to Finance", status: 302, headers: [["Location", `${FINANCE}/callback?code=…&state=…&iss=${encodeURIComponent(ISSUER)}`]], purpose: "A new code, for Finance only." });
    f.add({ from: "app-b", to: "idp", kind: "request", channel: "back", title: "POST /token, then validate ID token", method: "POST", endpoint: `${ISSUER}/token`, tokens: [handed],
      checks: [
        check("b-aud", "aud contains finance", handed.claims!.aud === "finance", `aud = ${String(handed.claims!.aud)}. An ID token is for the client it was issued to; Finance must not accept the Portal's.`, "OIDC Core §3.1.3.7 (3)"),
        check("b-nonce", "nonce matches Finance's request", handed.claims!.nonce === "n-finance", `nonce = ${String(handed.claims!.nonce)}.`),
        ...(c.bMfa === "yes" ? [check("b-acr", "The sign-in used MFA (acr / amr)", amr.includes("otp"), `amr = ${amr.join(", ")}.`, "OIDC Core §3.1.3.7 (12)")] : []),
      ],
      purpose: "Finance validates its own ID token. It learns the same subject (sub) the Portal did: the identity provider is the shared source of identity.",
      ifFails: "Finance refuses the sign-in." },
      { from: "app-b", to: "browser", kind: "response", channel: "back", title: "401 sign-in failed", status: 401, purpose: "No Finance session." });
    f.add({ from: "app-b", to: "browser", kind: "response", channel: "back", title: "Finance session cookie", headers: [["Set-Cookie", `__Host-finance=fb-27; ${SESSION_COOKIE}`]],
      sets: [{ at: "app-b", key: "Finance session fb-27", value: `alice, ${active ? "sid-9f2e" : "sid-a713"}, 1 h` }, { at: "browser", key: "Cookie for finance.example", value: "__Host-finance=fb-27" }],
      purpose: "Session three: Finance's own. Three sessions now exist, with three lifetimes." });

    // ---- Then ----
    if (c.after === "logout-a") {
      f.add({ from: "user", to: "app", kind: "action", channel: "back", title: "Clicks “Log out” in the Portal", purpose: "A local logout: only the Portal is involved." });
      f.add({ from: "app", to: "browser", kind: "response", channel: "back", title: "Deletes the Portal session", headers: [["Set-Cookie", "__Host-portal=; Max-Age=0; Path=/; Secure"]],
        sets: [{ at: "app", key: "Portal session pa-11", value: null }, { at: "browser", key: "Cookie for portal.example", value: null }],
        purpose: "The Portal forgets the user. The identity provider's session and Finance's session are untouched." });
      f.add({ from: "user", to: "app", kind: "action", channel: "back", title: "Opens the Portal again", purpose: "No Portal session, so the Portal redirects to the identity provider…" });
      f.add({ from: "idp", to: "app", kind: "redirect", channel: "front", title: "Signed straight back in (IdP session)", checks: [check("idp-session-2", "Identity provider session still valid", true, "Nobody ended it, so no password is asked.")],
        sets: [{ at: "app", key: "Portal session pa-12", value: "alice, new session" }, { at: "browser", key: "Cookie for portal.example", value: "__Host-portal=pa-12" }],
        purpose: "A local logout followed by a visit looks like 'logout didn't work'. To end SSO, the identity provider's session must end too." });
    } else if (c.after === "logout-idp") {
      f.add({ from: "user", to: "app", kind: "action", channel: "back", title: "Clicks “Log out everywhere”", purpose: "The Portal ends its session and asks the identity provider to end its own." });
      f.add({ from: "app", to: "browser", kind: "redirect", channel: "front", title: "302 end_session_endpoint", status: 302,
        headers: [["Set-Cookie", "__Host-portal=; Max-Age=0; Path=/; Secure"], ["Location", `${ISSUER}/logout?id_token_hint=…&post_logout_redirect_uri=${encodeURIComponent(PORTAL + "/signed-out")}&state=…`]],
        sets: [{ at: "app", key: "Portal session pa-11", value: null }, { at: "browser", key: "Cookie for portal.example", value: null }],
        purpose: "RP-Initiated Logout: id_token_hint tells the identity provider which session; post_logout_redirect_uri must be registered." });
      const sid = active ? "IdP session s-9f2e" : "IdP session s-a713";
      f.add({ from: "browser", to: "idp", kind: "request", channel: "front", title: "GET /logout", method: "GET", endpoint: `${ISSUER}/logout`, sets: [{ at: "idp", key: sid, value: null }, { at: "browser", key: "Cookie for idp.example", value: null }], purpose: "The identity provider ends its session: no application can sign in silently any more." });
      if (c.backchannel === "on") {
        const logoutToken = jwt("logout_token", "Logout token", { iss: ISSUER, aud: "finance", iat: at(f.now), jti: "lt-77", sid: active ? "sid-9f2e" : "sid-a713", events: { "http://schemas.openid.net/event/backchannel-logout": {} } });
        f.add({ from: "idp", to: "app-b", kind: "request", channel: "back", title: "POST backchannel_logout_uri (logout_token)", method: "POST", endpoint: `${FINANCE}/backchannel-logout`, tokens: [logoutToken],
          checks: [check("logout-token", "Logout token valid: signature, iss, aud=finance, events claim, sid, no nonce", true, "Finance validates it like an ID token, plus the logout-specific rules.", "OIDC Back-Channel Logout §2.6")],
          sets: [{ at: "app-b", key: "Finance session fb-27", value: null }],
          purpose: "Server to server: works even though the browser never visits Finance. Finance deletes every session with this sid.", protects: "HTTPS and the token's signature." });
      } else {
        f.add({ from: "idp", to: "idp", kind: "action", channel: "internal", title: "Finance is not told", purpose: "Finance registered no logout endpoint, so its session lives on until it expires (up to 1 hour), even though the user 'logged out everywhere'. Single logout is only as complete as the applications that take part." });
      }
      f.add({ from: "idp", to: "browser", kind: "redirect", channel: "front", title: "302 post_logout_redirect_uri", status: 302, headers: [["Location", `${PORTAL}/signed-out?state=…`]], purpose: "Back to the Portal's signed-out page." });
    } else if (c.after === "a-expires") {
      f.wait(3600);
      f.add({ from: "user", to: "app", kind: "action", channel: "back", title: "Returns to the Portal an hour later", checks: [check("a-expired", "Looks up the Portal session", true, "Expired after 1 hour, so the Portal redirects to the identity provider (expected, not an error).")],
        sets: [{ at: "app", key: "Portal session pa-11", value: null }, { at: "browser", key: "Cookie for portal.example", value: null }], purpose: "The application's session ended on its own schedule." });
      f.add({ from: "idp", to: "app", kind: "redirect", channel: "front", title: "New code without a prompt", checks: [check("idp-still", "Identity provider session valid", true, "Still within its 8 hours.")],
        sets: [{ at: "app", key: "Portal session pa-13", value: "alice, new session" }, { at: "browser", key: "Cookie for portal.example", value: "__Host-portal=pa-13" }],
        purpose: "The browser is redirected again, and the identity provider's longer session signs the user back in. A short app session plus a longer IdP session is a common design." });
    }
    return f.events;
  },
};
