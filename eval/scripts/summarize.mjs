import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
const tasks=JSON.parse(readFileSync('eval/tasks.json','utf8'));
const rows=[];
// The old runner lost tracePath on errors; recover this known failed run by its recorded trace.
const legacyErrors={'episodes-jev-required-2.json':'runs/2026-09-26T02-19-58.529Z-b6682a7e.jsonl'};
for(const path of readdirSync('runs/eval').filter(f=>f.endsWith('.json'))){
 const r=JSON.parse(readFileSync('runs/eval/'+path,'utf8'));const x=r.result;
 const trace=x.tracePath??legacyErrors[path];
 const events=trace?readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse):[];
 const usage=x.rootUsage??events.filter(e=>e.type==='root_reply').map(e=>e.usage);
 const rootUSD=usage.length?usage.reduce((n,u)=>n+(u?.cost?.total??0),0):null;
 const jevResponses=events.filter(e=>e.type==='jev_response');
 const jevInputTokens=x.metrics?.jev?.inputTokens??jevResponses.reduce((n,e)=>n+(e.usage?.input_tokens??0),0);
 const jevUSD=jevInputTokens*.042/1e6;
 const missingUsage=x.status==='error'||!!x.usageMayBeIncomplete||usage.some(u=>!u?.cost)||!!x.metrics?.jev?.unknownUsageRequests;
 const row={run:path,task:r.taskId,mode:r.mode,variant:r.variant,harnessHash:r.harnessHash,outputBudget:r.outputBudget??events.find(e=>e.type==='config')?.outputBudget,status:x.status,steps:x.steps??usage.length,seconds:x.milliseconds?x.milliseconds/1000:null,rootUSD,jevUSD,totalEstimatedUSD:rootUSD===null?null:rootUSD+jevUSD,costMayBeIncomplete:missingUsage,
 rootInputTokens:usage.reduce((n,u)=>n+(u?.input??0)+(u?.cacheRead??0),0),rootOutputTokens:usage.reduce((n,u)=>n+(u?.output??0),0),cacheReadTokens:usage.reduce((n,u)=>n+(u?.cacheRead??0),0),
 jevRequests:x.metrics?.jev?.requests??events.filter(e=>e.type==='jev_request').length,jevInputTokens,printedChars:x.metrics?.runtime?.observationChars??events.filter(e=>e.type==='cell_result').reduce((n,e)=>n+(e.output?.length??0),0),
 rejectedPrintCells:events.filter(e=>e.type==='cell_result'&&e.budget?.rejectedChars>0).length,cellErrors:events.filter(e=>e.type==='cell_result'&&e.error).map(e=>e.error),trace};
 row.diagnosticChars=events.filter(e=>e.type==='cell_result').reduce((n,e)=>n+(e.error?.length??0),0);
 row.chargedOutputChars=x.metrics?.runtime?.chargedOutputChars??null;
 row.legacyErrorBudgetBypass=path==='episodes-read-adaptive-4.json';
 if(r.taskId==='episodes-holdout'){
  const gold=tasks.find(t=>t.id===r.taskId).gold; const scores=new Map();
  for(const e of events.filter(e=>e.type==='jev_answers'))for(const [id,a] of Object.entries(e.answers??{}))if(/^(?:e|episode)\d{3}$/.test(id)&&typeof a.probability==='number')scores.set('episode-'+id.slice(-3),a.probability);
  if(scores.size===16){const yes=[...scores].filter(([,p])=>p>=.5).map(([id])=>id);row.rawJevAtHalf={records:16,tp:yes.filter(id=>gold.includes(id)).length,fp:yes.filter(id=>!gold.includes(id)),fn:gold.filter(id=>!yes.includes(id))};}
 }
 if(r.taskId.startsWith('episodes')&&x.answer){
  const gold=tasks.find(t=>t.id===r.taskId).gold;
  let answer;const raw=x.answer.replace(/^```json\s*|\s*```$/g,'');
  try{answer=JSON.parse(raw);row.validJSON=true;}catch{row.validJSON=false;try{answer=JSON.parse(raw.replaceAll('\\"','"'));row.recoveredEscapedJSON=true;}catch{}}
  if(answer?.unsupported_episode_ids){const got=answer.unsupported_episode_ids;const unique=[...new Set(got)];row.tp=unique.filter(id=>gold.includes(id)).length;row.fp=unique.filter(id=>!gold.includes(id));row.fn=gold.filter(id=>!unique.includes(id));row.exact=row.fp.length===0&&row.fn.length===0;row.countConsistent=answer.count===got.length;row.duplicateIDs=got.length-unique.length;}
  if(answer?.unsupported_episode_ids){const normalized=[...new Set(answer.unsupported_episode_ids.map(id=>/^\d{3}$/.test(id)?`episode-${id}`:id))];row.normalizedTP=normalized.filter(id=>gold.includes(id)).length;row.normalizedFP=normalized.filter(id=>!gold.includes(id));row.normalizedFN=gold.filter(id=>!normalized.includes(id));row.normalizedExact=row.normalizedFP.length===0&&row.normalizedFN.length===0;}
 }
 rows.push(row);
}
writeFileSync('eval/results.json',JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(rows,null,2));
