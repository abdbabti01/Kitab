import { registerEngine } from "../registry.ts";
import { dataStructuresAdapter } from "./data-structures.ts";
import { recursionAdapter } from "./recursion.ts";
import { packetJourneyAdapter } from "./packet-journey.ts";
import { tcpAdapter } from "./tcp.ts";

registerEngine(tcpAdapter);
registerEngine(dataStructuresAdapter);
registerEngine(recursionAdapter);
registerEngine(packetJourneyAdapter);

export { dataStructuresAdapter, packetJourneyAdapter, recursionAdapter, tcpAdapter };
