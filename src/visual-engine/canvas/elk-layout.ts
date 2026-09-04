import ELK from "elkjs/lib/elk.bundled.js";
import type {Edge,Node} from "@xyflow/react";
import type {VisualScene} from "../core/schema";

const elk=new ELK();
export async function layoutScene(scene:VisualScene):Promise<{nodes:Node[];edges:Edge[]}>{const graph=await elk.layout({id:"root",layoutOptions:{"elk.algorithm":"layered","elk.direction":"RIGHT","elk.spacing.nodeNode":"70","elk.layered.spacing.nodeNodeBetweenLayers":"110","elk.edgeRouting":"ORTHOGONAL"},children:scene.nodes.map(n=>({id:n.id,width:n.width,height:n.height})),edges:scene.edges.map(e=>({id:e.id,sources:[e.source],targets:[e.target]}))});return {nodes:(graph.children||[]).map(n=>{const source=scene.nodes.find(x=>x.id===n.id)!;return{id:n.id!,position:{x:n.x||0,y:n.y||0},type:"kitab",data:{...source,focused:scene.focus.includes(n.id!)}}}),edges:scene.edges.map(e=>({id:e.id,source:e.source,target:e.target,label:e.label,type:"smoothstep",animated:true,style:{stroke:"#b78639",strokeWidth:2},labelStyle:{fill:"#d8c39f",fontSize:11}}))}}
