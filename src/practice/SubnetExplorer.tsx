// Explore subnets: any IPv4 address and prefix, its bits, its block and a same-subnet check. Every value comes from
// the shared helper (src/net/ipv4.ts) through src/net/subnet-practice.ts. Nothing is stored and no progress is recorded.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { block, formatAddress, maskOf, parseAddress, prefixOfMask, toBinary } from "../net/ipv4.ts";
import {
  PRESETS,
  SPECIAL,
  blockStart,
  boundary,
  compare,
  describeRange,
  example,
  explain,
  question,
  readExplorerQuery,
} from "../net/subnet-practice.ts";
import { linkProps } from "../app/router.ts";
import { BitRows, BlockFacts, PredictionCard } from "./SubnetParts.tsx";
import "./subnets.css";

const count = (n: number) => n.toLocaleString("en");
/** Matches the phone layout in subnets.css, where the address bits show one octet per row. */
const ONE_OCTET_PER_ROW = "(max-width: 600px)";
function problem(read: () => unknown) {
  try {
    read();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function SubnetExplorer() {
  const initial = useRef(readExplorerQuery(window.location.search)).current;
  const [addressText, setAddressText] = useState(initial.address);
  const [prefix, setPrefixValue] = useState(initial.prefix);
  const [maskText, setMaskText] = useState(formatAddress(maskOf(initial.prefix)));
  const [destinationText, setDestinationText] = useState(initial.destination);
  const [predict, setPredict] = useState(true);
  const [attempt, setAttempt] = useState<{ key: string; tried: number[]; shown: boolean }>({ key: "", tried: [], shown: false });
  const [seed, setSeed] = useState(1);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    document.title = "Explore subnets · Kitab";
  }, []);

  // Results exist only while both the address and the mask are valid: invalid text never leaves stale values on screen.
  const addressError = problem(() => parseAddress(addressText.trim())),
    maskError = problem(() => prefixOfMask(maskText.trim())),
    address = addressError || maskError ? null : addressText.trim();
  const setPrefix = (p: number) => {
    setPrefixValue(p);
    setMaskText(formatAddress(maskOf(p)));
  };
  const onMask = (text: string) => {
    setMaskText(text);
    const p = problem(() => prefixOfMask(text.trim())) ? null : prefixOfMask(text.trim());
    if (p !== null) setPrefixValue(p);
  };
  const setAddress = (value: number) => setAddressText(formatAddress(value));
  const key = `${address}/${prefix}`,
    current = attempt.key === key ? attempt : { key, tried: [], shown: false };

  return (
    <main id="main" className="page subnet-page">
      <header className="subnet-heading">
        <p className="eyebrow">Practice · Explorer</p>
        <h1>Explore subnets</h1>
        <p className="section-lead">
          Type any IPv4 address and choose a prefix. See its bits, its block, and whether another address is on the same subnet. Nothing here is recorded: explore freely.
        </p>
        <a className="text-button subnet-lesson-link" {...linkProps("/learn/ipv4-subnets")}>New to subnets? Learn it step by step →</a>
      </header>

      <div className="subnet-layout">
        <div className="subnet-column">
          <AddressInputs
            addressText={addressText}
            addressError={addressError}
            onAddress={setAddressText}
            maskText={maskText}
            maskError={maskError}
            onMask={onMask}
            prefix={prefix}
            onPrefix={setPrefix}
          />
          <BitStrip address={address} prefix={prefix} onAddress={(value, message) => { setAddress(value); setAnnouncement(message); }} />
        </div>
        <div className="subnet-column">
          <BlockPanel
            address={address}
            prefix={prefix}
            predict={predict}
            onPredict={setPredict}
            attempt={current}
            onTry={(i) => setAttempt({ ...current, tried: [...current.tried, i] })}
            onShow={() => setAttempt({ ...current, shown: true })}
            onMove={(value) => setAddress(value)}
            onExample={() => {
              const e = example(seed);
              setSeed(e.seed);
              setAddressText(e.address);
              setPrefix(e.prefix);
            }}
          />
          <WhyPanel address={address} prefix={prefix} />
        </div>
      </div>
      <SameSubnetPanel address={address} prefix={prefix} destinationText={destinationText} onDestination={setDestinationText} />
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </main>
  );
}

export function AddressInputs(props: {
  addressText: string;
  addressError: string | null;
  onAddress: (text: string) => void;
  maskText: string;
  maskError: string | null;
  onMask: (text: string) => void;
  prefix: number;
  onPrefix: (prefix: number) => void;
}) {
  const { addressText, addressError, maskText, maskError, prefix } = props;
  const chip = (p: number) => (
    <button key={p} type="button" aria-pressed={p === prefix && !maskError} onClick={() => props.onPrefix(p)}>/{p}</button>
  );
  return (
    <section className="card subnet-card" aria-labelledby="subnet-inputs">
      <h2 id="subnet-inputs">Address and prefix</h2>
      <div className="subnet-fields">
        <div>
          <label htmlFor="subnet-address">IPv4 address</label>
          <input id="subnet-address" className="subnet-text" type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
            value={addressText} onChange={(e) => props.onAddress(e.target.value)}
            aria-invalid={addressError ? true : undefined} aria-describedby={addressError ? "subnet-address-error" : undefined} />
          {addressError && <p className="subnet-error" id="subnet-address-error">{addressError}</p>}
        </div>
        <div>
          <label htmlFor="subnet-mask">Subnet mask</label>
          <input id="subnet-mask" className="subnet-text" type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
            value={maskText} onChange={(e) => props.onMask(e.target.value)}
            aria-invalid={maskError ? true : undefined} aria-describedby={maskError ? "subnet-mask-error" : undefined} />
          {maskError && <p className="subnet-error" id="subnet-mask-error">{maskError}</p>}
        </div>
      </div>
      <div className="subnet-prefix">
        <div className="subnet-prefix-head">
          <label htmlFor="subnet-prefix">Prefix length</label>
          <output htmlFor="subnet-prefix">/{prefix}</output>
        </div>
        <input id="subnet-prefix" type="range" min={0} max={32} step={1} value={prefix}
          aria-valuetext={`/${prefix}, ${32 - prefix} host bits`} onChange={(e) => props.onPrefix(Number(e.target.value))} />
        <div className="subnet-chips" role="group" aria-label="Prefix presets">
          {PRESETS.map(chip)}
          <span className="subnet-chip-group" aria-hidden="true">Special</span>
          {SPECIAL.map(chip)}
        </div>
      </div>
    </section>
  );
}

/** The 32 address bits as toggle buttons, two octets per row, with one tab stop and arrow keys between bits. */
export function BitStrip({ address, prefix, onAddress }: { address: string | null; prefix: number; onAddress: (value: number, announcement: string) => void }) {
  const [focus, setFocus] = useState(31);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!address)
    return (
      <section className="card subnet-card" aria-labelledby="subnet-bits">
        <h2 id="subnet-bits">Address bits</h2>
        <p className="subnet-wait">Correct the address and mask above to see their bits.</p>
      </section>
    );
  const value = parseAddress(address),
    bits = toBinary(value).replace(/\./g, ""),
    mask = toBinary(maskOf(prefix)).replace(/\./g, ""),
    octets = address.split(".");
  const flip = (i: number) => {
    const weight = 2 ** (31 - i),
      on = bits[i] === "1",
      next = on ? value - weight : value + weight;
    onAddress(next, `Bit ${i + 1} is now ${on ? 0 : 1}. The address is ${formatAddress(next)}; the prefix is still /${prefix}.`);
  };
  const move = (event: KeyboardEvent, i: number) => {
    // Up and Down move a visual row: one octet on phones, two octets on wider screens.
    const row = window.matchMedia(ONE_OCTET_PER_ROW).matches ? 8 : 16,
      to = { ArrowRight: i + 1, ArrowDown: i + row, ArrowLeft: i - 1, ArrowUp: i - row, Home: 0, End: 31 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(31, to));
    setFocus(target);
    refs.current[target]?.focus();
  };
  return (
    <section className="card subnet-card" aria-labelledby="subnet-bits">
      <h2 id="subnet-bits">Address bits</h2>
      <p className="subnet-help" id="subnet-bits-help">
        Select a bit to flip it. That changes the <b>address</b>; the prefix stays <b>/{prefix}</b> until you change it with the slider, a preset or the mask.
      </p>
      <div className="subnet-rowlabel"><span>Address</span><code>{address}</code></div>
      <BitRows bits={bits} prefix={prefix} values={octets} role="group" aria-label={`Address bits of ${address}`} aria-describedby="subnet-bits-help"
        renderBit={({ bit, i, k, o, part, className }) => (
          <button key={i} ref={(el) => { refs.current[i] = el; }} type="button" className={className} aria-pressed={bit === "1"}
            tabIndex={i === focus ? 0 : -1} onFocus={() => setFocus(i)} onClick={() => flip(i)} onKeyDown={(e) => move(e, i)}
            aria-label={`Bit ${i + 1} of 32, ${part} bit, place value ${2 ** (7 - k)} in octet ${o + 1}`}>
            {bit}
          </button>
        )} />
      <div className="subnet-rowlabel"><span>Mask, set by the prefix</span><code>{formatAddress(maskOf(prefix))} (/{prefix})</code></div>
      <BitRows bits={mask} prefix={prefix} className="is-mask" aria-hidden="true" />
      <p className="subnet-legend">
        <span><i className="subnet-swatch is-network" />Network bits: <b>{prefix}</b></span>
        <span><i className="subnet-swatch is-host" />Host bits: <b>{32 - prefix}</b></span>
      </p>
      <p className="subnet-note">{boundary(address, prefix)}</p>
    </section>
  );
}

export function BlockPanel(props: {
  address: string | null;
  prefix: number;
  predict: boolean;
  onPredict: (on: boolean) => void;
  attempt: { tried: number[]; shown: boolean };
  onTry: (choice: number) => void;
  onShow: () => void;
  onMove: (value: number) => void;
  onExample: () => void;
}) {
  const { address, prefix, predict, attempt } = props;
  const header = (
    <>
      <h2 id="subnet-block">The block this address is in</h2>
      <label className="subnet-toggle">
        <input type="checkbox" checked={predict} onChange={(e) => props.onPredict(e.target.checked)} /> Predict before you see the answer
      </label>
    </>
  );
  if (!address)
    return (
      <section className="card subnet-card" aria-labelledby="subnet-block">
        {header}
        <p className="subnet-wait">Correct the address and mask to see its block.</p>
      </section>
    );
  const b = block(address, prefix),
    q = question(address, prefix),
    right = q.choices.findIndex((c) => c.correct),
    solved = attempt.tried.includes(right),
    revealed = !predict || solved || attempt.shown,
    start = parseAddress(blockStart(b)),
    range = describeRange(address);
  return (
    <section className="card subnet-card" aria-labelledby="subnet-block">
      {header}
      {predict && <PredictionCard question={q} attempt={attempt} revealed={revealed} onTry={props.onTry} onShow={props.onShow} />}
      {revealed && (
        <>
          <BlockFacts address={address} prefix={prefix} />
          <div className="subnet-ruler" aria-hidden="true">
            <span>{start > 0 ? `${formatAddress(start - b.size)}/${prefix}` : "—"}</span>
            <span className="is-current">
              {b.cidr}
              <i style={{ left: `${Math.min(100, ((parseAddress(address) - start + 0.5) / b.size) * 100)}%` }} />
            </span>
            <span>{start + b.size < 2 ** 32 ? `${formatAddress(start + b.size)}/${prefix}` : "—"}</span>
          </div>
        </>
      )}
      <div className="subnet-actions">
        <button type="button" className="button" disabled={start === 0} onClick={() => props.onMove(parseAddress(address) - b.size)}>‹ Previous block</button>
        <button type="button" className="button" disabled={start + b.size >= 2 ** 32} onClick={() => props.onMove(parseAddress(address) + b.size)}>Next block ›</button>
        <button type="button" className="button primary" onClick={props.onExample}>New question</button>
      </div>
      <p className="subnet-type">
        {range.cidr && <span className="subnet-tag">{range.cidr}</span>} {range.note}
      </p>
    </section>
  );
}

export function WhyPanel({ address, prefix }: { address: string | null; prefix: number }) {
  if (!address) return null;
  const b = block(address, prefix),
    e = explain(b, address);
  return (
    <aside className="card subnet-card subnet-why" aria-labelledby="subnet-why">
      <h2 id="subnet-why">What you're seeing</h2>
      <dl>
        <dt>What happens</dt>
        <dd>{e.what}</dd>
        <dt>Why it matters</dt>
        <dd>{e.why}</dd>
        {b.kind === "normal" && prefix > 0 && (
          <>
            <dt>Rule</dt>
            <dd>
              A prefix of n bits gives a block of 2<sup>32−n</sup> addresses that starts at a multiple of the block size. Here 2<sup>{32 - prefix}</sup> = {count(b.size)}, and {count(b.usable)} of them are usable.
            </dd>
          </>
        )}
        <dt>Source</dt>
        <dd>{e.source}</dd>
      </dl>
    </aside>
  );
}

export function SameSubnetPanel({ address, prefix, destinationText, onDestination }: { address: string | null; prefix: number; destinationText: string; onDestination: (text: string) => void }) {
  const error = problem(() => parseAddress(destinationText.trim())),
    destination = error ? null : destinationText.trim(),
    c = address && destination ? compare(address, destination, prefix) : null;
  return (
    <section className="card subnet-card subnet-compare" aria-labelledby="subnet-compare">
      <h2 id="subnet-compare">Is another address on this subnet?</h2>
      <div className="subnet-compare-grid">
        <div>
          <label htmlFor="subnet-destination">Destination address</label>
          <input id="subnet-destination" className="subnet-text" type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
            value={destinationText} onChange={(e) => onDestination(e.target.value)}
            aria-invalid={error ? true : undefined} aria-describedby={error ? "subnet-destination-error" : undefined} />
          {error && <p className="subnet-error" id="subnet-destination-error">{error}</p>}
        </div>
        <div>
          {c ? (
            <>
              <dl className="subnet-and">
                <dt>Your address</dt>
                <dd><code>{address} AND {c.mask} = {c.own}</code></dd>
                <dt>Destination</dt>
                <dd><code>{destination} AND {c.mask} = {c.other}</code></dd>
              </dl>
              <p className={`subnet-verdict${c.same ? "" : " is-remote"}`} role="status">
                {prefix === 0 ? (
                  <><b>Same block, but only on paper.</b> With /0 every address ANDs to 0.0.0.0, so a device configured this way would try to reach every destination directly with ARP. Real hosts are never configured with /0; it is used only for the default route.</>
                ) : c.same ? (
                  <><b>Same subnet.</b> With /{prefix}, both results are {c.own}, so a device with this address delivers directly: it uses ARP to find the destination's own MAC address.</>
                ) : (
                  <><b>Different subnet.</b> The results differ, so a device with this address hands the packet to its default gateway, and uses ARP to find the gateway's MAC address, not the destination's.</>
                )}
              </p>
            </>
          ) : (
            <p className="subnet-wait" role="status">{address ? "Enter a valid destination address to compare." : "Correct the address and mask above to compare."}</p>
          )}
          <p className="subnet-caveat">
            This is only the arithmetic a device uses to choose between delivering directly and using its gateway. It does not prove the packet arrives: cables, ARP, routes and NAT decide that. <a {...linkProps("/practice/network")}>Try it in the network playground</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
