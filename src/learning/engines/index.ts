import { registerEngine } from "../registry.ts";
import { dataStructuresAdapter } from "./data-structures.ts";
import { recursionAdapter } from "./recursion.ts";
import { tcpAdapter } from "./tcp.ts";

registerEngine(tcpAdapter);
registerEngine(dataStructuresAdapter);
registerEngine(recursionAdapter);

export { dataStructuresAdapter, recursionAdapter, tcpAdapter };
