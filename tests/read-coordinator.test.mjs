import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const module=await import('../src/api/read-coordinator.mjs').catch(()=>({}));
function owner(options){assert.equal(typeof module.createReadCoordinator,'function','read coordination is missing');return module.createReadCoordinator(options);}

test('shared readers own separate values, cancellation and deadlines',async()=>{
 let calls=0,aborted=false;
 const reads=owner({fetchImpl:async(_url,{signal})=>{calls++;signal.addEventListener('abort',()=>aborted=true);await delay(35);return new Response('{"root":{"value":1}}');}});
 const first=reads.read('/api/document?projectId=a',{timeoutMs:10});
 const second=reads.read('/api/document?projectId=a',{timeoutMs:200});
 await assert.rejects(first,{code:'READ_TIMEOUT'});
 const value=await second;assert.equal(calls,1);assert.equal(aborted,false);assert.equal(value.root.value,1);
 let release;const ready=new Promise(r=>release=r);
 const shared=owner({fetchImpl:async()=>{await ready;return new Response('{"value":1}');}});
 const a=shared.read('same'),b=shared.read('same');release();const [av,bv]=await Promise.all([a,b]);av.value=2;assert.equal(bv.value,1);
});

test('deadline covers stalled headers, body and queue; all departures abort the transfer',async()=>{
 let aborted=false;
 const reads=owner({fetchImpl:(_url,{signal})=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});},maxConcurrent:1});
 const a=reads.read('stuck',{timeoutMs:20});const b=reads.read('queued',{timeoutMs:10});
 await assert.rejects(b,{code:'READ_TIMEOUT'});await assert.rejects(a,{code:'READ_TIMEOUT'});assert.equal(aborted,true);
 const body=owner({fetchImpl:async()=>new Response(new ReadableStream({start(){}}))});
 await assert.rejects(body.read('body',{timeoutMs:10}),{code:'READ_TIMEOUT'});
 assert.equal(body.stats().active,0);
});

test('foreground overtakes queued prefetch and fresh bypass never shares an older read',async()=>{
 const started=[],releases=new Map();
 const reads=owner({maxConcurrent:1,fetchImpl:async url=>{started.push(url);await new Promise(r=>releases.set(url,r));return new Response('{}');}});
 const a=reads.read('a'),background=reads.read('background',{priority:'background'}),front=reads.read('front');
 await delay(0);releases.get('a')();await a;await delay(0);assert.equal(started[1],'front');releases.get('front')();await front;await delay(0);releases.get('background')();await background;
 let n=0;const versions=owner({fetchImpl:async()=>new Response(JSON.stringify({value:++n}))});
 const [old,current]=await Promise.all([versions.read('one'),versions.read('one',{fresh:true})]);assert.notEqual(old.value,current.value);
});

test('failed reads evict in-flight state and scopes cannot reuse another project snapshot',async()=>{
 let calls=0;const reads=owner({fetchImpl:async()=>{if(++calls===1)throw Error('offline');return new Response('{}');}});
 await assert.rejects(reads.read('same'),/offline/);await reads.read('same');assert.equal(calls,2);
 await Promise.all([reads.read('same',{scope:'a'}),reads.read('same',{scope:'b'})]);assert.equal(calls,4);
});
