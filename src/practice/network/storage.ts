import { importNetwork } from "./topology.ts";
import type { Network } from "./model.ts";
export { CHALLENGES_KEY } from "./mission-progress.ts";
export const WORKSPACE_KEY = "kitab.network.workspace.v1",
  SAVES_KEY = "kitab.network.saves.v1",
  /** A mission's network opened in the playground for free experiments; never saved over the workspace. */
  SCRATCH_KEY = "kitab.network.scratch";
export function loadWorkspace(): Network | null {
  const raw = localStorage.getItem(WORKSPACE_KEY);
  return raw ? importNetwork(raw) : null;
}
export const MAX_SAVES = 20;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
function rawSaves(storage: StorageLike): { name?: unknown; network?: unknown }[] {
  const raw = JSON.parse(storage.getItem(SAVES_KEY) ?? "[]");
  if (!Array.isArray(raw)) throw new Error("Saved networks could not be read.");
  return raw;
}
/** Named saves that can be opened, newest first. One that can't be read is left out here and kept as it is. */
export function savedNetworks(storage: StorageLike = localStorage): { name: string; network: Network }[] {
  return rawSaves(storage).flatMap((item) => {
    try {
      return [{ name: String(item.name), network: importNetwork(JSON.stringify(item.network)) }];
    } catch {
      return [];
    }
  });
}
/**
 * Saves the network under its name. Another save is never replaced without `replace`: "exists" means a save has
 * this name, "full" means there are MAX_SAVES and `replace` would drop the oldest. Throws when storage refuses.
 */
export function saveNamed(n: Network, replace = false, storage: StorageLike = localStorage): "saved" | "exists" | "full" {
  const raw = rawSaves(storage);
  const index = raw.findIndex((item) => item?.name === n.name);
  if (index !== -1 && !replace) return "exists";
  if (index === -1 && raw.length >= MAX_SAVES && !replace) return "full";
  const rest = index === -1 ? raw.slice(0, MAX_SAVES - 1) : raw.filter((_, i) => i !== index);
  storage.setItem(SAVES_KEY, JSON.stringify([{ name: n.name, network: n }, ...rest]));
  return "saved";
}
