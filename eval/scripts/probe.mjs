import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {config} from 'dotenv';
import {Corpus} from '../../dist/src/corpus.js';
import {Jev,httpTransport} from '../../dist/src/jev.js';
config({path:'.env',quiet:true});mkdirSync('runs/probes',{recursive:true});
const corpus=await Corpus.open('examples/booking');
const trace=[];const jev=new Jev(corpus,httpTransport(process.env.TYPESAFE_API_KEY),'jev-1.13.0',20,e=>trace.push(e));
const source=Object.fromEntries(await Promise.all(['holds.ts','cancel.ts','booking.ts','inventory.ts'].map(async p=>[p,await corpus.window(p,1,80)])));
const line=(p,n)=>source[p].lines.find(l=>l.start===n);
const narrow={'holds.ts':[line('holds.ts',15)],'cancel.ts':[line('cancel.ts',14)],'booking.ts':[line('booking.ts',16)],'inventory.ts':[line('inventory.ts',13)]};
const ranges={'holds.ts':[1,18],'cancel.ts':[11,18],'booking.ts':[13,19],'inventory.ts':[9,19]};
const coherent=Object.fromEntries(Object.entries(ranges).map(([p,[a,b]])=>[p,source[p].lines.filter(l=>l.start>=a&&l.start<=b)]));
const questions={
 store_ms:{type:'noul',instructions:'Does createHold store expiresAt using milliseconds since the Unix epoch, based on the executable assignments shown?'},
 compare_seconds:{type:'noul',instructions:'Does sweep compute nowSeconds by dividing its nowMs input by 1000 before comparing it to hold.expiresAt?'},
 unit_mismatch:{type:'noul',instructions:'Does the expiry cleanup fail for normal current timestamps because expiresAt is in milliseconds but the comparison uses current time in seconds?'},
 cancel_delete:{type:'noul',instructions:'Does the complete customer cancel function shown remove the hold entry from the holds Map?'},
 status_blocks:{type:'noul',instructions:'Does book reject any seat present in the holds Map without first checking the hold status or expiresAt?'},
 complete_cause:{type:'noul',instructions:'Does the shown code establish the combined cause: cancel keeps the hold, book blocks on Map membership, and sweep uses incompatible time units so waiting does not free the seat?'},
};
const distractors=readFileSync('work/httpx/httpx/_content.py','utf8').slice(0,12000);
const materials={isolated:narrow,coherent,whole_files:source,distracted:{relevant:coherent,unrelated_public_source:distractors}};
const results=[];
for(let repeat=1;repeat<=2;repeat++)for(const [condition,material] of Object.entries(materials)){
 const started=performance.now();const answer=await jev.ask(material,questions);
 const row={condition,repeat,materialChars:JSON.stringify(material).length,ms:performance.now()-started,answers:Object.fromEntries(Object.entries(answer.answers).map(([k,v])=>[k,v.probability])),unknown:answer.unknown};results.push(row);console.log(JSON.stringify(row));
}
writeFileSync('runs/probes/granularity.json',JSON.stringify({results,metrics:jev.metrics,trace},null,2));
