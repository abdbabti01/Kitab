import {z} from "zod";

export const VisualNodeSchema=z.object({id:z.string().min(1),kind:z.enum(["computer","router","service","packet"]),label:z.string().min(1).max(40),detail:z.string().max(120),width:z.number().min(120).max(280).default(180),height:z.number().min(64).max(180).default(92)});
export const VisualEdgeSchema=z.object({id:z.string().min(1),source:z.string().min(1),target:z.string().min(1),label:z.string().max(32).optional()});
export const SceneSchema=z.object({version:z.literal(1),id:z.string().min(1),title:z.string().min(1),narration:z.string().min(1),nodes:z.array(VisualNodeSchema).min(2).max(30),edges:z.array(VisualEdgeSchema).max(60),focus:z.array(z.string()).default([])}).superRefine((scene,ctx)=>{const ids=new Set(scene.nodes.map(n=>n.id));for(const edge of scene.edges)if(!ids.has(edge.source)||!ids.has(edge.target))ctx.addIssue({code:"custom",message:`Edge ${edge.id} references a missing node`});});
export type VisualScene=z.infer<typeof SceneSchema>;

export function parseScene(input:unknown){return SceneSchema.parse(input)}
