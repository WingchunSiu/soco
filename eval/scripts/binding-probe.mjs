import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {config} from 'dotenv';
import {httpTransport,readAnswers} from '../../dist/src/jev.js';
config({path:'.env',quiet:true});
const run=JSON.parse(readFileSync('runs/eval/episodes-holdout-jev-offload-7.json','utf8')).result;
const original=readFileSync(run.tracePath,'utf8').trim().split('\n').map(JSON.parse).find(e=>e.type==='jev_ask').body;
const call=httpTransport(process.env.TYPESAFE_API_KEY);const rows=[];
for(let repeat=1;repeat<=2;repeat++)for(const condition of ['unbound','bound']){
 const body=structuredClone(original);body.model='jev-1.13.0';
 if(condition==='bound')for(const [id,q] of Object.entries(body.questions))q.instructions=`Judge only record material.${id}. `+q.instructions;
 const started=performance.now();const response=await call(body);const parsed=readAnswers(response,Object.keys(body.questions));
 const row={condition,repeat,ms:performance.now()-started,answers:Object.fromEntries(Object.entries(parsed.answers).map(([k,v])=>[k,v.probability])),usage:response.usage};rows.push(row);console.log(JSON.stringify(row));
}
mkdirSync('runs/probes',{recursive:true});writeFileSync('runs/probes/binding.json',JSON.stringify({sourceTrace:run.tracePath,rows},null,2)+'\n');
