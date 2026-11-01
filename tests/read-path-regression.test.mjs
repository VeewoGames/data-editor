import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import crypto from 'node:crypto';
import {createAuthorityFixture,fixtureEnvironment} from './helpers/authority-fixture.mjs';
import {readTextFile} from '../src/file-service.mjs';

test('pure HTTP reads remain usable while lifecycle preparation is pending or fails closed',async t=>{
 const f=await createAuthorityFixture(t,{installed:false});
 const entry=path.join(f.tool,'server.mjs'),original=await fs.readFile(entry,'utf8');
 const marker='createProjectReadiness({ prepare: prepareProject })';assert.ok(original.includes(marker));
 await fs.writeFile(entry,original.replace(marker,"createProjectReadiness({ prepare: async()=>{await new Promise(resolve=>setTimeout(resolve,3000));throw Object.assign(new Error('closed historical recovery'),{code:'HISTORY_RUN_CLOSED',status:409});} })"));
 await f.install();
 const registry=path.join(f.directory,'failed-preparation-registry');await fs.mkdir(registry);
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const child=spawn(process.execPath,[entry,'--project',f.root,'--registry-home',registry,'--port',String(port)],{env:fixtureEnvironment(f.directory),windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
 f.onCleanup(Object.assign(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}},{fixtureDeletionBarrier:true}));
 for(let i=0;!logs.includes('Data Editor running at')&&i<200;i++)await new Promise(resolve=>setTimeout(resolve,25));
 assert.ok(logs.includes('Data Editor running at'),logs);
 const origin=`http://127.0.0.1:${port}`,projectId=(await (await fetch(origin+'/api/projects')).json()).activeProjectId;
 const state=async()=>(await fetch(origin+`/api/project-readiness?projectId=${projectId}`)).json();
 assert.equal((await state()).state,'initializing');
 const before=await fs.readFile(f.ledgerFile);
 const selected=await fetch(origin+`/api/document?projectId=${projectId}&path=data/items.json`,{signal:AbortSignal.timeout(1500)});assert.equal(selected.status,200);await selected.json();
 for(let i=0;(await state()).state!=='failed'&&i<120;i++)await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal((await state()).error.code,'HISTORY_RUN_CLOSED');
 for(const route of ['/api/files','/api/view-config','/api/shared-views','/api/document-metadata']){const query=new URLSearchParams({projectId,path:'data/items.json'});const response=await fetch(origin+route+'?'+query,{signal:AbortSignal.timeout(1500)});assert.equal(response.status,200,route);await response.json();}
 assert.deepEqual(await fs.readFile(f.ledgerFile),before);
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[Object.keys(JSON.parse(before).records)[0]]),{code:'HISTORY_RUN_CLOSED'});
});

test('opening one file never enumerates unrelated source directories',async t=>{
 await fs.mkdir(path.join(import.meta.dirname,'.scratch'),{recursive:true});
 const root=await fs.mkdtemp(path.join(import.meta.dirname,'.scratch/read-path-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'data/selected'),{recursive:true});
 await fs.mkdir(path.join(root,'data/unrelated'));
 await fs.writeFile(path.join(root,'data/selected/a.json'),'[{"id":"a"}]');
 const original=fs.readdir,visited=[];
 fs.readdir=async function(directory,...args){visited.push(String(directory));return original.call(this,directory,...args)};
 syncBuiltinESMExports();
 try{
  assert.equal(await readTextFile(root,'data/selected/a.json'),'[{"id":"a"}]');
  assert.equal(visited.some(p=>p.endsWith('unrelated')),false,'unrelated directory was scanned');
 }finally{fs.readdir=original;syncBuiltinESMExports();}
});

test('warm ordinary HTTP reads do not reserve publication operations',async t=>{
 const f=await createAuthorityFixture(t);
 const registry=path.join(f.directory,'registry');await fs.mkdir(registry,{recursive:true});
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,[path.join(f.tool,'server.mjs'),'--project',f.root,'--registry-home',registry,'--port',String(port)],{env:fixtureEnvironment(f.directory),windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}});
 // port 0 is printed as its actual assigned address by the server.
 let origin;
 for(let i=0;i<200;i++){
  const match=logs.match(/Data Editor running at (http:\/\/127\.0\.0\.1:\d+)/);
  if(match){origin=match[1];break;}
  if(child.exitCode!==null)throw Error(logs);
  await new Promise(r=>setTimeout(r,25));
 }
 assert.ok(origin,logs||'server did not become live');
 const projects=await (await fetch(origin+'/api/projects')).json();
 const projectId=projects.activeProjectId;
 const readiness=await fetch(origin+`/api/project-readiness?projectId=${projectId}`);
 assert.equal(readiness.status,200);
 for(let i=0;i<200;i++){
  const state=await (await fetch(origin+`/api/project-readiness?projectId=${projectId}`)).json();
  if(state.state==='ready')break;
  if(state.state==='failed')assert.fail(JSON.stringify(state));
  await new Promise(r=>setTimeout(r,25));
 }
 const before=await f.pub.inspectPublicationWindow(f.context);
 for(const route of ['/api/health',`/api/document?projectId=${projectId}&path=data/items.json`,`/api/view-config?projectId=${projectId}`,`/api/document-metadata?projectId=${projectId}&path=data/items.json`]){
  const response=await fetch(origin+route);assert.equal(response.status,200);const body=await response.json();if(route.includes('document-metadata')){assert.equal(body.root,undefined);assert.ok(Array.isArray(body.collections));}
 }
 assert.equal((await f.pub.inspectPublicationWindow(f.context)).revision,before.revision);
 // An out-of-band registry change creates an unprepared context. A GET must
 // read it without enrolling a changed manifest or reserving publication.
 const registryFile=path.join(registry,'projects.json');
 const changedRegistry=JSON.parse(await fs.readFile(registryFile,'utf8'));
 changedRegistry.projects.find(item=>item.id===projectId).filePolicy.includeExtensions.push('.txt');
 await fs.writeFile(path.join(f.root,'.data-editor/project.json'),JSON.stringify({version:1,requires:{capabilityApi:1},capabilities:{}}));
 await fs.writeFile(path.join(f.root,'.data-editor/enrollment.json'),JSON.stringify({version:1,requires:{capabilityApi:1}}));
 await fs.writeFile(registryFile,JSON.stringify(changedRegistry));
 const changedRead=await fetch(origin+`/api/document?projectId=${projectId}&path=data/items.json`);
 assert.equal(changedRead.status,200);
 assert.equal((await f.pub.inspectPublicationWindow(f.context)).revision,before.revision,'GET started recovery for a changed project scope');
 // A run created by an offline writer after startup must recover without a GET
 // triggering the effect. An absent original writer is independently verified.
 const runId=crypto.randomUUID();
 await fs.writeFile(path.join(f.actions,runId+'.json'),JSON.stringify({runId,action:{id:'generic-action',execution:{kind:'project-command'}},projectCommand:{writer:{pid:'999999999',creationTime:'0'}}}));
 let recovered;
 for(let i=0;i<400;i++){
  recovered=await fs.readFile(path.join(f.actions,runId+'.result.json'),'utf8').then(JSON.parse).catch(()=>null);
  if(recovered)break;await new Promise(r=>setTimeout(r,25));
 }
 assert.equal(recovered?.phase,'terminal','offline interrupted run was not discovered by lifecycle recovery');
 assert.equal(recovered?.outcome,'failed');
});
