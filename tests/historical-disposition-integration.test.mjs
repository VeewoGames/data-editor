import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import {mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createAuthorityFixture,fixtureEnvironment,assertFixtureLedgerUnchanged,assertMissing} from './helpers/authority-fixture.mjs';
const closed={code:'HISTORY_RUN_CLOSED'};

test('real public start recovery observe existing wrappers refuse both source receipt runs without effects',async t=>{
 const f=await createAuthorityFixture(t);let effects=0;const implementation=async()=>effects++;
 for(const runId of [f.old,f.child]){
  await assert.rejects(()=>f.runtime.publicationStart(implementation)({projectContext:f.context,dependencies:{runId}}),closed);
  await assert.rejects(()=>f.runtime.publicationRecovery(implementation)({projectContext:f.context,runId}),closed);
  await assert.rejects(()=>f.runtime.publicationObserve(f.context,runId,implementation),closed);
  await assert.rejects(()=>f.runtime.publicationExistingOperation(f.context,runId,implementation),closed);
 }
 assert.equal(effects,0);await assertFixtureLedgerUnchanged(f);
});

test('actual handoff and terminal result writers retain exact inventoried original bytes',async t=>{
 const f=await createAuthorityFixture(t,{seed:async project=>writeFile(path.join(project.actions,project.old+'.json'),'original unknown history')}),actions=await f.load('src/entry-actions.mjs'),file=path.join(f.actions,f.old+'.json'),before=await readFile(file);
 await assert.rejects(()=>actions.writeEntryActionHandoff(f.context,f.old,{runId:f.old}),closed);
 await assert.rejects(()=>actions.publishEntryActionResultIdempotently(f.context,f.old,{version:2,runId:f.old,actionId:'x',phase:'terminal',outcome:'failed'}),closed);
 assert.deepEqual(await readFile(file),before);await assertMissing(path.join(f.actions,f.old+'.result.json'));
});

test('pending fencing allocation and fencing admission reject before any mutation',async t=>{
 const f=await createAuthorityFixture(t),{createPendingEntryActionStore}=await f.load('src/pending-entry-action.mjs'),{createFencingAllocator}=await f.load('src/fencing-lock.mjs'),{claimFencingAdmission}=await f.load('src/entry-action-recovery.mjs');
 const store=createPendingEntryActionStore({projectContext:f.context});await assert.rejects(()=>store.create({runId:f.old}),closed);
 const stateRoot=path.join(f.runtimeRoot,'entry-action-fencing'),allocator=createFencingAllocator({stateRoot});
 await assert.rejects(()=>allocator.allocate({runId:f.old,canonicalFileKey:'a'.repeat(64),jobInstanceId:crypto.randomUUID()}),closed);
 await assert.rejects(()=>claimFencingAdmission({stateRoot,lease:{runId:f.old}}),closed);
 assert.equal((await store.list()).length,0);
 const token=crypto.randomUUID(),pending=path.join(f.runtimeRoot,'pending-entry-actions',token+'.json');await mkdir(path.dirname(pending),{recursive:true});await writeFile(pending,JSON.stringify({token,runId:f.old,state:'pending'}));const before=await readFile(pending);
 await assert.rejects(()=>store.write({token,runId:'new',state:'expired'}),closed);assert.deepEqual(await readFile(pending),before);
});

test('persisted child ancestry and actual followup cannot reopen historical parent',async t=>{
 let childIdentity;
 const f=await createAuthorityFixture(t,{seed:async(project,{load})=>{
  const {followupIdentity}=await load('src/project-skill-followup.mjs'),entry={sourcePath:'data/items.json',collectionPath:'items',rowId:'one'};childIdentity=followupIdentity(project.old,'next',entry);
  await writeFile(path.join(project.actions,project.old+'.json'),JSON.stringify({runId:project.old,entry,projectSkillLifecycle:{configDigest:'config',followup:{actionId:'next'}}}));
  await writeFile(path.join(project.actions,project.old+'.followup.json'),JSON.stringify({parentRunId:project.old,...childIdentity,actionId:'next',configDigest:'config',target:entry}));
  await writeFile(path.join(project.actions,childIdentity.childRunId+'.json'),JSON.stringify({runId:childIdentity.childRunId,projectSkillLifecycle:{parentRunId:project.old}}));
 }});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[childIdentity.childRunId]),closed);
 const {resumeProjectSkillFollowup}=await f.load('src/project-skill-followup.mjs');await assert.rejects(()=>resumeProjectSkillFollowup({projectContext:f.context,parentRunId:f.old,startChild:()=>assert.fail()}),closed);
 await assertFixtureLedgerUnchanged(f);
});

test('fake intent receipt verified flags and removed record cannot replace the pinned original ledger',async t=>{
 const f=await createAuthorityFixture(t);
 for(const records of [{},{[f.old]:{runId:f.old,phase:'intent',relatedRunIds:[f.old],evidenceDigest:'a'.repeat(64)}},{[f.old]:{...f.record,verified:true}}]){
  await writeFile(f.ledgerFile,JSON.stringify({...f.state,records}));
  await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['new']),{code:'HISTORY_SUCCESSOR_INVALID'});
  await assert.rejects(()=>f.inventory(),{code:'HISTORY_SUCCESSOR_INVALID'});
 }
 await writeFile(f.ledgerFile,f.ledgerBytes);await f.mod.assertHistoricalRunAllowed(f.context,['new']);
});

test('anchor ledger registration loss and runtime override remain fail closed',async t=>{
 const f=await createAuthorityFixture(t);await rm(path.join(f.binding.directory,'anchor.json'));
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['new']),{code:'HISTORY_STATE_UNVERIFIABLE'});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed({...f.context,runtimeDir:'other'},['new']),{code:'HISTORY_BINDING_INVALID'});
 await rm(f.binding.registration);await rm(f.binding.directory,{recursive:true});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['new']),{code:'HISTORY_REGISTRATION_REQUIRED'});
});

test('ordinary author save works but raw unknown runtime writes and exact artifact publication require automation scope',async t=>{
 const f=await createAuthorityFixture(t),file=f.sourceFile,journalFile=path.join(f.runtimeRoot,'commit-journal/save.json');
 await assert.rejects(()=>f.atomic.atomicWrite(file,'raw forbidden'),{code:'HISTORY_RUN_CONTEXT_REQUIRED'});
 await f.mod.withHistoricalAuthorSave(f.context,{sourceFile:file,journalFile},()=>f.atomic.atomicWrite(file,'author edit'));assert.equal(await readFile(file,'utf8'),'author edit');
 await assert.rejects(()=>f.atomic.atomicWrite(path.join(f.runtimeRoot,'unknown.json'),'{}'),{code:'HISTORY_RUN_CONTEXT_REQUIRED'});
 const {publishExactArtifact}=await f.load('src/entry-action-exact-artifact-store.mjs');await assert.rejects(()=>publishExactArtifact({projectContext:f.context,artifactId:'x',content:'{}'}),{code:'HISTORY_RUN_CONTEXT_REQUIRED'});
});

test('actual independent recovery CLI refuses before rewriting original run evidence',async t=>{
 const f=await createAuthorityFixture(t),file=path.join(f.actions,f.old+'.started.json'),before=await readFile(file);
 const result=await promisify(execFile)(process.execPath,[path.join(f.tool,'scripts/entry-action-recover.mjs'),'recover','--project',f.root,'--run-id',f.old],{windowsHide:true,env:fixtureEnvironment(f.directory)}).catch(error=>error);
 assert.equal(result.code,2);assert.match(result.stdout,/HISTORY_RUN_CLOSED/);assert.deepEqual(await readFile(file),before);
});

test('late async automation continuation rechecks catalog generation and retains its prior partial write',async t=>{
 const f=await createAuthorityFixture(t),schema=await f.load('src/deployment-authority-schema.mjs');let release,ready;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>ready=resolve);
 const operation=f.mod.withHistoricalRun(f.context,['fresh'],async()=>{await f.atomic.atomicWrite(f.sourceFile,'partial-before-activation');ready();await gate;await f.atomic.atomicWrite(f.sourceFile,'forbidden');});
 await started;const snapshot=await f.store.readAuthoritySnapshot();await writeFile(snapshot.file,schema.encode({...snapshot.catalog,generation:snapshot.catalog.generation+1}));release();
 await assert.rejects(()=>operation,{code:'HISTORY_AUTHORITY_GENERATION_STALE'});assert.equal(await readFile(f.sourceFile,'utf8'),'partial-before-activation');
});

test('immutable staging checks closed runs before final link and leaves no artifact',async t=>{
 const f=await createAuthorityFixture(t),{publishExactArtifact}=await f.load('src/entry-action-exact-artifact-store.mjs');
 await assert.rejects(()=>publishExactArtifact({projectContext:f.context,runId:f.old,artifactId:'artifact',content:'{}'}),closed);
 const files=await readdir(path.join(f.runtimeRoot,'entry-action-artifacts')).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error));assert.deepEqual(files,[]);await assertFixtureLedgerUnchanged(f);
});


for(const failure of [false,true])test(`automation scope expires after ${failure?'failed':'successful'} operation before Promise and timer descendants can dispatch or write`,async t=>{
 const f=await createAuthorityFixture(t);let release;const gate=new Promise(resolve=>release=resolve),late=[];let effects=0;
 try{await f.mod.withHistoricalRun(f.context,['fresh'],async()=>{
  for(const timer of [false,true])late.push((async()=>{await gate;if(timer)await new Promise(resolve=>setTimeout(resolve,0));
   const scopeCode=await f.mod.withHistoricalScopeEffect(()=>effects++).then(()=>null,error=>error.code);
   const rawCode=await f.atomic.atomicWrite(f.sourceFile,'forbidden').then(()=>null,error=>error.code);
   const externalCode=await f.atomic.atomicWrite(path.join(f.directory,'external-cache.json'),'forbidden').then(()=>null,error=>error.code);
   const reentryCode=await f.mod.withHistoricalRun(f.context,['reentry'],()=>effects++).then(()=>null,error=>error.code);
   return [scopeCode,rawCode,externalCode,reentryCode];
  })());
  if(failure)throw Error('operation failed');
 });}catch(error){assert.equal(error.message,'operation failed');}
 release();for(const codes of await Promise.all(late))assert.deepEqual(codes,Array(4).fill('HISTORY_RUN_SCOPE_EXPIRED'));
 assert.equal(effects,0);assert.match(await readFile(f.sourceFile,'utf8'),/original/);await assertMissing(path.join(f.directory,'external-cache.json'));
});

test('author and publication scope expiration also refuses effects outside the project',async t=>{
 const f=await createAuthorityFixture(t),journalFile=path.join(f.runtimeRoot,'commit-journal/save.json');
 for(const mode of ['author','publication']){
  let release,late;const gate=new Promise(resolve=>release=resolve),outside=path.join(f.directory,mode+'-cache.json');
  const operation=async()=>{late=(async()=>{await gate;return f.atomic.atomicWrite(outside,'forbidden').then(()=>null,error=>error.code);})();};
  if(mode==='author')await f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile},operation);else await f.mod.withHistoricalPublicationState(f.context,operation);
  release();assert.equal(await late,'HISTORY_AUTHOR_SCOPE_EXPIRED');await assertMissing(outside);
 }
});

test('author and publication admissions rehash live original evidence instead of trusting stored proof blobs',async t=>{
 const f=await createAuthorityFixture(t),evidence=path.join(f.actions,f.old+'.started.json'),journalFile=path.join(f.runtimeRoot,'commit-journal/save.json');await writeFile(evidence,'external-corruption');let effects=0;
 await assert.rejects(()=>f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile},()=>effects++),{code:'HISTORY_EVIDENCE_DRIFT'});
 await assert.rejects(()=>f.mod.withHistoricalPublicationState(f.context,()=>effects++),{code:'HISTORY_EVIDENCE_DRIFT'});
 assert.equal(effects,0);assert.match(await readFile(f.sourceFile,'utf8'),/original/);await assertFixtureLedgerUnchanged(f);
});


test('author and publication owners cannot elevate into a fresh automation run',async t=>{
 const f=await createAuthorityFixture(t),journalFile=path.join(f.runtimeRoot,'commit-journal/save.json');let effects=0;
 for(const mode of ['author','publication']){
  const operation=()=>assert.rejects(()=>f.mod.withHistoricalRun(f.context,['fresh-promoted'],async()=>{effects++;await f.atomic.atomicWrite(f.sourceFile,'forbidden');}),{code:'HISTORY_AUTHOR_SCOPE_ESCALATION'});
  if(mode==='author')await f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile},operation);else await f.mod.withHistoricalPublicationState(f.context,operation);
 }
 assert.equal(effects,0);assert.match(await readFile(f.sourceFile,'utf8'),/original/);await assertFixtureLedgerUnchanged(f);
});


test('cleanup of an expired async automation descendant retains execution evidence',async t=>{
 const f=await createAuthorityFixture(t),evidence=path.join(f.directory,'execution-evidence.txt');await writeFile(evidence,'retain evidence');let release,late;const gate=new Promise(resolve=>release=resolve);
 await f.mod.withHistoricalRun(f.context,['fresh-cleanup'],async()=>{late=(async()=>{await gate;return f.mod.cleanupHistoricalRun(()=>rm(evidence));})();});
 release();const result=await late;assert.equal(result.retained,true);assert.equal(result.reason,'HISTORY_RUN_SCOPE_EXPIRED');assert.equal(await readFile(evidence,'utf8'),'retain evidence');
});
