import type {VisualScene} from "../core/schema";

export type TcpState="CLOSED"|"SYN-SENT"|"SYN-RECEIVED"|"ESTABLISHED";
export type TcpEvent={id:string;title:string;narration:string;packet?:{label:string;seq:number;ack?:number;flags:string[];from:"client"|"server"};client:TcpState;server:TcpState};

export const tcpEvents:TcpEvent[]=[
 {id:"closed",title:"Choose the endpoints",narration:"The browser chooses temporary port 52491 and targets the server on port 443.",client:"CLOSED",server:"CLOSED"},
 {id:"syn",title:"Client sends SYN",narration:"The client proposes initial sequence number 1000. SYN consumes one sequence number.",packet:{label:"SYN",seq:1000,flags:["SYN"],from:"client"},client:"SYN-SENT",server:"CLOSED"},
 {id:"syn-ack",title:"Server replies SYN-ACK",narration:"ACK 1001 confirms the client's SYN. The server proposes its own initial sequence number 5000.",packet:{label:"SYN · ACK",seq:5000,ack:1001,flags:["SYN","ACK"],from:"server"},client:"SYN-SENT",server:"SYN-RECEIVED"},
 {id:"ack",title:"Client completes the handshake",narration:"ACK 5001 confirms the server's SYN. Both endpoints can now exchange bytes.",packet:{label:"ACK",seq:1001,ack:5001,flags:["ACK"],from:"client"},client:"ESTABLISHED",server:"ESTABLISHED"},
 {id:"data",title:"Send application bytes",narration:"The first data segment begins at sequence 1001 and contains 1460 bytes, so the receiver will expect byte 2461 next.",packet:{label:"DATA",seq:1001,ack:5001,flags:["ACK","PSH"],from:"client"},client:"ESTABLISHED",server:"ESTABLISHED"},
 {id:"data-ack",title:"Acknowledge the byte range",narration:"ACK 2461 means every client byte through 2460 arrived contiguously.",packet:{label:"ACK",seq:5001,ack:2461,flags:["ACK"],from:"server"},client:"ESTABLISHED",server:"ESTABLISHED"}
];

export function tcpScene(event:TcpEvent):VisualScene{return {version:1,id:event.id,title:event.title,narration:event.narration,focus:[event.packet?.from||""],nodes:[{id:"client",kind:"computer",label:"Client",detail:`192.168.1.8:52491 · ${event.client}`,width:210,height:110},{id:"router-a",kind:"router",label:"Gateway",detail:"Forwards using destination IP",width:160,height:82},{id:"router-b",kind:"router",label:"Internet router",detail:"Reframes packet for next link",width:175,height:82},{id:"server",kind:"computer",label:"Server",detail:`203.0.113.10:443 · ${event.server}`,width:210,height:110}],edges:[{id:"c-r1",source:"client",target:"router-a",label:"Ethernet"},{id:"r1-r2",source:"router-a",target:"router-b",label:"IP route"},{id:"r2-s",source:"router-b",target:"server",label:"Ethernet"}]}}
