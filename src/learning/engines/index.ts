import { registerEngine } from "../registry.ts";
import { dataStructuresAdapter } from "./data-structures.ts";
import { ipAddressingAdapter } from "./ip-addressing.ts";
import { recursionAdapter } from "./recursion.ts";
import { tcpAdapter } from "./tcp.ts";

registerEngine(tcpAdapter);
registerEngine(dataStructuresAdapter);
registerEngine(recursionAdapter);
registerEngine(ipAddressingAdapter);

export { dataStructuresAdapter, recursionAdapter, tcpAdapter };
