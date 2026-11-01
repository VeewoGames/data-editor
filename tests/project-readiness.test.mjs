import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectReadiness} from '../src/project-readiness.mjs';
const project={id:'generic',root:'one',dataSources:[],filePolicy:{includeExtensions:['.json']}};

test('ordinary observation never starts preparation for a new scope',async()=>{
 let count=0;const owner=createProjectReadiness({prepare:async()=>{count++;}});
 assert.equal(owner.inspect(project).state,'initializing');assert.equal(count,0);
 await owner.ensure(project);assert.equal(count,1);
 owner.inspect({...project,root:'new-root'});assert.equal(count,1);
});

test('concurrent preparations share one lifecycle and changed project config prepares again',async()=>{
 let count=0,release;const gate=new Promise(r=>release=r);
 const owner=createProjectReadiness({prepare:async()=>{count++;await gate;}});
 const a=owner.ensure(project),b=owner.ensure(project);await Promise.resolve();
 assert.equal(count,1);assert.equal(owner.inspect(project).state,'initializing');
 release();await Promise.all([a,b]);assert.equal(owner.inspect(project).state,'ready');
 await owner.ensure(project);assert.equal(count,1);
 await owner.ensure({...project,root:'two'});assert.equal(count,2);
});

test('failed and closed-window preparations never become ready and permit explicit retry',async()=>{
 let count=0;const owner=createProjectReadiness({prepare:async()=>{count++;if(count===1)throw Error('broken');if(count===2)return {recovered:false,reason:'publication_window_closed'};}});
 await assert.rejects(owner.ensure(project),/broken/);
 await assert.rejects(owner.ensure(project),/broken/);assert.equal(count,1);
 await assert.rejects(owner.ensure(project,{retry:true}),{code:'PROJECT_RECOVERY_PENDING'});
 assert.equal(owner.inspect(project).state,'failed');
 await owner.ensure(project,{retry:true});assert.equal(owner.inspect(project).state,'ready');
});
