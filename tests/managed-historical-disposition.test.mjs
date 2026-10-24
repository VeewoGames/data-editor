import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rm,cp} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const app=path.resolve(import.meta.dirname,'..'),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const base=path.join(app,'tests/managed-history-fixtures');await mkdir(base,{recursive:true});
 const directory=await mkdtemp(path.join(base,'case-')),tool=path.join(directory,'editor'),root=path.join(directory,'project');
 t.after(async()=>{assert.equal(path.dirname(directory),base);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:30});});
 await cp(path.join(app,'src'),path.join(tool,'src'),{recursive:true});await cp(path.join(app,'server.mjs'),path.join(tool,'server.mjs'));await mkdir(path.join(tool,'scripts'));await cp(path.join(app,'scripts/historical-deployment-upgrade.mjs'),path.join(tool,'scripts/historical-deployment-upgrade.mjs'));await mkdir(path.join(tool,'config'));await mkdir(path.join(root,'data'),{recursive:true});
 const mod=await import(pathToFileURL(path.join(tool,'src/historical-disposition.mjs'))),pub=await import(pathToFileURL(path.join(tool,'src/publication-window-state.mjs'))),runtime=await import(pathToFileURL(path.join(tool,'src/publication-window-runtime.mjs'))),scan=await import(pathToFileURL(path.join(tool,'src/publication-window-obligations.mjs'))),atomic=await import(pathToFileURL(path.join(tool,'src/atomic-file.mjs')));
 const context={projectRoot:root,runtimeDir:'.data-editor/runtime'},runtimeRoot=path.join(root,context.runtimeDir),actions=path.join(runtimeRoot,'entry-actions');await mkdir(actions,{recursive:true});
 const sourceFile=path.join(root,'data/items.json');await writeFile(sourceFile,'[{"draft":"original", "count":1}]');
 const old='10000000-0000-4000-8000-000000000001',child='10000000-0000-4000-8000-000000000002';
 await writeFile(path.join(actions,old+'.started.json'),JSON.stringify({runId:old}));
 await writeFile(path.join(actions,child+'.started.json'),JSON.stringify({runId:child,parentRunId:old}));
 await mkdir(path.join(runtimeRoot,'entry-action-group-journal'));await writeFile(path.join(runtimeRoot,'entry-action-group-journal/group.json'),JSON.stringify({runId:old,runIds:[old,child],groupId:'group-a',stage:'unknown'}));
 const config=path.join(tool,'config/historical-disposition-deployment.json'),normalize=f=>process.platform==='win32'?f.replaceAll('\\','/').toLowerCase():f;
 const policy={contract:mod.managedHistoryContract,businessFiles:['data/items.json'],deploymentFiles:await Promise.all(mod.managedHistoryRequiredDeploymentFiles.map(async file=>({path:file,digest:digest(await readFile(path.join(tool,file)))})))};
 const deployment={version:1,entries:[{projectRoot:normalize(root),runtime:normalize(runtimeRoot),anchorId:'managed-fixture-anchor',managedNonReplay:policy}]};
 await writeFile(config,JSON.stringify(deployment));await mod.initializeHistoricalDisposition(context);
 const binding=await mod.historyBinding(context),inventory=()=>scan.scanPublicationObligations(binding),prepare=()=>mod.prepareHistoricalDisposition(context),commit=id=>mod.commitHistoricalDisposition(context,{dispositionId:id});
 return {directory,tool,root,mod,pub,runtime,scan,atomic,context,runtimeRoot,actions,old,child,sourceFile,config,deployment,binding,inventory,prepare,commit};
}
const closed={code:'HISTORY_RUN_CLOSED'};

async function upgradeFixture(t){
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);await f.pub.initializePublicationWindow(f.context);
 const source=await readFile(f.config),ledgerFile=path.join(f.binding.directory,'state.json'),ledger=await readFile(ledgerFile);
 const upgrade=await import(pathToFileURL(path.join(f.tool,'scripts/historical-deployment-upgrade.mjs')));
 await writeFile(path.join(f.tool,'server.mjs'),Buffer.concat([await readFile(path.join(f.tool,'server.mjs')),Buffer.from('\n// isolated successor release\n')]));
 const bundle=await upgrade.prepareDeploymentUpgrade(f.context,source);
 return {...f,upgrade,bundle,source,ledger,ledgerFile};
}

test('deployment successor preserves original proof, closes old runs and permits later author edits',async t=>{
 const f=await upgradeFixture(t);
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),{code:'HISTORY_DEPLOYMENT_DRIFT'});
 assert.equal((await f.upgrade.applyDeploymentUpgrade(f.context,f.bundle)).status,'applied');
 assert.deepEqual(await readFile(f.ledgerFile),f.ledger);
 await f.mod.assertHistoricalRunAllowed(f.context,['fresh'],{fullInventory:true});
 for(const id of [f.old,f.child])await assert.rejects(()=>f.runtime.publicationRecovery(async()=>{throw Error('REPLAY');})({projectContext:f.context,runId:id}),closed);
 assert.ok((await f.inventory()).every(item=>item.blocking===false));
 const journalFile=path.join(f.runtimeRoot,'commit-journal/author.json');await mkdir(path.dirname(journalFile));
 await f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile},()=>f.atomic.atomicWrite(f.sourceFile,'[{"draft":"later author input"}]'));
 await f.mod.assertHistoricalRunAllowed(f.context,['another-new'],{fullInventory:true});
 assert.deepEqual(await readFile(f.ledgerFile),f.ledger);
 assert.equal((await f.upgrade.applyDeploymentUpgrade(f.context,f.bundle)).status,'already_applied');
});

test('successor ledger pin is unconditional for empty records, removed receipt and whitespace drift',async t=>{
 const f=await upgradeFixture(t);await f.upgrade.applyDeploymentUpgrade(f.context,f.bundle);
 const state=JSON.parse(f.ledger);
 for(const bytes of [Buffer.from(JSON.stringify({...state,records:{}})),Buffer.concat([f.ledger,Buffer.from('\n')])]){
  await writeFile(f.ledgerFile,bytes);
  await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),{code:'HISTORY_SUCCESSOR_INVALID'});
  await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[f.old]));
  await assert.rejects(()=>f.inventory(),{code:'HISTORY_SUCCESSOR_INVALID'});
 }
 await writeFile(f.ledgerFile,f.ledger);await f.mod.assertHistoricalRunAllowed(f.context,['fresh']);
});

test('missing or altered successor materials, target selection and target code are fail closed',async t=>{
 const f=await upgradeFixture(t);await f.upgrade.applyDeploymentUpgrade(f.context,f.bundle);
 const configBytes=await readFile(f.config),config=JSON.parse(configBytes),ref=config.entries[0].deploymentSuccessor;
 const certFile=path.join(path.dirname(f.config),ref.path),certBytes=await readFile(certFile);
 await rm(certFile);await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),{code:'HISTORY_SUCCESSOR_INVALID'});
 await writeFile(certFile,Buffer.concat([certBytes,Buffer.from(' ')]));await assert.rejects(()=>f.inventory(),{code:'HISTORY_SUCCESSOR_INVALID'});
 await writeFile(certFile,certBytes);
 delete config.entries[0].deploymentSuccessor;await writeFile(f.config,JSON.stringify(config));
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),{code:'HISTORY_BINDING_INVALID'});
 await writeFile(f.config,configBytes);
 const cert=JSON.parse(certBytes),snapshot=path.join(path.dirname(f.config),cert.sourceSnapshot.path),original=await readFile(snapshot);
 await writeFile(snapshot,Buffer.concat([original,Buffer.from('\n')]));await assert.rejects(()=>f.inventory(),{code:'HISTORY_SUCCESSOR_INVALID'});await writeFile(snapshot,original);
 await writeFile(path.join(f.tool,'server.mjs'),'drift');
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),{code:'HISTORY_DEPLOYMENT_DRIFT'});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[f.old]),closed);
});

test('successor preparation rejects wrong origin, new obligations, live reservations and changed evidence',async t=>{
 const f=await upgradeFixture(t);
 const wrong=JSON.parse(f.source);wrong.entries[0].managedNonReplay.deploymentFiles.reverse();
 await assert.rejects(()=>f.upgrade.prepareDeploymentUpgrade(f.context,Buffer.from(JSON.stringify(wrong))),{code:'HISTORY_UPGRADE_SOURCE_INVALID'});
 const fresh=path.join(f.actions,'fresh.started.json');await writeFile(fresh,JSON.stringify({runId:'fresh'}));
 await assert.rejects(()=>f.upgrade.prepareDeploymentUpgrade(f.context,f.source),{code:'HISTORY_UPGRADE_NEW_OBLIGATIONS'});await rm(fresh);
 const publicationFile=path.join(f.root,'.data-editor/publication-admission/state.json'),publicationBytes=await readFile(publicationFile),publication=JSON.parse(publicationBytes);
 for(const patch of [{accepted:{fresh:{settled:false}}},{accepted:[]},{continuations:[]},{accepted:{fresh:{settled:'false'}}},{accepted:{fresh:null}}]){
  await writeFile(publicationFile,JSON.stringify({...publication,...patch}));
  await assert.rejects(()=>f.upgrade.prepareDeploymentUpgrade(f.context,f.source),{code:'HISTORY_UPGRADE_NOT_QUIESCENT'});
 }
 await writeFile(publicationFile,publicationBytes);
 await writeFile(path.join(f.actions,f.old+'.started.json'),'changed');
 await assert.rejects(()=>f.upgrade.prepareDeploymentUpgrade(f.context,f.source),{code:'HISTORY_EVIDENCE_DRIFT'});
 assert.deepEqual(await readFile(f.config),f.source);assert.deepEqual(await readFile(f.ledgerFile),f.ledger);
});

test('successor apply rejects stale inputs; inert proof files and exact retries are safe',async t=>{
 const f=await upgradeFixture(t),server=path.join(f.tool,'server.mjs'),before=await readFile(server);
 await writeFile(server,Buffer.concat([before,Buffer.from('// later change')]));
 await assert.rejects(()=>f.upgrade.applyDeploymentUpgrade(f.context,f.bundle),{code:'HISTORY_UPGRADE_INPUT_DRIFT'});await writeFile(server,before);
 const changedConfig=Buffer.concat([f.source,Buffer.from('\n')]);await writeFile(f.config,changedConfig);
 await assert.rejects(()=>f.upgrade.applyDeploymentUpgrade(f.context,f.bundle),{code:'HISTORY_UPGRADE_CONFIG_STALE'});await writeFile(f.config,f.source);
 const cert=f.bundle.certificate,certRef=f.bundle.targetConfig.entries[0].deploymentSuccessor,directory=path.dirname(f.config);
 await mkdir(path.join(directory,'historical-deployment-upgrades'));
 // Crash before config selection: both immutable artifacts exist but authorize nothing.
 await writeFile(path.join(directory,cert.sourceSnapshot.path),f.source,{flag:'wx'});
 await writeFile(path.join(directory,certRef.path),`${JSON.stringify(cert,null,2)}\n`,{flag:'wx'});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),{code:'HISTORY_DEPLOYMENT_DRIFT'});
 assert.equal((await f.upgrade.applyDeploymentUpgrade(f.context,f.bundle)).status,'applied');
 assert.equal((await f.upgrade.applyDeploymentUpgrade(f.context,f.bundle)).status,'already_applied');
 assert.deepEqual(await readFile(f.ledgerFile),f.ledger);
});
test('intent crash resumes original decision, preserves bytes and blocks first initialization',async t=>{
 const f=await fixture(t),before=await readFile(path.join(f.actions,f.old+'.started.json'));
 const intent=await f.prepare();assert.equal(intent.phase,'intent');
 assert.deepEqual(await f.prepare(),intent);
 await assert.rejects(()=>f.pub.initializePublicationWindow(f.context),{code:'PUBLICATION_HISTORY_PENDING'});
 let effects=0;await assert.rejects(()=>f.runtime.publicationRecovery(async()=>effects++)({projectContext:f.context,runId:f.child}),closed);assert.equal(effects,0);
 const record=await f.commit(intent.dispositionId);assert.equal(record.contract,'managed-entry-non-replay-v1');assert.equal(record.evidence.snapshot.runIds.length,2);assert.deepEqual(record.evidence.snapshot.groupIds,['group-a']);
 assert.equal(record.evidence.obligations.length,3);assert.equal(record.businessOutcome,undefined);
 assert.deepEqual(await f.commit(intent.dispositionId),record);assert.deepEqual(await readFile(path.join(f.actions,f.old+'.started.json')),before);
 assert.equal(await readFile(path.join(f.actions,f.old+'.result.json')).then(()=>true,e=>e.code!=='ENOENT'),false);
 const all=await f.inventory();assert.equal(all.length,4);assert.ok(all.every(x=>x.blocking===false));
 const window=await f.pub.initializePublicationWindow(f.context);assert.equal(window.state,'OPEN');
 assert.equal((await f.pub.inspectPublicationWindow(f.context)).state,'OPEN');
});
test('receipt keeps old runs closed across all public wrappers and raw effects without side effects',async t=>{
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);let effects=0;
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
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);await f.pub.initializePublicationWindow(f.context);
 const journalFile=path.join(f.runtimeRoot,'commit-journal/author.json');await mkdir(path.dirname(journalFile));
 await f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile},()=>f.atomic.atomicWrite(f.sourceFile,'[{"draft":"new input", "count":2}]'));
 assert.ok((await f.inventory()).every(x=>!x.blocking));
 const result=await f.runtime.publicationStart(async input=>input.dependencies.runId)({projectContext:f.context});assert.ok(result);assert.notEqual(result,f.old);
 await f.mod.assertHistoricalRunAllowed(f.context,['new-run']);
 await writeFile(path.join(f.actions,'new-run.started.json'),'{"runId":"new-run"}');
 const all=await f.inventory();assert.ok(all.some(x=>x.runId==='new-run'&&x.blocking));assert.ok(all.filter(x=>x.runId===f.old).every(x=>!x.blocking));
});
test('business drift before commit remains blocking; original run intent cannot be replaced',async t=>{
 const f=await fixture(t),intent=await f.prepare();await writeFile(f.sourceFile,'changed concurrently');
 await assert.rejects(()=>f.commit(intent.dispositionId),{code:'HISTORY_BUSINESS_BASELINE_DRIFT'});
 assert.equal((await f.prepare()).dispositionId,intent.dispositionId);assert.ok((await f.inventory()).some(x=>x.blocking));await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[f.old]),closed);
});
test('related parent child and group evidence drift or added sibling invalidates projection',async t=>{
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);
 const group=path.join(f.runtimeRoot,'entry-action-group-journal/group.json'),before=await readFile(group);
 await writeFile(group,'{"runId":"other","groupId":"group-a","stage":"unknown"}');
 assert.ok((await f.inventory()).some(x=>x.blocking));await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['new']),{code:'HISTORY_EVIDENCE_DRIFT'});
 await writeFile(group,before);await writeFile(path.join(f.actions,'sibling.json'),JSON.stringify({runId:'sibling',parentRunId:f.old}));
 assert.ok((await f.inventory()).some(x=>x.blocking));
});
test('wrong root runtime anchor and caller verified or fake receipt cannot authorize',async t=>{
 const f=await fixture(t),intent=await f.prepare();
 await assert.rejects(()=>f.mod.commitHistoricalDisposition(f.context,{dispositionId:intent.dispositionId,verified:true}),{code:'HISTORY_DISPOSITION_REQUEST_INVALID'});
 await assert.rejects(()=>f.mod.commitHistoricalDisposition(f.context,{dispositionId:'caller-fake'}),{code:'HISTORY_DISPOSITION_NOT_FOUND'});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed({...f.context,runtimeDir:'other'},['new']),{code:'HISTORY_BINDING_INVALID'});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed({...f.context,projectRoot:path.join(f.root,'data')},['new']),{code:'HISTORY_BINDING_INVALID'});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed({...f.context,historicalDispositionAnchorId:'wrong'},['new']),{code:'HISTORY_BINDING_INVALID'});
});
test('missing guard manifest and partially delivered code both remain blocking',async t=>{
 const f=await fixture(t),intent=await f.prepare(),entry=f.deployment.entries[0],manifest=entry.managedNonReplay.deploymentFiles;
 entry.managedNonReplay.deploymentFiles=manifest.slice(1);await writeFile(f.config,JSON.stringify(f.deployment));
 await assert.rejects(()=>f.commit(intent.dispositionId),{code:'HISTORY_DEPLOYMENT_INCOMPLETE'});
 entry.managedNonReplay.deploymentFiles=manifest;await writeFile(f.config,JSON.stringify(f.deployment));
 await writeFile(path.join(f.tool,'src/entry-actions.mjs'),'// partial old deployment');
 await assert.rejects(()=>f.commit(intent.dispositionId),{code:'HISTORY_DEPLOYMENT_DRIFT'});assert.ok((await f.inventory()).some(x=>x.blocking));
});
test('original evidence byte change after intent refuses commit without touching old result',async t=>{
 const f=await fixture(t),intent=await f.prepare();await writeFile(path.join(f.actions,f.child+'.started.json'),'{}');
 await assert.rejects(()=>f.commit(intent.dispositionId),{code:'HISTORY_EVIDENCE_DRIFT'});assert.ok((await f.inventory()).some(x=>x.blocking));
});

test('process exit after durable intent resumes original disposition in a fresh process',async t=>{
 const f=await fixture(t),url=pathToFileURL(path.join(f.tool,'src/historical-disposition.mjs')).href;
 const code=`const m=await import(${JSON.stringify(url)});const i=await m.prepareHistoricalDisposition(${JSON.stringify(f.context)});process.stdout.write(JSON.stringify(i));process.exit(17);`;
 const crashed=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{windowsHide:true}).catch(e=>e);
 assert.equal(crashed.code,17);const intent=JSON.parse(crashed.stdout);
 assert.equal((await f.prepare()).dispositionId,intent.dispositionId);await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[f.old]),closed);
 const recovery=`const m=await import(${JSON.stringify(url)});const r=await m.commitHistoricalDisposition(${JSON.stringify(f.context)},{dispositionId:${JSON.stringify(intent.dispositionId)}});process.stdout.write(r.phase);`;
 assert.equal((await promisify(execFile)(process.execPath,['--input-type=module','-e',recovery],{windowsHide:true})).stdout,'receipt');
 assert.ok((await f.inventory()).every(x=>!x.blocking));
});
test('later READY through OPEN uses the same projection; new unresolved run blocks READY',async t=>{
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);await f.pub.initializePublicationWindow(f.context);
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
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);const file=path.join(f.runtimeRoot,'entry-action-group-journal/new.json');
 for(const value of [{runId:'fresh',members:[{runId:f.child}]},{runId:'fresh',groupId:'group-a'}]){
  await assert.rejects(()=>f.mod.withHistoricalRun(f.context,['fresh'],()=>f.atomic.atomicWrite(file,JSON.stringify(value))),closed);
 }
 await assert.rejects(()=>readFile(file),{code:'ENOENT'});
});

test('unrelated terminal history is inventoried but excluded from the managed refusal closure',async t=>{
 const f=await fixture(t),id='unrelated-terminal';
 await writeFile(path.join(f.actions,id+'.started.json'),JSON.stringify({runId:id}));
 await writeFile(path.join(f.actions,id+'.result.json'),JSON.stringify({phase:'terminal',outcome:'completed_without_changes',runId:id}));
 const record=await f.commit((await f.prepare()).dispositionId);
 assert.ok(!record.relatedRunIds.includes(id));assert.ok(!record.evidence.snapshot.files.some(x=>x.runIds.includes(id)));
 await f.mod.assertHistoricalRunAllowed(f.context,[id]);
 let effects=0;await f.runtime.publicationRecovery(async()=>effects++)({projectContext:f.context,runId:id});assert.equal(effects,1);
 assert.ok((await f.inventory()).every(x=>!x.blocking));
});


test('server save identity callback and legacy generated journal key have exact narrow author authority',async t=>{
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);await f.pub.initializePublicationWindow(f.context);
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

test('author source and journal stay exact while external tool cache keeps its owner and another managed root is refused',async t=>{
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);
 const outside=path.join(f.directory,'home/capabilities/lkg/project.json'),journalFile=path.join(f.runtimeRoot,'commit-journal/save.json');
 await mkdir(path.dirname(outside),{recursive:true});await mkdir(path.dirname(journalFile));
 await f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile},async()=>{
  await f.atomic.atomicWrite(outside,'tool-owned-cache');
  await f.atomic.atomicWrite(f.sourceFile,'valid-author-input');
  await assert.rejects(()=>f.atomic.atomicWrite(path.join(f.root,'data/other.json'),'forbidden'),{code:'HISTORY_AUTHOR_WRITESET_INVALID'});
 });
 assert.equal(await readFile(outside,'utf8'),'tool-owned-cache');
 const other=path.join(f.directory,'other-project');await mkdir(path.join(other,'data'),{recursive:true});await writeFile(path.join(other,'data/items.json'),'[]');
 const normalize=x=>process.platform==='win32'?x.replaceAll('\\','/').toLowerCase():x;
 f.deployment.entries.push({...f.deployment.entries[0],projectRoot:normalize(other),runtime:normalize(path.join(other,'.data-editor/runtime')),anchorId:'other-anchor'});
 await writeFile(f.config,JSON.stringify(f.deployment));
 await f.mod.initializeHistoricalDisposition({projectRoot:other});
 await f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile},async()=>{
  await assert.rejects(()=>f.atomic.atomicWrite(path.join(other,'data/items.json'),'cross-project'),{code:'HISTORY_BINDING_INVALID'});
 });
 assert.equal(await readFile(path.join(other,'data/items.json'),'utf8'),'[]');
});

test('known old run refusal remains immediate even if original evidence has drifted',async t=>{
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);
 await writeFile(path.join(f.actions,f.old+'.started.json'),'external-corruption');
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[f.old]),closed);
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['new-reader']),{code:'HISTORY_EVIDENCE_DRIFT'});
 await assert.rejects(()=>f.atomic.atomicWrite(path.join(f.runtimeRoot,'entry-action-group-journal/new.json'),JSON.stringify({runId:'fresh',groupId:'group-a'})),closed);
});
test('ordinary observations validate original bytes while new external relations block the next full admission',async t=>{
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);
 await writeFile(path.join(f.actions,'external-sibling.json'),JSON.stringify({runId:'external-sibling',parentRunId:f.old}));
 await f.mod.assertHistoricalRunAllowed(f.context,['current-reader']);
 let observations=0;await f.runtime.publicationObserve(f.context,'current-reader',async()=>observations++);assert.equal(observations,1);
 let starts=0;await assert.rejects(()=>f.runtime.publicationStart(async()=>starts++)({projectContext:f.context}),{code:'HISTORY_EVIDENCE_DRIFT'});assert.equal(starts,0);
 await assert.rejects(()=>f.runtime.publicationRecovery(async()=>starts++)({projectContext:f.context,runId:'fresh-recovery'}),{code:'HISTORY_EVIDENCE_DRIFT'});assert.equal(starts,0);
 assert.ok((await f.inventory()).some(x=>x.blocking));
});
test('each ordinary observation rehashes original evidence without cross-request cached validity',async t=>{
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);
 await f.runtime.publicationObserve(f.context,'reader',async()=>{});
 await writeFile(path.join(f.actions,f.old+'.started.json'),'{}');
 await assert.rejects(()=>f.runtime.publicationObserve(f.context,'reader',async()=>assert.fail()),{code:'HISTORY_EVIDENCE_DRIFT'});
});

test('real canonical legacy handoff stays unknown but closed receipt removes only its execution/save blocker',async t=>{
 const f=await fixture(t),{canonicalFileIdentity}=await import(pathToFileURL(path.join(f.tool,'src/canonical-file-identity.mjs'))),identity=await canonicalFileIdentity(f.context,'data/items.json');
 const actions=await import(pathToFileURL(path.join(f.tool,'src/entry-actions.mjs'))),policy=await import(pathToFileURL(path.join(f.tool,'src/field-write-policy.mjs')));
 const handoff={runId:f.old,entry:{sourcePath:'data/items.json',canonicalFileKey:identity.canonicalFileKey},action:{id:'legacy',execution:{kind:'project-skill'}}},file=path.join(f.actions,f.old+'.json');
 await writeFile(file,JSON.stringify(handoff));const before=await readFile(file);
 await writeFile(path.join(f.root,'.data-editor/automation-profile.json'),JSON.stringify({rules:[]}));
 const intent=await f.prepare();
 let active=await actions.findActiveEntryActionRuns(f.context,'data/items.json');assert.equal(active.runs.length,1);assert.equal((await policy.ordinarySaveBlockingRuns(f.context,active.runs)).length,1);
 await f.commit(intent.dispositionId);
 active=await actions.findActiveEntryActionRuns(f.context,'data/items.json');assert.deepEqual(active.runs,[]);assert.equal(active.historicalRuns.length,1);assert.equal(active.historicalRuns[0].phase,'running');assert.equal(active.historicalRuns[0].historicalDisposition.businessOutcome,'unchanged');
 // The save owner validates the ledger itself; caller flags alone cannot remove a blocker.
 assert.deepEqual(await policy.ordinarySaveBlockingRuns(f.context,[{runId:f.old,actionId:'legacy',phase:'running'}]),[]);
 assert.deepEqual(await readFile(file),before);await assert.rejects(()=>readFile(path.join(f.actions,f.old+'.result.json')),{code:'ENOENT'});
 const fresh={...handoff,runId:'fresh-active'};await writeFile(path.join(f.actions,'fresh-active.json'),JSON.stringify(fresh));
 active=await actions.findActiveEntryActionRuns(f.context,'data/items.json');assert.deepEqual(active.runs.map(x=>x.runId),['fresh-active']);assert.equal(active.historicalRuns.length,1);
 assert.equal((await policy.ordinarySaveBlockingRuns(f.context,[{runId:'fresh-active',actionId:'legacy',phase:'running',historicalDisposition:{blocking:false}}])).length,1);
 await writeFile(file,JSON.stringify({...handoff,externalChanged:true}));
 active=await actions.findActiveEntryActionRuns(f.context,'data/items.json');assert.ok(active.runs.some(x=>x.runId===f.old));assert.deepEqual(active.historicalRuns,[]);
});

test('a mutating observed command recovery upgrades before publishing any new result',async t=>{
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);
 await writeFile(path.join(f.actions,'external-sibling.json'),JSON.stringify({runId:'external-sibling',parentRunId:f.old}));
 const id='fresh-observed-recovery',handoff={runId:id,action:{id:'command',execution:{kind:'project-command'}},projectCommand:{writer:{pid:String(process.pid),creationTime:'old-process-identity'}}};
 await writeFile(path.join(f.actions,id+'.json'),JSON.stringify(handoff));
 const {recoverProjectCommandRun}=await import(pathToFileURL(path.join(f.tool,'src/project-command-recovery.mjs')));
 await assert.rejects(()=>recoverProjectCommandRun(f.context,id,undefined,{observer:true}),{code:'HISTORY_EVIDENCE_DRIFT'});
 await assert.rejects(()=>readFile(path.join(f.actions,id+'.result.json')),{code:'ENOENT'});
});
test('observed followup and nested recovery cannot inherit a read-only admission to mutate',async t=>{
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);
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
 const f=await fixture(t);await f.commit((await f.prepare()).dispositionId);
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

test('GET legacy migration leaves closed history and full-admission-refused new legacy bytes untouched',async t=>{
 const f=await fixture(t),oldFile=path.join(f.actions,f.old+'.started.json');
 await writeFile(oldFile,JSON.stringify({runId:f.old,status:'started',startedAt:'2020-01-01T00:00:00Z'}));
 await f.commit((await f.prepare()).dispositionId);const oldBytes=await readFile(oldFile);
 const {migrateLegacyEntryActionStateArtifacts}=await import(pathToFileURL(path.join(f.tool,'src/entry-actions.mjs')));
 const allowedFile=path.join(f.actions,'allowed-legacy.started.json');await writeFile(allowedFile,JSON.stringify({runId:'allowed-legacy',status:'started'}));
 const allowed=await f.runtime.publicationObserve(f.context,'legacy-state-migration',()=>migrateLegacyEntryActionStateArtifacts(f.context));assert.deepEqual(allowed.migrated,[allowedFile]);assert.equal(JSON.parse(await readFile(allowedFile)).phase,'review_running');assert.deepEqual(await readFile(oldFile),oldBytes);
 const refusedFile=path.join(f.actions,'refused-legacy.started.json');await writeFile(refusedFile,JSON.stringify({runId:'refused-legacy',status:'started'}));const refusedBytes=await readFile(refusedFile);
 await writeFile(path.join(f.actions,'external-sibling.json'),JSON.stringify({runId:'external-sibling',parentRunId:f.old}));
 const refused=await f.runtime.publicationObserve(f.context,'legacy-state-migration',()=>migrateLegacyEntryActionStateArtifacts(f.context));assert.deepEqual(refused.migrated,[]);
 assert.deepEqual(await readFile(refusedFile),refusedBytes);assert.deepEqual(await readFile(oldFile),oldBytes);
});
