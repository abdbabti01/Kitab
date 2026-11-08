import type { DeviceKind } from "./network/model.ts";
/** Code-native illustrations stay sharp at every canvas zoom level. */
export function DeviceArt({ kind }: { kind: DeviceKind }) {
  const common = {
    stroke: "currentColor",
    strokeWidth: 2.3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <g {...common}>
      {kind === "pc" && (
        <>
          <rect
            x="-32"
            y="-30"
            width="64"
            height="43"
            rx="5"
            fill="var(--surface)"
          />
          <rect
            x="-25"
            y="-23"
            width="50"
            height="29"
            rx="2"
            fill="var(--primary-soft)"
            stroke="none"
          />
          <path d="m-14-12 6 5-6 5m13 0h12" />
          <path d="M0 14v10m-18 2h36" />
          <circle cx="25" cy="9" r="1" fill="currentColor" />
        </>
      )}
      {kind === "phone" && (
        <>
          <rect
            x="-18"
            y="-34"
            width="36"
            height="66"
            rx="8"
            fill="var(--surface)"
          />
          <rect
            x="-12"
            y="-23"
            width="24"
            height="43"
            rx="3"
            fill="var(--primary-soft)"
            stroke="none"
          />
          <path d="M-5-28H5M-4 26h8m-5-34a10 10 0 0 1 12 0m-9 4a5 5 0 0 1 6 0" />
          <circle cx="0" cy="2" r="1" fill="currentColor" />
        </>
      )}
      {(kind === "router" || kind === "switch") && (
        <>
          <path d="m-37-6 12-14h50L37-6v29h-74Z" fill="var(--surface)" />
          <path d="M-37-6h74" />
          <path
            d="M-25 8h8v7h-8zm15 0h8v7h-8zm15 0h8v7H5z"
            fill="var(--primary-soft)"
          />
          <circle cx="26" cy="12" r="2" fill="var(--primary)" stroke="none" />
          {kind === "router" ? (
            <path d="m-13-14 7-3 7 3m-7-3v9m8-2 7 3 7-3m-7 3v-9" />
          ) : (
            <path d="M-15-14h30m-25 4h20" />
          )}
        </>
      )}
      {kind === "ap" && (
        <>
          <path d="M-22-4v-24m44 24v-24" />
          <rect
            x="-32"
            y="-4"
            width="64"
            height="29"
            rx="9"
            fill="var(--surface)"
          />
          <path d="M-12-22a18 18 0 0 1 24 0m-19 7a11 11 0 0 1 14 0" />
          <circle cx="0" cy="-7" r="2" fill="currentColor" />
          <circle cx="0" cy="11" r="3" fill="var(--primary)" stroke="none" />
        </>
      )}
      {kind === "server" && (
        <>
          <rect
            x="-24"
            y="-32"
            width="48"
            height="64"
            rx="5"
            fill="var(--surface)"
          />
          {[-20, -2, 16].map((y) => (
            <g key={y}>
              <rect
                x="-17"
                y={y}
                width="34"
                height="12"
                rx="2"
                fill="var(--primary-soft)"
              />
              <path d={`M-10 ${y + 6}h10`} />
              <circle
                cx="11"
                cy={y + 6}
                r="1.5"
                fill="var(--primary)"
                stroke="none"
              />
            </g>
          ))}
        </>
      )}
    </g>
  );
}
