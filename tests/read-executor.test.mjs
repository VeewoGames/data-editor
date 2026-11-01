import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/read-request-context.mjs').catch(()=>({}));
test('server read budget bounds concurrency and removes disconnected queued work',async()=>{
 assert.equal(typeof mod.createReadExecutor,'function');
 const executor=mod.createReadExecutor({concurrency:1});let release,started=0;
 const a=executor.run(async()=>{started++;await new Promise(r=>release=r);});
 const controller=new AbortController();const b=executor.run(async()=>{started++;},{signal:controller.signal});
 controller.abort();await assert.rejects(b,{code:'READ_CANCELLED'});release();await a;assert.equal(started,1);
});
test('deadline cancels only read work; detached lifecycle effects keep their owner',async()=>{
 assert.equal(typeof mod.createReadExecutor,'function');
 const executor=mod.createReadExecutor();let detached;
 const controller=new AbortController();
 await executor.run(async()=>{
   detached=mod.withoutReadRequest(async()=>{await new Promise(r=>setTimeout(r,5));mod.checkReadRequest();return 'effect kept';});
   controller.abort();assert.throws(()=>mod.checkReadRequest(),{code:'READ_CANCELLED'});
 },{signal:controller.signal}).catch(error=>assert.equal(error.code,'READ_CANCELLED'));
 assert.equal(await detached,'effect kept');
});
