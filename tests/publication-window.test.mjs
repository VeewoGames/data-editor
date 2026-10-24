import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { spawn,execFile } from 'node:child_process';
import {promisify} from 'node:util';
import { pathToFileURL } from 'node:url';
import { createProjectContext } from '../src/project-context.mjs';
import { initializePublicationWindow, inspectPublicationWindow, closePublicationWindow, advancePublicationWindow, recoverPublicationPublisher, reconcilePublicationReservation, digest, publicationBinding } from '../src/publication-window-state.mjs';
import { withPublicationOperation, publicationObserve, publicationConfigWrite, publicationStart, publicationCoordinator } from '../src/publication-window-runtime.mjs';
import { createDocumentCommitCoordinator } from '../src/document-commit-coordinator.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(),'editor-publication-'));
  t.after(() => rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:40}));
  await mkdir(path.join(root,'.data-editor'),{recursive:true}); await mkdir(path.join(root,'data'));
  await writeFile(path.join(root,'program.mjs'),'before');
  await writeFile(path.join(root,'.data-editor/automation-profile.json'),JSON.stringify({rules:[]}));
  await writeFile(path.join(root,'.data-editor/entry-action-contracts.json'),JSON.stringify({version:1,contracts:[]}));
  const context = createProjectContext(root);
  await initializePublicationWindow(context);
  return {root,context};
}
const close = f => closePublicationWindow(f.context,{publisher:'publisher',files:[{path:'program.mjs',afterDigest:digest('after')}]});
const advance = async (f,transition) => {const s=await inspectPublicationWindow(f.context);return advancePublicationWindow(f.context,{windowId:s.windowId,revision:s.revision,publisher:s.publisher,transition});};
async function json(file,value) {await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value));}
const tick = () => new Promise(resolve => setTimeout(resolve,10));
async function waitFor(file) {for(let i=0;i<400;i++){try{return await readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}await tick();}throw Error('fixture timed out');}
function child(code) {
  const p=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);
  return {p,exit:new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',code=>resolve({code,output}));})};
}

test('inspection is pure and a missing managed state fails closed',async t=>{
  const f=await fixture(t),b=await publicationBinding(f.context),before=await readFile(b.file,'utf8');
  await inspectPublicationWindow(f.context);assert.equal(await readFile(b.file,'utf8'),before);
  await rm(b.file);await assert.rejects(()=>withPublicationOperation(f.context,{mode:'new'},()=>assert.fail()),{code:'PUBLICATION_STATE_UNVERIFIABLE'});
});
test('physical root aliases cannot bypass a closed window; binding overrides fail closed',async t=>{
  const f=await fixture(t);await close(f);
  await assert.rejects(()=>withPublicationOperation({...f.context,projectId:'alias'},{mode:'new'},()=>assert.fail()),{code:'PUBLICATION_WINDOW_CLOSED'});
  await assert.rejects(()=>inspectPublicationWindow({...f.context,runtimeDir:'other-runtime'}),{code:'PUBLICATION_STATE_UNVERIFIABLE'});
});
test('accepted execution remains registered after start returns until async completion',async t=>{
  const f=await fixture(t);let release;const done=new Promise(r=>release=r);
  const start=publicationStart(async()=>({completion:done}));
  const run=await start({projectContext:f.context,request:{actionId:'x'}});await close(f);
  await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_DRAIN_PENDING'});
  release();await run.completion;assert.equal((await advance(f,'READY')).state,'READY');
});
test('normal input saves stay outside the deployment bundle; partial bundles cannot reopen',async t=>{
  const f=await fixture(t);await close(f);await advance(f,'READY');await advance(f,'DEPLOYING');
  await writeFile(path.join(f.root,'data/draft.json'),JSON.stringify({limit_note_output:'my draft'}));
  await assert.rejects(()=>advance(f,'VERIFYING'),{code:'PUBLICATION_PACKAGE_DRIFT'});
  assert.equal((await inspectPublicationWindow(f.context)).state,'HELD');
  await writeFile(path.join(f.root,'program.mjs'),'after');await advance(f,'VERIFYING');await advance(f,'OPEN');
  assert.equal(JSON.parse(await readFile(path.join(f.root,'data/draft.json'))).limit_note_output,'my draft');
});
test('old publisher revisions cannot advance or reopen after explicit takeover',async t=>{
  const f=await fixture(t),old=await close(f);
  await recoverPublicationPublisher(f.context,{windowId:old.windowId,revision:old.revision,publisher:'replacement'});
  await assert.rejects(()=>advancePublicationWindow(f.context,{windowId:old.windowId,revision:old.revision,publisher:'publisher',transition:'READY'}),{code:'PUBLICATION_OWNER_STALE'});
  assert.equal((await inspectPublicationWindow(f.context)).state,'HELD');
});
test('failed receipts and partial artifacts still block READY',async t=>{
  const f=await fixture(t);await json(path.join(f.root,'.data-editor/runtime/entry-actions/old.started.json'),{phase:'running'});
  await json(path.join(f.root,'.data-editor/runtime/entry-actions/old.result.json'),{phase:'terminal',outcome:'failed'});
  await json(path.join(f.root,'.data-editor/runtime/entry-action-group-journal/old.json'),{runId:'old',stage:'artifact_committed'});
  await close(f);await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_HISTORY_PENDING'});
});
test('orphan reservations and historical handoffs block deployment without automatic recovery',async t=>{
  const f=await fixture(t);await json(path.join(f.root,'.data-editor/runtime/entry-actions/00000000-0000-4000-8000-000000000001.json'),{version:1});
  await close(f);await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_HISTORY_PENDING'});
});
test('closed observations skip recovery; OPEN observations are atomic drain obligations',async t=>{
  const f=await fixture(t);let release,entered;const done=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const observing=publicationObserve(f.context,'recover-old',async()=>{entered();await done;return {recovered:true};});await started;
  await close(f);await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_DRAIN_PENDING'});
  assert.equal((await publicationObserve(f.context,'recover-new',()=>assert.fail())).reason,'publication_window_closed');
  release();await observing;await advance(f,'READY');
});
test('settings reject before first write and retain caller input',async t=>{
  const f=await fixture(t);await close(f);const input={rules:[{label:'my input'}]};
  await assert.rejects(()=>publicationConfigWrite(f.context,()=>writeFile(path.join(f.root,'bindings.json'),JSON.stringify(input))),{code:'PUBLICATION_WINDOW_CLOSED'});
  assert.equal(input.rules[0].label,'my input');await assert.rejects(()=>readFile(path.join(f.root,'bindings.json')),{code:'ENOENT'});
});
test('inherited async context does not give a new child the parent permit',async t=>{
  const f=await fixture(t);await withPublicationOperation(f.context,{mode:'new',runId:'parent'},async()=>{
    await close(f);
    await assert.rejects(()=>publicationStart(async()=>assert.fail())({projectContext:f.context,request:{actionId:'child'},dependencies:{followupRunId:'child'}}),{code:'PUBLICATION_WINDOW_CLOSED'});
  });
});
test('coordinator rechecks continuation inside the acquired document lock',async t=>{
  const f=await fixture(t),coordinator=createDocumentCommitCoordinator({identify:async()=>({canonicalFileKey:'x'})});
  let unlock,entered;const lock=coordinator.withIdentities([{canonicalFileKey:'x'}],async()=>{entered?.();await new Promise(r=>unlock=r);});
  while(!unlock)await tick();
  const operation=withPublicationOperation(f.context,{mode:'new'},async()=>publicationCoordinator(f.context,coordinator).withIdentities([{canonicalFileKey:'x'}],()=>42));
  while(!Object.keys((await inspectPublicationWindow(f.context)).accepted).length)await tick();await close(f);
  await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_DRAIN_PENDING'});unlock();await lock;assert.equal(await operation,42);await advance(f,'READY');
});
test('a separate project continues accepting actions during another window',async t=>{
  const f=await fixture(t),g=await fixture(t);await close(f);
  assert.equal(await withPublicationOperation(g.context,{mode:'new'},()=>7),7);
});
test('cross-process close versus start never admits an unregistered operation',async t=>{
  const f=await fixture(t);const runtime=pathToFileURL(path.resolve('src/publication-window-runtime.mjs')).href;
  const state=pathToFileURL(path.resolve('src/publication-window-state.mjs')).href;
  const entered=path.join(f.root,'entered'),release=path.join(f.root,'release');
  const worker=child(`import {withPublicationOperation} from ${JSON.stringify(runtime)};import fs from 'node:fs/promises';try{await withPublicationOperation(${JSON.stringify(f.context)},{mode:'new',runId:'child'},async()=>{await fs.writeFile(${JSON.stringify(entered)},'registered');for(;;){try{await fs.stat(${JSON.stringify(release)});break;}catch{}await new Promise(r=>setTimeout(r,10));}});}catch(e){console.log(e.code);process.exitCode=2;}`);
  await waitFor(entered);await close(f);await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_DRAIN_PENDING'});
  const late=child(`import {withPublicationOperation} from ${JSON.stringify(runtime)};try{await withPublicationOperation(${JSON.stringify(f.context)},{mode:'new'},()=>{throw Error('BYPASS')});}catch(e){console.log(e.code);}`);
  const denied=await late.exit;assert.match(denied.output,/PUBLICATION_WINDOW_CLOSED/);
  await writeFile(release,'go');assert.equal((await worker.exit).code,0);await advance(f,'READY');
});
test('crashed process reservation stays closed after another process resumes control',async t=>{
  const f=await fixture(t),runtime=pathToFileURL(path.resolve('src/publication-window-runtime.mjs')).href;
  const worker=child(`import {withPublicationOperation} from ${JSON.stringify(runtime)};await withPublicationOperation(${JSON.stringify(f.context)},{mode:'new',runId:'crashed'},async()=>{process.exit(23)});`);
  assert.equal((await worker.exit).code,23);await close(f);await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_DRAIN_PENDING'});
});
test('HELD restores the before bundle then drains unresolved original work',async t=>{
  const f=await fixture(t);await close(f);await advance(f,'READY');await advance(f,'DEPLOYING');
  await writeFile(path.join(f.root,'program.mjs'),'partial');await assert.rejects(()=>advance(f,'VERIFYING'),{code:'PUBLICATION_PACKAGE_DRIFT'});
  await json(path.join(f.root,'.data-editor/runtime/entry-actions/old.started.json'),{phase:'running'});
  await writeFile(path.join(f.root,'program.mjs'),'before');assert.equal((await advance(f,'DRAINING')).state,'DRAINING');
  await assert.rejects(()=>advance(f,'READY'),{code:'PUBLICATION_HISTORY_PENDING'});
});
test('explicit reconciliation closes only dead writers with no unresolved original effects',async t=>{
  const f=await fixture(t),runtime=pathToFileURL(path.resolve('src/publication-window-runtime.mjs')).href;
  const worker=child(`import {withPublicationOperation} from ${JSON.stringify(runtime)};await withPublicationOperation(${JSON.stringify(f.context)},{mode:'new',runId:'abandoned'},async()=>process.exit(23));`);
  assert.equal((await worker.exit).code,23);await close(f);const s=await inspectPublicationWindow(f.context);
  await reconcilePublicationReservation(f.context,{windowId:s.windowId,revision:s.revision,publisher:s.publisher,runId:'abandoned'});
  assert.equal((await inspectPublicationWindow(f.context)).accepted.abandoned.settlement,'reservation_never_started');await advance(f,'READY');
});
test('explicit reconciliation cannot close a still live asynchronous writer',async t=>{
  const f=await fixture(t);let release;const done=new Promise(r=>release=r),start=publicationStart(async()=>({completion:done}));
  const started=await start({projectContext:f.context,dependencies:{runId:'still-live'}});await close(f);const s=await inspectPublicationWindow(f.context);
  await assert.rejects(()=>reconcilePublicationReservation(f.context,{windowId:s.windowId,revision:s.revision,publisher:s.publisher,runId:'still-live'}),{code:'PUBLICATION_WRITER_UNVERIFIABLE'});release();await started.completion;
});
test('administrative CLI inspection is pure and stale publisher commands cannot mutate',async t=>{
  const f=await fixture(t),execute=promisify(execFile),binding=await publicationBinding(f.context),before=await readFile(binding.file,'utf8');
  const read=await execute(process.execPath,['scripts/publication-window.mjs','inspect',f.root],{windowsHide:true});assert.equal(JSON.parse(read.stdout).state,'OPEN');assert.equal(await readFile(binding.file,'utf8'),before);
  await close(f);const request=path.join(f.root,'request.json');await writeFile(request,JSON.stringify({windowId:'stale',revision:0,publisher:'wrong',transition:'OPEN'}));
  await assert.rejects(()=>execute(process.execPath,['scripts/publication-window.mjs','advance',f.root,request],{windowsHide:true}),e=>e.code===1&&e.stderr.includes('PUBLICATION_OWNER_STALE'));assert.equal((await inspectPublicationWindow(f.context)).state,'DRAINING');
});
