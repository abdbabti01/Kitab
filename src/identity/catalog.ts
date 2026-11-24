// The Identity track's ids, titles and versions without their content or engines, so the always-loaded course
// pages stay small. tests/identity-course.test.ts keeps these equal to the content and challenge modules.
export const identityUnitCatalog = [
  { id: "fundamentals", title: "Identity fundamentals" },
  { id: "passwords-sessions", title: "Passwords, login and sessions" },
  { id: "oauth", title: "OAuth 2.0 fundamentals" },
  { id: "oauth-flows", title: "OAuth authorization flows" },
  { id: "oidc", title: "OpenID Connect" },
  { id: "tokens", title: "JSON Web Tokens and token security" },
  { id: "sso", title: "Single sign-on" },
  { id: "saml", title: "SAML 2.0" },
  { id: "authorization", title: "Authorization architecture" },
  { id: "mfa-passkeys", title: "MFA, passkeys and passwordless" },
  { id: "enterprise", title: "Enterprise identity" },
  { id: "failures", title: "Security failures and their prevention" },
] as const;
export type IdentityUnitId = (typeof identityUnitCatalog)[number]["id"];

/** `variants` above 1: mastery needs passes in two different variants. */
export const identityChallengeCatalog = [
  { id: "authn-or-authz", title: "Authentication or authorization?", version: "1", unit: "fundamentals", variants: 2 },
  { id: "expired-session", title: "Investigate a redirect after a session expires", version: "1", unit: "passwords-sessions", variants: 2 },
  { id: "configure-oauth", title: "Configure OAuth correctly", version: "1", unit: "oauth", variants: 4 },
  { id: "repair-pkce", title: "Repair a broken sign-in flow", version: "1", unit: "oauth-flows", variants: 3 },
  { id: "validate-id-token", title: "Validate an ID token", version: "1", unit: "oidc", variants: 4 },
  { id: "token-rejected", title: "Why did the API reject the token?", version: "1", unit: "tokens", variants: 4 },
  { id: "sso-two-apps", title: "Set up SSO for two applications", version: "1", unit: "sso", variants: 3 },
  { id: "saml-failure", title: "Diagnose a SAML login failure", version: "1", unit: "saml", variants: 5 },
  { id: "fix-api-policy", title: "Fix an API authorization policy", version: "1", unit: "authorization", variants: 3 },
  { id: "phishing-resistant", title: "Stop a phishing proxy", version: "1", unit: "mfa-passkeys", variants: 1 },
  { id: "multi-tenant", title: "Secure a multi-tenant API", version: "1", unit: "enterprise", variants: 2 },
  { id: "enterprise-architecture", title: "Design an enterprise identity architecture", version: "1", unit: "enterprise", variants: 1 },
  { id: "incident-triage", title: "Triage identity incidents", version: "1", unit: "failures", variants: 5 },
] as const;
export type IdentityChallengeId = (typeof identityChallengeCatalog)[number]["id"];

export const identityUnitPath = (id: string) => `/learn/identity/${id}`;
export const identityChallengePath = (id: string) => `/practice/identity/challenges/${id}`;
export const IDENTITY_PLAYGROUND = "/practice/identity";
export const TOKEN_INSPECTOR = "/practice/identity/tokens";
export const AUTHZ_PLAYGROUND = "/practice/identity/authorization";
