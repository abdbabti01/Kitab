import type { SceneModule } from "./common.tsx";
import "./scenes.css";
import { dataStructureScene } from "./DataStructureScene.tsx";
import { ipAddressingScene } from "./IpAddressingScene.tsx";
import { ipv4SubnetsScene } from "./Ipv4SubnetsScene.tsx";
import { localDeliveryScene } from "./LocalDeliveryScene.tsx";
import { recursionScene } from "./RecursionScene.tsx";
import { tcpScene } from "./TcpScene.tsx";

/** UI projection per engine id. The mission shell never branches on topic. */
const scenes: Record<string, SceneModule<any>> = {
  tcp: tcpScene,
  "data-structures": dataStructureScene,
  recursion: recursionScene,
  "ip-addressing": ipAddressingScene,
  "ipv4-subnets": ipv4SubnetsScene,
  // Practice missions show the lesson's own frames for the decision they assess.
  "ipv4-practice": ipv4SubnetsScene,
  "local-delivery": localDeliveryScene,
};

export function sceneFor(engineId: string): SceneModule<any> | undefined {
  return scenes[engineId];
}
