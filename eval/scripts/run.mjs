import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [taskId,mode='jev',variant='adaptive',repeat='1',outputBudget='16000']=process.argv.slice(2);
const task=JSON.parse(readFileSync('eval/tasks.json','utf8')).find(t=>t.id===taskId);
if(!task)throw Error('Unknown task');
// Explicit treatment, separate from adaptive use and a single mandatory call.
if(variant==='offload')task.task+='\nThis is a semantic-offloading experiment. Delegate bulk record-level classification to Jev through code before printing the records. Construct batches with one independent question per record and a compact ID-to-text material, keeping full source in the code environment. Print compact judgments; use remaining source budget to audit uncertainty and examples. You choose batch sizes, questions, and follow-up reads. Report model judgments as predictions where not individually verified.';
const harnessHash=createHash('sha256').update(['prompt','cell-worker','runtime','corpus','jev','harness','output'].map(f=>readFileSync(`dist/src/${f}.js`)).join('\n')).digest('hex');
mkdirSync('runs/eval',{recursive:true});
const args=['dist/src/cli.js','run','--root',task.root,'--task',task.task,'--mode',mode,'--max-steps','14','--max-jev-requests','24','--output-budget',outputBudget,'--cell-budget','6000'];
if(variant==='required')args.push('--require-jev');
const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
child.on('close',code=>{
 let result;try{result=JSON.parse(stdout.trim());}catch{result={status:'error',error:stderr.trim()};}
 const record={taskId,mode,variant,repeat,outputBudget:Number(outputBudget),harnessHash,task:task.task,exitCode:code,result};
 const path=`runs/eval/${taskId}-${mode}-${variant}-${repeat}.json`;writeFileSync(path,JSON.stringify(record,null,2));
 console.log(JSON.stringify({path,status:result.status,steps:result.steps,seconds:result.milliseconds/1000,rootUSD:result.rootUsage?.reduce((n,u)=>n+(u?.cost?.total??0),0),metrics:result.metrics,error:result.error,trace:result.tracePath}));
});
