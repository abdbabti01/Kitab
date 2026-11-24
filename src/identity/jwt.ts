// Real JSON Web Token signing and verification with the Web Crypto API (browsers and Node share it): ES256
// (ECDSA P-256, RFC 7518 §3.4) and RS256 (RSASSA-PKCS1-v1_5, §3.3). Used by the Token Inspector and its tests.
// Keys are generated in the page for the session and never stored or sent anywhere. Decoding is never treated as
// verifying: claims are judged only after the signature has verified with a key the verifier already trusts.
import { base64url, fromBase64url, utf8 } from "./sha256.ts";

export const MAX_TOKEN = 16_384;
export const ALLOWED_ALGS = ["ES256", "RS256"] as const;
export type Alg = (typeof ALLOWED_ALGS)[number];
export type Jwk = JsonWebKey & { kid: string; alg: Alg; use: "sig" };

export type Decoded = { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Uint8Array<ArrayBuffer>; parts: [string, string, string] };

const json = (segment: string): Record<string, unknown> | null => {
  const bytes = fromBase64url(segment);
  if (!bytes) return null;
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

/** Splits and base64url-decodes a compact JWS. This proves nothing about who made it. */
export function decode(token: string): Decoded | { error: string } {
  const trimmed = token.trim();
  if (trimmed.length > MAX_TOKEN) return { error: `Longer than ${MAX_TOKEN} characters.` };
  const parts = trimmed.split(".");
  if (parts.length === 5) return { error: "Five parts: this is an encrypted JWE, which needs the recipient's private key to read." };
  if (parts.length !== 3) return { error: `A signed JWT has three dot-separated parts; this has ${parts.length}.` };
  const header = json(parts[0]);
  const payload = json(parts[1]);
  const signature = fromBase64url(parts[2]);
  if (!header) return { error: "The header isn't base64url-encoded JSON." };
  if (!payload) return { error: "The payload isn't base64url-encoded JSON." };
  if (!signature) return { error: "The signature isn't base64url." };
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature, parts: parts as [string, string, string] };
}

const params = (alg: Alg) => (alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" });
const signParams = (alg: Alg) => (alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" });

export type KeyPair = { kid: string; alg: Alg; privateKey: CryptoKey; publicJwk: Jwk };

export async function generateKey(kid: string, alg: Alg = "ES256"): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey(
    alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const { key_ops: _ops, ext: _ext, ...rest } = exported;
  return { kid, alg, privateKey: pair.privateKey, publicJwk: { ...rest, kid, alg, use: "sig" } };
}

/** Signs header.payload. The header is written as given, so samples can carry deliberately wrong values. */
export async function sign(header: Record<string, unknown>, payload: Record<string, unknown>, key: KeyPair): Promise<string> {
  const input = `${base64url(utf8(JSON.stringify(header)))}.${base64url(utf8(JSON.stringify(payload)))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(signParams(key.alg), key.privateKey, utf8(input)));
  return `${input}.${base64url(signature)}`;
}

/** Re-encodes edited header or payload JSON with the ORIGINAL signature, as a tamperer would. */
export function tamper(token: string, header: Record<string, unknown>, payload: Record<string, unknown>) {
  const signature = token.split(".")[2] ?? "";
  return `${base64url(utf8(JSON.stringify(header)))}.${base64url(utf8(JSON.stringify(payload)))}.${signature}`;
}

export async function verifySignature(decoded: Decoded, jwk: Jwk): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, params(jwk.alg), false, ["verify"]);
    return await crypto.subtle.verify(signParams(jwk.alg), key, decoded.signature, utf8(decoded.signingInput));
  } catch {
    return false;
  }
}

export type Expect = { issuer: string; audience: string; now: number; skew: number; jwks: Jwk[]; required?: string[] };
export type Step = { id: string; label: string; status: "pass" | "fail" | "skipped"; detail: string; rule: string };
export type Validation = { valid: boolean; steps: Step[]; decoded: Decoded | null };

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/**
 * Validates a JWT the way a careful resource server does, in order: parse, algorithm allowlist, key by kid from the
 * trusted set, signature, then claims (iss, aud, exp, nbf, required). After a failure the remaining steps are
 * skipped: claims of a token whose signature didn't verify are not evidence of anything.
 */
export async function validate(token: string, expect: Expect): Promise<Validation> {
  const steps: Step[] = [];
  let failed = false;
  const add = (id: string, label: string, ok: boolean, detail: string, rule: string) => {
    steps.push({ id, label, status: failed ? "skipped" : ok ? "pass" : "fail", detail: failed ? "Not checked: an earlier step failed." : detail, rule });
    if (!ok) failed = true;
  };
  const decoded = decode(token);
  if ("error" in decoded) {
    add("parse", "Parse three base64url JSON parts", false, decoded.error, "RFC 7515 §7.1");
    return { valid: false, steps, decoded: null };
  }
  add("parse", "Parse three base64url JSON parts", true, "Header and payload decoded. Anyone can do this: it proves nothing yet.", "RFC 7515 §7.1");
  const alg = decoded.header.alg;
  const allowed = (ALLOWED_ALGS as readonly unknown[]).includes(alg);
  add("alg", "alg is on this API's allowlist (ES256, RS256)", allowed, allowed ? `alg = ${String(alg)}.` : alg === "none" ? "alg = none: an unsigned token. Never accept it." : String(alg).startsWith("HS") ? `alg = ${String(alg)}: a shared-secret algorithm. Accepting it would let an attacker 'sign' with the public key as the HMAC secret (algorithm confusion).` : `alg = ${show(alg)} is not allowed.`, "RFC 8725 §3.1");
  const kid = decoded.header.kid;
  const jwk = expect.jwks.find((k) => k.kid === kid);
  add("kid", "kid names a key in the issuer's published JWKS", !!jwk, jwk ? `kid ${String(kid)} found.` : kid === undefined ? "No kid in the header." : `kid ${show(kid)} isn't in the JWKS. Refetch the JWKS once (rate-limited) in case of rotation; never fetch a key from a URL inside the token.`, "RFC 7515 §4.1.4");
  add("key-alg", "The key's algorithm matches the header", !!jwk && jwk.alg === alg, jwk ? `Key alg ${jwk.alg}, header alg ${show(alg)}.` : "", "RFC 8725 §3.1");
  const ok = failed ? false : await verifySignature(decoded, jwk!);
  add("signature", "Signature verifies with that public key (Web Crypto)", ok, ok ? `crypto.subtle.verify(${jwk!.alg === "ES256" ? "ECDSA P-256, SHA-256" : "RSASSA-PKCS1-v1_5, SHA-256"}) returned true.` : "crypto.subtle.verify returned false: the header or payload was changed after signing, or another key signed it.", "RFC 7515 §5.2");
  const p = decoded.payload;
  add("iss", "iss equals the trusted issuer exactly", p.iss === expect.issuer, `iss = ${show(p.iss)}; expected ${expect.issuer}.`, "RFC 7519 §4.1.1");
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  add("aud", "aud contains this API (exact match)", aud.includes(expect.audience), `aud = ${show(p.aud)}; this API is ${expect.audience}.`, "RFC 7519 §4.1.3");
  const exp = typeof p.exp === "number" ? p.exp : null;
  add("exp", `Not expired (now < exp + ${expect.skew} s skew)`, exp !== null && expect.now < exp + expect.skew, exp === null ? "No exp claim." : `exp ${new Date(exp * 1000).toISOString()}, now ${new Date(expect.now * 1000).toISOString()}.`, "RFC 7519 §4.1.4");
  const nbf = typeof p.nbf === "number" ? p.nbf : null;
  add("nbf", `Already valid (now ≥ nbf − ${expect.skew} s skew)`, nbf === null || expect.now >= nbf - expect.skew, nbf === null ? "No nbf: valid from issue." : `nbf ${new Date(nbf * 1000).toISOString()}.`, "RFC 7519 §4.1.5");
  const missing = (expect.required ?? []).filter((claim) => p[claim] === undefined);
  add("required", "Required claims are present", missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}.` : `${(expect.required ?? []).join(", ")} present.`, "RFC 9068 §2.2");
  return { valid: !failed, steps, decoded };
}

export const ISSUER = "https://idp.kitab.example";
export const AUDIENCE = "https://api.kitab.example";

export type Sample = { id: string; label: string; token: string; teaches: string };

/** Synthetic tokens for the inspector, freshly signed with keys generated for this page. */
export async function samples(now: number, keys: { current: KeyPair; next: KeyPair; attacker: KeyPair; rsa?: KeyPair }): Promise<Sample[]> {
  const base = { iss: ISSUER, sub: "user-248289761001", aud: AUDIENCE, scope: "orders.read", tenant: "acme", iat: now - 60, exp: now + 240, jti: "synthetic-1", synthetic: true };
  const h = (key: KeyPair, extra: Record<string, unknown> = {}) => ({ alg: key.alg, typ: "at+jwt", kid: key.kid, ...extra });
  const valid = await sign(h(keys.current), base, keys.current);
  const decodedValid = decode(valid) as Decoded;
  const list: Sample[] = [
    { id: "valid", label: "Valid access token", token: valid, teaches: "Every step passes." },
    { id: "tampered", label: "Payload edited after signing", token: tamper(valid, decodedValid.header, { ...base, scope: "orders.read orders.delete" }), teaches: "Changing one claim breaks the signature." },
    { id: "attacker-key", label: "Signed by another key with a trusted kid", token: await sign(h(keys.attacker, { kid: keys.current.kid }), base, keys.attacker), teaches: "The kid only names a key; the signature must verify with it." },
    { id: "unknown-kid", label: "Unknown kid", token: await sign(h(keys.attacker), base, keys.attacker), teaches: "A key the issuer never published." },
    { id: "rotated", label: "Signed with the next key (after rotation)", token: await sign(h(keys.next), base, keys.next), teaches: "Valid once the JWKS includes the new key." },
    { id: "wrong-iss", label: "Wrong issuer", token: await sign(h(keys.current), { ...base, iss: "https://idp.kitab.example.attacker.example" }, keys.current), teaches: "Exact match, not prefix." },
    { id: "wrong-aud", label: "Issued for another API", token: await sign(h(keys.current), { ...base, aud: "https://hr.kitab.example" }, keys.current), teaches: "Same issuer, wrong audience." },
    { id: "expired", label: "Expired", token: await sign(h(keys.current), { ...base, iat: now - 900, exp: now - 300 }, keys.current), teaches: "Signature fine, too late." },
    { id: "nbf", label: "Not valid yet", token: await sign(h(keys.current), { ...base, nbf: now + 600 }, keys.current), teaches: "nbf in the future, beyond the skew." },
    { id: "missing", label: "Missing sub", token: await sign(h(keys.current), (({ sub: _sub, ...rest }) => rest)(base), keys.current), teaches: "A required claim is absent." },
    { id: "alg-none", label: "alg: none", token: `${base64url(utf8(JSON.stringify({ alg: "none", typ: "JWT" })))}.${decodedValid.parts[1]}.`, teaches: "An unsigned token must never be accepted." },
    { id: "alg-hs256", label: "alg: HS256 (algorithm confusion)", token: `${base64url(utf8(JSON.stringify({ alg: "HS256", typ: "JWT", kid: keys.current.kid })))}.${decodedValid.parts[1]}.${base64url(new Uint8Array(32))}`, teaches: "Only the algorithms this API expects." },
    { id: "html", label: "Claims containing markup", token: await sign(h(keys.current), { ...base, name: '<img src=x onerror="alert(1)">' }, keys.current), teaches: "Claim values are data, shown as text, never as HTML." },
  ];
  if (keys.rsa) list.splice(1, 0, { id: "rs256", label: "Valid RS256 token", token: await sign(h(keys.rsa), base, keys.rsa), teaches: "RSA signatures verify the same way." });
  return list;
}
