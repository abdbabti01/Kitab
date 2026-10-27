import type { SceneModule } from "./common.tsx";
import { dataStructureScene } from "./DataStructureScene.tsx";
import { recursionScene } from "./RecursionScene.tsx";
import { tcpScene } from "./TcpScene.tsx";

/** UI projection per engine id. The mission shell never branches on topic. */
const scenes: Record<string, SceneModule<any>> = {
  tcp: tcpScene,
  "data-structures": dataStructureScene,
  recursion: recursionScene,
};

export function sceneFor(engineId: string): SceneModule<any> | undefined {
  return scenes[engineId];
}
