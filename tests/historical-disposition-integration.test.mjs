import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {mkdir,mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createProjectContext} from '../src/project-context.mjs';
import {initializeHistoryTestFixture,removeHistoryTestFixtureDeployment,withHistoricalAuthorSave,cleanupHistoricalRun,historyBinding,withHistoryProjectLock,withHistoricalRun,assertHistoricalRunAllowed,commitHistoricalDisposition} from '../src/historical-disposition.mjs';
import {publicationStart,publicationRecovery,publicationObserve,publicationExistingOperation} from '../src/publication-window-runtime.mjs';
import {publicationBinding,initializePublicationWindow} from '../src/publication-window-state.mjs';
import {scanPublicationObligations} from '../src/publication-window-obligations.mjs';
import {atomicWrite} from '../src/atomic-file.mjs';
import {writeEntryActionHandoff,publishEntryActionResultIdempotently} from '../src/entry-actions.mjs';
import {createPendingEntryActionStore} from '../src/pending-entry-action.mjs';
import {createFencingAllocator} from '../src/fencing-lock.mjs';
import {claimFencingAdmission} from '../src/entry-action-recovery.mjs';
import {resumeProjectSkillFollowup,followupIdentity} from '../src/project-skill-followup.mjs';
import {publishExactArtifact} from '../src/entry-action-exact-artifact-store.mjs';

const record=(runId,phase='intent')=>({runId,phase,relatedRunIds:[runId],evidenceDigest:'a'.repeat(64)});
async function fixture(t,records={old:record('old')}){
 const base=path.resolve(import.meta.dirname,'history-fixtures');await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'case-'));
 t.after(async()=>{assert.equal(path.dirname(root),base);await removeHistoryTestFixtureDeployment(context);await rm(root,{recursive:true,force:true});});
 await mkdir(path.join(root,'data'));await writeFile(path.join(root,'data/current.json'),JSON.stringify({draft:'保留草稿',reviewed:'已验文案',count:1}));
 const context=createProjectContext(root),binding=await initializeHistoryTestFixture(context,records);
 return{root,context,binding};
}
async function addIntent(f,id){return withHistoryProjectLock(f.binding,async()=>{const file=path.join(f.binding.directory,'state.json'),state=JSON.parse(await readFile(file));state.revision++;state.records[id]=record(id);await writeFile(file,JSON.stringify(state));});}
const closed={code:'HISTORY_RUN_CLOSED'};

test('real public start/recovery/observer/existing reject even without publication state',async t=>{
 const f=await fixture(t);let effects=0;const implementation=async()=>{effects++;};
 await assert.rejects(()=>publicationStart(implementation)({projectContext:f.context,dependencies:{runId:'old'}}),closed);
 await assert.rejects(()=>publicationRecovery(implementation)({projectContext:f.context,runId:'old'}),closed);
 await assert.rejects(()=>publicationObserve(f.context,'old',implementation),closed);
 await assert.rejects(()=>publicationExistingOperation(f.context,'old',implementation),closed);
 assert.equal(effects,0);
 const value=await publicationStart(async input=>input.dependencies.runId)({projectContext:f.context});assert.ok(value);assert.notEqual(value,'old');
});
test('real result and handoff writers preserve original bytes',async t=>{
 const f=await fixture(t);const file=path.join(f.binding.runtime,'entry-actions/old.json');await mkdir(path.dirname(file));await writeFile(file,'original unknown history');
 await assert.rejects(()=>writeEntryActionHandoff(f.context,'old',{runId:'old'}),closed);
 await assert.rejects(()=>publishEntryActionResultIdempotently(f.context,'old',{version:2,runId:'old',actionId:'x',phase:'terminal',outcome:'failed'}),closed);
 assert.equal(await readFile(file,'utf8'),'original unknown history');
});
test('pending and fencing public mutations reject before creating ledger or token',async t=>{
 const f=await fixture(t);const store=createPendingEntryActionStore({projectContext:f.context});
 await assert.rejects(()=>store.create({runId:'old'}),closed);
 const allocator=createFencingAllocator({stateRoot:path.join(f.binding.runtime,'entry-action-fencing')});
 await assert.rejects(()=>allocator.allocate({runId:'old',canonicalFileKey:'a'.repeat(64),jobInstanceId:crypto.randomUUID()}),closed);
 await assert.rejects(()=>claimFencingAdmission({stateRoot:path.join(f.binding.runtime,'entry-action-fencing'),lease:{runId:'old'}}),closed);
 assert.equal((await store.list()).length,0);
 const token=crypto.randomUUID(),directory=path.join(f.binding.runtime,'pending-entry-actions');await mkdir(directory,{recursive:true});
 await writeFile(path.join(directory,`${token}.json`),JSON.stringify({token,runId:'old',state:'pending'}));
 await assert.rejects(()=>store.write({token,runId:'new',state:'expired'}),closed);
});
test('parent intent blocks actual followup and persisted child ancestry',async t=>{
 const f=await fixture(t);await mkdir(path.join(f.binding.runtime,'entry-actions'));
 const entry={sourcePath:'data/current.json',collectionPath:'items',rowId:'one'},identity=followupIdentity('old','next',entry);
 await writeFile(path.join(f.binding.runtime,'entry-actions/old.json'),JSON.stringify({runId:'old',entry,projectSkillLifecycle:{configDigest:'config',followup:{actionId:'next'}}}));
 await writeFile(path.join(f.binding.runtime,'entry-actions/old.followup.json'),JSON.stringify({parentRunId:'old',...identity,actionId:'next',configDigest:'config',target:entry}));
 await writeFile(path.join(f.binding.runtime,`entry-actions/${identity.childRunId}.json`),JSON.stringify({runId:identity.childRunId,projectSkillLifecycle:{parentRunId:'old'}}));
 await assert.rejects(()=>assertHistoricalRunAllowed(f.context,[identity.childRunId]),closed);
 for(const handoff of [null,{runId:identity.childRunId},{runId:identity.childRunId,parentRunId:'other',projectSkillLifecycle:{parentRunId:'old'}}]){
  const file=path.join(f.binding.runtime,`entry-actions/${identity.childRunId}.json`);if(handoff)await writeFile(file,JSON.stringify(handoff));else await rm(file);
  await assert.rejects(()=>assertHistoricalRunAllowed(f.context,[identity.childRunId]),{code:'HISTORY_RELATION_INVALID'});
 }
 await assert.rejects(()=>resumeProjectSkillFollowup({projectContext:f.context,parentRunId:'old',startChild:()=>assert.fail()}),closed);
});
test('receipt and verified fields never authorize proof or remove scanner blockers',async t=>{
 const f=await fixture(t,{old:{...record('old','receipt'),verified:true}});
 await assert.rejects(()=>assertHistoricalRunAllowed(f.context,['new']),{code:'HISTORY_PROOF_UNSUPPORTED'});
 await assert.rejects(()=>commitHistoricalDisposition({verified:true}),{code:'HISTORY_DISPOSITION_REQUEST_INVALID'});
 const blockers=await scanPublicationObligations(await publicationBinding(f.context));assert.equal(blockers[0].reason,'proof_unsupported');
});
test('intent scanner adds refusal without reducing raw history obligations or provisioning',async t=>{
 const f=await fixture(t);await mkdir(path.join(f.binding.runtime,'entry-actions'));
 await writeFile(path.join(f.binding.runtime,'entry-actions/old.started.json'),'{}');
 const before=await readFile(path.join(f.binding.directory,'state.json'),'utf8');
 const blockers=await scanPublicationObligations(await publicationBinding(f.context));assert.ok(blockers.some(x=>x.kind==='run'));assert.ok(blockers.some(x=>x.reason==='intent_pending'));
 assert.equal(await readFile(path.join(f.binding.directory,'state.json'),'utf8'),before);
 await assert.rejects(()=>initializePublicationWindow(f.context),{code:'PUBLICATION_HISTORY_PENDING'});
});
test('anchor/state loss, corrupt registration and runtime override fail closed',async t=>{
 const f=await fixture(t);await rm(path.join(f.binding.directory,'anchor.json'));await rm(path.join(f.binding.directory,'state.json'));
 await assert.rejects(()=>assertHistoricalRunAllowed(f.context,['new']),{code:'HISTORY_STATE_UNVERIFIABLE'});
 await assert.rejects(()=>assertHistoricalRunAllowed({...f.context,runtimeDir:'other'},['new']),{code:'HISTORY_BINDING_INVALID'});
 await writeFile(f.binding.registration,'broken');await assert.rejects(()=>assertHistoricalRunAllowed(f.context,['new']),{code:'HISTORY_STATE_UNVERIFIABLE'});
});
test('independently pinned context rejects loss of registration plus state directory',async t=>{
 const f=await fixture(t);await rm(f.binding.registration);await rm(f.binding.directory,{recursive:true});
 await assert.rejects(()=>assertHistoricalRunAllowed(f.context,['new']),{code:'HISTORY_REGISTRATION_REQUIRED'});
});
test('late async continuation checks intent again and retains prior partial commit',async t=>{
 const f=await fixture(t,{}),file=path.join(f.root,'data/current.json');let release;
 const waiting=new Promise(r=>release=r);
 const operation=withHistoricalRun(f.context,['late'],async()=>{await atomicWrite(file,'partial-before-intent');await waiting;await atomicWrite(file,'forbidden');});
 while(await readFile(file,'utf8')!=='partial-before-intent')await new Promise(r=>setTimeout(r,5));
 await addIntent(f,'late');release();await assert.rejects(()=>operation,closed);
 assert.equal(await readFile(file,'utf8'),'partial-before-intent');
});
test('ordinary author save and unrelated project remain usable; raw unknown runtime effect rejects',async t=>{
 const f=await fixture(t),other=await fixture(t,{});
 const sourceFile=path.join(f.root,'data/current.json'),journalFile=path.join(f.binding.runtime,'commit-journal/save.json');
 await assert.rejects(()=>atomicWrite(sourceFile,'raw forbidden'),{code:'HISTORY_RUN_CONTEXT_REQUIRED'});
 await withHistoricalAuthorSave(f.context,{sourceFile,journalFile},()=>atomicWrite(sourceFile,'author edit'));assert.equal(await readFile(sourceFile,'utf8'),'author edit');
 await withHistoricalRun(other.context,['old'],()=>atomicWrite(path.join(other.root,'data/current.json'),'other project'));
 await assert.rejects(()=>atomicWrite(path.join(f.binding.runtime,'unknown.json'),'{}'),{code:'HISTORY_RUN_CONTEXT_REQUIRED'});
 await assert.rejects(()=>publishExactArtifact({projectContext:f.context,artifactId:'x',content:'{}'}),{code:'HISTORY_RUN_CONTEXT_REQUIRED'});
});
test('actual recovery CLI refuses before reading or rewriting original run',async t=>{
 const f=await fixture(t);const result=await promisify(execFile)(process.execPath,[path.resolve(import.meta.dirname,'../scripts/entry-action-recover.mjs'),'recover','--project',f.root,'--run-id','old'],{windowsHide:true}).catch(e=>e);
 assert.equal(result.code,2);assert.match(result.stdout,/HISTORY_RUN_CLOSED/);
});
test('cross-process short lock serializes intent publication before a waiting real write',async t=>{
 const f=await fixture(t,{}),file=path.join(f.root,'data/current.json');
 const url=pathToFileURL(path.resolve(import.meta.dirname,'../src/historical-disposition.mjs')).href;
 const code=`import{withHistoryProjectLock}from ${JSON.stringify(url)};import{readFile,writeFile}from'node:fs/promises';await withHistoryProjectLock(${JSON.stringify(f.binding)},async()=>{process.stdout.write('locked\\n');await new Promise(r=>setTimeout(r,150));const file=${JSON.stringify(path.join(f.binding.directory,'state.json'))};const s=JSON.parse(await readFile(file));s.records.race=${JSON.stringify(record('race'))};s.revision++;await writeFile(file,JSON.stringify(s));});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
 await assert.rejects(()=>withHistoricalRun(f.context,['race'],()=>atomicWrite(file,'forbidden')),closed);
 assert.equal(await exited,0);assert.match(await readFile(file,'utf8'),/保留草稿/);
});
test('intent after immutable staging prevents the real final artifact link',async t=>{
 const f=await fixture(t,{}),original=fs.promises.readFile;let staged=false;
 fs.promises.readFile=async(file,...args)=>{
  if(path.resolve(String(file)).toLowerCase()===path.resolve(f.binding.registration).toLowerCase()&&!staged){
   const names=await readdir(path.join(f.binding.runtime,'entry-action-artifacts')).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
   if(names.some(name=>name.endsWith('.publish'))){staged=true;await addIntent(f,'late-artifact');}
  }
  return original(file,...args);
 };
 syncBuiltinESMExports();
 try{await assert.rejects(()=>publishExactArtifact({projectContext:f.context,runId:'late-artifact',artifactId:'artifact',content:'{}'}),closed);}
 finally{fs.promises.readFile=original;syncBuiltinESMExports();}
 assert.equal(staged,true);
 const directory=path.join(f.binding.runtime,'entry-action-artifacts');
 const files=await readdir(directory);assert.deepEqual(files,[]);
});
test('cleanup rechecks intent under the actual removal lock and retains execution evidence',async t=>{
 const f=await fixture(t,{}),evidence=path.join(f.root,'execution-evidence.txt');await writeFile(evidence,'retain evidence');
 let release,ready;const gate=new Promise(r=>release=r),started=new Promise(r=>ready=r);
 const cleanup=withHistoricalRun(f.context,['clean'],async()=>{await assertHistoricalRunAllowed(f.context,['clean']);ready();await gate;return cleanupHistoricalRun(()=>rm(evidence));});
 await started;await addIntent(f,'clean');release();const result=await cleanup;
 assert.equal(result.retained,true);assert.equal(await readFile(evidence,'utf8'),'retain evidence');
});
