import {useEffect,useMemo,useState} from "react";
import {Background,Controls,MiniMap,ReactFlow,type Edge,type Node} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {KitabNode} from "./KitabNode";
import {layoutScene} from "./elk-layout";
import type {VisualScene} from "../core/schema";

const nodeTypes={kitab:KitabNode};
export function FlowCanvas({scene}:{scene:VisualScene}){const [nodes,setNodes]=useState<Node[]>([]),[edges,setEdges]=useState<Edge[]>([]);useEffect(()=>{let active=true;layoutScene(scene).then(x=>{if(active){setNodes(x.nodes);setEdges(x.edges)}});return()=>{active=false}},[scene]);const options=useMemo(()=>({hideAttribution:true}),[]);return <div className="kve-canvas"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{padding:.22}} nodesDraggable={false} nodesConnectable={false} elementsSelectable={true} proOptions={options}><Background color="#59452f" gap={24} size={1}/><MiniMap pannable zoomable nodeColor="#8f672c" maskColor="#15100bcc"/><Controls showInteractive={false}/></ReactFlow></div>}
