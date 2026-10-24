import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp,mkdir,writeFile,readFile,rm,readdir } from 'node:fs/promises';
import { createProjectContext } from '../src/project-context.mjs';
import { initializePublicationWindow,closePublicationWindow,advancePublicationWindow,inspectPublicationWindow,reconcilePublicationReservation,digest } from '../src/publication-window-state.mjs';
import {pathToFileURL} from 'node:url';
import {commitEntryActionGroup} from '../src/entry-action-group-commit.mjs';
import {canonicalFileIdentity} from '../src/canonical-file-identity.mjs';
import {canonicalProjectArtifactIdentity} from '../src/canonical-project-artifact-identity.mjs';
import {createDocumentCommitCoordinator} from '../src/document-commit-coordinator.mjs';
import {createEntryActionRunRoute} from '../src/entry-action-route.mjs';
import {createPendingEntryActionStore} from '../src/pending-entry-action.mjs';
import {createFencingAllocator} from '../src/fencing-lock.mjs';
import { publicationStart,withPublicationOperation,settlePublicationPending } from '../src/publication-window-runtime.mjs';
import { rowDigest } from '../src/row-digest.mjs';
import { startProjectCommandEntryAction } from '../src/project-command-action-service.mjs';
import { startProjectSkillEntryAction } from '../src/project-skill-action-service.mjs';
import { startProposalOnlyEntryAction,submitFreshEntryActionProposal,recoverProposalOnlyEntryActionGroup } from '../src/entry-action-service.mjs';
import { submitFreshCandidateCreate,commitPreparedCandidateCreate,recoverCandidateCreate } from '../src/entry-action-candidate-create-service.mjs';
import { publishExactArtifact } from '../src/entry-action-exact-artifact-store.mjs';
import { promoteEmbeddedIdentity,recoverPendingEmbeddedIdentityPromotions } from '../src/durable-identity-coordinator.mjs';
import { recoverProjectCommandRun } from '../src/project-command-recovery.mjs';
import { resumeProjectSkillFollowup } from '../src/project-skill-followup.mjs';
import { saveAutomationProfile } from '../src/automation-profile.mjs';

const canonical = x => Array.isArray(x)?`[${x.map(canonical).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`:JSON.stringify(x);
async function fixture(t,delay=0,noChanges=false) {
  const root=await mkdtemp(path.join(os.tmpdir(),'editor-window-integration-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  await mkdir(path.join(root,'.data-editor'));await mkdir(path.join(root,'data'));
  const row={__entry_id:'row-1',source:'author draft',generated:'reviewed copy'};
  await writeFile(path.join(root,'data/items.json'),JSON.stringify([row]));await writeFile(path.join(root,'dependency.json'),'{}');
  await writeFile(path.join(root,'command.mjs'),`let t='';for await(const b of process.stdin)t+=b;const input=JSON.parse(t);await new Promise(r=>setTimeout(r,${delay}));console.log(JSON.stringify(${noChanges?"{kind:'project-command-result',status:'no_changes',summary:'unchanged'}":"{kind:'entry-action-proposal',changes:[{field:'generated',beforeExists:true,before:input.entry.row.generated,afterExists:true,after:'compiled'}],summary:'updated',evidence:[]}"}));`);
  const profile={rules:[{id:'compile',label:'Compile',enabled:true,icon:'refresh',targets:[{file:'data/items.json',collection:'$'}],payload:{includeRow:true,includeNeighbors:false},execution:{kind:'project-command',resultPolicy:'proposal',command:{path:'command.mjs',args:[],readDependencies:['dependency.json'],timeoutMs:3000},allowConcurrentSave:true},contractId:'fixture.command.v1'}]};
  await writeFile(path.join(root,'.data-editor/automation-profile.json'),JSON.stringify(profile));
  const c={contractId:'fixture.command.v1',version:1,predicate:{all:[]},writableFields:['generated'],legalTransitions:[],textArtifactPolicy:{},evidencePolicy:{},resultPolicy:'proposal',createAuthority:null};
  await writeFile(path.join(root,'.data-editor/entry-action-contracts.json'),JSON.stringify({version:1,contracts:[{...c,digest:digest(canonical(c))}]}));
  const context=createProjectContext(root);await initializePublicationWindow(context);
  const input={projectContext:context,project:{id:'fixture'},request:{actionId:'compile',sourcePath:'data/items.json',collectionPath:'$',rowId:'row-1',expectedRowDigest:rowDigest(row)}};
  return {root,context,input,row,profile};
}
const close=f=>closePublicationWindow(f.context,{publisher:'publisher',files:[{path:'dependency.json',afterDigest:digest('{}')}]});
async function advance(f,transition){const s=await inspectPublicationWindow(f.context);return advancePublicationWindow(f.context,{windowId:s.windowId,revision:s.revision,publisher:s.publisher,transition});}
async function stateFiles(root){const result={};async function walk(p){for(const e of await readdir(p,{withFileTypes:true}).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e))){if(e.isDirectory())await walk(path.join(p,e.name));else result[path.relative(root,path.join(p,e.name))]=digest(await readFile(path.join(p,e.name)));}}await walk(path.join(root,'.data-editor'));return result;}

test('real command remains admitted through closure and original journal publication',async t=>{
  const f=await fixture(t,150),run=await startProjectCommandEntryAction(f.input);await close(f);
  await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_DRAIN_PENDING'});await run.completion;
  const row=JSON.parse(await readFile(path.join(f.root,'data/items.json')))[0];assert.equal(row.generated,'compiled');assert.equal(row.source,'author draft');
  assert.equal((await advance(f,'READY')).state,'READY');
});
test('real no_changes stays registered until its terminal receipt',async t=>{
  const f=await fixture(t,120,true),before=await readFile(path.join(f.root,'data/items.json'),'utf8'),run=await startProjectCommandEntryAction(f.input);await close(f);await run.completion;await advance(f,'READY');assert.equal(await readFile(path.join(f.root,'data/items.json'),'utf8'),before);
});
test('saved author input during drain invalidates old generation and survives',async t=>{
  const f=await fixture(t,150),run=await startProjectCommandEntryAction(f.input);await close(f);
  const changed={...f.row,source:'new author input'};await writeFile(path.join(f.root,'data/items.json'),JSON.stringify([changed]));
  await assert.rejects(()=>run.completion,{code:'PROJECT_COMMAND_DOCUMENT_STALE'});assert.deepEqual(JSON.parse(await readFile(path.join(f.root,'data/items.json'))),[changed]);await advance(f,'READY');
});
test('every public managed write boundary rejects before validation at READY',async t=>{
  const f=await fixture(t);await close(f);await advance(f,'READY');const before=await stateFiles(f.root);
  const input={projectContext:f.context,request:{actionId:'compile'},lease:{runId:'late'}};
  for(const fn of [startProjectCommandEntryAction,startProjectSkillEntryAction,startProposalOnlyEntryAction,submitFreshEntryActionProposal,submitFreshCandidateCreate,commitPreparedCandidateCreate,publishExactArtifact,promoteEmbeddedIdentity,recoverCandidateCreate,recoverProposalOnlyEntryActionGroup,recoverPendingEmbeddedIdentityPromotions])await assert.rejects(()=>fn(input),{code:'PUBLICATION_WINDOW_CLOSED'},fn.name);
  await assert.rejects(()=>recoverProjectCommandRun(f.context,'late'),{code:'PUBLICATION_WINDOW_CLOSED'});
  assert.deepEqual(await stateFiles(f.root),before);

});
test('raw group target B cannot use a valid project A permit',async t=>{
  const a=await fixture(t),b=await fixture(t);await close(b);await advance(b,'READY');await mkdir(path.join(b.root,'docs'));const sourceIdentity=await canonicalFileIdentity(b.context,'data/items.json'),artifactIdentity=await canonicalProjectArtifactIdentity(b.context,'docs/artifact.md');
  const before=await stateFiles(b.root);
  await withPublicationOperation(a.context,{mode:'new',runId:'cross-project'},async()=>{
    await assert.rejects(()=>commitEntryActionGroup({coordinator:createDocumentCommitCoordinator(),groupJournal:{readOptional:()=>assert.fail('journal touched')},childJournal:{},groupEntry:{runId:'cross-project',source:{canonicalFileKey:sourceIdentity.canonicalFileKey},artifact:{canonicalFileKey:artifactIdentity.canonicalFileKey}},sourceIdentity,artifactIdentity,readSource:async()=>'',writeSource:()=>assert.fail(),readArtifact:async()=>null,writeArtifact:()=>assert.fail(),verifyOwnership:async()=>{},verifyAuthority:async()=>{},refreshIdentities:async()=>{},publishResultIdempotently:()=>assert.fail()}),{code:'PUBLICATION_RESERVATION_REQUIRED'});
  });assert.deepEqual(await stateFiles(b.root),before);
});
test('real original-run recovery followed by explicit reconcile closes crashed registration',async t=>{
  const f=await fixture(t),id='00000000-0000-4000-8000-000000000002',module=pathToFileURL(path.resolve('src/publication-window-runtime.mjs')).href,identity=pathToFileURL(path.resolve('src/service-process-identity.mjs')).href;
  const code=`import {withPublicationOperation} from ${JSON.stringify(module)};import {readServiceProcessIdentity} from ${JSON.stringify(identity)};import fs from 'node:fs/promises';await withPublicationOperation(${JSON.stringify(f.context)},{mode:'new',runId:${JSON.stringify(id)}},async()=>{const dir=${JSON.stringify(path.join(f.root,'.data-editor/runtime/entry-actions'))};await fs.mkdir(dir,{recursive:true});await fs.writeFile(dir+'/'+${JSON.stringify(id)}+'.json',JSON.stringify({runId:${JSON.stringify(id)},action:{id:'compile',execution:{kind:'project-command'}},projectCommand:{writer:await readServiceProcessIdentity()}}));await fs.writeFile(dir+'/'+${JSON.stringify(id)}+'.started.json',JSON.stringify({version:2,runId:${JSON.stringify(id)},phase:'running'}));process.exit(23);});`;
  const p=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:'ignore'});assert.equal(await new Promise(r=>p.once('exit',r)),23);await close(f);
  await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_DRAIN_PENDING'});assert.equal((await recoverProjectCommandRun(f.context,id)).recovered,true);const s=await inspectPublicationWindow(f.context);await reconcilePublicationReservation(f.context,{windowId:s.windowId,revision:s.revision,publisher:s.publisher,runId:id});await advance(f,'READY');
});
test('OPEN recovery observation is retained but closed observation has zero writes',async t=>{
  const f=await fixture(t);assert.equal((await recoverProjectCommandRun(f.context,'absent',undefined,{observer:true})).recovered,false);
  await close(f);const before=await stateFiles(f.root);
  assert.equal((await recoverProjectCommandRun(f.context,'absent',undefined,{observer:true})).reason,'publication_window_closed');
  assert.equal((await resumeProjectSkillFollowup({projectContext:f.context,parentRunId:'absent'})).state,'deferred');
  assert.deepEqual(await stateFiles(f.root),before);
});
test('ack continuation completion stays reserved after the pending parent is settled',async t=>{
  const f=await fixture(t);await withPublicationOperation(f.context,{mode:'new',runId:'pending',pending:true},async()=>{});await close(f);
  let release;const done=new Promise(r=>release=r);const start=publicationStart(async()=>({completion:done}));
  let accepted;await withPublicationOperation(f.context,{mode:'continue',runId:'pending'},async()=>{accepted=await start({projectContext:f.context,request:{actionId:'compile'},dependencies:{runId:'pending'}});await settlePublicationPending(f.context,'pending');});
  await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_DRAIN_PENDING'});release();await accepted.completion;await advance(f,'READY');
});
test('real promotion route and ack keep the accepted child in drain until completion',async t=>{
  const f=await fixture(t);let release,observed;const done=new Promise(r=>release=r);
  const route=createEntryActionRunRoute({loadRegistry:async()=>({projects:[{id:'fixture',root:f.root}]}),resolveExecution:async()=>({kind:'proposal'}),resolveCapabilityState:async()=>({status:'active',generation:1,manifestDigest:'fixed'}),preflightEntryAction:async()=>{},promoteIdentity:async()=>({receipt:{durableId:'row-1',canonicalRowDigest:'digest',documentEtag:'etag'},root:[f.row],format:'json',documentEtag:'etag'}),documentCommitCoordinator:createDocumentCommitCoordinator(),startEntryAction:publicationStart(async input=>({runId:input.dependencies.runId,completion:done})),onCompletion:started=>observed=started});
  const response=await route.run({projectId:'fixture',actionId:'compile',sourcePath:'data/items.json',collectionPath:'$',sourceRowIndex:0,expectedRowDigest:'digest',idempotencyKey:'promotion_123'});
  const store=createPendingEntryActionStore({projectContext:f.context}),pending=await store.read(response.pendingActionToken);await close(f);
  const ack=await route.ackStart({projectId:'fixture',pendingActionToken:response.pendingActionToken});assert.equal(ack.runId,pending.runId);
  await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_DRAIN_PENDING'});release();await observed.completion;
  await createFencingAllocator({stateRoot:path.join(f.root,'.data-editor/runtime/entry-action-fencing')}).abortLaunching(pending.lease);
  assert.equal((await advance(f,'READY')).state,'READY');
});
test('managed settings are rejected with original caller profile retained',async t=>{
  const f=await fixture(t);await close(f);const before=await stateFiles(f.root);const input=structuredClone(f.profile);input.rules[0].label='unsaved edit';
  await assert.rejects(()=>saveAutomationProfile(f.context,input),{code:'PUBLICATION_WINDOW_CLOSED'});assert.equal(input.rules[0].label,'unsaved edit');assert.deepEqual(await stateFiles(f.root),before);
});
test('closed HTTP state queries do not trigger legacy migrations or identity recovery',async t=>{
  const f=await fixture(t);await close(f);await advance(f,'READY');
  const id='00000000-0000-4000-8000-000000000001';await mkdir(path.join(f.root,'.data-editor/runtime/entry-actions'),{recursive:true});await writeFile(path.join(f.root,`.data-editor/runtime/entry-actions/${id}.started.json`),JSON.stringify({version:1,runId:id,status:'started'}));
  const registry=await mkdtemp(path.join(os.tmpdir(),'editor-window-registry-'));t.after(()=>rm(registry,{recursive:true,force:true,maxRetries:5,retryDelay:40}));
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const p=spawn(process.execPath,['server.mjs','--project',f.root,'--registry-home',registry,'--port',String(port)],{cwd:process.cwd(),windowsHide:true,stdio:'ignore'});
  t.after(async()=>{if(p.exitCode===null){p.kill();await new Promise(r=>p.once('exit',r));}});
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,25));}
  const projects=await(await fetch(`http://127.0.0.1:${port}/api/projects`)).json(),projectId=projects.activeProjectId,before=await stateFiles(f.root);
  const status=await fetch(`http://127.0.0.1:${port}/api/publication-window?projectId=${projectId}`);assert.equal(status.status,200);assert.equal((await status.json()).state,'READY');
  const observed=await fetch(`http://127.0.0.1:${port}/api/entry-actions/result?projectId=${projectId}&runId=${id}`);assert.equal(observed.status,404);
  const run=await fetch(`http://127.0.0.1:${port}/api/entry-actions/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...f.input.request,projectId})});assert.equal(run.status,409);assert.equal((await run.json()).code,'PUBLICATION_WINDOW_CLOSED');
  assert.deepEqual(await stateFiles(f.root),before);
  const settings=await fetch(`http://127.0.0.1:${port}/api/automation-settings`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,profile:f.profile,bindings:{version:2,defaults:{},bindings:{}}})});assert.equal(settings.status,409);assert.equal((await settings.json()).code,'PUBLICATION_WINDOW_CLOSED');assert.deepEqual(await stateFiles(f.root),before);
  const loaded=await(await fetch(`http://127.0.0.1:${port}/api/document?projectId=${projectId}&path=data/items.json`)).json();
  const saved=await fetch(`http://127.0.0.1:${port}/api/save`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,path:'data/items.json',documentEtag:loaded.documentEtag,root:[{...f.row,source:'saved during READY'}],documentContracts:[]})});assert.equal(saved.status,200,JSON.stringify(await saved.json()));
  const current=JSON.parse(await readFile(path.join(f.root,'data/items.json')))[0];assert.equal(current.source,'saved during READY');assert.equal(current.generated,'reviewed copy');
});
