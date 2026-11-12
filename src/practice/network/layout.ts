// The diagram on a narrow screen: a layout computed for reading, never saved over the learner's own. Devices go in
// rows by how many links they are from the first device (the leftmost one in the learner's layout), so every link
// joins neighbouring rows or two devices of one row, and no cable runs behind a device it does not reach. Rows are not
// squeezed to fit: the canvas pans across a wide row instead, so names stay readable.
import type { Network } from "./model.ts";

/** Room for a device: its tile, name and address, the label of what it is doing, and a frame moving between rows. */
export const COLUMN = 210;
export const ROW = 330;
const SIDE = 110, TOP = 140, BOTTOM = 190;

export type Layout = { pos: Record<string, { x: number; y: number }>; width: number; height: number; rows: string[][] };

export function stackedLayout(network: Network): Layout {
  const byPlace = [...network.devices].sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
  const saved = new Map(network.devices.map((d) => [d.id, d]));
  const near = new Map(network.devices.map((d) => [d.id, [] as string[]]));
  for (const l of network.links) {
    near.get(l.a.device)?.push(l.b.device);
    near.get(l.b.device)?.push(l.a.device);
  }
  // Breadth-first from the leftmost device not yet placed: each part of a disconnected network starts its own rows.
  const seen = new Set<string>(),
    rows: string[][] = [];
  for (const start of byPlace) {
    if (seen.has(start.id)) continue;
    seen.add(start.id);
    let row = [start.id];
    while (row.length) {
      rows.push(row);
      const next: string[] = [];
      for (const id of row) for (const n of near.get(id) ?? []) if (!seen.has(n)) (seen.add(n), next.push(n));
      row = next;
    }
  }
  // In each row, devices sit under the devices they connect to in the row above, then in the learner's own top-to-bottom order.
  const column: Record<string, number> = {};
  rows.forEach((row, r) => {
    const above = new Set(r > 0 ? rows[r - 1] : []);
    const under = (id: string) => {
      const ns = (near.get(id) ?? []).filter((n) => above.has(n));
      return ns.length ? ns.reduce((s, n) => s + column[n], 0) / ns.length : Infinity;
    };
    const key = new Map(row.map((id) => [id, under(id)]));
    row.sort((a, b) => {
      const ka = key.get(a)!, kb = key.get(b)!;
      return ka !== kb ? (ka === Infinity ? 1 : kb === Infinity ? -1 : ka - kb) : saved.get(a)!.y - saved.get(b)!.y || saved.get(a)!.x - saved.get(b)!.x;
    });
    row.forEach((id, i) => (column[id] = i - (row.length - 1) / 2));
  });
  const widest = Math.max(1, ...rows.map((r) => r.length));
  const width = SIDE * 2 + (widest - 1) * COLUMN;
  const pos: Layout["pos"] = {};
  rows.forEach((row, r) => row.forEach((id) => (pos[id] = { x: width / 2 + column[id] * COLUMN, y: TOP + r * ROW })));
  return { pos, width, height: TOP + Math.max(0, rows.length - 1) * ROW + BOTTOM, rows };
}
