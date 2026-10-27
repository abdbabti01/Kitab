import { registerEngine } from "../registry.ts";
import { dataStructuresAdapter } from "./data-structures.ts";
import { recursionAdapter } from "./recursion.ts";
import { messageJourneyAdapter } from "./message-journey.ts";
import { tcpAdapter } from "./tcp.ts";

registerEngine(tcpAdapter);
registerEngine(dataStructuresAdapter);
registerEngine(recursionAdapter);
registerEngine(messageJourneyAdapter);

export { dataStructuresAdapter, messageJourneyAdapter, recursionAdapter, tcpAdapter };
