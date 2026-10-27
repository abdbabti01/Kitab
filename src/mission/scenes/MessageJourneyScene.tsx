import { bits, codePointLabel, hex, hosts, routers, type JourneyLevel, type NodeId, type Unit } from "../../visual-engine/engines/protocols/message-journey.ts";
import type { MessageJourneyData } from "../../learning/engines/message-journey.ts";
import { entity, type SceneProps } from "./common.tsx";

type Props = SceneProps<MessageJourneyData>;

const levels: { id: JourneyLevel; name: string; short: string }[] = [
  { id: "application", name: "Application", short: "App" },
  { id: "transport", name: "Transport", short: "TCP" },
  { id: "network", name: "Network", short: "IP" },
  { id: "link", name: "Link", short: "Link" },
];

const columns: ({ kind: "node"; id: NodeId; name: string; detail: string } | { kind: "link"; id: "link-1" | "link-2" | "link-3" })[] = [
  { kind: "node", id: "a", name: "Computer A", detail: hosts.a.iface.ip },
  { kind: "link", id: "link-1" },
  { kind: "node", id: "r1", name: "Router R1", detail: "forwards" },
  { kind: "link", id: "link-2" },
  { kind: "node", id: "r2", name: "Router R2", detail: "forwards" },
  { kind: "link", id: "link-3" },
  { kind: "node", id: "b", name: "Computer B", detail: hosts.b.iface.ip },
];

const isRouter = (id: NodeId) => id === "r1" || id === "r2";

function Wrappers({ unit }: { unit: Unit }) {
  return (
    <span className="mj-wrappers" aria-hidden="true">
      {unit.link && <i data-wrapper="link">LINK</i>}
      {unit.ip && <i data-wrapper="ip">IP</i>}
      {unit.tcp && <i data-wrapper="tcp">TCP</i>}
      {unit.app && <i data-wrapper="data">{unit.app.length} B</i>}
    </span>
  );
}

function UnitGlyph({ unit, props }: { unit: Unit; props: Props }) {
  const id = `unit-${unit.id}`;
  const flags = unit.tcp ? ` ${unit.tcp.flags.join("+")}` : "";
  return (
    <button {...entity(id, props, `${unit.label}${flags}${unit.dropped ? ", discarded" : ""}`, `mj-unit dir-${unit.direction} ${unit.dropped ? "is-dropped" : ""} ${unit.link?.checksum === "corrupted" ? "is-corrupt" : ""}`, "unit")}>
      <b>{unit.tcp && !unit.app ? unit.tcp.flags.join("-") : unit.label}</b>
      <Wrappers unit={unit} />
    </button>
  );
}

function EndpointBadge({ side, props }: { side: "a" | "b"; props: Props }) {
  const s = props.frame.data.event.snapshot[side];
  return (
    <button {...entity(`endpoint-${side}`, props, `${side.toUpperCase()}'s TCP, state ${s.state}`, "mj-endpoint")}>
      <span>{side === "a" ? "A's" : "B's"} TCP · port {hosts[side].port}</span>
      <b>{s.state}</b>
      {s.rcvNxt !== null && <small>expects {s.rcvNxt}</small>}
    </button>
  );
}

function Cell({ node, level, props }: { node: NodeId; level: JourneyLevel; props: Props }) {
  const { event } = props.frame.data;
  const unit = event.snapshot.unit;
  const here = unit && unit.at === node && unit.level === level;
  const absent = isRouter(node) && (level === "application" || level === "transport");
  const acting = event.node === node && event.level === level;
  return (
    <div className={`mj-cell ${absent ? "is-absent" : ""} ${acting ? "is-acting" : ""}`} data-level={level}>
      {absent ? <span className="mj-none">none</span> : null}
      {!absent && level === "transport" && (node === "a" || node === "b") && <EndpointBadge side={node} props={props} />}
      {!absent && level === "network" && isRouter(node) && (
        <button {...entity(node, props, `${routers[node].name}, forwarding table`, "mj-router")}>
          <span>{routers[node].name.replace("Router ", "")}</span>
          <small>forwarding</small>
        </button>
      )}
      {here && <UnitGlyph unit={unit} props={props} />}
    </div>
  );
}

function MessageStrip({ props }: { props: Props }) {
  const { encoding, event } = props.frame.data;
  const s = event.snapshot;
  const selectedByte = props.selected?.startsWith("byte-") ? Number(props.selected.slice(5)) : props.selected?.startsWith("char-") ? encoding.characters[Number(props.selected.slice(5))]?.byteStart : null;
  const focusedBytes = new Set(props.frame.focus.filter((id) => id.startsWith("byte-")).map((id) => Number(id.slice(5))));
  const shownBits = selectedByte ?? (focusedBytes.size ? Math.min(...focusedBytes) : null);
  return (
    <div className="mj-message">
      <div className="mj-program">
        <button {...entity("program-a", props, `Chat program A, message ${encoding.text}`, "mj-program-head")}>
          <span>Chat program A</span>
          <small>{s.a.written ? `${s.a.written} bytes handed to TCP` : "your message"}</small>
        </button>
        <p className="mj-compact-text" aria-hidden="true">{encoding.text}</p>
        <ol className="mj-chars" aria-label="Characters">
          {encoding.characters.map((char) => (
            <li key={char.index}>
              <button {...entity(`char-${char.index}`, props, `Character ${char.char}, ${codePointLabel(char.codePoint)}${s.encoded ? `, ${char.byteCount} byte${char.byteCount === 1 ? "" : "s"}` : ""}`, `mj-char span-${char.byteCount}`)} style={s.encoded ? { flexGrow: char.byteCount } : undefined}>
                <b>{char.char === " " ? "␠" : char.char}</b>
                {s.encoded && <small>{char.byteCount} B</small>}
              </button>
            </li>
          ))}
        </ol>
        {s.encoded && (
          <>
            <ol className="mj-bytes" aria-label="UTF-8 bytes">
              {encoding.bytes.map((item) => (
                <li key={item.index} style={{ flexGrow: 1 }}>
                  <button {...entity(`byte-${item.index}`, props, `Byte ${item.index + 1}: ${item.value}, ${hex(item.value)}, bits ${bits(item.value)}`, `mj-byte role-${item.role} ${shownBits === item.index ? "is-shown" : ""}`, `byte-${item.index}`)}>
                    <b>{item.value}</b>
                    <small>{hex(item.value)}</small>
                  </button>
                </li>
              ))}
            </ol>
            {shownBits !== null && encoding.bytes[shownBits] && (
              <p className="mj-bits" aria-live="polite">
                <span>Byte {shownBits + 1} = {encoding.bytes[shownBits].value} =</span>
                <span className="mj-bit-row" aria-label={`bits ${bits(encoding.bytes[shownBits].value)}`}>
                  {[...bits(encoding.bytes[shownBits].value)].map((bit, index) => <i key={index} data-bit={bit}>{bit}</i>)}
                </span>
              </p>
            )}
          </>
        )}
      </div>
      <div className="mj-program is-receiver">
        <button {...entity("program-b", props, `Chat program B${s.b.text ? `, received ${s.b.text}` : ", nothing received yet"}`, "mj-program-head")}>
          <span>Chat program B</span>
          <small>{s.b.buffer.length ? `${s.b.buffer.length} bytes waiting in TCP` : "inbox"}</small>
        </button>
        <p className={`mj-inbox ${s.b.text ? "has-text" : ""}`}>{s.b.text ?? "Nothing yet"}</p>
      </div>
    </div>
  );
}

function UnitDetail({ props }: { props: Props }) {
  const unit = props.frame.data.event.snapshot.unit;
  if (!unit) return <p className="mj-detail-empty">Nothing is moving at this step.</p>;
  return (
    <ol className={`mj-layers-strip ${unit.dropped ? "is-dropped" : ""}`} aria-label={`${unit.label}: wrappers, outermost first`}>
      {unit.link && (
        <li>
          <button {...entity("hdr-link", props, "Link header", "mj-hdr hdr-link")}>
            <b>Link header</b>
            <small>to {unit.link.dst}</small>
          </button>
        </li>
      )}
      {unit.ip && (
        <li>
          <button {...entity("hdr-ip", props, "IP header", "mj-hdr hdr-ip")}>
            <b>IP header</b>
            <small>{unit.ip.src} → {unit.ip.dst} · TTL {unit.ip.ttl}</small>
          </button>
        </li>
      )}
      {unit.tcp && (
        <li>
          <button {...entity("hdr-tcp", props, "TCP header", "mj-hdr hdr-tcp")}>
            <b>TCP header</b>
            <small>{unit.tcp.srcPort} → {unit.tcp.dstPort} · seq {unit.tcp.seq}{unit.tcp.ack !== null ? ` · ack ${unit.tcp.ack}` : ""}</small>
          </button>
        </li>
      )}
      {unit.app && (
        <li className="mj-data">
          <b>Data</b>
          <small>{unit.app.length} bytes: {unit.app.join(" ")}</small>
        </li>
      )}
      {unit.link && (
        <li className="mj-trailer">
          <b>{unit.link.padding ? `+${unit.link.padding} pad · ` : ""}checksum</b>
          <small>{unit.link.checksum === "ok" ? "ok" : "damaged"} · {unit.link.frameBytes} B total</small>
        </li>
      )}
    </ol>
  );
}

function Scene(props: Props) {
  const { event } = props.frame.data;
  const unit = event.snapshot.unit;
  return (
    <div className={`mj-scene ${props.frame.level === "application" ? "" : "is-compact-message"}`}>
      <MessageStrip props={props} />
      <div className="mj-map" role="group" aria-label="The two computers, the routers between them and their levels">
        <div className="mj-corner" aria-hidden="true" />
        {columns.map((column) =>
          column.kind === "node" ? (
            <div className={`mj-col-head ${event.node === column.id ? "is-acting" : ""}`} key={column.id}>
              <b>{column.name}</b>
              <small>{column.detail}</small>
            </div>
          ) : (
            <div className="mj-link-head" key={column.id}>
              <button {...entity(column.id, props, `Link ${column.id.at(-1)}`, "mj-link-name")}>{column.id.at(-1)}</button>
            </div>
          ),
        )}
        {levels.map((level) => (
          <div className={`mj-row ${props.frame.level === level.id ? "is-current" : ""}`} key={level.id} data-level={level.id}>
            <div className="mj-row-name"><b>{level.name}</b><b className="mj-short" aria-hidden="true">{level.short}</b></div>
            {columns.map((column) =>
              column.kind === "node" ? (
                <Cell node={column.id} level={level.id} props={props} key={column.id} />
              ) : (
                <div className={`mj-wire ${level.id === "link" ? "is-cable" : ""} ${unit?.at === column.id ? "is-busy" : ""}`} key={column.id}>
                  {level.id === "link" && unit?.at === column.id && <UnitGlyph unit={unit} props={props} />}
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      <div className={`mj-path ${unit?.at === "path" ? "is-busy" : ""}`}>
        <span>{unit?.at === "path" ? (unit.direction === "a-to-b" ? "A → B: crossing the network inside an IP packet" : "B → A: crossing the network inside an IP packet") : "Network path (shown in detail in “Across the network”)"}</span>
        {unit?.at === "path" && <UnitGlyph unit={unit} props={props} />}
      </div>
      <div className="mj-detail">
        <h3 className="scene-label">{unit ? `What is moving: ${unit.label}` : "What is moving"}</h3>
        <UnitDetail props={props} />
      </div>
    </div>
  );
}

export const messageJourneyScene = { Scene };
