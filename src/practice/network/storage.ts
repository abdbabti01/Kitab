import { importNetwork } from "./topology.ts";
import type { Network } from "./model.ts";
export const WORKSPACE_KEY = "kitab.network.workspace.v1",
  SAVES_KEY = "kitab.network.saves.v1",
  CHALLENGES_KEY = "kitab.network.challenges.v1";
export function loadWorkspace(): Network | null {
  const raw = localStorage.getItem(WORKSPACE_KEY);
  return raw ? importNetwork(raw) : null;
}
export function savedNetworks(): { name: string; network: Network }[] {
  const raw = JSON.parse(localStorage.getItem(SAVES_KEY) ?? "[]");
  if (!Array.isArray(raw)) throw new Error("Saved networks could not be read.");
  return raw
    .slice(0, 20)
    .map((item) => ({
      name: String(item.name),
      network: importNetwork(JSON.stringify(item.network)),
    }));
}
export function saveNamed(n: Network) {
  const entries = savedNetworks().filter((e) => e.name !== n.name);
  entries.unshift({ name: n.name, network: n });
  localStorage.setItem(SAVES_KEY, JSON.stringify(entries.slice(0, 20)));
}
