// Every Identity Playground scenario, in the order the Playground lists them.
import type { Scenario } from "../model.ts";
import { oidcLogin } from "./oidc.ts";
import { sso } from "./sso.ts";
import { clientCredentials, deviceGrant, introspection, refreshRotation } from "./oauth.ts";
import { saml } from "./saml.ts";
import { keyRotation, phishing, webauthn } from "./factors.ts";

export const scenarios: Scenario[] = [oidcLogin, sso, clientCredentials, deviceGrant, refreshRotation, introspection, saml, phishing, webauthn, keyRotation];
export const findScenario = (id: string) => scenarios.find((s) => s.id === id);
