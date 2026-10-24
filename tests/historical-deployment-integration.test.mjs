import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {mkdir,mkdtemp,cp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';

const baseApp=path.resolve(import.meta.dirname,'..'),old='10000000-0000-4000-8000-000000000001';
const record={runId:old,phase:'intent',relatedRunIds:[old],evidenceDigest:'a'.repeat(64)};
const url=(app,file)=>pathToFileURL(path.join(app,file)).href;
async function invoke(f,body,env={}){
 const code=`const app=${JSON.stringify(f.app)},root=${JSON.stringify(f.root)};const{createProjectContext}=await import(${JSON.stringify(url(f.app,'src/project-context.mjs'))});const context=createProjectContext({projectRoot:root,projectId:'fixture'});try{${body};process.stdout.write(JSON.stringify({ok:true}));}catch(e){process.stdout.write(JSON.stringify({code:e.code??e.message}));}`;
 return JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{windowsHide:true,env:{...process.env,...env}})).stdout);
}
async function fixture(t){
 const parent=path.resolve(baseApp,'../../deployment-fixtures');await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,'case-')),app=path.join(directory,'editor');
 t.after(async()=>{assert.equal(path.dirname(directory),parent);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:40});});
 await mkdir(app);
 await symlink(path.join(baseApp,'node_modules'),path.join(app,'node_modules'),'junction');
 for(const name of ['src','scripts','config','server.mjs','package.json'])await cp(path.join(baseApp,name),path.join(app,name),{recursive:true});
 const root=path.join(app,'tests/history-fixtures/project');await mkdir(path.join(root,'data'),{recursive:true});await mkdir(path.join(root,'docs'));
 await writeFile(path.join(root,'data/items.json'),JSON.stringify([{id:'one',description:'保留草稿',description_zh:'已验文案',limit_note_output:'每回合1次'}]));
 await writeFile(path.join(root,'docs/approved.md'),'approved document');
 const config=path.join(app,'config/historical-disposition-deployment.json');await writeFile(config,JSON.stringify({version:1,entries:[]}));
 const{createProjectContext}=await import(url(app,'src/project-context.mjs'));
 const{initializeHistoryTestFixture}=await import(url(app,'src/historical-disposition.mjs'));
 const context=createProjectContext({projectRoot:root,projectId:'fixture'}),binding=await initializeHistoryTestFixture(context,{[old]:record});
 return{directory,app,root,config,context,binding};
}
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
test('missing, malformed, duplicate and overlapping fixed configurations refuse; explicit empty permits unrelated projects',async t=>{
 const f=await fixture(t),valid=JSON.parse(await readFile(f.config,'utf8'));
 for(const value of [null,'broken',JSON.stringify({...valid,entries:[...valid.entries,...valid.entries]}),JSON.stringify({...valid,entries:[...valid.entries,{...valid.entries[0],projectRoot:valid.entries[0].projectRoot+'/nested',runtime:valid.entries[0].projectRoot+'/nested/runtime'}]})]){
  if(value===null)await rm(f.config);else await writeFile(f.config,value);
  assert.equal((await invoke(f,importGuard(f)+`await h.assertHistoricalRunAllowed(context,['new'])`)).code,'HISTORY_DEPLOYMENT_UNVERIFIABLE');
 }
 await writeFile(f.config,'{"version":1,"entries":[]}');
 assert.equal((await invoke(f,importGuard(f)+`await h.assertHistoricalRunAllowed(context,['new'])`)).code,'HISTORY_DEPLOYMENT_REQUIRED');
 const other=path.join(f.directory,'other');await mkdir(other);
 assert.equal((await invoke(f,importGuard(f)+`await h.assertHistoricalRunAllowed({projectRoot:${JSON.stringify(other)}},['new'])`)).ok,true);
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
 const f=await fixture(t),code=`const{recoverPendingEmbeddedIdentityPromotions}=await import(${JSON.stringify(url(f.app,'src/durable-identity-coordinator.mjs'))});let writes=0;const entry={kind:'identity_promotion',stage:'intent',projectId:'fixture',idempotencyKey:'original_key',sourcePath:'data/items.json'};const result=await recoverPendingEmbeddedIdentityPromotions({projectContext:context,dependencies:{journal:{list:async()=>[entry],write:async()=>{writes++}}}});if(writes||result.recovered.length||result.pending[0]!=='original_key')throw Error('RECOVERY_BYPASS');`;
 assert.equal((await invoke(f,code)).ok,true);
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
 await rm(f.config);assert.equal((await invoke(f,body)).code,'HISTORY_DEPLOYMENT_UNVERIFIABLE');await assert.rejects(()=>readFile(marker),{code:'ENOENT'});
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
 const f=await fixture(t),other=path.join(f.app,'tests/history-fixtures/other');await mkdir(other);
 const h=await import(url(f.app,'src/historical-disposition.mjs'));await h.initializeHistoryTestFixture({projectRoot:other,projectId:'other'},{});
 const body=importGuard(f)+`const result=await h.withHistoricalRun({projectRoot:${JSON.stringify(other)}},['fresh'],()=>h.withHistoricalLaunch(root,()=>{throw Error('CROSS_PROJECT_LAUNCH');})).then(()=>null,e=>e.code);if(result!=='HISTORY_BINDING_INVALID')throw Error('CROSS_PROJECT_BYPASS:'+result);`;
 assert.equal((await invoke(f,body)).ok,true);
});
async function server(t,f){
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,[path.join(f.app,'server.mjs'),'--project',f.root,'--registry-home',path.join(f.directory,'registry'),'--port',String(port),'--bridge-port','1'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATA_EDITOR_HOME:path.join(f.directory,'registry')}});
 let stderr='';child.stderr.on('data',b=>stderr+=b);const exit=new Promise(r=>child.once('exit',r));t.after(async()=>{if(child.exitCode===null)child.kill();await exit;});
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(stderr);try{if((await fetch(base+'/api/health')).ok)return{base,child,exit};}catch{}await new Promise(r=>setTimeout(r,40));}
 throw Error('fixture HTTP did not start: '+stderr);
}
test('real HTTP author save and idempotency work while old ack and post-loss writes refuse; service restart retains pin',async t=>{
 const f=await fixture(t),first=await server(t,f),base=first.base;
 const projectId=(await (await fetch(base+'/api/projects')).json()).activeProjectId;
 const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
 const document=await (await fetch(base+'/api/document?'+new URLSearchParams({projectId,path:'data/items.json'}))).json();
 const root=document.root??document.document?.root;assert.ok(root,JSON.stringify(document));root[0].description='作者修改草稿';
 const save={projectId,path:'data/items.json',root,documentEtag:document.documentEtag,idempotencyKey:'ordinary_save_test'};
 const saved=await post('/api/save',save);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal((await post('/api/save',save)).status,200);
 assert.equal(JSON.parse(await readFile(path.join(f.root,'data/items.json'),'utf8'))[0].description_zh,'已验文案');
 const token=crypto.randomUUID(),pendingDir=path.join(f.binding.runtime,'pending-entry-actions');await mkdir(pendingDir,{recursive:true});const pendingFile=path.join(pendingDir,token+'.json');await writeFile(pendingFile,JSON.stringify({token,runId:old,projectId,state:'pending'}));const before=await readFile(pendingFile,'utf8');
 const ack=await post('/api/entry-actions/ack-start',{projectId,pendingActionToken:token});assert.equal(ack.status,409,JSON.stringify(ack));assert.equal(ack.body.code,'HISTORY_RUN_CLOSED');assert.equal(await readFile(pendingFile,'utf8'),before);
 first.child.kill();await first.exit;const second=await server(t,f);
 const original=await readFile(path.join(f.root,'data/items.json'),'utf8');await dropProjectEvidence(f);
 const response=await fetch(second.base+'/api/save',{method:'POST',headers:{'content-type':'application/json',origin:second.base},body:JSON.stringify({...save,root:[{id:'one',description:'forbidden'}],idempotencyKey:'post_loss_save'})});
 assert.equal(response.status,409);assert.equal((await response.json()).code,'HISTORY_REGISTRATION_REQUIRED');assert.equal(await readFile(path.join(f.root,'data/items.json'),'utf8'),original);
});
