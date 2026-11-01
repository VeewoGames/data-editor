import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createAuthorityFixture,digest,assertFixtureLedgerUnchanged,assertMissing} from './helpers/authority-fixture.mjs';
const fixture=createAuthorityFixture;
const closed={code:'HISTORY_RUN_CLOSED'};

test('receipt keeps old runs closed across all public wrappers and raw effects without side effects',async t=>{
 const f=await fixture(t);let effects=0;
 const op=async()=>effects++;
 for(const runId of [f.old,f.child]){
  await assert.rejects(()=>f.runtime.publicationStart(op)({projectContext:f.context,dependencies:{runId}}),closed);
  await assert.rejects(()=>f.runtime.publicationRecovery(op)({projectContext:f.context,runId}),closed);
  await assert.rejects(()=>f.runtime.publicationObserve(f.context,runId,op),closed);
  await assert.rejects(()=>f.runtime.publicationExistingOperation(f.context,runId,op),closed);
  await assert.rejects(()=>f.mod.withHistoricalRun(f.context,[runId],()=>f.atomic.atomicWrite(f.sourceFile,'forbidden')),closed);
 }
 assert.equal(effects,0);assert.match(await readFile(f.sourceFile,'utf8'),/original/);
});

test('ordinary author save and later new automation remain valid after receipt',async t=>{
 const f=await fixture(t);await f.pub.initializePublicationWindow(f.context);
 const journalFile=path.join(f.runtimeRoot,'commit-journal/author.json');await mkdir(path.dirname(journalFile));
 await f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile},()=>f.atomic.atomicWrite(f.sourceFile,'[{"draft":"new input", "count":2}]'));
 assert.ok((await f.inventory()).every(x=>!x.blocking));
 const result=await f.runtime.publicationStart(async input=>input.dependencies.runId)({projectContext:f.context});assert.ok(result);assert.notEqual(result,f.old);
 await f.mod.assertHistoricalRunAllowed(f.context,['new-run']);
 await writeFile(path.join(f.actions,'new-run.started.json'),'{"runId":"new-run"}');
 const all=await f.inventory();assert.ok(all.some(x=>x.runId==='new-run'&&x.blocking));assert.ok(all.filter(x=>x.runId===f.old).every(x=>!x.blocking));
});

test('related parent child and group evidence drift or added sibling invalidates projection',async t=>{
 const f=await fixture(t);
 const group=path.join(f.runtimeRoot,'entry-action-group-journal/group.json'),before=await readFile(group);
 await writeFile(group,'{"runId":"other","groupId":"group-a","stage":"unknown"}');
 await assert.rejects(()=>f.inventory(),{code:'HISTORY_EVIDENCE_DRIFT'});await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['new']),{code:'HISTORY_EVIDENCE_DRIFT'});
 await writeFile(group,before);await writeFile(path.join(f.actions,'sibling.json'),JSON.stringify({runId:'sibling',parentRunId:f.old}));
 assert.ok((await f.inventory()).some(x=>x.blocking));
});

test('later READY through OPEN uses the same projection; new unresolved run blocks READY',async t=>{
 const f=await fixture(t);await f.pub.initializePublicationWindow(f.context);
 await writeFile(path.join(f.root,'.data-editor/automation-profile.json'),JSON.stringify({rules:[]}));
 await writeFile(path.join(f.root,'.data-editor/entry-action-contracts.json'),JSON.stringify({version:1,contracts:[]}));
 await writeFile(path.join(f.root,'program.mjs'),'before');
 await f.pub.closePublicationWindow(f.context,{publisher:'fixture',files:[{path:'program.mjs',afterDigest:digest('after')}]});
 const advance=async transition=>{const state=await f.pub.inspectPublicationWindow(f.context);return f.pub.advancePublicationWindow(f.context,{windowId:state.windowId,revision:state.revision,publisher:'fixture',transition});};
 await advance('READY');await advance('DEPLOYING');await writeFile(path.join(f.root,'program.mjs'),'after');await advance('VERIFYING');assert.equal((await advance('OPEN')).state,'OPEN');
 await f.pub.closePublicationWindow(f.context,{publisher:'fixture',files:[{path:'program.mjs',afterDigest:digest('after')}]});
 await writeFile(path.join(f.actions,'new-unknown.started.json'),JSON.stringify({runId:'new-unknown'}));
 await assert.rejects(()=>advance('READY'),{code:'PUBLICATION_HISTORY_PENDING'});
});

test('group member relabel and same group ID cannot use a fresh automation writer',async t=>{
 const f=await fixture(t);const file=path.join(f.runtimeRoot,'entry-action-group-journal/new.json');
 for(const value of [{runId:'fresh',members:[{runId:f.child}]},{runId:'fresh',groupId:'group-a'}]){
  await assert.rejects(()=>f.mod.withHistoricalRun(f.context,['fresh'],()=>f.atomic.atomicWrite(file,JSON.stringify(value))),closed);
 }
 await assert.rejects(()=>readFile(file),{code:'ENOENT'});
});


test('server save identity callback and legacy generated journal key have exact narrow author authority',async t=>{
 const f=await fixture(t);await f.pub.initializePublicationWindow(f.context);
 const {createDocumentCommitCoordinator}=await import(pathToFileURL(path.join(f.tool,'src/document-commit-coordinator.mjs')));
 const coordinator=createDocumentCommitCoordinator(),key='legacy_'+digest('real-server-save-request');
 await coordinator.withCommit({projectContext:f.context,sourcePath:'data/items.json'},async identity=>{
  const sourceFile=identity.resolvedPath??identity.canonicalPath,journalFile=path.join(f.context.projectRoot,f.context.runtimeDir,'commit-journal',key+'.json');
  await mkdir(path.dirname(journalFile),{recursive:true});
  await f.mod.withHistoricalAuthorSave(f.context,{sourceFile,journalFile},async()=>{
   await f.atomic.atomicWrite(journalFile,JSON.stringify({idempotencyKey:key,stage:'commit_intent'}));
   await f.atomic.atomicWrite(sourceFile,'server-save');
   await f.atomic.atomicWrite(journalFile,JSON.stringify({idempotencyKey:key,stage:'result_published'}));
  });
 });
 assert.equal(await readFile(f.sourceFile,'utf8'),'server-save');
});


test('known old runs and raw group writers stay refused when original evidence has drifted',async t=>{
 const f=await fixture(t);
 await writeFile(path.join(f.actions,f.old+'.started.json'),'external-corruption');
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[f.old]),{code:'HISTORY_EVIDENCE_DRIFT'});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['new-reader']),{code:'HISTORY_EVIDENCE_DRIFT'});
 await assert.rejects(()=>f.atomic.atomicWrite(path.join(f.runtimeRoot,'entry-action-group-journal/new.json'),JSON.stringify({runId:'fresh',groupId:'group-a'})),{code:'HISTORY_EVIDENCE_DRIFT'});
});

test('ordinary observations validate original bytes while new external relations block the next full admission',async t=>{
 const f=await fixture(t);
 await writeFile(path.join(f.actions,'external-sibling.json'),JSON.stringify({runId:'external-sibling',parentRunId:f.old}));
 await f.mod.assertHistoricalRunAllowed(f.context,['current-reader']);
 let observations=0;await f.runtime.publicationObserve(f.context,'current-reader',async()=>observations++);assert.equal(observations,1);
 let starts=0;await assert.rejects(()=>f.runtime.publicationStart(async()=>starts++)({projectContext:f.context}),{code:'HISTORY_EVIDENCE_DRIFT'});assert.equal(starts,0);
 await assert.rejects(()=>f.runtime.publicationRecovery(async()=>starts++)({projectContext:f.context,runId:'fresh-recovery'}),{code:'HISTORY_EVIDENCE_DRIFT'});assert.equal(starts,0);
 assert.ok((await f.inventory()).some(x=>x.blocking));
});

test('each ordinary observation rehashes original evidence without cross-request cached validity',async t=>{
 const f=await fixture(t);
 await f.runtime.publicationObserve(f.context,'reader',async()=>{});
 await writeFile(path.join(f.actions,f.old+'.started.json'),'{}');
 await assert.rejects(()=>f.runtime.publicationObserve(f.context,'reader',async()=>assert.fail()),{code:'HISTORY_EVIDENCE_DRIFT'});
});


test('a mutating observed command recovery upgrades before publishing any new result',async t=>{
 const f=await fixture(t);
 await writeFile(path.join(f.actions,'external-sibling.json'),JSON.stringify({runId:'external-sibling',parentRunId:f.old}));
 const id='fresh-observed-recovery',handoff={runId:id,action:{id:'command',execution:{kind:'project-command'}},projectCommand:{writer:{pid:String(process.pid),creationTime:'old-process-identity'}}};
 await writeFile(path.join(f.actions,id+'.json'),JSON.stringify(handoff));
 const {recoverProjectCommandRun}=await import(pathToFileURL(path.join(f.tool,'src/project-command-recovery.mjs')));
 await assert.rejects(()=>recoverProjectCommandRun(f.context,id,undefined,{observer:true}),{code:'HISTORY_EVIDENCE_DRIFT'});
 await assert.rejects(()=>readFile(path.join(f.actions,id+'.result.json')),{code:'ENOENT'});
});

test('observed followup and nested recovery cannot inherit a read-only admission to mutate',async t=>{
 const f=await fixture(t);
 await writeFile(path.join(f.actions,'external-sibling.json'),JSON.stringify({runId:'external-sibling',parentRunId:f.old}));
 let effects=0;
 await assert.rejects(()=>f.runtime.publicationObserve(f.context,'fresh-nested',()=>f.runtime.publicationRecovery(async()=>effects++)({projectContext:f.context,runId:'fresh-nested'})),{code:'HISTORY_EVIDENCE_DRIFT'});
 const id='fresh-parent',handoff={runId:id,entry:{sourcePath:'data/items.json',collectionPath:'items',rowId:'one'},projectSkillLifecycle:{configDigest:'config',followup:{actionId:'child',on:['completed_with_writeback']}}};
 await writeFile(path.join(f.actions,id+'.json'),JSON.stringify(handoff));await writeFile(path.join(f.actions,id+'.result.json'),JSON.stringify({runId:id,phase:'terminal',outcome:'completed_with_writeback'}));
 const {resumeProjectSkillFollowup}=await import(pathToFileURL(path.join(f.tool,'src/project-skill-followup.mjs')));
 await assert.rejects(()=>resumeProjectSkillFollowup({projectContext:f.context,parentRunId:id,startChild:async()=>effects++}),{code:'HISTORY_EVIDENCE_DRIFT'});
 assert.equal(effects,0);await assert.rejects(()=>readFile(path.join(f.actions,id+'.followup.json')),{code:'ENOENT'});
});


test('terminal observed command and unchanged completed followup remain pure reads',async t=>{
 const f=await fixture(t);
 await writeFile(path.join(f.actions,'external-sibling.json'),JSON.stringify({runId:'external-sibling',parentRunId:f.old}));
 const recovery=await import(pathToFileURL(path.join(f.tool,'src/project-command-recovery.mjs'))),followup=await import(pathToFileURL(path.join(f.tool,'src/project-skill-followup.mjs')));
 const id='terminal-reader';await writeFile(path.join(f.actions,id+'.json'),JSON.stringify({runId:id,action:{id:'command',execution:{kind:'project-command'}},projectCommand:{writer:{pid:String(process.pid),creationTime:'old-identity'}}}));
 await writeFile(path.join(f.actions,id+'.result.json'),JSON.stringify({runId:id,phase:'terminal',outcome:'completed_without_changes'}));
 assert.equal((await recovery.recoverProjectCommandRun(f.context,id,undefined,{observer:true})).recovered,true);
 const parent='completed-parent',entry={sourcePath:'data/items.json',collectionPath:'items',rowId:'one'},identity=followup.followupIdentity(parent,'child',entry);
 await writeFile(path.join(f.actions,parent+'.json'),JSON.stringify({runId:parent,entry,projectSkillLifecycle:{configDigest:'config',followup:{actionId:'child',on:['completed_with_writeback']}}}));
 await writeFile(path.join(f.actions,parent+'.result.json'),JSON.stringify({runId:parent,phase:'terminal',outcome:'completed_with_writeback'}));
 const file=path.join(f.actions,parent+'.followup.json'),intent={version:1,parentRunId:parent,actionId:'child',...identity,configDigest:'config',target:entry,state:'completed',childOutcome:'completed_without_changes',childResultStatus:'no_changes'};
 await writeFile(file,JSON.stringify(intent));await writeFile(path.join(f.actions,identity.childRunId+'.result.json'),JSON.stringify({runId:identity.childRunId,phase:'terminal',outcome:'completed_without_changes',resultStatus:'no_changes'}));
 const before=await readFile(file);assert.equal((await followup.resumeProjectSkillFollowup({projectContext:f.context,parentRunId:parent,startChild:()=>assert.fail()})).state,'completed');assert.deepEqual(await readFile(file),before);
});



test('source receipt preserves inventoried closure and unknown business outcomes byte for byte',async t=>{
 const f=await fixture(t),record=f.record;
 assert.equal(record.phase,'receipt');assert.equal(record.contract,'managed-entry-non-replay-v1');
 assert.deepEqual(record.evidence.snapshot.runIds,[f.old,f.child]);assert.deepEqual(record.evidence.snapshot.groupIds,['group-a']);
 assert.equal(record.evidence.obligations.length,3);assert.equal(record.businessOutcome,undefined);
 assert.ok((await f.inventory()).every(item=>item.blocking===false));
 await assertMissing(path.join(f.actions,f.old+'.result.json'));await assertFixtureLedgerUnchanged(f);
});

test('author source and journal are exact across two managed roots while external tool cache keeps its owner',async t=>{
 const f=await fixture(t,{rootCount:2}),other=f.projects[1],outside=path.join(f.directory,'home/capabilities/cache.json'),journalFile=path.join(f.runtimeRoot,'commit-journal/save.json');
 await mkdir(path.dirname(outside),{recursive:true});await mkdir(path.dirname(journalFile),{recursive:true});
 await f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile},async()=>{
  await f.atomic.atomicWrite(outside,'tool-owned-cache');await f.atomic.atomicWrite(f.sourceFile,'author-input');
  await assert.rejects(()=>f.atomic.atomicWrite(path.join(f.root,'data/other.json'),'forbidden'),{code:'HISTORY_AUTHOR_WRITESET_INVALID'});
  await assert.rejects(()=>f.atomic.atomicWrite(other.sourceFile,'cross-project'),{code:'HISTORY_BINDING_INVALID'});
 });
 assert.equal(await readFile(outside,'utf8'),'tool-owned-cache');assert.match(await readFile(other.sourceFile,'utf8'),/original/);await assertFixtureLedgerUnchanged(f);
});

test('unrelated terminal history is inventoried but excluded from source receipt closure',async t=>{
 const id='unrelated-terminal',f=await fixture(t,{seed:async project=>{
  await writeFile(path.join(project.actions,id+'.started.json'),JSON.stringify({runId:id}));
  await writeFile(path.join(project.actions,id+'.result.json'),JSON.stringify({phase:'terminal',outcome:'completed_without_changes',runId:id}));
 }});
 assert.ok(!f.record.relatedRunIds.includes(id));assert.ok(!f.record.evidence.snapshot.files.some(item=>item.runIds.includes(id)));
 await f.mod.assertHistoricalRunAllowed(f.context,[id]);let effects=0;
 await f.runtime.publicationRecovery(async()=>effects++)({projectContext:f.context,runId:id});assert.equal(effects,1);
});

test('real canonical legacy handoff stays unknown while only its execution and save blockers project closed',async t=>{
 const f=await fixture(t,{seed:async(project,{load})=>{
  const {canonicalFileIdentity}=await load('src/canonical-file-identity.mjs'),identity=await canonicalFileIdentity(project.context,'data/items.json');
  const handoff={runId:project.old,entry:{sourcePath:'data/items.json',canonicalFileKey:identity.canonicalFileKey},action:{id:'legacy',execution:{kind:'project-skill'}}};
  await writeFile(path.join(project.actions,project.old+'.json'),JSON.stringify(handoff));
  await writeFile(path.join(project.root,'.data-editor/automation-profile.json'),JSON.stringify({rules:[]}));
 }});
 const actions=await f.load('src/entry-actions.mjs'),policy=await f.load('src/field-write-policy.mjs'),file=path.join(f.actions,f.old+'.json'),before=await readFile(file);
 let active=await actions.findActiveEntryActionRuns(f.context,'data/items.json');assert.deepEqual(active.runs,[]);assert.equal(active.historicalRuns.length,1);assert.equal(active.historicalRuns[0].phase,'running');assert.equal(active.historicalRuns[0].historicalDisposition.businessOutcome,'unchanged');
 assert.deepEqual(await policy.ordinarySaveBlockingRuns(f.context,[{runId:f.old,actionId:'legacy',phase:'running'}]),[]);
 assert.deepEqual(await readFile(file),before);await assertMissing(path.join(f.actions,f.old+'.result.json'));
 const fresh={...JSON.parse(before),runId:'fresh-active'};await writeFile(path.join(f.actions,'fresh-active.json'),JSON.stringify(fresh));
 active=await actions.findActiveEntryActionRuns(f.context,'data/items.json');assert.deepEqual(active.runs.map(item=>item.runId),['fresh-active']);assert.equal(active.historicalRuns.length,1);
 assert.equal((await policy.ordinarySaveBlockingRuns(f.context,[{runId:'fresh-active',actionId:'legacy',phase:'running',historicalDisposition:{blocking:false}}])).length,1);
 await writeFile(file,JSON.stringify({...JSON.parse(before),externalChanged:true}));await assert.rejects(()=>actions.findActiveEntryActionRuns(f.context,'data/items.json'),{code:'HISTORY_EVIDENCE_DRIFT'});
});

test('GET legacy migration leaves source receipt history and full-admission-refused fresh bytes untouched',async t=>{
 const f=await fixture(t,{seed:async project=>writeFile(path.join(project.actions,project.old+'.started.json'),JSON.stringify({runId:project.old,status:'started',startedAt:'2020-01-01T00:00:00Z'}))});
 const oldFile=path.join(f.actions,f.old+'.started.json'),oldBytes=await readFile(oldFile),{migrateLegacyEntryActionStateArtifacts}=await f.load('src/entry-actions.mjs');
 const allowedFile=path.join(f.actions,'allowed-legacy.started.json');await writeFile(allowedFile,JSON.stringify({runId:'allowed-legacy',status:'started'}));
 const allowed=await f.runtime.publicationObserve(f.context,'legacy-state-migration',()=>migrateLegacyEntryActionStateArtifacts(f.context));assert.deepEqual(allowed.migrated,[allowedFile]);assert.equal(JSON.parse(await readFile(allowedFile)).phase,'review_running');assert.deepEqual(await readFile(oldFile),oldBytes);
 const refusedFile=path.join(f.actions,'refused-legacy.started.json');await writeFile(refusedFile,JSON.stringify({runId:'refused-legacy',status:'started'}));const refusedBytes=await readFile(refusedFile);
 await writeFile(path.join(f.actions,'external-sibling.json'),JSON.stringify({runId:'external-sibling',parentRunId:f.old}));
 const refused=await f.runtime.publicationObserve(f.context,'legacy-state-migration',()=>migrateLegacyEntryActionStateArtifacts(f.context));assert.deepEqual(refused.migrated,[]);assert.deepEqual(await readFile(refusedFile),refusedBytes);assert.deepEqual(await readFile(oldFile),oldBytes);
});
