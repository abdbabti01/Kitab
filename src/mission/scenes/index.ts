import type { SceneModule } from "./common.tsx";
import "./scenes.css";
import { dataStructureScene } from "./DataStructureScene.tsx";
import { ipAddressingScene } from "./IpAddressingScene.tsx";
import { ipv4SubnetsScene } from "./Ipv4SubnetsScene.tsx";
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
};

/** Scenes for on-demand engines (engines/browser.ts), loaded with their engine. */
const onDemandScenes: Record<string, () => Promise<SceneModule<any>>> = {
  "local-delivery": () => import("./LocalDeliveryScene.tsx").then((m) => m.localDeliveryScene),
};

export function sceneFor(engineId: string): SceneModule<any> | undefined {
  return scenes[engineId];
}

/** Resolves once the scene is available to sceneFor. Rejects if its code fails to load; calling again retries. */
export async function loadScene(engineId: string) {
  if (scenes[engineId] || !onDemandScenes[engineId]) return;
  scenes[engineId] = await onDemandScenes[engineId]();
}
