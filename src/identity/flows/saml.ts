// SAML 2.0 Web Browser SSO: SP-initiated, AuthnRequest over the HTTP-Redirect binding, Response over the HTTP-POST
// binding (SAML 2.0 Bindings §3.4, §3.5; Profiles §4.1), with the Service Provider's processing rules (Profiles
// §4.1.4.3) and XML Signature checks. Taught defensively: signature-wrapping is shown only as the check that stops it.
import { check, flow, type Scenario, type Token } from "../model.ts";
import { actors } from "./common.ts";

const SP = "https://reports.example";
const ACS = `${SP}/saml/acs`;
const IDP_SSO = "https://idp.example/saml/sso";

const sp = { ...actors.app, label: "Service provider", role: "Reports app: trusts the IdP's signed assertions.", origin: SP };

export const saml: Scenario = {
  id: "saml",
  title: "Enterprise SSO with SAML 2.0",
  summary: "The service provider sends an AuthnRequest through the browser; the identity provider posts back a signed assertion that the service provider validates before starting a session.",
  standards: ["SAML 2.0 Core (assertions, conditions)", "SAML 2.0 Bindings §3.4 HTTP-Redirect, §3.5 HTTP-POST", "SAML 2.0 Profiles §4.1 Web Browser SSO", "XML Signature 1.1"],
  actors: [actors.user, actors.browser, sp, actors.idp, actors.attacker],
  controls: [
    { id: "initiated", label: "Started by", level: "basic", help: "SP-initiated has an InResponseTo to check; IdP-initiated (unsolicited) does not, which removes a replay and CSRF defence.", options: [
      { value: "sp", label: "Service provider (user opens the app)" },
      { value: "idp", label: "Identity provider (user clicks a tile)" },
    ] },
    { id: "spAllowsUnsolicited", label: "Service provider accepts unsolicited responses", level: "advanced", help: "Whether this SP is configured to accept IdP-initiated SSO.", options: [
      { value: "no", label: "No" },
      { value: "yes", label: "Yes", when: (c) => c.initiated === "idp" },
    ] },
    { id: "fault", label: "Break something", level: "fault", help: "Inject one fault and see which processing rule stops it.", options: [
      { value: "none", label: "Nothing" },
      { value: "unsigned", label: "Assertion is not signed" },
      { value: "rotated-cert", label: "IdP signs with a new certificate the SP's metadata doesn't have" },
      { value: "audience", label: "Assertion is for another service provider" },
      { value: "expired", label: "Assertion's NotOnOrAfter has passed" },
      { value: "in-response-to", label: "InResponseTo doesn't match the request", when: (c) => c.initiated === "sp" },
      { value: "replay", label: "The same assertion is posted twice" },
      { value: "wrapping", label: "Signature covers a different element than the one read" },
    ] },
  ],
  modelNote: "Modelled: the messages, assertion fields and the service provider's checks. XML is shown in outline; canonicalization and signature computation are not performed.",
  notModelled: ["Encrypted assertions (EncryptedAssertion) and their key transport", "Artifact binding and SOAP back channel", "Single Logout (SAML SLO)", "Metadata signature verification and refresh"],
  run(c) {
    const f = flow();
    const fault = c.fault;
    const requestId = "_a91c4f-synthetic";
    if (c.initiated === "sp") {
      f.add({ from: "user", to: "browser", kind: "action", channel: "internal", title: "Opens reports.example", purpose: "The user starts at the service provider." });
      f.add({ from: "browser", to: "app", kind: "request", channel: "back", title: "GET /reports (no session)", method: "GET", endpoint: `${SP}/reports`, purpose: "No SP session cookie, so the SP must ask the identity provider." });
      f.add({ from: "app", to: "app", kind: "action", channel: "internal", title: "Builds an AuthnRequest",
        body: `<samlp:AuthnRequest ID="${requestId}" Version="2.0" IssueInstant="2027-01-15T08:00:00Z"\n  Destination="${IDP_SSO}" AssertionConsumerServiceURL="${ACS}"\n  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">\n  <saml:Issuer>${SP}</saml:Issuer>\n</samlp:AuthnRequest>`,
        sets: [{ at: "app", key: "Outstanding request", value: `${requestId}, expires in 5 min` }], purpose: "The SP remembers the request ID so it can match the response (InResponseTo)." });
      f.add({ from: "app", to: "browser", kind: "redirect", channel: "front", title: "302 to IdP (HTTP-Redirect binding)", status: 302, headers: [["Location", `${IDP_SSO}?SAMLRequest=<deflated, base64, url-encoded>&RelayState=%2Freports&SigAlg=…&Signature=…`]], purpose: "The request is DEFLATE-compressed and base64-encoded into the URL. RelayState brings the user back to the page they wanted." });
      f.add({ from: "browser", to: "idp", kind: "request", channel: "front", title: "GET /saml/sso?SAMLRequest", method: "GET", endpoint: IDP_SSO,
        checks: [check("sp-known", "Issuer is a service provider in the IdP's metadata, ACS URL matches its registration", true, `${SP}, ACS ${ACS}.`)], purpose: "The IdP looks up the SP by entityID and will post only to the ACS URL in that SP's metadata." });
    } else {
      f.add({ from: "user", to: "idp", kind: "action", channel: "front", title: "Clicks the Reports tile in the IdP portal", purpose: "IdP-initiated: no request from the SP exists." });
    }
    f.add({ from: "user", to: "idp", kind: "action", channel: "front", title: "Authenticates at the IdP", checks: [check("authn", "User authenticated", true, "Password + MFA (synthetic), or an existing IdP session.")], purpose: "As with OIDC, credentials go only to the identity provider." });
    const assertion: Token = {
      kind: "saml_assertion", label: "SAML assertion", format: "xml", signedBy: fault === "unsigned" ? "none" : fault === "rotated-cert" ? "idp-cert-2027" : "idp-cert-2026",
      value: `<saml:Assertion ID="_as-5521" IssueInstant="2027-01-15T08:00:05Z">\n  <saml:Issuer>https://idp.example</saml:Issuer>\n  ${fault === "unsigned" ? "<!-- no ds:Signature -->" : `<ds:Signature><ds:SignedInfo><ds:Reference URI="#${fault === "wrapping" ? "_as-ORIGINAL" : "_as-5521"}"/></ds:SignedInfo>…</ds:Signature>`}\n  <saml:Subject>\n    <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">alice@acme.example</saml:NameID>\n    <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">\n      <saml:SubjectConfirmationData ${c.initiated === "sp" ? `InResponseTo="${fault === "in-response-to" ? "_other-request" : requestId}" ` : ""}Recipient="${ACS}" NotOnOrAfter="${fault === "expired" ? "2027-01-15T07:55:00Z" : "2027-01-15T08:05:05Z"}"/>\n    </saml:SubjectConfirmation>\n  </saml:Subject>\n  <saml:Conditions NotBefore="2027-01-15T08:00:00Z" NotOnOrAfter="${fault === "expired" ? "2027-01-15T07:55:00Z" : "2027-01-15T08:05:05Z"}">\n    <saml:AudienceRestriction><saml:Audience>${fault === "audience" ? "https://payroll.example" : SP}</saml:Audience></saml:AudienceRestriction>\n  </saml:Conditions>\n  <saml:AuthnStatement AuthnInstant="2027-01-15T08:00:04Z" SessionIndex="_si-7"/>\n  <saml:AttributeStatement>\n    <saml:Attribute Name="groups"><saml:AttributeValue>finance-readers</saml:AttributeValue></saml:Attribute>\n  </saml:AttributeStatement>\n</saml:Assertion>`,
    };
    f.add({ from: "idp", to: "browser", kind: "response", channel: "front", title: "200 auto-submitting form (HTTP-POST binding)", status: 200, tokens: [assertion],
      body: `<form method="post" action="${ACS}">\n  <input type="hidden" name="SAMLResponse" value="<base64 Response with the signed Assertion>">\n  <input type="hidden" name="RelayState" value="/reports">\n</form><script>document.forms[0].submit()</script>`,
      purpose: "The assertion is too big for a URL, so the browser posts it to the SP's Assertion Consumer Service. It travels through the browser: the signature is what makes it trustworthy." });
    f.add({ from: "browser", to: "app", kind: "request", channel: "front", title: "POST /saml/acs SAMLResponse", method: "POST", endpoint: ACS, tokens: [assertion], purpose: "The SP now validates everything before believing any of it." });
    const unsolicitedOk = c.initiated === "sp" || c.spAllowsUnsolicited === "yes";
    f.add({ from: "app", to: "app", kind: "action", channel: "internal", title: "Validates the response and assertion",
      checks: [
        check("signature", "Assertion signature verifies with the IdP certificate from metadata", fault !== "unsigned" && fault !== "rotated-cert", fault === "unsigned" ? "No signature on the assertion (or the response): reject." : fault === "rotated-cert" ? "Signed with idp-cert-2027, but the SP's metadata only has idp-cert-2026. Update metadata before the IdP switches (publish both during rollover)." : "Signed with idp-cert-2026, which is in the SP's metadata.", "XML Signature; Profiles §4.1.3.5"),
        check("signed-element", "The element the SP reads is the element the signature covers", fault !== "wrapping", fault === "wrapping" ? "The signature references #_as-ORIGINAL, but the SP was about to read _as-5521: a signature-wrapping attempt. Use only the signed element, by its reference, after schema validation." : "Reference URI #_as-5521 is the assertion being processed."),
        check("issuer", "Issuer is the expected IdP", true, "https://idp.example"),
        check("recipient", "Destination and Recipient are this ACS URL", true, ACS),
        check("audience", "AudienceRestriction contains this SP's entityID", fault !== "audience", fault === "audience" ? `Audience is https://payroll.example, not ${SP}: an assertion for another SP.` : SP, "Core §2.5.1.4"),
        check("time", "Now is within NotBefore / NotOnOrAfter (with small skew)", fault !== "expired", fault === "expired" ? "NotOnOrAfter was 07:55:00, five minutes ago." : "Valid until 08:05:05.", "Core §2.5.1.2"),
        check("in-response-to", c.initiated === "sp" ? "InResponseTo matches an outstanding request" : "Unsolicited responses are allowed by configuration", c.initiated === "sp" ? fault !== "in-response-to" : unsolicitedOk, c.initiated === "sp" ? (fault === "in-response-to" ? `InResponseTo=_other-request; outstanding: ${requestId}.` : `${requestId} was outstanding; now removed.`) : unsolicitedOk ? "Accepted: the SP relies on audience, time and replay checks alone." : "This SP accepts only responses to its own requests.", "Profiles §4.1.4.3"),
        check("replay", "Assertion ID not seen before", true, "_as-5521 recorded until it expires.", "Profiles §4.1.4.5"),
      ],
      sets: [{ at: "app", key: "Outstanding request", value: null }, { at: "app", key: "Replay cache", value: "_as-5521 until 08:05:05" }],
      purpose: "Every rule protects against something specific: forged, misdirected, stale or replayed assertions.",
      ifFails: "Reject, log it, show a generic sign-in error. Never read attributes from an assertion that failed validation." },
      { from: "app", to: "browser", kind: "response", channel: "back", title: "403 SAML validation failed", status: 403, purpose: "No session." });
    f.add({ from: "app", to: "browser", kind: "redirect", channel: "back", title: "302 /reports with SP session cookie", status: 302, headers: [["Set-Cookie", "__Host-reports=r-41; Path=/; Secure; HttpOnly; SameSite=Lax"], ["Location", "/reports"]],
      sets: [{ at: "app", key: "SP session r-41", value: "alice@acme.example, groups finance-readers" }, { at: "browser", key: "Cookie for reports.example", value: "__Host-reports=r-41" }],
      purpose: "The SP starts its own session, like an OIDC relying party, and maps the groups attribute to its roles." });
    if (fault === "replay") {
      f.wait(60);
      f.add({ from: "attacker", to: "app", kind: "request", channel: "front", title: "POST /saml/acs (captured SAMLResponse)", method: "POST", endpoint: ACS, tokens: [assertion], purpose: "A minute later, someone posts a copy of the same response, captured from a log or a shared computer. Its signature is still valid." });
      f.add({ from: "app", to: "app", kind: "action", channel: "internal", title: "Validates the response again",
        checks: [check("signature", "Assertion signature verifies", true, "Still validly signed."), check("time", "Within NotOnOrAfter", true, "Still before 08:05:05."), check("replay", "Assertion ID not seen before", false, "_as-5521 is already in the replay cache: a re-posted assertion.", "Profiles §4.1.4.5")],
        purpose: "A bearer assertion works for whoever posts it, so the SP must remember the IDs it accepted until they expire." },
        { from: "app", to: "attacker", kind: "response", channel: "back", title: "403 replay rejected", status: 403, purpose: "No session for the replayer." });
    }
    return f.events;
  },
};

