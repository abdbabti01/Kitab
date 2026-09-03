import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, Check, Database, Globe2, Server, Zap } from "lucide-react";
import type { ChapterMode } from "./curated";
import "./lesson-engines.css";

type Props={mode:ChapterMode;step:number;changed:boolean};

export function LessonEngine(props:Props){
 if(props.mode==="network"||props.mode==="dns"||props.mode==="request")return <NetworkEngine {...props}/>;
 if(props.mode==="array"||props.mode==="list"||props.mode==="hash")return <MemoryEngine {...props}/>;
 if(props.mode==="stack"||props.mode==="scheduler")return <ExecutionEngine {...props}/>;
 if(props.mode==="tree"||props.mode==="index")return <TreeEngine {...props}/>;
 return <DistributedEngine {...props}/>;
}

function NetworkEngine({mode,step,changed}:Props){
 const [protocol,setProtocol]=useState("TCP"),[latency,setLatency]=useState(45),[loss,setLoss]=useState(0);
 const layers=["Application","Transport","Internet","Link"];
 const senderPath=[1,1,1,0,1,2,3,-1,-1,-1,1,1,1];
 const receiverPath=[-1,-1,2,-1,-1,-1,-1,-1,0,2,2,2,2];
 const packetLost=changed||loss>20;
 return <div className="engine network-engine">
  <div className="engine-toolbar" aria-label="Network controls">
   <label>Protocol<select value={protocol} onChange={e=>setProtocol(e.target.value)}><option>TCP</option><option>UDP</option><option>QUIC</option></select></label>
   <label>Latency <b>{latency} ms</b><input aria-label="Latency" type="range" min="5" max="300" value={latency} onChange={e=>setLatency(+e.target.value)}/></label>
   <label>Loss <b>{loss}%</b><input aria-label="Packet loss" type="range" min="0" max="40" value={loss} onChange={e=>setLoss(+e.target.value)}/></label>
  </div>
  <div className="network-stage" style={{"--travel":`${Math.min(2.5,.45+latency/90)}s`} as React.CSSProperties}>
   <Computer name="Computer A" side="sender" layers={layers} active={senderPath[step]??-1}/>
   <div className="network-medium"><Globe2/><b>{mode==="dns"?"DNS hierarchy":mode==="request"?"Internet + services":"Routers"}</b><span>frames change · IP packet continues</span><div className={`live-packet ${packetLost?"lost":""}`}><small>{protocol}</small><b>{protocol==="UDP"?"DATAGRAM":"SEGMENT"}</b></div>{packetLost&&<em><AlertTriangle/> loss detected · {protocol==="UDP"?"application decides":"retransmitting"}</em>}</div>
   <Computer name="Computer B" side="receiver" layers={[...layers].reverse()} active={receiverPath[step]??-1}/>
  </div>
  <div className="packet-anatomy"><span>PAYLOAD</span><span className={step>=1?"on":""}>{protocol} HEADER</span><span className={step>=2?"on":""}>IP HEADER</span><span className={step>=3?"on":""}>LINK HEADER + TRAILER</span></div>
 </div>
}

function Computer({name,side,layers,active}:{name:string;side:string;layers:string[];active:number}){return <div className="engine-computer"><header><Server/><span><b>{name}</b><small>{side}</small></span></header>{layers.map((layer,i)=><div className={i===active?"layer active":"layer"} key={layer}><span>L{side==="sender"?4-i:i+1}</span><b>{layer}</b><small>{layer==="Application"?"HTTP bytes":layer==="Transport"?"ports · sequence · ACK":layer==="Internet"?"source + destination IP":"local frame + error check"}</small>{i===active&&<ArrowDown/>}</div>)}</div>}

function MemoryEngine({mode,step,changed}:Props){
 const values=mode==="list"?["HEAD","0x21 A","0x9F B","0x44 C","NULL"]:["12","24","31","48","55","67"];
 return <div className="engine memory-engine"><div className="memory-map"><div className="memory-ruler"><span>ADDRESS</span>{values.map((_,i)=><small key={i}>0x{(32+i*17).toString(16).toUpperCase()}</small>)}</div><div className={changed?"memory-cells changed":"memory-cells"}>{values.map((v,i)=><div className={i===Math.min(step,values.length-1)?"active":""} key={v}><small>{mode==="array"?`index ${i}`:mode==="hash"?`bucket ${i}`:"node"}</small><b>{mode==="hash"&&i===3?(changed?"fox · cat":"fox"):v}</b>{mode==="list"&&i<values.length-1&&<ArrowRight/>}</div>)}</div></div><div className="operation-cost"><span><b>READ</b><em>{mode==="array"?"O(1)":"O(n)"}</em></span><span><b>INSERT</b><em>{mode==="list"?"O(1) after locating":"O(n)"}</em></span><span><b>MEMORY</b><em>{mode==="list"?"scattered":"contiguous"}</em></span></div></div>
}

function ExecutionEngine({mode,step,changed}:Props){const lines=mode==="stack"?["factorial(3)","return 3 * factorial(2)","return 2 * factorial(1)","return 1"]:["ready: [A, B, C]","restore registers(A)","run A for 10ms","save A → dispatch B"];const active=Math.min(step,lines.length-1);return <div className="engine execution-engine"><div className="code-pane"><span>PROGRAM</span>{lines.map((x,i)=><code className={i===active?"active":""} key={x}><i>{i+1}</i>{x}</code>)}</div><div className="execution-arrow"><Zap/><span>one step</span></div><div className={changed?"frame-pane overflow":"frame-pane"}><span>{mode==="stack"?"CALL STACK":"CPU STATE"}</span>{lines.slice(0,active+1).reverse().map((x,i)=><div className={i===0?"active":""} key={x}><b>{mode==="stack"?`frame ${active-i+1}`:`context ${String.fromCharCode(65+i)}`}</b><small>{x}</small></div>)}{changed&&<em><AlertTriangle/> {mode==="stack"?"No base case: stack keeps growing":"Too many switches: useful work falls"}</em>}</div></div>}

function TreeEngine({mode,step,changed}:Props){const nodes=changed?[8,12,14,16,18]:[8,4,12,2,7,10,14];const visited=mode==="index"?[0,1,4]:[0,1,4];return <div className="engine tree-engine"><svg viewBox="0 0 700 390" role="img" aria-label={mode==="index"?"B-tree index traversal":"Binary search tree traversal"}>{!changed&&<g className="edges"><path d="M350 70 L210 170 M350 70 L490 170 M210 170 L120 285 M210 170 L285 285 M490 170 L420 285 M490 170 L580 285"/></g>}{changed&&<g className="edges"><path d="M100 55 L220 120 L340 185 L460 250 L580 315"/></g>}{nodes.map((n,i)=>{const balanced=[[350,55],[210,165],[490,165],[120,280],[285,280],[420,280],[580,280]][i];const chain=[100+i*120,55+i*65];const [x,y]=changed?chain:balanced;return <g className={visited.slice(0,step+1).includes(i)?"tree-node active":"tree-node"} transform={`translate(${x} ${y})`} key={n}><circle r="34"/><text textAnchor="middle" dy="6">{n}</text></g>})}</svg><div className="tree-readout"><b>{changed?"Unbalanced path":"Search path"}</b><span>{changed?"8 → 12 → 14 → 16 → 18":"8 → 4 → 7"}</span><em>{changed?"O(n) worst case":"O(log n) when balanced"}</em></div></div>}

function DistributedEngine({step,changed}:Props){const services=[{name:"Browser",icon:<Globe2/>},{name:"API",icon:<Server/>},{name:"Cache",icon:<Zap/>},{name:"Database",icon:<Database/>}];return <div className="engine distributed-engine"><div className="service-flow">{services.map((s,i)=><div className={i===Math.min(step,3)?"service active":"service"} key={s.name}>{s.icon}<b>{s.name}</b><small>{changed&&i===2?"MISS":"healthy"}</small>{i<3&&<ArrowRight/>}</div>)}</div><div className="trace"><span>REQUEST TRACE</span>{services.slice(0,Math.min(step+1,4)).map((s,i)=><p key={s.name}><i>{i+1}</i><b>{s.name}</b><em>{changed&&i===2?"fallback to database":"completed"}</em><Check/></p>)}</div></div>}
