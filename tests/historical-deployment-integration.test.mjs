import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {mkdir,mkdtemp,cp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';

import {createAuthorityFixture,invokeFixture,fixtureEnvironment,moduleUrl,digest,assertFixtureLedgerUnchanged} from './helpers/authority-fixture.mjs';
const old='10000000-0000-4000-8000-000000000001';
const url=moduleUrl,invoke=invokeFixture;
const fixture=createAuthorityFixture;
const importGuard=f=>`const h=await import(${JSON.stringify(url(f.app,'src/historical-disposition.mjs'))});`;
const importAtomic=f=>`const{atomicWrite}=await import(${JSON.stringify(url(f.app,'src/atomic-file.mjs'))});`;
async function dropProjectEvidence(f){await rm(f.binding.registration);await rm(f.binding.directory,{recursive:true});}

test('fixed delivery pin survives all project markers disappearing in independent raw and CLI processes',async t=>{
 const f=await fixture(t),file=path.join(f.root,'data/items.json'),before=await readFile(file,'utf8');await dropProjectEvidence(f);
 const result=await invoke(f,importAtomic(f)+`await atomicWrite(${JSON.stringify(file)},'forbidden')`);assert.equal(result.code,'HISTORY_REGISTRATION_REQUIRED');
 const child=await promisify(execFile)(process.execPath,[path.join(f.app,'scripts/entry-action-recover.mjs'),'recover','--project',f.root,'--run-id',old],{windowsHide:true}).catch(e=>e);
 assert.equal(child.code,2);assert.match(child.stdout,/HISTORY_REGISTRATION_REQUIRED/);assert.equal(await readFile(file,'utf8'),before);
});
test('request context and environment cannot replace the delivery pin or runtime',async t=>{
 const f=await fixture(t);
 assert.equal((await invoke(f,importGuard(f)+`await h.assertHistoricalRunAllowed({...context,historicalDispositionAnchorId:'forged'},['new'])`)).code,'HISTORY_BINDING_INVALID');
 assert.equal((await invoke(f,importGuard(f)+`await h.assertHistoricalRunAllowed({...context,runtimeDir:'other'},['new'])`)).code,'HISTORY_BINDING_INVALID');
 assert.equal((await invoke(f,importGuard(f)+`await h.assertHistoricalRunAllowed({...context,projectRoot:root+'/data'},['new'])`)).code,'HISTORY_BINDING_INVALID');
 const fake=path.join(f.directory,'fake.json');await writeFile(fake,'{"version":1,"entries":[]}');
 assert.equal((await invoke(f,importGuard(f)+`await h.assertHistoricalRunAllowed(context,[${JSON.stringify(old)}])`,{DATA_EDITOR_HISTORY_DEPLOYMENT_FILE:fake})).code,'HISTORY_RUN_CLOSED');
});
test('missing malformed duplicate overlapping authority catalogs refuse and explicit empty still refuses registered roots',async t=>{
 const f=await fixture(t),snapshot=await f.store.readAuthoritySnapshot(),catalog=snapshot.catalog,schema=await f.load('src/deployment-authority-schema.mjs');
 const duplicate={...catalog,entries:[...catalog.entries,...catalog.entries]};
 const overlapping={...catalog,entries:[...catalog.entries,{...catalog.entries[0],intent:{...catalog.entries[0].intent,root:catalog.entries[0].intent.root+'/nested',runtime:catalog.entries[0].intent.root+'/nested/runtime'}}]};
 for(const value of [null,Buffer.from('broken'),schema.encode(duplicate),schema.encode(overlapping)]){
  if(value===null)await rm(snapshot.file);else await writeFile(snapshot.file,value);
  const result=await invoke(f,importGuard(f)+`await h.assertHistoricalRunAllowed(context,['new'])`);assert.match(result.code,/^HISTORY_AUTHORITY_/);
 }
 await writeFile(snapshot.file,schema.encode({version:2,contract:'history-authority-catalog-v2',generation:0,minReaderProtocol:2,entries:[]}));
 assert.equal((await invoke(f,importGuard(f)+`await h.assertHistoricalRunAllowed(context,['new'])`)).code,'HISTORY_DEPLOYMENT_REQUIRED');
 const other=path.join(f.directory,'unregistered');await mkdir(other);assert.equal((await invoke(f,importGuard(f)+`await h.assertHistoricalRunAllowed({projectRoot:${JSON.stringify(other)}},['new'])`)).ok,true);
});

test('raw source/artifact/identity writes cannot forge a run payload; explicit author scope is exact and cannot be promoted',async t=>{
 const f=await fixture(t),sourceFile=path.join(f.root,'data/items.json'),journalFile=path.join(f.binding.runtime,'commit-journal/save_example.json');
 for(const file of [sourceFile,path.join(f.root,'docs/approved.md'),path.join(f.binding.runtime,'identity-promotion-journal/receipt.json')]){
  assert.equal((await invoke(f,importAtomic(f)+`await atomicWrite(${JSON.stringify(file)},JSON.stringify({runId:'new'}))`)).code,'HISTORY_RUN_CONTEXT_REQUIRED');
 }
 const args=JSON.stringify({sourceFile,journalFile});
 assert.equal((await invoke(f,importGuard(f)+`await h.withHistoricalRun(context,['new'],()=>h.withHistoricalAuthorSave(context,${args},async()=>{}))`)).code,'HISTORY_AUTHOR_SCOPE_ESCALATION');
 assert.equal((await invoke(f,importGuard(f)+importAtomic(f)+`await h.withHistoricalAuthorSave(context,${args},()=>atomicWrite(${JSON.stringify(path.join(f.root,'docs/approved.md'))},'forbidden'))`)).code,'HISTORY_AUTHOR_WRITESET_INVALID');
});
test('identity recovery leaves unknown original ownership pending and does not manufacture a receipt',async t=>{
 const f=await fixture(t),code=`const{recoverPendingEmbeddedIdentityPromotions}=await import(${JSON.stringify(url(f.app,'src/durable-identity-coordinator.mjs'))});let writes=0;const entry={kind:'identity_promotion',stage:'intent',projectId:context.projectId,idempotencyKey:'original_key',sourcePath:'data/items.json'};const result=await recoverPendingEmbeddedIdentityPromotions({projectContext:context,dependencies:{journal:{list:async()=>[entry],write:async()=>{writes++}}}});if(writes||result.recovered.length||result.pending[0]!=='original_key')throw Error('RECOVERY_BYPASS');`;
 const observed=await invoke(f,code);assert.equal(observed.ok,true,JSON.stringify(observed));
});
test('author scopes expire on success and failure before delayed descendants can write',async t=>{
 const f=await fixture(t),sourceFile=path.join(f.root,'data/items.json'),journalFile=path.join(f.binding.runtime,'commit-journal/author_lifetime.json');
 const args=JSON.stringify({sourceFile,journalFile});
 for(const failure of [false,true]){
  const body=importGuard(f)+importAtomic(f)+`let release,late;const gate=new Promise(r=>release=r);try{await h.withHistoricalAuthorSave(context,${args},async()=>{late=(async()=>{await gate;await atomicWrite(${JSON.stringify(sourceFile)},'forbidden')})();if(${failure})throw Error('save failed');});}catch(e){if(e.message!=='save failed')throw e;}release();const code=await late.then(()=>null,e=>e.code);if(code!=='HISTORY_AUTHOR_SCOPE_EXPIRED')throw Error('AUTHOR_LIFETIME_BYPASS:'+code);`;
  assert.equal((await invoke(f,body)).ok,true);
 }
 assert.match(await readFile(sourceFile,'utf8'),/已验文案/);
});
test('public raw command runner requires automation scope and checks fixed configuration before spawn',async t=>{
 const f=await fixture(t),tools=path.join(f.root,'tools');await mkdir(tools);
 const marker=path.join(f.root,'spawned.txt');await writeFile(path.join(tools,'launch.mjs'),`import{writeFile}from'node:fs/promises';await writeFile(${JSON.stringify(marker)},'spawned');process.stdout.write('{}');`);
 const body=`const{executeProjectCommand}=await import(${JSON.stringify(url(f.app,'src/project-command-runner.mjs'))});await executeProjectCommand(context,{path:'tools/launch.mjs',args:[],timeoutMs:1000},{});`;
 assert.equal((await invoke(f,body)).code,'HISTORY_RUN_CONTEXT_REQUIRED');
 await assert.rejects(()=>readFile(marker),{code:'ENOENT'});
 await rm(path.join(f.authority,'catalog.v2.json'));assert.equal((await invoke(f,body)).code,'HISTORY_AUTHORITY_MISSING');await assert.rejects(()=>readFile(marker),{code:'ENOENT'});
});
test('raw supervisor dispatch with a protected cwd refuses without stopping the shared helper',async t=>{
 const f=await fixture(t);
 const body=`const{createJobSupervisor}=await import(${JSON.stringify(url(f.app,'src/job-supervisor.mjs'))});
 const{EventEmitter}=await import('node:events');const{PassThrough,Writable}=await import('node:stream');
 const child=new EventEmitter();child.pid=8123;child.creationFileTime='133000000000000000';child.stdout=new PassThrough();child.stderr=new PassThrough();let killed=false,commands=[];
 child.kill=()=>{killed=true;child.emit('exit',null,'SIGTERM');return true};child.unref=()=>{};
 child.stdin=new Writable({write(bytes,encoding,callback){const command=JSON.parse(bytes.toString());commands.push(command);if(command.type==='shutdown')setImmediate(()=>child.emit('exit',0));callback();}});
 const supervisor=createJobSupervisor({toolRoot:app,verifyHelper:async()=>({}),spawnProcess:()=>{setImmediate(()=>child.stdout.write(JSON.stringify({type:'ready',protocolVersion:2,pid:child.pid,creationFileTime:child.creationFileTime})+'\\n'));return child;}});
 const code=await supervisor.start({id:'raw',command:process.execPath,cwd:root}).then(()=>null,e=>e.code);
 if(code!=='HISTORY_RUN_CONTEXT_REQUIRED'||killed||commands.some(c=>c.type==='start'))throw Error('RAW_SUPERVISOR_BYPASS:'+code);await supervisor.shutdown();`;
 assert.equal((await invoke(f,body)).ok,true);
});
test('an automation scope for project A cannot authorize a protected project B launch',async t=>{
 const f=await fixture(t,{rootCount:2}),other=f.projects[1].root;
 const body=importGuard(f)+`const result=await h.withHistoricalRun({projectRoot:${JSON.stringify(other)}},['fresh'],()=>h.withHistoricalLaunch(root,()=>{throw Error('CROSS_PROJECT_LAUNCH');})).then(()=>null,e=>e.code);if(result!=='HISTORY_BINDING_INVALID')throw Error('CROSS_PROJECT_BYPASS:'+result);`;
 assert.equal((await invoke(f,body)).ok,true);
});
async function server(t,f){
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));assert.ok(![8787,8791].includes(port));
 const child=spawn(process.execPath,[path.join(f.app,'server.mjs'),'--project',f.root,'--registry-home',path.join(f.directory,'registry'),'--port',String(port),'--bridge-port','1'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:fixtureEnvironment(f.directory)});
 let stderr='';child.stderr.on('data',b=>stderr+=b);const exit=new Promise(r=>child.once('exit',r));f.onCleanup(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();await exit;});
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(stderr);try{if((await fetch(base+'/api/health')).ok)return{base,child,exit};}catch{}await new Promise(r=>setTimeout(r,40));}
 throw Error('fixture HTTP did not start: '+stderr);
}
test('real HTTP author save and idempotency work while old ack and post-loss writes refuse; service restart retains pin',async t=>{
 const f=await fixture(t),first=await server(t,f),base=first.base;
 const projectId=(await (await fetch(base+'/api/projects')).json()).activeProjectId;
 const catalogFile=path.join(f.authority,'catalog.v2.json'),catalogBefore=await readFile(catalogFile);
 for(const route of ['/api/deployment-authority','/api/historical-deployment']){const response=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({operation:'init-empty',authorityDirectory:path.join(f.directory,'forged')})});assert.equal(response.status,404);}
 assert.deepEqual(await readFile(catalogFile),catalogBefore);
 const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
 const document=await (await fetch(base+'/api/document?'+new URLSearchParams({projectId,path:'data/items.json'}))).json();
 const root=document.root??document.document?.root;assert.ok(root,JSON.stringify(document));root[0].description='作者修改草稿';
 const save={projectId,path:'data/items.json',root,documentEtag:document.documentEtag,idempotencyKey:'ordinary_save_test'};
 const saved=await post('/api/save',save);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal((await post('/api/save',save)).status,200);
 assert.equal(JSON.parse(await readFile(path.join(f.root,'data/items.json'),'utf8'))[0].description_zh,'已验文案');
 const token=crypto.randomUUID(),pendingDir=path.join(f.binding.runtime,'pending-entry-actions');await mkdir(pendingDir,{recursive:true});const pendingFile=path.join(pendingDir,token+'.json');await writeFile(pendingFile,JSON.stringify({token,runId:old,projectId,state:'pending'}));const before=await readFile(pendingFile,'utf8');
 const ack=await post('/api/entry-actions/ack-start',{projectId,pendingActionToken:token});assert.equal(ack.status,409,JSON.stringify(ack));assert.equal(ack.body.code,'HISTORY_RUN_CLOSED');assert.equal(await readFile(pendingFile,'utf8'),before);
 await rm(pendingFile);first.child.kill();await first.exit;const second=await server(t,f);
 const original=await readFile(path.join(f.root,'data/items.json'),'utf8');await dropProjectEvidence(f);
 const response=await fetch(second.base+'/api/save',{method:'POST',headers:{'content-type':'application/json',origin:second.base},body:JSON.stringify({...save,root:[{id:'one',description:'forbidden'}],idempotencyKey:'post_loss_save'})});
 assert.equal(response.status,409);assert.equal((await response.json()).code,'HISTORY_REGISTRATION_REQUIRED');assert.equal(await readFile(path.join(f.root,'data/items.json'),'utf8'),original);
});
