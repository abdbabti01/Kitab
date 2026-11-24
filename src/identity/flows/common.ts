// Synthetic parties, addresses and token builders shared by the scenarios. Every host is under .example (RFC 2606):
// reserved, so none of these can ever be a real identity provider or application. Times are seconds after a fixed
// instant so runs replay exactly.
import type { Actor, ActorId, Token } from "../model.ts";

export const T0 = 1_800_000_000; // 2027-01-15T08:00:00Z
export const ISSUER = "https://idp.example";
export const APP = "https://app.example";
export const API = "https://api.example";
export const PORTAL = "https://portal.example";
export const FINANCE = "https://finance.example";
export const IDP_KEY = "idp-2027-a";
export const IDP_KEY_NEXT = "idp-2027-b";

export const actors: Record<ActorId, Actor> = {
  user: { id: "user", label: "User", role: "The person signing in." },
  browser: { id: "browser", label: "Browser", role: "Follows redirects, keeps cookies per site, runs the app's JavaScript." },
  app: { id: "app", label: "Application", role: "The OAuth client / OpenID Connect relying party.", origin: APP },
  "app-b": { id: "app-b", label: "Application B", role: "A second relying party that trusts the same identity provider.", origin: FINANCE },
  idp: { id: "idp", label: "Identity provider", role: "Authorization server and OpenID Provider: authenticates users, issues codes and tokens.", origin: ISSUER },
  api: { id: "api", label: "Orders API", role: "Resource server: accepts access tokens issued for it.", origin: API },
  service: { id: "service", label: "Billing service", role: "A backend service calling an API as itself, with no user.", origin: "https://billing.example" },
  device: { id: "device", label: "TV app", role: "A device with no browser or keyboard to speak of.", origin: undefined },
  phone: { id: "phone", label: "Phone browser", role: "A second device the user signs in with.", origin: undefined },
  authenticator: { id: "authenticator", label: "Authenticator", role: "Holds passkey private keys and verifies the user (PIN, biometric). Built into the device or a security key." },
  attacker: { id: "attacker", label: "Attacker", role: "Synthetic adversary: holds a stolen value or runs a look-alike site." },
};

export const pick = (...ids: ActorId[]) => ids.map((id) => actors[id]);
export const at = (seconds: number) => T0 + seconds;
export const iso = (seconds: number) => new Date((T0 + seconds) * 1000).toISOString().replace(".000", "");

/** A modelled JWT: header, claims and the key that signed it. The value shown is a placeholder, never a real token. */
export function jwt(kind: Token["kind"], label: string, claims: Record<string, unknown>, signedBy = IDP_KEY, alg = "RS256"): Token {
  return { kind, label, format: "jwt", header: { alg, typ: kind === "access_token" ? "at+jwt" : "JWT", kid: signedBy }, claims, signedBy, value: `<${label}: header.payload.signature, signed with ${signedBy}>` };
}
export const opaque = (kind: Token["kind"], label: string, value: string): Token => ({ kind, label, format: "opaque", value });

export const query = (params: [string, string][]) => params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

/** Cookie attributes the scenarios use for an application session (OWASP Session Management). */
export const SESSION_COOKIE = "Path=/; Secure; HttpOnly; SameSite=Lax";
