import { config } from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Corpus } from '../../dist/src/corpus.js';
import { Jev, httpTransport } from '../../dist/src/jev.js';
import { Runtime } from '../../dist/src/runtime.js';
import { piRoot } from '../../dist/src/root.js';
import { runHarness } from '../../dist/src/harness.js';

config({path:resolve('.env'),quiet:true});
const [label='3'] = process.argv.slice(2);
if(!/^[a-z0-9-]+$/.test(label))throw Error('Use an alphanumeric run label');
const path=`runs/poc/dispatch-jev-${label}.json`;
if(existsSync(path))throw Error('Run already exists; choose another label');
mkdirSync('runs/poc',{recursive:true});
const tracePath=resolve(`runs/poc/dispatch-jev-${label}.jsonl`);
writeFileSync(tracePath,'',{flag:'wx',mode:0o600});
const usages=[];
const trace=event=>{
  if(event.type==='root_reply')usages.push(event.usage??null);
  appendFileSync(tracePath,JSON.stringify({time:new Date().toISOString(),...event})+'\n');
};
const corpus=await Corpus.open('examples/dispatch');
const jev=new Jev(corpus,httpTransport(process.env.TYPESAFE_API_KEY),process.env.JEV_MODEL??'jev-latest',8,trace);
const runtime=new Runtime(corpus,jev,120000,trace,14000,6000);
const files=await corpus.files('handlers');
const task=`Investigate why the Dispatch service can acknowledge success before its audit event is durable. Identify all affected handlers and explain each mechanism from original evidence. Handlers with no audit action are outside scope. Distinguish safe counterexamples. This is an authored, read-only fixture, not a reproduced incident.

Primitive contracts: appendCommitted resolves only after durable storage and rejects on failure; appendCommittedSync returns only after durable storage and throws on failure; commitOutbox atomically commits all events durably before resolving. Returning a successful response or calling response.send makes it observable immediately; later awaits cannot retract it. Process termination loses memory, microtasks, and timers. Business primitives updateEntity/charge/render/query do not record audit events.

Environment input is ALREADY LOADED: state.records maps all 20 handler paths to COMPLETE source text, including imports. state.refs maps each path to versioned block references. state.contracts is the full contracts.ts text. This is input preparation, not model analysis. Do not rediscover or print inventories, symbols, lengths, or all handler bodies.

Use this semantic-computation protocol:
1. Your FIRST code action should use jev.map(state.records, genericQuestions, state.contracts). Write one or two generic questions to identify audit-relevant handlers and missing helper context. Map applies each question to EACH record. Print a compact ID/probability table, not full result objects. Keep null/unknown explicit.
2. Select candidates using the results. In code, follow their actual imports and load needed helper definitions with repo tools into external state. Do not print the helper bodies yet. Missing helper behavior remains unresolved regardless of a high score. Keep ordinary search/read available for recovery.
3. Use a SECOND semantic pass to judge early acknowledgement with that context. Use jev.map(selectedRecords, {early:{type:'noul',instructions:'<your complete generic criterion for this handler>'}}, helperContext). Shared helpers/contracts go in the THIRD argument, never as extra records to classify. You may instead compose per-record context bundles. Print compact decisions only.
4. Based on those results, print NUMBERED original source chains for suspected problems and plausible safe counterexamples. Read to resolve a concrete question; avoid rereading every irrelevant record. Distinguish what was loaded into state from what you actually saw printed. Budget is 14,000 printed characters total; use about 2,000 for screening/routing and reserve the rest for decisive evidence. Stop retrying output that cannot fit.
5. Deliver JSON: findings:[{path,mechanism,evidence:['path:start-end',...]}], ruled_out:[{path,why}], limitations:[...]. Cite actual numbered lines, never estimated offsets. Root makes the final assessment. Explicitly state unresolved evidence.

The choice of questions, candidate selection, dependency composition, second-pass judgments, source review and final answer are yours. The host only preloads input, binds questions and packs API requests.`;
const harnessHash=createHash('sha256').update(['prompt','cell-worker','cell-code','runtime','corpus','jev','semantic-map','harness','output','root','types'].map(f=>readFileSync(`dist/src/${f}.js`)).join('\n')).digest('hex');
const manifest={kind:'real model run on authored fixture',profile:'input-preloaded; instructed semantic investigation',label,mode:'jev',harnessHash,sourceHashes:JSON.parse(readFileSync('eval/dispatch-key.json','utf8')).sources,task,limits:{steps:12,jevRequests:8,outputChars:14000,cellChars:6000}};
writeFileSync(path,JSON.stringify({...manifest,status:'running'},null,2)+'\n');
const started=performance.now();
let result;
try {
  trace({type:'environment_preload',paths:files,meaning:'Raw input only; no semantic labels or candidate selection. Gold remains outside corpus.'});
  const initialized=await runtime.eval(`state.records = {}; state.refs = {}; for (var path of ${JSON.stringify(files)}) { state.refs[path] = await repo.blocks(path); state.records[path] = (await Promise.all(state.refs[path].map(ref => repo.read(ref)))).map(block => block.text).join(''); } state.contracts = (await repo.read((await repo.blocks('contracts.ts'))[0])).text;`);
  if(initialized.error)throw Error(initialized.error);
  result=await runHarness({task,runtime,root:piRoot(process.env.ROOT_PROVIDER??'xai',process.env.ROOT_MODEL,process.env.ROOT_API_KEY),mode:'jev',maxSteps:12,trace});
} catch(error) {
  result={status:'error',error:error.message,rootUsage:usages,usageMayBeIncomplete:true,milliseconds:performance.now()-started};
} finally {runtime.close();}
result={...result,tracePath,metrics:{corpus:corpus.metrics,jev:jev.metrics,runtime:runtime.metrics},environmentPreparationCells:1};
writeFileSync(path,JSON.stringify({...manifest,result},null,2)+'\n');
console.log(JSON.stringify({path,status:result.status,steps:result.steps,tracePath,seconds:result.milliseconds/1000,knownRootUSD:usages.reduce((n,u)=>n+(u?.cost?.total??0),0),jev:jev.metrics}));
