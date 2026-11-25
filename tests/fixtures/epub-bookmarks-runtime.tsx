import { createRoot } from "react-dom/client";
import { FoliateReader } from "../../src/epub/FoliateReader";
import { prepareFoliateSession } from "../../src/epub/foliateSession";
import "../../src/index.css";
const w=window as any;
const bridge=(v:object)=>w.webkit.messageHandlers.test.postMessage(JSON.stringify(v));
const sleep=(ms=80)=>new Promise(r=>setTimeout(r,ms));
const check=(v:unknown,m:string)=>{if(!v)throw Error(m)};
const until=async(f:()=>unknown)=>{for(let i=0;i<200;i++){if(f())return;await sleep()}throw Error("Timed out")};
const key=async(key:string,extra={})=>{document.activeElement!.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true,...extra}));await sleep()};
let records:any[]=[],undo:any[]=[],position:any=null,failDelete=false;
w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
 if(cmd==="load_epub_session_position")return position;
 if(cmd==="save_epub_session_position"){position={cfi:args.cfi,cfiModel:"foliate-html-v1"};return}
 if(cmd!=="epub_bookmarks")return;
 let changed=false;
 if(args.action==="add"&&!records.some(r=>r.cfi===args.cfi)){records.push({id:String(Date.now()),cfi:args.cfi,cfiModel:"foliate-html-v1",label:args.label});changed=true}
 if(args.action==="delete"&&failDelete)throw Error("Storage unavailable");
 if(args.action==="delete"){undo=records.filter(r=>args.ids.includes(r.id));records=records.filter(r=>!args.ids.includes(r.id));changed=!!undo.length}
 if(args.action==="undo"&&undo.length){records.push(...undo);undo=[];changed=true}
 return {records:structuredClone(records),changed};
}};
async function command(name:string){
 if(!document.querySelector('.command-palette')){document.querySelector<HTMLElement>('[aria-label="EPUB reading area"]')!.focus();await key(':')}
 await key(':');const input=document.querySelector<HTMLInputElement>('.command-filter')!;
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,name);input.dispatchEvent(new Event('input',{bubbles:true}));await sleep();await key('Enter');await sleep(150);
}
(async()=>{
 const bytes=await(await fetch('/book.epub')).arrayBuffer();
 const prepared=await prepareFoliateSession(new File([bytes],'book.epub'));
 createRoot(document.getElementById('root')!).render(<FoliateReader prepared={prepared} sessionId="1"/>);
 await until(()=>document.querySelector('.status-commands'));
 document.querySelector<HTMLElement>('.foliate-publication')!.focus();w.__snapshotDone=false;bridge({nativeKey:'m'});await until(()=>w.__snapshotDone);await sleep(150);check(records.length===1,"mark missing");check(position===null,"mark wrote reading position");
 // The native runner temporarily resizes the view; test deduplication after its reflow settles.
 records=[];await sleep(250);await key('m');await sleep(150);
 document.querySelector<HTMLElement>('.foliate-publication')!.focus();await key('m');await sleep(150);check(records.length===1,"duplicate CFI");
 await command('layout');await key('Escape');await key('Escape');await sleep(200);check(prepared.view.renderer.getAttribute('flow')==='scrolled','continuous layout');
 await prepared.view.goTo(2);await sleep(150);document.querySelector<HTMLElement>('.foliate-publication')!.focus();await key('m');await sleep(150);check(records.length===2,"multiple marks");
 await command('marks');await key('a');await sleep(150);check(document.querySelector('[aria-multiselectable="true"]'),"multiselect missing");
 await key(' ');check(document.querySelectorAll('[aria-selected="true"]').length===1,'selection missing');
 await key('j');check(document.querySelectorAll('[aria-selected="true"]').length===1,'focus changed selection');
 await key('Escape');check(!document.querySelector('[aria-selected="true"]'),'Escape selection');
 await key('d');check(records.length===2,'unguarded deletion');
 await key('a',{ctrlKey:true});failDelete=true;await key('d');await sleep();check(records.length===2 && document.querySelectorAll('[aria-selected="true"]').length===2,'failed deletion lost bookmarks or selection');failDelete=false;await key('d');await sleep();check(records.length===0,'bulk deletion');
 await key('u');await sleep();check(records.length===2,'undo');
 await key(' ');await key('/');check(!document.querySelector('[aria-selected="true"]'),'filter selection');await key('Escape');
 w.__snapshotDone=false;bridge({snapshot:'epub-bookmarks.png'});await until(()=>w.__snapshotDone);
 await key('Enter');await until(()=>!document.querySelector('.command-palette'));
 check(prepared.view.lastLocation?.cfi,'bookmark navigation');
 const count=records.length;
 await command('epub text larger');await key('Escape');await key('Escape');
 check(records.length===count,'appearance changed bookmarks');

 bridge({passed:true,cases:['creation-without-position-write','deduplication','multiple','selection-focus','escape','guarded-delete','bulk-undo','filter-clears','navigation'],errors:[]});
})().catch(e=>bridge({passed:false,error:String(e)}));
