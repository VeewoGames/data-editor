import test from 'node:test';
import assert from 'node:assert/strict';
import {readServiceProcessIdentity,serviceProcessIsAlive} from '../src/service-process-identity.mjs';
test('Windows process identity queries yield the event loop and preserve creation identity',{skip:process.platform!=='win32'},async()=>{
 let settled=false;const result=readServiceProcessIdentity().then(value=>{settled=true;return value;});
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(settled,false,'identity lookup blocked ordinary request timers');
 const identity=await result;assert.equal(identity.pid,String(process.pid));assert.ok(/^\d+$/.test(identity.creationTime));
 assert.equal(await serviceProcessIsAlive(identity),true);assert.equal(await serviceProcessIsAlive({...identity,creationTime:'wrong'}),false);
});
