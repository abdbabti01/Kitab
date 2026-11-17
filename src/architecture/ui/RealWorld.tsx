import { otherRoles, realComponents, valueKindLabel, type RealSetting } from "../real-world.ts";
import { ExampleBlock } from "../../ui/ExploreGuide.tsx";
import { components, COMPONENT_KINDS, type ComponentKind } from "../model.ts";


/** Where one setting lives in real systems, what changing it trades off, and how Kitab models it. Closed by default. */
export function RealSettingNote({ label, info }: { label: string; info: RealSetting }) {
  return (
    <details className="real-note">
      <summary>In a real system<span className="sr-only">: {label}</span></summary>
      <p className={`real-kind is-${info.kind}`}>{valueKindLabel[info.kind]}</p>
      <dl>
        <div><dt>Where it's set</dt><dd>{info.where}</dd></div>
        <div><dt>Changing it</dt><dd>{info.tradeoff}</dd></div>
        <div><dt>In Kitab</dt><dd>{info.model}</dd></div>
      </dl>
      {info.example && <ExampleBlock example={info.example} />}
    </details>
  );
}

/** What runs in this role in real systems, where, and how it talks to the rest. */
export function RealComponentNote({ kind }: { kind: ComponentKind }) {
  const real = realComponents[kind];
  return (
    <details className="modelled real-note">
      <summary>In a real system</summary>
      <dl>
        <div><dt>Typical software</dt><dd>{real.software}</dd></div>
        <div><dt>Where it runs</dt><dd>{real.runsOn}</dd></div>
        <div><dt>How it talks</dt><dd>{real.talks}</dd></div>
      </dl>
    </details>
  );
}

/** The roles on the palette as real servers, the common roles the simulator leaves out, and roles vs machines. */
export function ServerRoles() {
  return (
    <details className="server-roles">
      <summary>Server roles in real systems</summary>
      <p>Each box is a <b>role</b>, not a machine. One virtual machine can run a web server, the application and a database as separate processes; large systems give each role its own machines, containers or managed service.</p>
      <dl>
        {COMPONENT_KINDS.map((kind) => (
          <div key={kind}><dt>{components[kind].name}</dt><dd>{components[kind].role} <span className="muted">{realComponents[kind].software}</span></dd></div>
        ))}
      </dl>
      <p className="muted">Not in this simulator, but in most real systems:</p>
      <dl>
        {otherRoles.map((r) => <div key={r.name}><dt>{r.name}</dt><dd>{r.role} <span className="muted">{r.software}</span></dd></div>)}
      </dl>
    </details>
  );
}
