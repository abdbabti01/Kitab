import { ArrowDown, ArrowRight, Globe2, Laptop, Router, Smartphone } from "lucide-react";
import type { IpAddressingData } from "../../learning/engines/ip-addressing.ts";
import { entity, SceneSection, type SceneProps } from "./common.tsx";
import "./ip-addressing.css";

type Props = SceneProps<IpAddressingData>;

function Lan({ props }: { props: Props }) {
  const data = props.frame.data;
  const showWan = data.view === "interfaces";
  return (
    <SceneSection label={showWan ? "Two interfaces on one router" : "Your home LAN"} className="ip-scene">
      <div className="ip-lan">
        <span className="ip-tag">Local network</span>
        <div className="ip-devices">
          <button {...entity("client", props, "PC Wi-Fi interface", "ip-node")}><Laptop aria-hidden="true" /><b>PC</b><code>{data.client}</code></button>
          <button {...entity("phone", props, "Phone Wi-Fi interface", "ip-node")}><Smartphone aria-hidden="true" /><b>Phone</b><code>{data.phone}</code></button>
          <button {...entity("gateway", props, "Router LAN interface", "ip-node")}><Router aria-hidden="true" /><b>Router · LAN</b><code>{data.gateway}</code></button>
        </div>
        <p className="ip-caption">Wi-Fi or Ethernet carries frames between local devices.</p>
      </div>
      {showWan && <div className="ip-wan"><Globe2 aria-hidden="true" /><span>Same router · WAN interface <code>{data.natPublic}</code></span><ArrowRight aria-hidden="true" /><span>Toward the ISP</span></div>}
    </SceneSection>
  );
}

function BitRow({ label, address, prefix }: { label: string; address: string; prefix: number }) {
  const octets = address.split(".").map((octet) => Number(octet).toString(2).padStart(8, "0"));
  return (
    <div className="ip-bit-row">
      <div><b>{label}</b><code>{address}</code></div>
      <div className="ip-bits" aria-label={octets.join(" ")}>
        {octets.map((octet, index) => (
          <span className="ip-octet" key={index} aria-hidden="true">
            {Array.from(octet, (bit, bitIndex) => <span className={index * 8 + bitIndex < prefix ? "ip-prefix-bit" : "ip-host-bit"} key={bitIndex}>{bit}</span>)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ConnectedSubnet({ props }: { props: Props }) {
  const { client, connectedSubnet, destination, direct } = props.frame.data;
  return (
    <SceneSection label="Which addresses belong to the PC’s subnet?" className="ip-scene">
      <div className="ip-parent-range">
        <button {...entity("subnet", props, "Inspect the PC's subnet", "ip-inspect")}><code>{connectedSubnet.cidr}</code></button>
        <span>{connectedSubnet.total} addresses</span>
        <small>{connectedSubnet.network} – {connectedSubnet.broadcast}</small>
      </div>
      <div className="ip-results">
        <div><span>PC address</span><code>{client}</code><small>Inside this subnet</small></div>
        <div><span>{destination.label} address</span><code>{destination.address}</code><small>{direct ? "Inside this subnet" : "Outside this subnet"}</small></div>
      </div>
    </SceneSection>
  );
}

function Address({ props }: { props: Props }) {
  const data = props.frame.data;
  const compare = data.view === "mask";
  return (
    <SceneSection label={compare ? "Bitwise AND, then compare" : "Read the address in bits"} className="ip-scene">
      <div className="ip-legend"><span className="ip-tag">Prefix · {data.prefix} bits</span><span className="ip-tag ip-tag-muted">Host part · {32 - data.prefix} bits</span></div>
      <BitRow label="PC address" address={data.client} prefix={data.prefix} />
      {compare && <BitRow label={data.destination.label} address={data.destination.address} prefix={data.prefix} />}
      <button {...entity("mask", props, `Inspect subnet mask ${data.mask}`, "ip-inspect")}>Subnet mask <code>{data.mask}</code></button>
      {compare && <>
        <BitRow label="Mask" address={data.mask} prefix={data.prefix} />
        <p className="ip-caption">Mask bit <b>1</b> keeps the address bit. Mask bit <b>0</b> turns it into zero.</p>
        <div className="ip-results">
          <div><span>PC AND mask</span><code>{data.clientNetwork}</code></div>
          <div><span>Destination AND mask</span><code>{data.destinationNetwork}</code></div>
        </div>
        <p className="ip-result">{data.direct ? "Same result → same subnet" : "Different results → outside the PC’s subnet"}</p>
      </>}
      {!compare && <p className="ip-caption">Each box is one octet. The slash in <code>{data.client}/{data.prefix}</code> tells you where the prefix ends.</p>}
    </SceneSection>
  );
}

function Ranges({ props }: { props: Props }) {
  const { original, split, prefix } = props.frame.data;
  return (
    <SceneSection label="The same address range, split in half" className="ip-scene">
      <button {...entity("ranges", props, "Inspect the subnet ranges", "ip-inspect")}>Compare /24 and /25</button>
      <div className="ip-parent-range">
        <b>{original.cidr}</b><span>{original.total} addresses</span>
        <small>{original.network} – {original.broadcast}</small>
      </div>
      <ArrowDown className="ip-down" aria-hidden="true" />
      <div className="ip-split">
        {split.map((block, index) => (
          <div key={block.cidr}>
            <span className="ip-tag">New bit is {index}</span>
            <b>{block.cidr}</b>
            <small>Network <code>{block.network}</code></small>
            <small>Hosts <code>{block.firstHost}</code>–<code>{block.lastHost}</code></small>
            <small>Broadcast <code>{block.broadcast}</code></small>
          </div>
        ))}
      </div>
      <p className="ip-caption">This example currently uses <code>/{prefix}</code>. Change it below the step controls and compare the route to the printer.</p>
    </SceneSection>
  );
}

function Route({ props }: { props: Props }) {
  const { view, destination, direct, nextHop, nextHopMac, gateway, clientNetwork, prefix } = props.frame.data;
  const hopLabel = direct ? destination.label : "Home router";
  return (
    <SceneSection label={view === "routes" ? "Inside the PC’s routing table" : "Packet destination and local recipient"} className="ip-scene">
      {view === "routes" && <table className="ip-table">
        <thead><tr><th scope="col">Route</th><th scope="col">Deliver to</th><th scope="col">Decision</th></tr></thead>
        <tbody>
          <tr className={direct ? "ip-chosen" : undefined}><td><code>{clientNetwork}/{prefix}</code></td><td>Destination</td><td>{direct ? "Selected" : "Outside this prefix"}</td></tr>
          <tr className={!direct ? "ip-chosen" : undefined}><td><code>0.0.0.0/0</code></td><td><code>{gateway}</code></td><td>{direct ? "Less specific" : "Selected"}</td></tr>
        </tbody>
      </table>}
      <div className="ip-results">
        <div><span>Packet destination</span><code>{destination.address}</code><small>{destination.label}</small></div>
        <div><span>Next hop on this link</span><code>{nextHop}</code><small>{hopLabel}</small></div>
      </div>
      <button {...entity("route", props, "Inspect the chosen route", "ip-inspect")}>{direct ? "Direct on the LAN" : "Via the default gateway"}</button>
      {view === "link" && <p className="ip-caption">Local frame destination MAC <code>{nextHopMac}</code>. Inside the frame, the packet still targets <code>{destination.address}</code>.</p>}
    </SceneSection>
  );
}

function Translation({ props }: { props: Props }) {
  const data = props.frame.data;
  const packet = data.packet!;
  const changedField = data.view === "nat-out" ? 0 : 1;
  return (
    <SceneSection label={changedField === 0 ? "Outgoing web request" : "Returning web response"} className="ip-scene">
      <table className="ip-table ip-packet">
        <thead><tr><th scope="col">At router</th><th scope="col">Source IP:port</th><th scope="col">Destination IP:port</th></tr></thead>
        <tbody>
          <tr><th scope="row">Before</th>{packet.before.map((endpoint) => <td key={endpoint}><code>{endpoint}</code></td>)}</tr>
          <tr><th scope="row">After</th>{packet.after.map((endpoint, index) => <td key={endpoint} className={index === changedField ? "ip-chosen" : undefined}><code>{endpoint}</code></td>)}</tr>
        </tbody>
      </table>
      <button {...entity("nat", props, "Inspect the NAT table", "ip-inspect")}><Router aria-hidden="true" size={16} /> Router NAT table</button>
      <table className="ip-table">
        <thead><tr><th scope="col">Device</th><th scope="col">Private IP:port</th><th scope="col">Outside IP:port</th></tr></thead>
        <tbody>{data.natEntries.map((entry) => (
          <tr key={entry.device} className={entry.device === "PC" ? "ip-chosen" : undefined}><th scope="row">{entry.device}</th><td><code>{entry.inside}</code></td><td><code>{entry.outside}</code></td></tr>
        ))}</tbody>
      </table>
      <p className="ip-caption">The PC and phone use the same outside IP. The different outside ports let the router tell their connections apart.</p>
    </SceneSection>
  );
}

function Scene(props: Props) {
  switch (props.frame.data.view) {
    case "lan":
    case "interfaces": return <Lan props={props} />;
    case "subnet": return <ConnectedSubnet props={props} />;
    case "address":
    case "mask": return <Address props={props} />;
    case "ranges": return <Ranges props={props} />;
    case "routes":
    case "link": return <Route props={props} />;
    case "nat-out":
    case "nat-in": return <Translation props={props} />;
    case "handoff": return (
      <SceneSection label="In the recorded C# walkthrough" className="ip-scene">
        <button {...entity("route", props, "Inspect the simulated route lookup", "ip-inspect")}><code>Ipv4.LookupRoute()</code></button>
        <dl className="ip-handoff">
          {props.frame.facts.slice(0, 2).map((fact) => <div key={fact.id}><dt>{fact.label}</dt><dd><code>{fact.value}</code></dd></div>)}
        </dl>
        <p className="ip-caption">In Packet Journey, click <b>Watch first request chunk</b>, then <b>Step</b> twice to reach “Look up the next hop.” Open <b>C# source</b> to see the method.</p>
      </SceneSection>
    );
  }
}

export const ipAddressingScene = { Scene };
