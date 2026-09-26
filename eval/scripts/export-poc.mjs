import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const [runPath='runs/poc/dispatch-jev-5.json'] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath,'utf8'));
if (!run.result?.tracePath) throw Error('Run has no retained trace');
const events = readFileSync(run.result.tracePath,'utf8').trim().split('\n').map(JSON.parse);
const key = JSON.parse(readFileSync('eval/dispatch-key.json','utf8'));
const sources = Object.fromEntries(Object.entries(run.sourceHashes).map(([path,sha256])=> {
  const text = readFileSync(resolve('examples/dispatch',path),'utf8');
  if (createHash('sha256').update(text).digest('hex')!==sha256) throw Error(`Source version changed: ${path}`);
  return [path,{text,sha256,lines:text.trimEnd().split('\n').length}];
}));
let final;
try { final=JSON.parse(run.result.answer.replace(/^```(?:json)?\s*|\s*```$/g,'')); } catch { final={raw:run.result.answer}; }
const found = (final.findings??[]).map(x=>x.path);
function exposedLines(output) {
  const seen=[];
  const lines=output.split('\n');
  let file;
  lines.forEach((line,index)=>{
    const header=line.match(/^FILE (.+)$/);
    if(header){file=Object.hasOwn(sources,header[1])?header[1]:undefined;return;}
    const numbered=line.match(/^(\d+)\|(.*)$/);
    if(numbered&&file){
      const source=sources[file].text.split('\n');
      if(+numbered[1]>=1&&numbered[2].trimEnd()===source[+numbered[1]-1]?.trimEnd())seen.push(`${file}:${+numbered[1]}`);
      return;
    }
    const m=line.match(/^([^\s]+\.(?:ts|md)):(\d+)(?:-(\d+))? (.*)$/);
    if(!m||!sources[m[1]])return;
    const source=sources[m[1]].text.split('\n');
    const start=+m[2],end=+(m[3]??m[2]);
    for(let n=start;n<=end;n++) {
      const actual=n===start?m[4]:lines[index+n-start];
      if(actual?.trimEnd()===source[n-1]?.trimEnd())seen.push(`${m[1]}:${n}`);
    }
  });
  return seen;
}
const seen=new Set(events.filter(e=>e.type==='cell_result').flatMap(e=>exposedLines(e.output)));
const citations = (final.findings??[]).flatMap(f=>(f.evidence??[]).map(citation=>{
  const m = String(citation).match(/^(.+):(\d+)(?:-(\d+))?$/);
  const valid = !!m && !!sources[m[1]] && +m[2]>=1 && +(m[3]??m[2])>=+m[2] && +(m[3]??m[2])<=sources[m[1]].lines;
  const seenInRootOutput=valid&&Array.from({length:+(m[3]??m[2])-+m[2]+1},(_,i)=>`${m[1]}:${+m[2]+i}`).every(line=>seen.has(line));
  return {finding:f.path,citation,valid,seenInRootOutput};
}));
const evaluation = {
  basis:'Authored fixture key written before runs. Path matches and citation bounds are mechanical checks; semantic evidence still needs review.',
  expected:Object.keys(key.expected).length,
  matched:found.filter(x=>Object.hasOwn(key.expected,x)),
  falsePositives:found.filter(x=>!Object.hasOwn(key.expected,x)),
  missed:Object.keys(key.expected).filter(x=>!found.includes(x)),
  duplicates:found.length-new Set(found).size,
  citations,
};
const turns=[];
let current;
for (const event of events) {
  if(event.type==='root_reply') {
    let action;try{action=JSON.parse(event.text);}catch{action={action:'invalid',code:event.text};}
    current={step:event.step,time:event.time,action:action.action,code:action.code??'',answer:action.answer??'',output:'',operations:[],maps:[],usage:event.usage,errors:[],loaded:[]};
    turns.push(current);
  }
  if(!current) continue;
  if(event.type==='cell') current.executedCode=event.executedCode??event.code;
  if(event.type==='operation') {
    current.operations.push({method:event.method,args:event.method.startsWith('repo.')?event.args:undefined});
    if(event.method==='repo.window') current.loaded.push(event.args[0]);
    if(event.method==='repo.read'&&event.args[0]?.path) current.loaded.push(event.args[0].path);
    if(event.method==='repo.lines') for(const span of event.args[0]??[]) current.loaded.push(span.path);
  }
  if(event.type==='jev_map_start') current.maps.push({questions:event.questions,batches:event.batches,records:[],context:null});
  if(event.type==='jev_map_batch') {
    const map=current.maps.at(-1);
    if(!map)continue;
    map.context=event.body.state.material.context??null;
    const materials=Object.values(event.body.state.material.records);
    const ids=[...new Set(event.bindings.map(b=>b.record))];
    ids.forEach((id,i)=>map.records.push({id,material:materials[i]}));
  }
  if(event.type==='jev_map_result') {
    const map=current.maps.at(-1);if(map){map.result=event;map.result.time=undefined;map.result.type=undefined;}
  }
  if(event.type==='jev_ask') current.asks=(current.asks??[]).concat([{material:event.body.state.material,questions:event.body.questions}]);
  if(event.type==='jev_answers'&&current.asks?.length) current.asks.at(-1).result=event;
  if(event.type==='cell_result') {
    current.output=event.output;current.budget=event.budget;
    current.exposedLines=exposedLines(event.output);
    if(event.error)current.errors.push(event.error);
  }
}
const usage=run.result.rootUsage??[];
const knownRootUSD=usage.reduce((n,u)=>n+(typeof u?.cost?.total==='number'?u.cost.total:0),0);
const metrics={...run.result.metrics,steps:run.result.steps,seconds:run.result.milliseconds/1000,knownRootUSD,
  rootCostUnknown:!!run.result.usageMayBeIncomplete||usage.some(u=>typeof u?.cost?.total!=='number'),
  rootInputTokens:usage.reduce((n,u)=>n+(u?.input??0)+(u?.cacheRead??0),0),rootOutputTokens:usage.reduce((n,u)=>n+(u?.output??0),0),
  cacheReadTokens:usage.reduce((n,u)=>n+(u?.cacheRead??0),0),
};
const replay={title:'SOCO · Investigate through semantic computation',kind:'Recorded real API run on an authored development fixture',
  run:basename(runPath),trace:basename(run.result.tracePath),harnessHash:run.harnessHash,task:run.task,
  provider:usage[0]?.provider??null,model:usage[0]?.model??null,jevModels:[...new Set(events.filter(e=>e.type==='jev_response').map(e=>e.model).filter(Boolean))],
  status:run.result.status,profile:run.profile??'unseeded',sources,turns,final,metrics,evaluation,
};
mkdirSync('demo',{recursive:true});
writeFileSync('demo/replay.json',JSON.stringify(replay,null,2)+'\n');
const template=readFileSync('demo/template.html','utf8');
writeFileSync('demo/inspect.html',template.replace('/*__REPLAY_DATA__*/',JSON.stringify(replay).replaceAll('<','\\u003c')));
mkdirSync('eval/poc',{recursive:true});
writeFileSync(`eval/poc/${basename(runPath)}`,JSON.stringify({run:replay.run,trace:replay.trace,harnessHash:run.harnessHash,metrics,evaluation,final},null,2)+'\n');
console.log(JSON.stringify({run:replay.run,matched:evaluation.matched.length,missed:evaluation.missed,falsePositives:evaluation.falsePositives,invalidCitations:citations.filter(c=>!c.valid),metrics}));

// Build the short film separately; keep the inspectable trace available.
if (replay.run === 'dispatch-jev-5.json') await import('./build-demo.mjs');
