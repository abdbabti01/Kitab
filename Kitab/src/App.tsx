"use client";
import { createContext, useContext, useState } from "react";
import { ArrowRight, Box, Braces, Database, Network, Play, RotateCcw, Route, Sparkles } from "lucide-react";

const TabsContext=createContext({value:"",setValue:(_value:string)=>{}});
function Tabs({defaultValue,children}:{defaultValue:string,children:React.ReactNode}){const [value,setValue]=useState(defaultValue);return <TabsContext.Provider value={{value,setValue}}><div>{children}</div></TabsContext.Provider>}
function TabsList({children,className=""}:{children:React.ReactNode,className?:string}){return <div className={className} role="tablist">{children}</div>}
function TabsTrigger({value,children}:{value:string,children:React.ReactNode}){const tabs=useContext(TabsContext);return <button role="tab" aria-selected={tabs.value===value} data-state={tabs.value===value?"active":"inactive"} onClick={()=>tabs.setValue(value)}>{children}</button>}
function TabsContent({value,children,className=""}:{value:string,children:React.ReactNode,className?:string}){const tabs=useContext(TabsContext);return tabs.value===value?<section className={className} role="tabpanel">{children}</section>:null}

const requests=[
 ["01","You enter a URL","The browser reads the address and identifies the website you want."],
 ["02","DNS finds the server","DNS translates the website name into an IP address computers can use."],
 ["03","A connection opens","Your browser and the server create a reliable TCP connection."],
 ["04","The request travels","An HTTP request asks the server for the page you chose."],
 ["05","The server responds","The server returns HTML, CSS, JavaScript, and other files."],
 ["06","The page appears","The browser arranges and paints those files on your screen."],
];
const structures={array:{label:"Array",note:"Quick access by position",items:["A","B","C","D"]},stack:{label:"Stack",note:"Last in, first out — like plates",items:["1","2","3","4"]},queue:{label:"Queue",note:"First in, first out — like a line",items:["Ana","Leo","Mia","Sam"]}};

export default function Home(){
 const [tcp,setTcp]=useState(0),[request,setRequest]=useState(0),[structure,setStructure]=useState<keyof typeof structures>("array");
 const packets=[["SYN","Can we talk?","client"],["SYN + ACK","Yes — I heard you.","server"],["ACK","Great. Connection ready!","client"]];
 return <main>
  <header className="topbar"><a className="brand" href="#top"><span><Braces/></span>Code Atlas</a><nav><a href="#explorer">Explore</a><a href="#how">How it works</a></nav><div className="pill"><Sparkles/>Beginner mode</div></header>
  <section id="top" className="intro"><div><p className="eyebrow">Computer science, made visible</p><h1>Don’t just read it.<br/><em>See how it works.</em></h1></div><p>Explore the invisible systems behind every click, request, and line of code—with interactive models you control.</p></section>
  <section id="explorer" className="lab"><div className="lab-head"><div><small>01</small><p className="eyebrow">Choose a concept</p><h2>Open the machine</h2></div><p>Press the controls, watch each step, and connect the animation to the plain-English explanation.</p></div>
   <Tabs defaultValue="tcp"><TabsList className="tabs"><TabsTrigger value="tcp"><Network/>TCP handshake</TabsTrigger><TabsTrigger value="request"><Route/>Web request</TabsTrigger><TabsTrigger value="data"><Database/>Data structures</TabsTrigger></TabsList>
    <TabsContent value="tcp" className="lesson"><div className="stage tcp"><Device icon="●" title="Your browser" sub="Client"/><div className="lane"><i/>{packets.slice(0,tcp).map((p,i)=><b key={p[0]} className={`packet p${i}`}>{p[0]}</b>)}<small>A connection forms before data moves</small></div><Device icon={<Box/>} title="Web server" sub="Server" server/></div><Explain kicker="CONCEPT 01 · NETWORKING" title="The TCP three-way handshake" intro="Before two computers exchange data, they introduce themselves and confirm they can both hear each other."><div className="readout">{tcp===0?<><strong>Ready to connect?</strong><span>Start the model and watch the conversation.</span></>:<><strong>{tcp}. {packets[tcp-1][0]}</strong><span>“{packets[tcp-1][1]}”</span></>}</div><div className="controls"><button className="primary" onClick={()=>setTcp(x=>Math.min(3,x+1))} disabled={tcp===3}><Play/>{tcp===0?"Start handshake":tcp===3?"Connected":"Next step"}</button><button aria-label="Reset" onClick={()=>setTcp(0)}><RotateCcw/></button></div><div className="dots">{[1,2,3].map(n=><i className={tcp>=n?"on":""} key={n}/>)}</div></Explain></TabsContent>
    <TabsContent value="request" className="lesson"><div className="stage map">{requests.map((r,i)=><button onClick={()=>setRequest(i)} className={i<=request?"reached":""} key={r[0]}><small>{r[0]}</small><strong>{r[1]}</strong></button>)}</div><Explain kicker="CONCEPT 02 · THE WEB" title="The life of a request" intro="One click starts a fast relay across the internet. Follow it from your keyboard to a server and back."><div className="readout"><strong>{requests[request][0]}. {requests[request][1]}</strong><span>{requests[request][2]}</span></div><div className="controls"><button className="primary" onClick={()=>setRequest(x=>(x+1)%requests.length)}>Next stop<ArrowRight/></button><button aria-label="Restart" onClick={()=>setRequest(0)}><RotateCcw/></button></div></Explain></TabsContent>
    <TabsContent value="data" className="lesson"><div className="stage structures"><div className={`items ${structure}`}>{structures[structure].items.map((x,i)=><div key={x}><small>{i}</small><strong>{x}</strong></div>)}</div><p>{structures[structure].note}</p></div><Explain kicker="CONCEPT 03 · ORGANIZING DATA" title="Data structures" intro="A data structure is simply a way to organize information so a program can use it efficiently."><div className="choices">{(Object.keys(structures) as (keyof typeof structures)[]).map(k=><button className={structure===k?"selected":""} onClick={()=>setStructure(k)} key={k}>{structures[k].label}</button>)}</div><div className="readout"><strong>{structures[structure].label}</strong><span>{structure==="array"?"Each value has a numbered address called an index.":structure==="stack"?"You add and remove items from the same end.":"Items leave in the same order they arrived."}</span></div></Explain></TabsContent>
   </Tabs>
  </section>
  <section id="how" className="principles"><small>02</small><p className="eyebrow">Built for first-time learners</p><h2>See it. Touch it. Understand it.</h2><div>{[["01","One idea at a time","Every model focuses on the smallest useful mental picture."],["02","Words beside motion","The explanation changes with the graphic, so you know what you’re seeing."],["03","You control the pace","Replay and move step by step until the concept clicks."]].map(x=><article key={x[0]}><b>{x[0]}</b><h3>{x[1]}</h3><p>{x[2]}</p></article>)}</div></section>
  <footer><a className="brand" href="#top"><span><Braces/></span>Code Atlas</a><p>Complex ideas, drawn clearly.</p></footer>
 </main>
}
function Device({icon,title,sub,server=false}:{icon:React.ReactNode,title:string,sub:string,server?:boolean}){return <div className={`device ${server?"server":""}`}><i>{icon}</i><strong>{title}</strong><small>{sub}</small></div>}
function Explain({kicker,title,intro,children}:{kicker:string,title:string,intro:string,children:React.ReactNode}){return <div className="explain"><p className="kicker">{kicker}</p><h3>{title}</h3><p className="summary">{intro}</p>{children}</div>}
