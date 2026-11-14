// Every engine, registered synchronously: for the Worker (tutor grounding) and tests. Browser pages import browser.ts instead.
import { registerEngine } from "../registry.ts";
import { gatewayPracticeAdapter } from "./gateway-practice.ts";
import { localDeliveryAdapter } from "./local-delivery.ts";
export * from "./eager.ts";

registerEngine(localDeliveryAdapter);
registerEngine(gatewayPracticeAdapter);
