# Identity track: standards reference

Primary sources the track follows, with their status as checked on 2026-11-23. Content cites section numbers where a
rule is applied; checks in the Playground carry a `rule` field naming the clause.

| Standard | Status (checked 2026-11-23) | Used for |
|---|---|---|
| RFC 6749 OAuth 2.0 Authorization Framework | Proposed Standard (2012), updated by RFC 9700 | Roles, endpoints, grants, error codes |
| RFC 6750 Bearer Token Usage | Proposed Standard, updated by RFC 9700 | `Authorization: Bearer`, `WWW-Authenticate`, invalid_token / insufficient_scope |
| RFC 9700 Best Current Practice for OAuth 2.0 Security | BCP 240, January 2025 | Exact redirect URI matching (§2.1), PKCE required for public clients and recommended for confidential ones, S256 only (§2.1.1), implicit grant SHOULD NOT (§2.1.2), refresh token rotation or sender-constraining for public clients (§2.2.2), audience restriction (§2.3), ROPC MUST NOT (§2.4), mix-up and open redirector defences |
| RFC 10017 OAuth 2.0 for Browser-Based Applications | Best Current Practice, August 2026 (header lists BCP 212, which conflicts with RFC 8252's BCP number; treat the BCP number as unverified) | BFF, token-mediating backend and browser-based client in decreasing order of security; token storage trade-offs (§8); discouraged patterns (§7) |
| RFC 7636 PKCE | Proposed Standard | Verifier, S256 challenge (§4.2), server check (§4.6); Appendix B vector is tested |
| RFC 9207 Authorization Server Issuer Identification | Proposed Standard | `iss` in the authorization response (mix-up defence) |
| RFC 8628 Device Authorization Grant | Proposed Standard | Device codes, polling errors (§3.5), remote phishing (§5.4) |
| RFC 7009 Token Revocation; RFC 7662 Token Introspection | Proposed Standards | Revocation, `active` responses, protected introspection |
| RFC 8707 Resource Indicators; RFC 9068 JWT Access Tokens | Proposed Standards | `resource`, `aud`, `typ: at+jwt` |
| RFC 7523 JWT client authentication; RFC 8705 mutual TLS | Proposed Standards | `private_key_jwt`, `tls_client_auth` |
| RFC 9449 DPoP | Proposed Standard | Sender-constrained tokens (taught, not simulated) |
| RFC 7515–7519 JOSE (JWS, JWE, JWK, JWA, JWT); RFC 8725 JWT BCP | Proposed Standards; BCP 225 | Structure, `kid`, algorithm allowlists, validation |
| RFC 8252 OAuth for Native Apps | BCP 212 | Loopback redirect URIs (§7.3), system browser |
| RFC 8693 Token Exchange | Proposed Standard | Confused-deputy mitigation (taught) |
| OAuth 2.1 | Internet-Draft `draft-ietf-oauth-v2-1-17` (31 October 2026), not an RFC | Mentioned as the consolidation in progress; never cited as a standard |
| OpenID Connect Core 1.0 incorporating errata set 2 | Final, 15 December 2023 | ID token, validation steps §3.1.3.7 (issuer, audience, azp, signature, alg, exp, iat, nonce, acr, auth_time), prompt / max_age / acr_values, UserInfo §5.3 |
| OpenID Connect Discovery 1.0 | Final | Discovery document, `jwks_uri` |
| OIDC RP-Initiated Logout 1.0; Back-Channel Logout 1.0; Front-Channel Logout 1.0 | Final | Logout scenarios and their limits |
| SAML 2.0 Core, Bindings, Profiles (OASIS, 2005, with errata) | OASIS Standard | AuthnRequest, HTTP-Redirect and HTTP-POST bindings, assertion processing rules (Profiles §4.1.4), replay |
| XML Signature Syntax and Processing 1.1 (W3C) | Recommendation | Signature references (wrapping defence) |
| RFC 7643, RFC 7644 SCIM 2.0 | Proposed Standards | Provisioning and deprovisioning |
| W3C Web Authentication Level 3 | Recommendation, 25 August 2026 | Ceremonies §7.1, §7.2; rpId and origin checks; flags |
| NIST SP 800-63B | Current revision | Factors, phishing resistance, password guidance |
| OWASP Cheat Sheets (Password Storage, Session Management, CSRF, Authorization, SAML, MFA); API Security Top 10 2023 | Current | Argon2id parameters, cookie attributes, BOLA, tenant isolation |

Vendor documentation (Microsoft Entra ID, Auth0, Okta, Keycloak) is used only for concepts and terminology; the course
deliberately gives no portal click-paths, which change.

Framework versions in the code examples: .NET 10 SDK 10.0.401 with Microsoft.AspNetCore.Authentication.JwtBearer and
OpenIdConnect 10.0.15; Spring Boot 4.2.0 (Spring Security) on JDK 17 with Maven 3.8.1; Python 3.13 with FastAPI 0.165.0,
PyJWT 2.15.1 and Authlib 1.9.10.
