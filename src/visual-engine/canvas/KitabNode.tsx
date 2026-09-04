import {Handle,Position,type NodeProps} from "@xyflow/react";
import {Cpu,Globe2,Monitor,Package} from "lucide-react";

export function KitabNode({data}:NodeProps){const d=data as {kind:string;label:string;detail:string;focused:boolean};const Icon=d.kind==="computer"?Monitor:d.kind==="router"?Globe2:d.kind==="packet"?Package:Cpu;return <div className={`kve-node ${d.kind} ${d.focused?"focused":""}`}><Handle type="target" position={Position.Left}/><Icon/><span><b>{d.label}</b><small>{d.detail}</small></span><Handle type="source" position={Position.Right}/></div>}
