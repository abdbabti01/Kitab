import type { RecursionFrameData } from "../../learning/engines/recursion.ts";
import { entity, SceneSection, type SceneProps } from "./common.tsx";

type Props = SceneProps<RecursionFrameData>;

function Scene(props: Props) {
  const { event, source } = props.frame.data;
  const limit = Number(props.trace.params.stackLimit);
  const depth = event.stack.length;
  return (
    <div className="rec-scene">
      <SceneSection label="Code" className="rec-code">
        <ol className="rec-lines">
          {source.map((line, index) => (
            <li className={`${event.line === index + 1 ? "is-current" : ""} ${line.trim().startsWith("//") ? "is-comment" : ""}`} key={index} aria-current={event.line === index + 1 ? "step" : undefined}>
              <span className="rec-line-no" aria-hidden="true">{index + 1}</span>
              <code>{line}</code>
            </li>
          ))}
        </ol>
      </SceneSection>
      <SceneSection label="Call stack (top first)" className="rec-stack">
        <div className={`rec-meter ${event.kind === "overflow" ? "is-overflow" : ""}`} role="img" aria-label={`${depth} of ${limit} frames used`}>
          <span style={{ width: `${Math.min(100, (depth / limit) * 100)}%` }} />
          <small>{depth} / {limit} frames</small>
        </div>
        <ol className="rec-frames">
          {[...event.stack].reverse().map((frame, index) => (
            <li key={frame.id} data-flip={frame.id}>
              <button {...entity(frame.id, props, `${frame.fn}(${frame.n}), ${frame.status}${frame.returnValue === undefined ? "" : `, returning ${frame.returnValue}`}${index === 0 ? ", top of stack" : ""}`, `rec-frame status-${frame.status}`)}>
                <b>{frame.fn}({frame.n})</b>
                <small>n = {frame.n}</small>
                <em>{frame.returnValue === undefined ? frame.status : `returns ${frame.returnValue}`}</em>
              </button>
            </li>
          ))}
          <li data-flip="main">
            <button {...entity("main", props, "main(), the caller", "rec-frame is-main")}>
              <b>main()</b>
              <small>caller</small>
              <em>{event.kind === "complete" && props.trace.outcome.status === "returned" ? `result = ${props.trace.outcome.result}` : event.kind === "overflow" || (event.kind === "complete" && props.trace.outcome.status === "overflow") ? "crashed" : "waiting"}</em>
            </button>
          </li>
        </ol>
        {event.returned && <p className="scene-caption">Returned value: <b>{event.returned.value}</b></p>}
      </SceneSection>
    </div>
  );
}

export const recursionScene = { Scene };
