// The Identity track's units in teaching order (A–L).
import type { IdentityUnit } from "./types.ts";
import { fundamentals, oauth, passwordsSessions } from "./units-1.ts";
import { oauthFlows, oidc, tokens } from "./units-2.ts";
import { authorization, saml, sso } from "./units-3.ts";
import { enterprise, failures, mfaPasskeys } from "./units-4.ts";

export const identityUnits: IdentityUnit[] = [fundamentals, passwordsSessions, oauth, oauthFlows, oidc, tokens, sso, saml, authorization, mfaPasskeys, enterprise, failures];
export const findIdentityUnit = (id: string) => identityUnits.find((u) => u.id === id);
