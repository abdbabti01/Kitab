// Scene for "Understanding IPv4 addresses and subnets". It draws the engine's example with Explore subnets' parts and
// the shared IPv4 helper, so the lesson and the explorer always show the same values. Predictions keep their state in
// the scene only: nothing is scored or stored.
import { useState } from "react";
import { Laptop, Router } from "lucide-react";
import type { Ipv4SubnetsData } from "../../learning/engines/ipv4-subnets.ts";
import { block, classify, formatAddress, maskOf, parseAddress, sameSubnet, toBinary } from "../../net/ipv4.ts";
import { blockStart, explorerPath, localQuestion, question } from "../../net/subnet-practice.ts";
import { BitRows, BlockFacts, PredictionCard } from "../../practice/SubnetParts.tsx";
import { linkProps } from "../../app/router.ts";
import { entity, SceneSection, type SceneProps } from "./common.tsx";
import "./ipv4-subnets.css";

type Props = SceneProps<Ipv4SubnetsData>;
const plain = (value: number) => toBinary(value).replace(/\./g, "");
const RANGES = ["10.0.0.1", "172.16.0.1", "192.168.0.1", "127.0.0.1", "169.254.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "100.64.0.1", "224.0.0.1"];
const RANGE_NAMES: Record<string, string> = { private: "Private", loopback: "Loopback", "link-local": "Link-local", documentation: "Documentation", shared: "Shared (carrier NAT)", multicast: "Multicast" };

function Chip({ id, props, label, children }: { id: string; props: Props; label: string; children: React.ReactNode }) {
  return <button {...entity(id, props, label, "v4-chip")}>{children}</button>;
}

function AddressRows({ address, prefix, mask = true, label = "Address" }: { address: string; prefix: number; mask?: boolean; label?: string }) {
  return (
    <>
      <div className="subnet-rowlabel"><span>{label}</span><code>{address}</code></div>
      <BitRows bits={plain(parseAddress(address))} prefix={prefix} values={address.split(".")} aria-hidden="true" />
      {mask && (
        <>
          <div className="subnet-rowlabel"><span>Mask</span><code>{formatAddress(maskOf(prefix))} (/{prefix})</code></div>
          <BitRows bits={plain(maskOf(prefix))} prefix={prefix} className="is-mask" aria-hidden="true" />
        </>
      )}
    </>
  );
}

/** A prediction inside the scene. Its attempt resets when the example or step changes; nothing is recorded. */
function Prediction({ props, kind }: { props: Props; kind: "network" | "local" }) {
  const d = props.frame.data;
  const key = `${props.trace.scenarioKey}:${props.frame.id}`;
  const [attempt, setAttempt] = useState({ key, tried: [] as number[], shown: false });
  const current = attempt.key === key ? attempt : { key, tried: [] as number[], shown: false };
  const q = kind === "network" ? question(d.address, d.prefix) : localQuestion(d.address, d.destination, d.prefix);
  const revealed = current.shown || current.tried.includes(q.choices.findIndex((c) => c.correct));
  return (
    <>
      <PredictionCard id={`lesson-${kind}`} question={q} attempt={current} revealed={revealed}
        onTry={(i) => setAttempt({ ...current, tried: [...current.tried, i] })} onShow={() => setAttempt({ ...current, shown: true })} />
      {revealed && kind === "network" && <BlockFacts address={d.address} prefix={d.prefix} />}
    </>
  );
}

function Verdict({ address, destination, prefix, who = "Your PC" }: { address: string; destination: string; prefix: number; who?: string }) {
  const same = sameSubnet(address, destination, prefix),
    mask = formatAddress(maskOf(prefix));
  return (
    <>
      <dl className="subnet-and">
        <dt>{who}</dt>
        <dd><code>{address} AND {mask} = {blockStart(block(address, prefix))}</code></dd>
        <dt>Destination</dt>
        <dd><code>{destination} AND {mask} = {blockStart(block(destination, prefix))}</code></dd>
      </dl>
      <p className={`subnet-verdict${same ? "" : " is-remote"}`}>
        {same ? <><b>Same subnet.</b> {who} delivers directly and uses ARP for the destination's MAC address.</> : <><b>Different subnet.</b> {who} hands the packet to its default gateway.</>}
      </p>
    </>
  );
}

export function Ipv4SubnetsScene(props: Props) {
  const d = props.frame.data,
    b = block(d.address, d.prefix),
    edge = Math.min(3, Math.floor(d.prefix / 8)),
    octet = Number(d.address.split(".")[edge]);
  let body: React.ReactNode;
  switch (d.view) {
    case "interface": {
      const c = classify(d.address);
      body = (
        <div className="v4-device">
          <Laptop aria-hidden="true" />
          <div>
            <b>Your PC · Wi-Fi interface</b>
            <Chip id="address" props={props} label="Inspect the address"><code>{d.address}/{d.prefix}</code></Chip>
            <small>{c.cidr ? `In ${c.cidr} (${c.source})` : "Not in a special-purpose range"}</small>
          </div>
        </div>
      );
      break;
    }
    case "octets":
      body = (
        <div className="v4-octets">
          {d.address.split(".").map((value, i) => <div key={i}><code>{value}</code><small>Octet {i + 1} · 8 bits</small></div>)}
        </div>
      );
      break;
    case "octet":
      body = (
        <table className="v4-places">
          <caption>Octet {edge + 1}: {octet}</caption>
          <tbody>
            <tr><th scope="row">Place value</th>{[128, 64, 32, 16, 8, 4, 2, 1].map((v) => <td key={v}>{v}</td>)}</tr>
            <tr><th scope="row">Bit</th>{[...octet.toString(2).padStart(8, "0")].map((bit, i) => <td key={i} className={edge * 8 + i < d.prefix ? "is-network" : "is-host"}>{bit}</td>)}</tr>
          </tbody>
        </table>
      );
      break;
    case "bits":
      body = <AddressRows address={d.address} prefix={32} mask={false} />;
      break;
    case "prefix":
    case "mask":
    case "third-octet":
      body = (
        <>
          <AddressRows address={d.address} prefix={d.prefix} mask={d.view !== "prefix"} />
          <p className="subnet-legend"><span><i className="subnet-swatch is-network" />Network bits: <b>{d.prefix}</b></span><span><i className="subnet-swatch is-host" />Host bits: <b>{32 - d.prefix}</b></span></p>
        </>
      );
      break;
    case "predict-network":
      body = <Prediction props={props} kind="network" />;
      break;
    case "and":
      body = (
        <>
          <AddressRows address={d.address} prefix={d.prefix} />
          <AddressRows address={blockStart(b)} prefix={d.prefix} mask={false} label="Address AND mask" />
        </>
      );
      break;
    case "block":
    case "third-octet-block":
      body = <><Chip id="block" props={props} label="Inspect the block"><code>{b.cidr}</code></Chip><BlockFacts address={d.address} prefix={d.prefix} /></>;
      break;
    case "special-blocks":
      body = (
        <div className="v4-specials">
          {([["203.0.113.6", 31], ["198.51.100.20", 32], ["0.0.0.0", 0]] as const).map(([ip, prefix]) => (
            <div key={prefix} className="v4-special"><h4>/{prefix}</h4><BlockFacts address={ip} prefix={prefix} /></div>
          ))}
        </div>
      );
      break;
    case "special-ranges": {
      const own = classify(d.address);
      body = (
        <table className="v4-ranges">
          <thead><tr><th scope="col">Range</th><th scope="col">Kind</th><th scope="col">Source</th></tr></thead>
          <tbody>
            {RANGES.map((ip) => classify(ip)).map((c) => (
              <tr key={c.cidr} className={c.cidr === own.cidr ? "is-own" : ""}><td><code>{c.cidr}</code></td><td>{RANGE_NAMES[c.range] ?? c.range}{c.cidr === own.cidr ? " · your address" : ""}</td><td>{c.source}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3}>{own.cidr ? `${d.address} is in ${own.cidr}.` : `${d.address} is in none of these ranges, which alone doesn't make it public or reachable.`}</td></tr></tfoot>
        </table>
      );
      break;
    }
    case "predict-local":
      body = <Prediction props={props} kind="local" />;
      break;
    case "compare":
      body = <><Chip id="verdict" props={props} label="Inspect the decision"><code>/{d.prefix}</code> decision</Chip><Verdict address={d.address} destination={d.destination} prefix={d.prefix} /></>;
      break;
    case "mismatch-pc":
      body = <Verdict address={d.address} destination={d.destination} prefix={d.prefix} who={`Your PC (/${d.prefix})`} />;
      break;
    case "mismatch-neighbour":
      body = <Verdict address={d.destination} destination={d.address} prefix={d.neighbourPrefix} who={`Neighbour (/${d.neighbourPrefix})`} />;
      break;
    case "mismatch-split":
      body = <><Verdict address={d.address} destination={d.destination} prefix={d.neighbourPrefix} who={`Your PC (/${d.neighbourPrefix})`} /><Verdict address={d.destination} destination={d.address} prefix={d.neighbourPrefix} who={`Neighbour (/${d.neighbourPrefix})`} /></>;
      break;
    case "p2p-link":
    case "p2p-compare":
      body = (
        <>
          <div className="v4-link">
            <span><Router aria-hidden="true" /><code>{d.address}/{d.prefix}</code></span>
            <i aria-hidden="true" />
            <span><Router aria-hidden="true" /><code>{d.destination}/{d.prefix}</code></span>
          </div>
          {d.view === "p2p-link" ? <BlockFacts address={d.address} prefix={d.prefix} /> : <Verdict address={d.address} destination={d.destination} prefix={d.prefix} who="Router A" />}
        </>
      );
      break;
  }
  return (
    <SceneSection label={props.frame.title} className="v4-scene">
      {body}
      <a className="v4-explore" {...linkProps(explorerPath({ address: d.address, prefix: d.prefix, destination: d.destination }))}>
        Open this example in Explore subnets: edit the bits yourself →
      </a>
    </SceneSection>
  );
}

export const ipv4SubnetsScene = { Scene: Ipv4SubnetsScene };
