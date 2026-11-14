import { registerEngine } from "../registry.ts";
import { dataStructuresAdapter } from "./data-structures.ts";
import { ipAddressingAdapter } from "./ip-addressing.ts";
import { ipv4SubnetsAdapter } from "./ipv4-subnets.ts";
import { recursionAdapter } from "./recursion.ts";
import { tcpAdapter } from "./tcp.ts";

registerEngine(tcpAdapter);
registerEngine(dataStructuresAdapter);
registerEngine(recursionAdapter);
registerEngine(ipAddressingAdapter);
registerEngine(ipv4SubnetsAdapter);

export { dataStructuresAdapter, recursionAdapter, tcpAdapter };
