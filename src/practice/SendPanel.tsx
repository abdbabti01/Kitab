// Choose what to send: source device, kind of traffic, destination and options.
import type { ReactNode } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import type { InputError } from "./useJourney.ts";
import type { Action, Network } from "./network/model.ts";

export function SendPanel({
  network,
  action,
  onAction,
  onSend,
  inputError,
  onClearError,
  onRestart,
  kinds = ["http", "ping", "dhcp"],
  children,
}: {
  network: Network;
  action: Action;
  onAction: (update: (a: Action) => Action) => void;
  onSend: () => void;
  inputError: InputError | null;
  onClearError: () => void;
  onRestart: () => void;
  /** Which kinds of traffic may be sent here. */
  kinds?: Action["kind"][];
  /** Extra controls under the options row. */
  children?: ReactNode;
}) {
  const labels: Record<Action["kind"], string> = {
    http: "HTTP · load a page",
    ping: "Ping · check reachability",
    dhcp: "DHCP · configure automatically",
  };
  return (
    <section className="send-panel" aria-label="Send traffic">
      <div className="send-title">
        <span className="step-marker">01</span>
        <div>
          <b>Send something</b>
          <small>Choose the app and where its message goes.</small>
        </div>
      </div>
      <div className="send-fields">
        <label>
          <span>From</span>
          <select
            aria-label="Source device"
            value={action.source}
            aria-invalid={inputError?.field === "source" || undefined}
            aria-describedby={inputError?.field === "source" ? "send-error" : undefined}
            onChange={(e) => {
              onClearError();
              onAction((a) => ({ ...a, source: e.target.value }));
            }}
          >
            <option value="" disabled>
              Choose a device
            </option>
            {network.devices
              .filter((d) => d.kind !== "switch" && d.kind !== "ap")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>Action</span>
          <select
            aria-label="Traffic type"
            value={action.kind}
            onChange={(e) => onAction((a) => ({ ...a, kind: e.target.value as Action["kind"] }))}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {labels[k]}
              </option>
            ))}
          </select>
        </label>
        {action.kind !== "dhcp" && (
          <label className="destination-field">
            <span>To</span>
            <input
              aria-label="Destination"
              value={action.target}
              aria-invalid={inputError?.field === "target" || undefined}
              aria-describedby={inputError?.field === "target" ? "send-error" : undefined}
              onChange={(e) => {
                onClearError();
                onAction((a) => ({ ...a, target: e.target.value }));
              }}
              placeholder={action.kind === "http" ? "http://kitab.test/" : "192.168.1.20"}
            />
          </label>
        )}
        <button className="button primary send-button" disabled={!action.source} onClick={onSend}>
          <ArrowRight size={17} /> {action.kind === "dhcp" ? "Configure automatically" : "Send request"}
        </button>
      </div>
      {inputError && (
        <p className="field-error" id="send-error" role="alert">
          {inputError.message}
        </p>
      )}
      <div className="send-options">
        {action.kind === "http" && (
          <label className="network-check">
            <input
              type="checkbox"
              checked={!!action.dropOnce}
              onChange={(e) => onAction((a) => ({ ...a, dropOnce: e.target.checked }))}
            />{" "}
            Drop one data segment
          </label>
        )}
        {action.kind !== "dhcp" && (
          <label className="ttl-input">
            Starting TTL{" "}
            <input
              aria-label="Starting TTL"
              type="number"
              min={1}
              max={255}
              value={action.ttl ?? 64}
              onChange={(e) =>
                onAction((a) => ({ ...a, ttl: Math.max(1, Math.min(255, Number(e.target.value) || 1)) }))
              }
            />
            <span>router hop limit</span>
          </label>
        )}
        <button className="text-button" onClick={onRestart}>
          <RotateCcw size={13} /> Restart simulation
        </button>
      </div>
      {children}
    </section>
  );
}
