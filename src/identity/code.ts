// C#, Java and Python examples for the Identity track, using each platform's maintained libraries (ASP.NET Core
// authentication, Spring Security, FastAPI with PyJWT and Authlib). scripts/verify-identity-examples.ts builds every
// example and runs the ones marked "run", comparing their output with `output`. Examples marked "build" need a real
// identity provider to run, so they are only compiled (Python: compiled and imported); the page says which.
//
// Every key in these examples is generated at startup and every token is minted by a stand-in for the identity
// provider inside the same program, clearly labelled. That is a demonstration technique, never production setup.
import type { Lang } from "../structures/guide/content.ts";

export type IdentityExample = {
  id: string;
  topic: "pkce" | "protected-api" | "oidc-login" | "client-credentials" | "session-cookie";
  lang: Lang;
  title: string;
  framework: string;
  /** Where the code lives in a real project. */
  file: string;
  source: string;
  /** Other files the project needs (configuration), shown and written by the verifier. */
  extra?: { file: string; source: string }[];
  /** Packages with versions (NuGet, Maven, PyPI). */
  deps: string[];
  verify: "run" | "build";
  output?: string;
  notes: { code: string; explain: string }[];
  failure: string;
  production: string[];
};

const code = (s: TemplateStringsArray) => String.raw(s).replace(/^\n/, "").replace(/\s+$/, "");

const apiOutput = "no token: 401\nalice reads her order 123: 200\nalice reads frank's order 124: 403\ntoken for another API: 401\nexpired token: 401\ntoken without orders.read: 403\nglobex user reads acme order 123: 404";

export const identityExamples: IdentityExample[] = [
  // ---------------- PKCE ----------------
  {
    id: "pkce-cs", topic: "pkce", lang: "csharp", title: "Generate and check a PKCE pair", framework: ".NET base library", file: "Pkce.cs (in your OAuth client, or let the OIDC handler do it: UsePkce = true)", deps: [], verify: "run",
    source: code`
using System.Security.Cryptography;
using System.Text;

static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
static string Challenge(string verifier) => Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

// RFC 7636 Appendix B: a known verifier and its challenge.
Console.WriteLine($"RFC 7636 example challenge: {Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")}");

// A new pair: 32 random bytes from the OS's cryptographic generator.
var verifier = Base64Url(RandomNumberGenerator.GetBytes(32));
var challenge = Challenge(verifier);
Console.WriteLine($"new verifier length: {verifier.Length}");
Console.WriteLine($"challenge length: {challenge.Length}");
// What the authorization server does at the token endpoint (RFC 7636 §4.6).
Console.WriteLine($"verifier matches its challenge: {CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Challenge(verifier)), Encoding.ASCII.GetBytes(challenge))}");`,
    output: "RFC 7636 example challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM\nnew verifier length: 43\nchallenge length: 43\nverifier matches its challenge: True",
    notes: [
      { code: "RandomNumberGenerator.GetBytes(32)", explain: "Cryptographically secure randomness: 256 bits, encoded as 43 base64url characters (RFC 7636 allows 43–128)." },
      { code: "SHA256.HashData(...)", explain: "S256: the challenge is the base64url SHA-256 of the verifier's ASCII bytes. The hash can't be reversed, so the challenge can travel through the browser." },
      { code: "FixedTimeEquals", explain: "Comparing secrets in constant time avoids leaking how many characters matched." },
    ],
    failure: "Using System.Random, or Guid.NewGuid(), for the verifier: predictable values let an attacker who intercepts the code guess the verifier.",
    production: ["ASP.NET Core's OpenID Connect handler generates and checks PKCE for you (UsePkce defaults to true).", "Store the verifier server-side or in the protected correlation cookie, never in the URL."],
  },
  {
    id: "pkce-java", topic: "pkce", lang: "java", title: "Generate and check a PKCE pair", framework: "JDK (java.security)", file: "Pkce.java (or let Spring Security do it for public clients)", deps: [], verify: "run",
    source: code`
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

public class Pkce {
    static final Base64.Encoder URL = Base64.getUrlEncoder().withoutPadding();

    static String challenge(String verifier) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return URL.encodeToString(hash);
    }

    public static void main(String[] args) throws Exception {
        // RFC 7636 Appendix B: a known verifier and its challenge.
        System.out.println("RFC 7636 example challenge: " + challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));

        byte[] random = new byte[32];
        new SecureRandom().nextBytes(random);
        String verifier = URL.encodeToString(random);
        String challenge = challenge(verifier);
        System.out.println("new verifier length: " + verifier.length());
        System.out.println("challenge length: " + challenge.length());
        // What the authorization server does at the token endpoint (RFC 7636 §4.6).
        System.out.println("verifier matches its challenge: " + MessageDigest.isEqual(challenge(verifier).getBytes(StandardCharsets.US_ASCII), challenge.getBytes(StandardCharsets.US_ASCII)));
    }
}`,
    output: "RFC 7636 example challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM\nnew verifier length: 43\nchallenge length: 43\nverifier matches its challenge: true",
    notes: [
      { code: "new SecureRandom()", explain: "The JDK's cryptographically strong generator; never java.util.Random for secrets." },
      { code: "Base64.getUrlEncoder().withoutPadding()", explain: "Base64url without '=' padding, as RFC 7636 requires." },
      { code: "MessageDigest.isEqual", explain: "A constant-time comparison." },
    ],
    failure: "Encoding with the standard Base64 alphabet (+ and /) produces a challenge the server computes differently, and every exchange fails with invalid_grant.",
    production: ["Spring Security's OAuth2 client applies PKCE automatically for public clients (no client secret), and can be configured to for confidential ones.", "Keep the verifier in the server-side session until the code exchange."],
  },
  {
    id: "pkce-py", topic: "pkce", lang: "python", title: "Generate and check a PKCE pair", framework: "Python standard library", file: "pkce.py (or let Authlib do it: code_challenge_method='S256')", deps: [], verify: "run",
    source: code`
import base64
import hashlib
import hmac
import secrets


def challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


# RFC 7636 Appendix B: a known verifier and its challenge.
print("RFC 7636 example challenge:", challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))

verifier = secrets.token_urlsafe(32)  # 32 random bytes, base64url without padding
new_challenge = challenge(verifier)
print("new verifier length:", len(verifier))
print("challenge length:", len(new_challenge))
# What the authorization server does at the token endpoint (RFC 7636 §4.6).
print("verifier matches its challenge:", hmac.compare_digest(challenge(verifier), new_challenge))`,
    output: "RFC 7636 example challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM\nnew verifier length: 43\nchallenge length: 43\nverifier matches its challenge: True",
    notes: [
      { code: "secrets.token_urlsafe(32)", explain: "The secrets module is Python's cryptographically secure source; 32 bytes give a 43-character verifier." },
      { code: "rstrip(b\"=\")", explain: "Base64url without padding." },
      { code: "hmac.compare_digest", explain: "Constant-time comparison of secrets." },
    ],
    failure: "Using the random module, which is predictable, for verifiers or state values.",
    production: ["Authlib generates the verifier and challenge when code_challenge_method='S256' is set, and keeps the verifier in the session.", "Never log verifiers, codes or tokens."],
  },

  // ---------------- Protected API ----------------
  {
    id: "api-cs", topic: "protected-api", lang: "csharp", title: "A protected API: JWT bearer, scope policy, object and tenant checks", framework: "ASP.NET Core 10 minimal API", file: "Program.cs of an ASP.NET Core Web API project",
    deps: ["Microsoft.AspNetCore.Authentication.JwtBearer 10.0.15"], verify: "run",
    source: code`
#:sdk Microsoft.NET.Sdk.Web
#:package Microsoft.AspNetCore.Authentication.JwtBearer@10.0.15
#:property PublishAot=false

using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

const string Issuer = "https://idp.example", Audience = "https://api.example";
// DEMO ONLY: a key generated at startup stands in for the identity provider's signing key. In production, set
// options.Authority to the provider's issuer and the handler downloads its keys (JWKS) and rotates with them.
var signingKey = new RsaSecurityKey(RSA.Create(2048)) { KeyId = "demo-key" };

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Services.AddAuthentication().AddJwtBearer(options =>
{
    options.MapInboundClaims = false; // keep "sub", "scope", "tenant" as issued
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = Issuer,
        ValidAudience = Audience,
        IssuerSigningKey = signingKey,
        ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
        ClockSkew = TimeSpan.FromSeconds(30),
    };
});
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("orders.read", policy => policy.RequireAuthenticatedUser()
        .RequireAssertion(ctx => (ctx.User.FindFirstValue("scope") ?? "").Split(' ').Contains("orders.read")))
    .SetFallbackPolicy(new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

var orders = new Dictionary<int, (string Owner, string Tenant, int Total)>
{
    [123] = ("alice", "acme", 120), [124] = ("frank", "acme", 900), [900] = ("gina", "globex", 50),
};

var app = builder.Build();
app.MapGet("/api/orders/{id:int}", (int id, ClaimsPrincipal user) =>
{
    // Tenant first: another organisation's order is "not found", so its existence doesn't leak.
    if (!orders.TryGetValue(id, out var order) || order.Tenant != user.FindFirstValue("tenant")) return Results.NotFound();
    // Object-level authorization: the caller owns it, or has a role that may see others' orders.
    if (order.Owner != user.FindFirstValue("sub") && user.FindFirstValue("role") != "support") return Results.Forbid();
    return Results.Ok(new { id, total = order.Total });
}).RequireAuthorization("orders.read");

await app.StartAsync();
var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
using var http = new HttpClient { BaseAddress = new Uri(address) };

await Show("no token", 123, null);
await Show("alice reads her order 123", 123, Token("alice", "acme"));
await Show("alice reads frank's order 124", 124, Token("alice", "acme"));
await Show("token for another API", 123, Token("alice", "acme", audience: "https://hr.example"));
await Show("expired token", 123, Token("alice", "acme", lifetime: -300));
await Show("token without orders.read", 123, Token("alice", "acme", scope: "profile"));
await Show("globex user reads acme order 123", 123, Token("dave", "globex"));
await app.StopAsync();

async Task Show(string label, int id, string? token)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/orders/{id}");
    if (token is not null) request.Headers.Authorization = new("Bearer", token);
    using var response = await http.SendAsync(request);
    Console.WriteLine($"{label}: {(int)response.StatusCode}");
}

// DEMO ONLY: the stand-in identity provider. Real tokens come from the provider's token endpoint.
string Token(string sub, string tenant, string scope = "orders.read", string audience = Audience, int lifetime = 300)
{
    var now = DateTime.UtcNow;
    return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
    {
        Issuer = Issuer, Audience = audience,
        IssuedAt = now.AddSeconds(Math.Min(0, lifetime) - 10), NotBefore = now.AddSeconds(Math.Min(0, lifetime) - 10), Expires = now.AddSeconds(lifetime),
        Claims = new Dictionary<string, object> { ["sub"] = sub, ["tenant"] = tenant, ["scope"] = scope },
        SigningCredentials = new SigningCredentials(signingKey, SecurityAlgorithms.RsaSha256),
    });
}`,
    output: apiOutput,
    notes: [
      { code: "AddJwtBearer(...)", explain: "The authentication handler: reads Authorization: Bearer, validates signature, issuer, audience, lifetime and algorithm, and builds the ClaimsPrincipal. Any failure leaves the request unauthenticated." },
      { code: "#:property PublishAot=false", explain: "Only for this single-file demo: .NET 10 file-based apps default to native-AOT settings, which turn off reflection-based JSON. A normal Web API project (.csproj) doesn't need it." },
      { code: "ValidAudience = Audience", explain: "A token for another API (hr.example) is rejected with 401, even though the same issuer signed it." },
      { code: "ClockSkew = TimeSpan.FromSeconds(30)", explain: "The default is 5 minutes; keep it small." },
      { code: "AddPolicy(\"orders.read\", ...)", explain: "Authorization runs after authentication: authenticated but without the scope gives 403 Forbidden; unauthenticated gives 401 with WWW-Authenticate: Bearer." },
      { code: "SetFallbackPolicy(...)", explain: "Deny by default: any endpoint without its own policy still requires an authenticated user." },
      { code: "order.Tenant != ...", explain: "Tenant isolation and object-level checks belong in the handler or data access: no token claim can express 'this order'." },
    ],
    failure: "Remove ValidAudience and the 'token for another API' line prints 200: any token from the same issuer would work here.",
    production: ["Set options.Authority (and Audience) instead of a key: the handler fetches discovery and JWKS and handles key rotation.", "Keep authorization rules in policies or a service, and test them with two users and two tenants.", "Never log the Authorization header."],
  },
  {
    id: "api-java", topic: "protected-api", lang: "java", title: "A protected API: resource server, scope authority, object and tenant checks", framework: "Spring Boot 4.2, Spring Security", file: "src/main/java/example/OrdersApi.java",
    deps: ["org.springframework.boot:spring-boot-starter-web 4.2.0", "org.springframework.boot:spring-boot-starter-oauth2-resource-server 4.2.0"], verify: "run",
    source: code`
package example;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.Date;
import java.util.Map;
import org.springframework.boot.Banner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.http.ResponseEntity;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class OrdersApi {
    static final String ISSUER = "https://idp.example", AUDIENCE = "https://api.example";
    // DEMO ONLY: a key generated at startup stands in for the identity provider's key. In production, set
    // spring.security.oauth2.resourceserver.jwt.issuer-uri and Spring fetches the provider's JWKS.
    static final RSAKey KEY = generate();

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/orders/**").hasAuthority("SCOPE_orders.read")
                .anyRequest().denyAll()) // deny by default
            .oauth2ResourceServer(rs -> rs.jwt(Customizer.withDefaults()))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .csrf(csrf -> csrf.disable()); // bearer tokens only, no cookies: nothing for CSRF to ride on
        return http.build();
    }

    @Bean
    JwtDecoder jwtDecoder() throws Exception {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(KEY.toRSAPublicKey()).build();
        OAuth2TokenValidator<Jwt> audience = jwt -> jwt.getAudience().contains(AUDIENCE)
            ? OAuth2TokenValidatorResult.success()
            : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "The token is not for this API", null));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(ISSUER), audience));
        return decoder;
    }

    record Order(String owner, String tenant, int total) {}

    @RestController
    static class Orders {
        static final Map<Integer, Order> ORDERS = Map.of(
            123, new Order("alice", "acme", 120), 124, new Order("frank", "acme", 900), 900, new Order("gina", "globex", 50));

        @GetMapping("/api/orders/{id}")
        ResponseEntity<?> get(@PathVariable("id") int id, @AuthenticationPrincipal Jwt jwt) {
            Order order = ORDERS.get(id);
            // Tenant first: another organisation's order is "not found", so its existence doesn't leak.
            if (order == null || !order.tenant().equals(jwt.getClaimAsString("tenant"))) return ResponseEntity.notFound().build();
            // Object-level authorization.
            if (!order.owner().equals(jwt.getSubject()) && !"support".equals(jwt.getClaimAsString("role"))) return ResponseEntity.status(403).build();
            return ResponseEntity.ok(Map.of("id", id, "total", order.total()));
        }
    }

    public static void main(String[] args) throws Exception {
        SpringApplication application = new SpringApplication(OrdersApi.class);
        application.setBannerMode(Banner.Mode.OFF);
        application.setLogStartupInfo(false);
        var context = application.run("--server.port=0", "--logging.level.root=OFF");
        int port = Integer.parseInt(context.getEnvironment().getProperty("local.server.port"));
        HttpClient http = HttpClient.newHttpClient();
        show(http, port, "no token", 123, null);
        show(http, port, "alice reads her order 123", 123, token("alice", "acme", "orders.read", AUDIENCE, 300));
        show(http, port, "alice reads frank's order 124", 124, token("alice", "acme", "orders.read", AUDIENCE, 300));
        show(http, port, "token for another API", 123, token("alice", "acme", "orders.read", "https://hr.example", 300));
        show(http, port, "expired token", 123, token("alice", "acme", "orders.read", AUDIENCE, -300));
        show(http, port, "token without orders.read", 123, token("alice", "acme", "profile", AUDIENCE, 300));
        show(http, port, "globex user reads acme order 123", 123, token("dave", "globex", "orders.read", AUDIENCE, 300));
        context.close();
    }

    static void show(HttpClient http, int port, String label, int id, String token) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/orders/" + id));
        if (token != null) request.header("Authorization", "Bearer " + token);
        System.out.println(label + ": " + http.send(request.build(), HttpResponse.BodyHandlers.discarding()).statusCode());
    }

    // DEMO ONLY: the stand-in identity provider. Real tokens come from the provider's token endpoint.
    static String token(String sub, String tenant, String scope, String audience, long lifetime) throws Exception {
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder().issuer(ISSUER).subject(sub).audience(audience)
            .claim("tenant", tenant).claim("scope", scope)
            .issueTime(Date.from(now.plusSeconds(Math.min(0, lifetime) - 10))).expirationTime(Date.from(now.plusSeconds(lifetime))).build();
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(KEY.getKeyID()).build(), claims);
        jwt.sign(new RSASSASigner(KEY));
        return jwt.serialize();
    }

    static RSAKey generate() {
        try {
            return new RSAKeyGenerator(2048).keyID("demo-key").generate();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}`,
    output: apiOutput,
    notes: [
      { code: "SecurityFilterChain", explain: "Spring Security's filter chain runs before any controller: the bearer token filter authenticates, then authorizeHttpRequests authorizes. A missing or bad token gets 401 from BearerTokenAuthenticationEntryPoint; a missing authority gets 403." },
      { code: "hasAuthority(\"SCOPE_orders.read\")", explain: "The resource server turns the scope claim into SCOPE_ authorities (granted authorities)." },
      { code: "JwtValidators.createDefaultWithIssuer(ISSUER)", explain: "Checks exp and nbf (60 s default skew) and the exact issuer. Audience isn't checked by default: the custom validator adds it." },
      { code: ".anyRequest().denyAll()", explain: "Deny by default for anything not listed." },
      { code: "SessionCreationPolicy.STATELESS", explain: "An API authenticated per request by bearer tokens keeps no HTTP session." },
    ],
    failure: "Drop the audience validator and 'token for another API' prints 200: tokens for any API from this issuer are accepted.",
    production: ["Configure spring.security.oauth2.resourceserver.jwt.issuer-uri (and audiences, in recent Spring Boot) instead of a key.", "Use @EnableMethodSecurity with @PreAuthorize for per-method rules; keep object-level checks next to the data access."],
  },
  {
    id: "api-py", topic: "protected-api", lang: "python", title: "A protected API: bearer validation, scope dependency, object and tenant checks", framework: "FastAPI with PyJWT", file: "app/main.py",
    deps: ["fastapi 0.165.0", "pyjwt[crypto] 2.15.1", "httpx (for TestClient)"], verify: "run",
    source: code`
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.testclient import TestClient

ISSUER, AUDIENCE = "https://idp.example", "https://api.example"
# DEMO ONLY: a key generated at startup stands in for the identity provider's key. In production use
# jwt.PyJWKClient(jwks_uri) to fetch the provider's keys by kid.
private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
public_key = private_key.public_key()

ORDERS = {123: {"owner": "alice", "tenant": "acme", "total": 120}, 124: {"owner": "frank", "tenant": "acme", "total": 900}, 900: {"owner": "gina", "tenant": "globex", "total": 50}}

bearer = HTTPBearer(auto_error=False)


def current_claims(credentials: HTTPAuthorizationCredentials | None = Security(bearer)) -> dict:
    if credentials is None:
        raise HTTPException(401, headers={"WWW-Authenticate": "Bearer"})
    try:
        return jwt.decode(credentials.credentials, public_key, algorithms=["RS256"], audience=AUDIENCE, issuer=ISSUER, leeway=30,
                          options={"require": ["exp", "iss", "aud", "sub"]})
    except jwt.InvalidTokenError:
        raise HTTPException(401, headers={"WWW-Authenticate": 'Bearer error="invalid_token"'})


def require_scope(scope: str):
    def check(claims: dict = Depends(current_claims)) -> dict:
        if scope not in claims.get("scope", "").split():
            raise HTTPException(403, headers={"WWW-Authenticate": f'Bearer error="insufficient_scope", scope="{scope}"'})
        return claims
    return check


app = FastAPI()


@app.get("/api/orders/{order_id}")
def get_order(order_id: int, claims: dict = Depends(require_scope("orders.read"))):
    order = ORDERS.get(order_id)
    # Tenant first: another organisation's order is "not found", so its existence doesn't leak.
    if order is None or order["tenant"] != claims.get("tenant"):
        raise HTTPException(404)
    # Object-level authorization.
    if order["owner"] != claims["sub"] and claims.get("role") != "support":
        raise HTTPException(403)
    return {"id": order_id, "total": order["total"]}


# DEMO ONLY: the stand-in identity provider. Real tokens come from the provider's token endpoint.
def token(sub, tenant, scope="orders.read", audience=AUDIENCE, lifetime=300):
    now = datetime.now(timezone.utc)
    start = now + timedelta(seconds=min(0, lifetime) - 10)
    claims = {"iss": ISSUER, "sub": sub, "aud": audience, "tenant": tenant, "scope": scope, "iat": start, "nbf": start, "exp": now + timedelta(seconds=lifetime)}
    return jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "demo-key"})


if __name__ == "__main__":
    client = TestClient(app)

    def show(label, order_id, bearer_token=None):
        headers = {"Authorization": f"Bearer {bearer_token}"} if bearer_token else {}
        print(f"{label}: {client.get(f'/api/orders/{order_id}', headers=headers).status_code}")

    show("no token", 123)
    show("alice reads her order 123", 123, token("alice", "acme"))
    show("alice reads frank's order 124", 124, token("alice", "acme"))
    show("token for another API", 123, token("alice", "acme", audience="https://hr.example"))
    show("expired token", 123, token("alice", "acme", lifetime=-300))
    show("token without orders.read", 123, token("alice", "acme", scope="profile"))
    show("globex user reads acme order 123", 123, token("dave", "globex"))`,
    output: apiOutput,
    notes: [
      { code: "HTTPBearer(auto_error=False)", explain: "Extracts the credential from the Authorization header; with auto_error off, the dependency decides the 401 and its WWW-Authenticate header." },
      { code: "jwt.decode(..., algorithms=[\"RS256\"], audience=..., issuer=...)", explain: "PyJWT verifies the signature with the given key, only for the listed algorithms, and checks exp, nbf, iss and aud. Passing algorithms explicitly prevents algorithm confusion." },
      { code: "Depends(require_scope(\"orders.read\"))", explain: "FastAPI dependencies run before the endpoint: identity context first, then the scope check (403 insufficient_scope)." },
      { code: "order[\"tenant\"] != claims.get(\"tenant\")", explain: "Tenant and object checks in the endpoint, deny by default." },
    ],
    failure: "Calling jwt.decode(token, options={\"verify_signature\": False}) would accept anyone's forged token. Never disable verification.",
    production: ["Use jwt.PyJWKClient with the provider's jwks_uri (it caches keys and selects them by kid).", "Return the same 404 for 'missing' and 'another tenant's'."],
  },

  // ---------------- OIDC login ----------------
  {
    id: "oidc-cs", topic: "oidc-login", lang: "csharp", title: "Sign in with OpenID Connect and a cookie session", framework: "ASP.NET Core 10", file: "Program.cs of an ASP.NET Core web app; settings in appsettings.json and user secrets / a vault",
    deps: ["Microsoft.AspNetCore.Authentication.OpenIdConnect 10.0.15"], verify: "build",
    source: code`
#:sdk Microsoft.NET.Sdk.Web
#:package Microsoft.AspNetCore.Authentication.OpenIdConnect@10.0.15

using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddAuthentication(options =>
    {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme; // the app's own session
        options.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme; // how to sign in
    })
    .AddCookie(options =>
    {
        options.Cookie.Name = "__Host-app";
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.ExpireTimeSpan = TimeSpan.FromHours(1);
        options.SlidingExpiration = false;
    })
    .AddOpenIdConnect(options =>
    {
        options.Authority = builder.Configuration["Oidc:Authority"];   // the issuer; discovery and JWKS come from it
        options.ClientId = builder.Configuration["Oidc:ClientId"];
        options.ClientSecret = builder.Configuration["Oidc:ClientSecret"]; // from user secrets or a vault, never source control
        options.ResponseType = OpenIdConnectResponseType.Code;            // Authorization Code flow
        options.UsePkce = true;                                           // the default; shown for clarity
        options.Scope.Clear();
        options.Scope.Add("openid");
        options.Scope.Add("profile");
        options.MapInboundClaims = false;
        options.TokenValidationParameters.NameClaimType = "name";
        options.SaveTokens = true; // tokens kept in the encrypted cookie ticket, server-side readable only
    });
builder.Services.AddAuthorization();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/", (ClaimsPrincipal user) => $"Signed in as {user.Identity?.Name}").RequireAuthorization();
app.MapPost("/logout", () => Results.SignOut(new AuthenticationProperties { RedirectUri = "/" },
    [CookieAuthenticationDefaults.AuthenticationScheme, OpenIdConnectDefaults.AuthenticationScheme]));
app.Run();`,
    notes: [
      { code: "DefaultChallengeScheme = OpenIdConnect", explain: "An unauthenticated request to a protected page is challenged: the handler builds the authorization request (state, nonce, PKCE) and redirects to the provider." },
      { code: "ResponseType = Code", explain: "Authorization Code flow. The handler also validates state (in a protected correlation cookie), exchanges the code with the verifier, and validates the ID token (signature from JWKS, iss, aud, exp, nonce)." },
      { code: "AddCookie(...)", explain: "After validation the handler signs in to the cookie scheme: the app's own session, separate from the provider's." },
      { code: "Results.SignOut(... both schemes)", explain: "Ends the cookie session and sends the user to the provider's end_session_endpoint (RP-initiated logout)." },
    ],
    failure: "Setting options.TokenValidationParameters.ValidateAudience = false to 'fix' an error lets ID tokens issued to other clients sign users in.",
    production: ["Store ClientSecret in user secrets (development) and a vault (production), or use a certificate or federated credential.", "For APIs, request an access token for the API's audience and call it from the server (backend-for-frontend)."],
  },
  {
    id: "oidc-java", topic: "oidc-login", lang: "java", title: "Sign in with OpenID Connect (oauth2Login)", framework: "Spring Boot 4.2, Spring Security OAuth2 Client", file: "src/main/java/example/WebSecurity.java + src/main/resources/application.yml",
    deps: ["org.springframework.boot:spring-boot-starter-web 4.2.0", "org.springframework.boot:spring-boot-starter-oauth2-client 4.2.0"], verify: "build",
    source: code`
package example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.oidc.web.logout.OidcClientInitiatedLogoutSuccessHandler;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class WebSecurity {
    @Bean
    SecurityFilterChain web(HttpSecurity http, ClientRegistrationRepository registrations) throws Exception {
        OidcClientInitiatedLogoutSuccessHandler logout = new OidcClientInitiatedLogoutSuccessHandler(registrations);
        logout.setPostLogoutRedirectUri("{baseUrl}/");
        http.authorizeHttpRequests(auth -> auth.requestMatchers("/", "/error").permitAll().anyRequest().authenticated())
            .oauth2Login(Customizer.withDefaults())               // Authorization Code flow, state, nonce, ID token validation
            .logout(l -> l.logoutSuccessHandler(logout))          // RP-initiated logout at the provider
            .sessionManagement(s -> s.sessionFixation(f -> f.changeSessionId())); // new session id at login
        return http.build();
    }

    @RestController
    static class Home {
        @GetMapping("/me")
        String me(@AuthenticationPrincipal OidcUser user) {
            return "Signed in as " + user.getSubject() + " (" + user.getIssuer() + ")";
        }
    }

    public static void main(String[] args) {
        SpringApplication.run(WebSecurity.class, args);
    }
}`,
    extra: [{ file: "src/main/resources/application.yml", source: code`
spring:
  security:
    oauth2:
      client:
        registration:
          idp:
            client-id: \${OIDC_CLIENT_ID}
            client-secret: \${OIDC_CLIENT_SECRET}   # from the environment or a vault
            authorization-grant-type: authorization_code
            scope: openid,profile
        provider:
          idp:
            issuer-uri: \${OIDC_ISSUER}            # discovery: endpoints and JWKS
server:
  servlet:
    session:
      cookie:
        secure: true
        http-only: true
        same-site: lax` }],
    notes: [
      { code: "oauth2Login(...)", explain: "Adds the filters that redirect to the provider, receive the callback, check state, exchange the code and validate the ID token (OidcIdTokenValidator: iss, aud, exp, iat, nonce)." },
      { code: "issuer-uri", explain: "Spring reads the provider's discovery document at startup and validates that its issuer matches." },
      { code: "sessionFixation(... changeSessionId())", explain: "The servlet session id changes at login (Spring's default, shown explicitly)." },
      { code: "OidcClientInitiatedLogoutSuccessHandler", explain: "After local logout, redirects to the provider's end_session_endpoint with id_token_hint." },
    ],
    failure: "Permitting every request (anyRequest().permitAll()) leaves pages reachable without signing in; Spring Security's authorizeHttpRequests is ordered, first match wins.",
    production: ["Spring applies PKCE automatically for public clients; for confidential clients it can be enabled with an authorization request resolver customizer.", "Keep client secrets out of source control (environment, vault)."],
  },
  {
    id: "oidc-py", topic: "oidc-login", lang: "python", title: "Sign in with OpenID Connect (Authlib)", framework: "FastAPI (Starlette) with Authlib", file: "app/auth.py",
    deps: ["fastapi 0.165.0", "authlib 1.9.10", "httpx", "itsdangerous"], verify: "build",
    source: code`
import os

from authlib.integrations.starlette_client import OAuth
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from starlette.middleware.sessions import SessionMiddleware

app = FastAPI()
# Starlette's SessionMiddleware keeps the session in a signed cookie. Keep it small (no tokens); use a server-side
# session store in production if you must keep tokens.
app.add_middleware(SessionMiddleware, secret_key=os.environ["SESSION_SECRET"], https_only=True, same_site="lax", max_age=3600)

oauth = OAuth()
oauth.register(
    "idp",
    server_metadata_url=os.environ.get("OIDC_ISSUER", "https://idp.example") + "/.well-known/openid-configuration",
    client_id=os.environ.get("OIDC_CLIENT_ID"),
    client_secret=os.environ.get("OIDC_CLIENT_SECRET"),
    client_kwargs={"scope": "openid profile", "code_challenge_method": "S256"},
)


@app.get("/login")
async def login(request: Request):
    # Builds the authorization request with state, nonce and PKCE, and stores them in the session.
    return await oauth.idp.authorize_redirect(request, request.url_for("callback"))


@app.get("/callback")
async def callback(request: Request):
    # Checks state, exchanges the code with the verifier, and validates the ID token (signature from JWKS, iss, aud, exp, nonce).
    token = await oauth.idp.authorize_access_token(request)
    user = token["userinfo"]
    request.session.clear()  # drop pre-login data before starting the signed-in session
    request.session["user"] = {"iss": user["iss"], "sub": user["sub"], "name": user.get("name")}
    return RedirectResponse("/")


@app.get("/logout")
async def logout(request: Request):
    request.session.clear()  # local logout; redirect to the provider's end_session_endpoint to end its session too
    return RedirectResponse("/")`,
    notes: [
      { code: "oauth.register(..., server_metadata_url=...)", explain: "Authlib reads the discovery document: endpoints, issuer and jwks_uri." },
      { code: "code_challenge_method: S256", explain: "Enables PKCE." },
      { code: "authorize_access_token(request)", explain: "Validates state, redeems the code, and parses and validates the ID token, returning its claims as userinfo." },
      { code: "request.session.clear()", explain: "Start a fresh session at sign-in: the session-fixation defence for cookie-stored sessions." },
    ],
    failure: "Reading the ID token's claims with jwt.decode(..., options={'verify_signature': False}) instead of letting the library validate it.",
    production: ["SESSION_SECRET from a secret store; rotate it.", "For server-side sessions (and storing tokens), use a session backend rather than a cookie."],
  },

  // ---------------- Client credentials ----------------
  {
    id: "cc-cs", topic: "client-credentials", lang: "csharp", title: "Client Credentials with token caching", framework: ".NET HttpClient", file: "Infrastructure/OrdersApiClient.cs in the calling service",
    deps: [], verify: "build",
    source: code`
using System.Net.Http.Headers;
using System.Net.Http.Json;

// The calling service: gets a token as itself, caches it until shortly before expiry, then calls the API.
var http = new HttpClient();
var tokens = new ClientCredentialsTokens(http,
    tokenEndpoint: new Uri(Environment.GetEnvironmentVariable("TOKEN_ENDPOINT") ?? "https://idp.example/token"),
    clientId: Environment.GetEnvironmentVariable("CLIENT_ID") ?? "billing",
    clientSecret: Environment.GetEnvironmentVariable("CLIENT_SECRET") ?? throw new InvalidOperationException("CLIENT_SECRET is not set"),
    scope: "orders.read", resource: "https://api.example");

using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example/api/orders?date=2027-01-15");
request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await tokens.GetAsync());
using var response = await http.SendAsync(request);
Console.WriteLine((int)response.StatusCode);

sealed class ClientCredentialsTokens(HttpClient http, Uri tokenEndpoint, string clientId, string clientSecret, string scope, string resource)
{
    readonly SemaphoreSlim gate = new(1, 1);
    string? token;
    DateTimeOffset renewAt;

    public async Task<string> GetAsync()
    {
        if (token is not null && DateTimeOffset.UtcNow < renewAt) return token;
        await gate.WaitAsync(); // one renewal at a time, however many requests need a token
        try
        {
            if (token is not null && DateTimeOffset.UtcNow < renewAt) return token;
            using var request = new HttpRequestMessage(HttpMethod.Post, tokenEndpoint)
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "client_credentials", ["scope"] = scope, ["resource"] = resource,
                }),
            };
            // client_secret_basic (RFC 6749 §2.3.1). Prefer private_key_jwt or a managed identity where available.
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"{Uri.EscapeDataString(clientId)}:{Uri.EscapeDataString(clientSecret)}")));
            using var response = await http.SendAsync(request);
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadFromJsonAsync<TokenResponse>() ?? throw new InvalidOperationException("Empty token response");
            token = body.access_token;
            renewAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(0, body.expires_in - 60)); // renew a minute early
            return token;
        }
        finally { gate.Release(); }
    }

    sealed record TokenResponse(string access_token, int expires_in, string token_type);
}`,
    notes: [
      { code: "grant_type=client_credentials", explain: "No user, no browser: the service is the resource owner." },
      { code: "resource=https://api.example", explain: "RFC 8707 resource indicator: ask for a token whose audience is the API." },
      { code: "SemaphoreSlim gate", explain: "Single-flight renewal: a burst of requests triggers one token request, not hundreds." },
      { code: "renewAt = ... expires_in - 60", explain: "Renew before expiry so calls never carry an expired token." },
    ],
    failure: "Requesting a new token for every API call: hundreds of token requests a second hit the authorization server's rate limits.",
    production: ["Libraries such as Duende.AccessTokenManagement or Microsoft.Identity.Client (MSAL) handle caching and renewal; prefer them.", "Prefer certificate or federated credentials (managed identities) to secrets."],
  },
  {
    id: "cc-java", topic: "client-credentials", lang: "java", title: "Client Credentials with Spring's OAuth2 client", framework: "Spring Boot 4.2, Spring Security OAuth2 Client", file: "src/main/java/example/BillingJob.java + application.yml",
    deps: ["org.springframework.boot:spring-boot-starter-web 4.2.0", "org.springframework.boot:spring-boot-starter-oauth2-client 4.2.0"], verify: "build",
    source: code`
package example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.security.oauth2.client.AuthorizedClientServiceOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientProviderBuilder;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.client.OAuth2ClientHttpRequestInterceptor;
import org.springframework.web.client.RestClient;

@SpringBootApplication
public class BillingJob {
    /** Works outside a web request (a scheduled job): tokens are cached per registration and renewed before expiry. */
    @Bean
    OAuth2AuthorizedClientManager authorizedClientManager(ClientRegistrationRepository registrations, OAuth2AuthorizedClientService clients) {
        var manager = new AuthorizedClientServiceOAuth2AuthorizedClientManager(registrations, clients);
        manager.setAuthorizedClientProvider(OAuth2AuthorizedClientProviderBuilder.builder().clientCredentials().build());
        return manager;
    }

    @Bean
    RestClient ordersApi(OAuth2AuthorizedClientManager manager) {
        var interceptor = new OAuth2ClientHttpRequestInterceptor(manager);
        interceptor.setClientRegistrationIdResolver(request -> "billing"); // adds Authorization: Bearer <token for "billing">
        return RestClient.builder().baseUrl("https://api.example").requestInterceptor(interceptor).build();
    }

    public static void main(String[] args) {
        var context = SpringApplication.run(BillingJob.class, args);
        String orders = context.getBean(RestClient.class).get().uri("/api/orders?date=2027-01-15").retrieve().body(String.class);
        System.out.println(orders);
    }
}`,
    extra: [{ file: "src/main/resources/application.yml", source: code`
spring:
  main:
    web-application-type: none
  security:
    oauth2:
      client:
        registration:
          billing:
            provider: idp
            client-id: billing
            client-secret: \${BILLING_CLIENT_SECRET}
            authorization-grant-type: client_credentials
            scope: orders.read
        provider:
          idp:
            token-uri: https://idp.example/token` }],
    notes: [
      { code: "clientCredentials()", explain: "The provider that requests tokens with grant_type=client_credentials and reuses them until they expire." },
      { code: "OAuth2ClientHttpRequestInterceptor", explain: "Adds the bearer token to every request made with this RestClient." },
      { code: "AuthorizedClientServiceOAuth2AuthorizedClientManager", explain: "The manager for use outside an HTTP request, such as jobs." },
    ],
    failure: "Putting the client secret in application.yml in source control.",
    production: ["Use private_key_jwt client authentication where the provider supports it.", "One registration per downstream API, each with the narrowest scope."],
  },
  {
    id: "cc-py", topic: "client-credentials", lang: "python", title: "Client Credentials with Authlib", framework: "Authlib (httpx client)", file: "billing/orders_client.py",
    deps: ["authlib 1.9.10", "httpx"], verify: "build",
    source: code`
import os

from authlib.integrations.httpx_client import OAuth2Client

TOKEN_ENDPOINT = os.environ.get("TOKEN_ENDPOINT", "https://idp.example/token")


def orders_client() -> OAuth2Client:
    # The client fetches a token with grant_type=client_credentials and fetches a new one when it expires.
    client = OAuth2Client(
        client_id=os.environ.get("CLIENT_ID", "billing"),
        client_secret=os.environ["CLIENT_SECRET"],
        scope="orders.read",
        token_endpoint=TOKEN_ENDPOINT,
        grant_type="client_credentials",
    )
    client.fetch_token(TOKEN_ENDPOINT, grant_type="client_credentials", resource="https://api.example")
    return client


if __name__ == "__main__":
    with orders_client() as client:
        print(client.get("https://api.example/api/orders", params={"date": "2027-01-15"}).status_code)`,
    notes: [
      { code: "OAuth2Client(..., token_endpoint=..., grant_type=\"client_credentials\")", explain: "With token_endpoint set, Authlib renews an expired client-credentials token before the next request." },
      { code: "resource=...", explain: "Resource indicator (RFC 8707), sent as an extra token request parameter." },
    ],
    failure: "Creating a new client (and token) per request instead of reusing one per process.",
    production: ["CLIENT_SECRET from a secret store; prefer private_key_jwt (Authlib supports it) or a workload identity."],
  },

  // ---------------- Session cookies ----------------
  {
    id: "session-cs", topic: "session-cookie", lang: "csharp", title: "Cookie sessions: attributes, sign-in, logout", framework: "ASP.NET Core 10 cookie authentication", file: "Program.cs",
    deps: [], verify: "run",
    source: code`
#:sdk Microsoft.NET.Sdk.Web

using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(options =>
{
    options.Cookie.Name = "__Host-app";                        // browser enforces Secure, Path=/ and no Domain
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.ExpireTimeSpan = TimeSpan.FromMinutes(30);
    options.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; }; // an API answers 401
});
builder.Services.AddAuthorization();

var app = builder.Build();
app.MapPost("/login", async (HttpContext ctx) =>
{
    // A real login first verifies the password (PasswordHasher<TUser>) or completes an OIDC sign-in.
    var user = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "alice")], CookieAuthenticationDefaults.AuthenticationScheme));
    await ctx.SignInAsync(user); // issues a NEW protected ticket: nothing from before sign-in is reused
    return Results.NoContent();
});
app.MapGet("/me", (ClaimsPrincipal user) => user.Identity!.Name).RequireAuthorization();
app.MapPost("/logout", async (HttpContext ctx) => { await ctx.SignOutAsync(); return Results.NoContent(); });

await app.StartAsync();
var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
using var http = new HttpClient(new HttpClientHandler { UseCookies = false }) { BaseAddress = new Uri(address) };

Console.WriteLine($"me without a cookie: {(int)(await http.GetAsync("/me")).StatusCode}");
var login = await http.PostAsync("/login", null);
var setCookie = login.Headers.GetValues("Set-Cookie").Single();
var cookie = setCookie.Split(';')[0];
Console.WriteLine($"cookie name: {cookie.Split('=')[0]}");
Console.WriteLine($"cookie attributes: {string.Join("; ", setCookie.Split("; ").Skip(1).Where(a => !a.StartsWith("expires")))}");
using var me = new HttpRequestMessage(HttpMethod.Get, "/me");
me.Headers.Add("Cookie", cookie);
Console.WriteLine($"me with the cookie: {await (await http.SendAsync(me)).Content.ReadAsStringAsync()}");
var logout = await http.PostAsync("/logout", null);
Console.WriteLine($"logout expires the cookie: {logout.Headers.GetValues("Set-Cookie").Single().Contains("expires=Thu, 01 Jan 1970")}");
await app.StopAsync();`,
    output: "me without a cookie: 401\ncookie name: __Host-app\ncookie attributes: path=/; secure; samesite=lax; httponly\nme with the cookie: alice\nlogout expires the cookie: True",
    notes: [
      { code: "options.Cookie.Name = \"__Host-app\"", explain: "The __Host- prefix makes browsers refuse the cookie unless it is Secure, has Path=/ and no Domain." },
      { code: "SecurePolicy = Always; HttpOnly; SameSite = Lax", explain: "HTTPS only, invisible to JavaScript, not sent on cross-site subrequests." },
      { code: "ctx.SignInAsync(user)", explain: "Issues a new encrypted authentication ticket. ASP.NET Core cookie auth stores the session in the cookie itself (protected with Data Protection); add an ITicketStore to keep it server-side." },
      { code: "ctx.SignOutAsync()", explain: "Expires the cookie. With a server-side ticket store it also deletes the server-side session, so a copied cookie stops working." },
    ],
    failure: "Without HttpOnly, a script injected into any page can read document.cookie and send the session to an attacker.",
    production: ["Use an ITicketStore (server-side sessions) when you need immediate revocation.", "Add antiforgery tokens to forms (builder.Services.AddAntiforgery, enabled by default for Razor Pages and MVC forms)."],
  },
  {
    id: "session-java", topic: "session-cookie", lang: "java", title: "Sessions, CSRF and logout in Spring Security", framework: "Spring Boot 4.2, Spring Security", file: "src/main/java/example/SessionSecurity.java + application.yml",
    deps: ["org.springframework.boot:spring-boot-starter-web 4.2.0", "org.springframework.boot:spring-boot-starter-security 4.2.0"], verify: "build",
    source: code`
package example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@SpringBootApplication
public class SessionSecurity {
    @Bean
    SecurityFilterChain web(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth.requestMatchers("/login").permitAll().anyRequest().authenticated())
            .formLogin(Customizer.withDefaults())
            .csrf(Customizer.withDefaults())                                       // on by default for cookie sessions
            .sessionManagement(s -> s
                .sessionFixation(f -> f.changeSessionId())                         // new id at login
                .maximumSessions(3))
            .logout(l -> l.invalidateHttpSession(true).deleteCookies("JSESSIONID")); // server-side session destroyed
        return http.build();
    }

    /** Stores {id}hash; Spring's current default encoder is bcrypt, and Argon2PasswordEncoder is available. */
    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    public static void main(String[] args) {
        SpringApplication.run(SessionSecurity.class, args);
    }
}`,
    extra: [{ file: "src/main/resources/application.yml", source: code`
server:
  servlet:
    session:
      timeout: 30m
      cookie:
        secure: true
        http-only: true
        same-site: lax` }],
    notes: [
      { code: "sessionFixation(f -> f.changeSessionId())", explain: "The servlet container issues a new session id at authentication." },
      { code: "csrf(Customizer.withDefaults())", explain: "Synchronizer-token CSRF protection for state-changing requests." },
      { code: "invalidateHttpSession(true)", explain: "Logout destroys the server-side session, not just the cookie." },
      { code: "createDelegatingPasswordEncoder()", explain: "Hashes with a strong adaptive algorithm and records which one ({bcrypt}, {argon2}), so you can upgrade later." },
    ],
    failure: "Disabling CSRF protection in a cookie-session application because 'the API returned 403'.",
    production: ["Spring Session (Redis or JDBC) keeps sessions server-side across instances.", "Set idle and absolute timeouts."],
  },
  {
    id: "session-py", topic: "session-cookie", lang: "python", title: "Session and cookie settings (Django)", framework: "Django settings", file: "project/settings.py (excerpt)",
    deps: [], verify: "build",
    source: code`
# Django keeps sessions server-side (database or cache) and gives the browser only a random session key.
SESSION_ENGINE = "django.contrib.sessions.backends.cache"   # or .db
SESSION_COOKIE_NAME = "__Host-sessionid"
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 30 * 60
SESSION_EXPIRE_AT_BROWSER_CLOSE = False

CSRF_COOKIE_SECURE = True
CSRF_COOKIE_SAMESITE = "Lax"

# Strong, adaptive password hashing; the first entry hashes new passwords, the rest still verify old ones.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",   # needs the argon2-cffi package
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

# django.contrib.auth.login() rotates the session key at sign-in (fixation defence);
# django.contrib.auth.logout() flushes the server-side session.`,
    notes: [
      { code: "SESSION_ENGINE", explain: "Server-side sessions: logout and revocation are immediate." },
      { code: "SESSION_COOKIE_SECURE / HTTPONLY / SAMESITE", explain: "The same three attributes as everywhere." },
      { code: "PASSWORD_HASHERS", explain: "Argon2 first; Django upgrades stored hashes on the next successful login." },
    ],
    failure: "Setting SESSION_COOKIE_SECURE = False in production to make local testing work.",
    production: ["Use Django's CsrfViewMiddleware (on by default) and {% csrf_token %} in forms."],
  },
];

export const examplesFor = (topic: string) => identityExamples.filter((e) => e.topic === topic);
export const exampleTopics: Record<IdentityExample["topic"], string> = {
  pkce: "PKCE: verifier and challenge",
  "protected-api": "A protected API",
  "oidc-login": "Sign in with OpenID Connect",
  "client-credentials": "Service-to-service tokens",
  "session-cookie": "Session cookies",
};
