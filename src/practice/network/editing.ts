import type { Network } from "./model.ts";
/** Positions are presentation only. Undoing a move must not release a DHCP lease. */
export function sameConfiguration(a: Network, b: Network): boolean {
  const withoutPositions = (n: Network) => ({
    ...n,
    devices: n.devices.map(({ x: _x, y: _y, ...device }) => device),
  });
  return (
    JSON.stringify(withoutPositions(a)) === JSON.stringify(withoutPositions(b))
  );
}
