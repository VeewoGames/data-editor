import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,rm,readdir,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createAuthorityFixture,assertFixtureLedgerUnchanged,assertMissing,fixtureEnvironment,digest,invokeFixture,moduleUrl} from './helpers/authority-fixture.mjs';

test('v2 imports complete original v1 managed evidence without changing original ledger',async t=>{
 const f=await createAuthorityFixture(t,{installed:false}),bundle=await f.prepare();
 assert.equal((await f.apply(bundle)).status,'applied');
 assert.equal((await f.store.inspectAuthority()).entries.length,1);
 await assertFixtureLedgerUnchanged(f);
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[f.old]),{code:'HISTORY_RUN_CLOSED'});
 await f.mod.assertHistoricalRunAllowed(f.context,['fresh'],{fullInventory:true});
});
test('v2 imports complete successor v1 evidence with original receipt bytes',async t=>{
 const f=await createAuthorityFixture(t,{installed:false,successor:true});
 assert.equal((await f.apply(await f.prepare())).status,'applied');await assertFixtureLedgerUnchanged(f);
 await f.mod.assertHistoricalRunAllowed(f.context,['fresh'],{fullInventory:true});
});


test('prepare is readonly; activation is exact retry and preserves original proof objects',async t=>{
 const f=await createAuthorityFixture(t,{installed:false}),source=await readFile(f.sourceConfig),bundle=await f.prepare();
 await assertMissing(f.authority);assert.deepEqual(await readFile(f.sourceConfig),source);await assertFixtureLedgerUnchanged(f);
 const before=await f.store.readAuthoritySnapshot().catch(e=>e.code);assert.equal(before,'HISTORY_AUTHORITY_MISSING');
 assert.equal((await f.apply(bundle)).status,'applied');
 const installed=await f.store.readAuthoritySnapshot(),catalogBytes=installed.bytes;
 assert.equal((await f.apply(bundle)).status,'already_applied');
 assert.deepEqual((await f.store.readAuthoritySnapshot()).bytes,catalogBytes);
 const selection=installed.entries[0];assert.deepEqual(selection.authority.proof.ledgerBytes,f.ledgerBytes);
 for(const file of f.record.evidence.snapshot.files)assert.ok(bundle.objects.some(object=>object.digest===file.digest));
 assert.deepEqual(await readFile(f.sourceConfig),source);await assertFixtureLedgerUnchanged(f);
});

test('multi-root import uses catalog CAS and cannot overwrite another selected root',async t=>{
 const f=await createAuthorityFixture(t,{installed:false,rootCount:2}),first=await f.prepare(f.projects[0]),staleSecond=await f.prepare(f.projects[1]);
 await f.apply(first);const original=(await f.store.readAuthoritySnapshot()).catalog.entries[0];
 await assert.rejects(()=>f.apply(staleSecond),{code:'HISTORY_AUTHORITY_CATALOG_STALE'});
 const second=await f.prepare(f.projects[1]);await f.apply(second);
 const snapshot=await f.store.readAuthoritySnapshot();assert.equal(snapshot.catalog.generation,2);assert.equal(snapshot.entries.length,2);
 assert.deepEqual(snapshot.catalog.entries.find(entry=>entry.intent.root===original.intent.root),original);
 for(const project of f.projects)await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(project.context,[project.old]),{code:'HISTORY_RUN_CLOSED'});
 await assertFixtureLedgerUnchanged(f);
});

test('missing catalog fails closed globally and ignores old v1 config even for unrelated paths',async t=>{
 const f=await createAuthorityFixture(t,{installed:false});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed({projectRoot:path.join(f.directory,'unrelated')},['fresh']),{code:'HISTORY_AUTHORITY_MISSING'});
 await assert.rejects(()=>f.atomic.atomicWrite(path.join(f.directory,'outside.json'),'forbidden'),{code:'HISTORY_AUTHORITY_MISSING'});
 await assertMissing(path.join(f.directory,'outside.json'));
 await f.store.initializeEmptyAuthority();
 await f.mod.assertHistoricalRunAllowed({projectRoot:path.join(f.directory,'unrelated')},['fresh']);
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),{code:'HISTORY_DEPLOYMENT_REQUIRED'});
 await assert.rejects(()=>f.store.initializeEmptyAuthority(),{code:'HISTORY_AUTHORITY_ALREADY_INITIALIZED'});
});

for(const kind of ['source-code','target-code','source-config','evidence','ledger','registration','business','publication'])test(`apply rejects ${kind} drift after readonly prepare without activating catalog`,async t=>{
 const f=await createAuthorityFixture(t,{installed:false}),bundle=await f.prepare();
 const file={
  'source-code':path.join(f.sourceTool,'server.mjs'),'target-code':path.join(f.tool,'server.mjs'),'source-config':f.sourceConfig,
  evidence:path.join(f.actions,f.old+'.started.json'),ledger:f.ledgerFile,registration:f.binding.registration,business:f.sourceFile,publication:f.publicationFile,
 }[kind];
 const original=await readFile(file);
 if(kind==='registration'){const value=JSON.parse(original);value.anchorId='wrong-anchor';await writeFile(file,JSON.stringify(value));}
 else if(kind==='publication'){const value=JSON.parse(original);value.state='DRAINING';await writeFile(file,JSON.stringify(value));}
 else await writeFile(file,Buffer.concat([original,Buffer.from(' ')]));
 const changed=await readFile(file);
 await assert.rejects(()=>f.apply(bundle),error=>/^HISTORY_/.test(error.code));
 await assertMissing(path.join(f.authority,'catalog.v2.json'));
 assert.deepEqual(await readFile(file),changed);
 await writeFile(file,original);assert.equal((await f.apply(bundle)).status,'applied');
 await assertFixtureLedgerUnchanged(f);
});

test('immutable package object tampering, ledger deletion and target drift fail after selection',async t=>{
 const f=await createAuthorityFixture(t),snapshot=await f.store.readAuthoritySnapshot(),ref=snapshot.catalog.entries[0].envelopeRef,file=path.join(f.authority,ref.path),original=await readFile(file);
 await writeFile(file,Buffer.concat([original,Buffer.from(' ')]));
 await assert.rejects(()=>f.store.inspectAuthority(),{code:'HISTORY_AUTHORITY_DIGEST_MISMATCH'});await writeFile(file,original);
 await writeFile(f.ledgerFile,JSON.stringify({...f.state,records:{}}));
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),{code:'HISTORY_SUCCESSOR_INVALID'});await writeFile(f.ledgerFile,f.ledgerBytes);
 const server=path.join(f.tool,'server.mjs');await writeFile(server,Buffer.concat([await readFile(server),Buffer.from(' ')]));
 await assert.rejects(()=>f.store.inspectAuthority(),{code:'HISTORY_DEPLOYMENT_DRIFT'});
});

test('environment and context fields cannot select another authority directory',async t=>{
 const f=await createAuthorityFixture(t),fake=path.join(f.directory,'fake-authority');
 const code=`const h=await import(${JSON.stringify(moduleUrl(f.tool,'src/historical-disposition.mjs'))});await h.assertHistoricalRunAllowed({...context,deploymentAuthorityDirectory:${JSON.stringify(fake)},authorityDirectory:${JSON.stringify(fake)}},[${JSON.stringify(f.old)}]);`;
 assert.equal((await invokeFixture(f,code,{DATA_EDITOR_DEPLOYMENT_AUTHORITY:fake,DATA_EDITOR_HISTORY_DEPLOYMENT_FILE:fake,LOCALAPPDATA:fake})).code,'HISTORY_RUN_CLOSED');
 await assertMissing(fake);
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed({...f.context,historicalDispositionAnchorId:'forged'},['fresh']),{code:'HISTORY_BINDING_INVALID'});
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed({...f.context,runtimeDir:'other'},['fresh']),{code:'HISTORY_BINDING_INVALID'});
});

async function cli(f,args){
 const result=await promisify(execFile)(process.execPath,[path.join(f.tool,'scripts/deployment-authority.mjs'),...args],{windowsHide:true,env:fixtureEnvironment(f.directory),maxBuffer:1024*1024}).catch(error=>error);
 return {exitCode:result.code??0,body:JSON.parse(result.stdout)};
}
test('real CLI prepare/apply/verify enforces bundle digest and exact retry without implicit initialization',async t=>{
 const f=await createAuthorityFixture(t,{installed:false}),output=path.join(f.directory,'bundle.json');
 assert.equal((await cli(f,['verify'])).body.code,'HISTORY_AUTHORITY_MISSING');
 const prepared=await cli(f,['prepare','--source-tool',f.sourceTool,'--project',f.root,'--output',output]);assert.equal(prepared.exitCode,0);assert.equal(prepared.body.status,'prepared');await assertMissing(f.authority);
 const bytes=await readFile(output);assert.equal(prepared.body.bundleDigest,digest(bytes));
 assert.equal((await cli(f,['apply','--bundle',output,'--bundle-digest','0'.repeat(64)])).body.code,'HISTORY_AUTHORITY_BUNDLE_DIGEST_MISMATCH');
 const args=['apply','--bundle',output,'--bundle-digest',prepared.body.bundleDigest];const applied=await cli(f,args);assert.equal(applied.body.status,'applied',JSON.stringify(applied));assert.equal((await cli(f,args)).body.status,'already_applied');
 assert.equal((await cli(f,['verify'])).body.entries.length,1);await assertFixtureLedgerUnchanged(f);
 assert.equal((await cli(f,['verify','--authority-directory',f.directory])).body.code,'HISTORY_AUTHORITY_ARGUMENT_INVALID');
});

test('real CLI new-install empty catalog requires explicit flag and never revives registered unselected history',async t=>{
 const f=await createAuthorityFixture(t,{installed:false});
 assert.equal((await cli(f,['init-empty'])).body.code,'HISTORY_AUTHORITY_ARGUMENT_REQUIRED');await assertMissing(f.authority);
 assert.equal((await cli(f,['init-empty','--confirm-new-install'])).body.status,'initialized');
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),{code:'HISTORY_DEPLOYMENT_REQUIRED'});
});


test('source config and successor materials become immutable proof inputs rather than runtime selectors',async t=>{
 const f=await createAuthorityFixture(t,{successor:true}),snapshot=await f.store.readAuthoritySnapshot();
 await rm(f.sourceConfig);await rm(path.join(f.sourceTool,'config/historical-deployment-upgrades'),{recursive:true});
 await f.mod.assertHistoricalRunAllowed(f.context,['fresh'],{fullInventory:true});
 assert.equal((await f.store.inspectAuthority()).entries.length,1);
 assert.deepEqual((await f.store.readAuthoritySnapshot()).bytes,snapshot.bytes);await assertFixtureLedgerUnchanged(f);
});


test('apply forbids removing an unrelated selected root from the next catalog',async t=>{
 const f=await createAuthorityFixture(t,{installed:false,rootCount:2});await f.apply(await f.prepare(f.projects[0]));
 const snapshot=await f.store.readAuthoritySnapshot(),bundle=await f.prepare(f.projects[1]);bundle.catalog.entries=bundle.catalog.entries.filter(entry=>entry.intent.root!==snapshot.entries[0].projectRoot);
 await assert.rejects(()=>f.apply(bundle),{code:'HISTORY_AUTHORITY_PROTECTION_REMOVAL'});assert.deepEqual((await f.store.readAuthoritySnapshot()).bytes,snapshot.bytes);
});

test('exact applied retry remains idempotent after a later legitimate author edit',async t=>{
 const f=await createAuthorityFixture(t,{installed:false}),bundle=await f.prepare();await f.apply(bundle);
 const journalFile=path.join(f.runtimeRoot,'commit-journal/later-author.json');await f.mod.withHistoricalAuthorSave(f.context,{sourceFile:f.sourceFile,journalFile},()=>f.atomic.atomicWrite(f.sourceFile,'later author input'));
 assert.equal((await f.apply(bundle)).status,'already_applied');assert.equal(await readFile(f.sourceFile,'utf8'),'later author input');await assertFixtureLedgerUnchanged(f);
});


for(const kind of ['certificate','snapshot'])test(`successor ${kind} drift after prepare never activates v2 selection`,async t=>{
 const f=await createAuthorityFixture(t,{installed:false,successor:true}),bundle=await f.prepare(),config=JSON.parse(await readFile(f.sourceConfig));
 const certificateRef=config.entries[0].deploymentSuccessor,certificateFile=path.join(f.sourceTool,'config',certificateRef.path),certificate=JSON.parse(await readFile(certificateFile));
 const file=kind==='certificate'?certificateFile:path.join(f.sourceTool,'config',certificate.sourceSnapshot.path),before=await readFile(file);await writeFile(file,Buffer.concat([before,Buffer.from(' ')]));
 await assert.rejects(()=>f.apply(bundle),{code:'HISTORY_SUCCESSOR_INVALID'});await assertMissing(path.join(f.authority,'catalog.v2.json'));await assertFixtureLedgerUnchanged(f);
});


test('prepare rejects malformed or nonquiescent publication reservations without manufacturing catalog',async t=>{
 const f=await createAuthorityFixture(t,{installed:false}),original=JSON.parse(await readFile(f.publicationFile));
 for(const patch of [{accepted:[]},{continuations:[]},{accepted:{fresh:{settled:false}}},{accepted:{fresh:{settled:'false'}}},{accepted:{fresh:null}},{continuations:{fresh:{}}}]){
  await writeFile(f.publicationFile,JSON.stringify({...original,...patch}));
  await assert.rejects(()=>f.prepare(),error=>['HISTORY_UPGRADE_NOT_QUIESCENT','PUBLICATION_STATE_UNVERIFIABLE'].includes(error.code),JSON.stringify(patch));
 }
 await assertMissing(path.join(f.authority,'catalog.v2.json'));await assertFixtureLedgerUnchanged(f);
});


test('catalog path occupied by a directory is unverifiable rather than an absent initial authority',async t=>{
 const f=await createAuthorityFixture(t,{installed:false}),bundle=await f.prepare();await mkdir(path.join(f.authority,'catalog.v2.json'),{recursive:true});
 await assert.rejects(()=>f.prepare(),{code:'HISTORY_AUTHORITY_UNVERIFIABLE'});
 await assert.rejects(()=>f.apply(bundle),{code:'HISTORY_AUTHORITY_UNVERIFIABLE'});
 await assertFixtureLedgerUnchanged(f);
});

test('actual root lock holds a newly selected root import until protected root A effect releases',async t=>{
 const f=await createAuthorityFixture(t,{installed:false,rootCount:2});await f.apply(await f.prepare(f.projects[0]));const bundle=await f.prepare(f.projects[1]);
 let release,ready,applied=false,effects=0;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>ready=resolve);
 const effect=f.mod.withHistoricalRun(f.context,['fresh-lock'],()=>f.mod.withHistoricalScopeEffect(async()=>{ready();await gate;effects++;}));let importing;
 try{
  await started;importing=f.apply(bundle).then(result=>{applied=true;return result;});await new Promise(resolve=>setTimeout(resolve,160));
  assert.equal(applied,false);assert.equal(effects,0);assert.equal((await f.store.readAuthoritySnapshot()).entries.length,1);
 }finally{release();await effect;if(importing)await importing;}
 assert.equal(applied,true);assert.equal(effects,1);assert.equal((await f.store.readAuthoritySnapshot()).entries.length,2);await assertFixtureLedgerUnchanged(f);
});

test('actual delivery lock lets an already admitted unknown raw effect finish before first import of that root',async t=>{
 const f=await createAuthorityFixture(t,{installed:false});await f.store.initializeEmptyAuthority();const bundle=await f.prepare(),anchorFile=path.join(f.binding.directory,'anchor.json'),originals=await Promise.all([f.binding.registration,anchorFile,f.ledgerFile].map(async file=>({file,bytes:await readFile(file)})));
 // Model registration being installed while an effect previously admitted in the
 // explicit empty catalog still owns delivery. All files are private originals.
 await rm(f.binding.registration);await rm(f.binding.directory,{recursive:true});
 let release,ready,applied=false,effects=0;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>ready=resolve);
 const target=path.join(f.root,'unmanaged-effect.txt'),effect=f.mod.withHistoricalFileEffect(target,null,async()=>{ready();await gate;effects++;});let importing;
 try{
  await started;for(const original of originals){await mkdir(path.dirname(original.file),{recursive:true});await writeFile(original.file,original.bytes);}
  importing=f.apply(bundle).then(result=>{applied=true;return result;});await new Promise(resolve=>setTimeout(resolve,160));
  assert.equal(applied,false);assert.equal(effects,0);assert.equal((await f.store.readAuthoritySnapshot()).entries.length,0);
 }finally{release();await effect;if(importing)await importing;}
 assert.equal(applied,true);assert.equal(effects,1);await assertFixtureLedgerUnchanged(f);
});
