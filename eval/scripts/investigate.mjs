import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [label = '1', mode = 'jev'] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label) || !['jev','read'].includes(mode)) throw Error('Usage: investigate.mjs LABEL [jev|read]');
const task = `Investigate the Dispatch service. An incident report says clients can receive a successful HTTP response but the corresponding audit event can still be missing from durable storage after process termination or a storage failure. Identify all handler paths where this is possible, explain each mechanism, and distinguish superficially similar safe paths. Handlers with no audit action are outside this incident's scope. Use the explicit primitive contracts in contracts.ts; do not assume that an async helper, an await, or a queued event implies durability. Do not execute or edit the service.
Return a JSON object with findings (each with path, mechanism, evidence as an array of exact path:start-end strings), ruled_out (brief explanations of checked counterexamples), and limitations. Cite the decisive handler/helper/contract chain. This is an authored development fixture; report what the source establishes, not a reproduced production incident.`;
const offload = `
This is a proof of concept of programmatic semantic offloading. Use this investigation protocol:
1. Read the brief and primitive contracts. Load handler source into state without printing whole inventories or all handler bodies.
2. Use jev.map for an initial semantic pass over handler records. You write the questions. Include task-relevant screening and whether essential helper context is missing; absence of a helper remains unresolved regardless of a high score. Print one compact decision table.
3. Use those results and code to choose which dependencies to load. Expand the missing definitions, keeping full source and versioned refs in state. Run a focused follow-up semantic judgment with that context; do not independently repeat the entire investigation from scratch.
4. Read compact, versioned original evidence for final findings and at least one plausible counterexample. Root makes the final source-based assessment. An audit should answer a specific remaining question; do not mechanically reread all records. Reserve about half the print budget for decisive evidence and finish once the evidence supports the diagnosis.
5. Deliver the findings and limitations. Unknown judgments remain explicit; ordinary search/read can recover missed evidence.
Use state or var for reusable bindings. Combine independent preparation in a cell. Keep metadata and probabilities compact; do not print repeated paths, lengths, IDs, or full response objects.`;
const path = `runs/poc/dispatch-${mode}-${label}.json`;
if (existsSync(path)) throw Error('Run already exists; use a new label');
mkdirSync('runs/poc', {recursive:true});
const harnessFiles = ['prompt','cell-worker','cell-code','runtime','corpus','jev','semantic-map','harness','output','root','types'];
const harnessHash = createHash('sha256').update(harnessFiles.map(f=>readFileSync(`dist/src/${f}.js`)).join('\n')).digest('hex');
const manifest = {kind:'real model run on authored fixture',label,mode,harnessHash,sourceHashes:JSON.parse(readFileSync('eval/dispatch-key.json','utf8')).sources,
  task:task+(mode==='jev'?offload:''),limits:{steps:16,jevRequests:12,outputChars:14000,cellChars:6000}};
writeFileSync(path,JSON.stringify({...manifest,status:'running'},null,2)+'\n');
const child=spawn(process.execPath,['dist/src/cli.js','run','--root','examples/dispatch','--task',manifest.task,'--mode',mode,'--max-steps','16','--max-jev-requests','12','--output-budget','14000','--cell-budget','6000'],{stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';
child.stdout.on('data',b=>stdout+=b);
child.stderr.on('data',b=>stderr+=b);
child.on('close',code=>{
  let result; try {result=JSON.parse(stdout.trim());} catch {result={status:'error',error:stderr.trim()||'No valid CLI response',usageMayBeIncomplete:true};}
  writeFileSync(path,JSON.stringify({...manifest,exitCode:code,result},null,2)+'\n');
  console.log(JSON.stringify({path,status:result.status,steps:result.steps,trace:result.tracePath,seconds:result.milliseconds/1000,
    knownRootUSD:result.rootUsage?.reduce((n,u)=>n+(u?.cost?.total??0),0),usageMayBeIncomplete:result.usageMayBeIncomplete??result.rootUsage?.some(u=>typeof u?.cost?.total!=='number'),jev:result.metrics?.jev}));
});
