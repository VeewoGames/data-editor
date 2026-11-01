import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,realpath,readdir,symlink,lstat,rename,rm} from 'node:fs/promises';
import {spawnWindowsPersistentProcess} from '../src/persistent-process.mjs';
import {inspectProcess,terminateWindowsProcess} from '../stop.mjs';
import {createAuthorityFixture,assertFixtureLedgerUnchanged,assertMissing,digest,moduleUrl} from './helpers/authority-fixture.mjs';
const app=path.resolve(import.meta.dirname,'..'),worker=path.join(app,'tests/helpers/authority-native-worker.mjs'),key=f=>path.resolve(f).replaceAll('\\','/').toLowerCase();
async function setup(t){
 const f=await createAuthorityFixture(t,{installed:false,nativeLocator:true}),report={id:path.basename(f.directory),scope:'native helper unchanged; only fixed product suffix replaced in disposable target tool',nativeOwnedRoot:f.nativeOwnedRoot,authority:f.authority,profile:f.profile,hostUser:os.userInfo(),hostPid:process.pid,helperSha256:digest(await readFile(path.join(app,'native/authority-locator/bin/win32-x64/data-editor-authority-locator.exe'))),productionLocatorSha256:digest(await readFile(path.join(app,'src/deployment-authority-locator.mjs'))),fixtureLocatorSha256:digest(await readFile(path.join(f.tool,'src/deployment-authority-locator.mjs'))),events:[]};
 report.cleanupState=f.cleanupState;
 f.onCleanup(async()=>{const dir=path.join(app,'tests/.scratch/authority-native-evidence',report.id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');});
 return {f,report};
}
async function ordinary(f,report,operation,{waitMs=90000}={}){
 const nonce=report.events.length,specFile=path.join(f.directory,'ordinary-'+nonce+'.json'),output=path.join(f.directory,'ordinary-'+nonce+'-result.json');
 const spec={tool:f.tool,operation,bundleFile:path.join(f.directory,'approved-bundle.json'),context:f.context,oldRun:f.old};await writeFile(specFile,JSON.stringify(spec));
 const handle=await spawnWindowsPersistentProcess(process.execPath,[worker,specFile,output],{cwd:f.directory,timeoutMs:15000});
 const ownership={pid:handle.pid,operation,specFile,output,processExited:false};(report.workers??=[]).push(ownership);let result;
 const cleanup=async()=>{
  if(ownership.processExited)return;
  const info=await inspectProcess(handle.pid);
  if(info){const command=info.commandLine.replaceAll('\\','/').toLowerCase();assert.equal(key(info.executablePath),key(process.execPath),'refuse to stop an unrelated reused PID');for(const file of [worker,specFile,output])assert.ok(command.includes(key(file)),'refuse to stop a worker with another task identity');await terminateWindowsProcess(handle.pid);}
  for(let n=0;n<50;n++){try{process.kill(handle.pid,0);}catch(e){if(e.code==='ESRCH'){ownership.processExited=true;break;}throw e;}await new Promise(r=>setTimeout(r,100));}
  assert.equal(ownership.processExited,true,'owned ordinary worker must exit before fixture deletion');if(result)result.processExited=true;
 };
 cleanup.fixtureDeletionBarrier=true;f.onCleanup(cleanup);
 try{
  for(let n=0;n<waitMs/100;n++){try{result=JSON.parse(await readFile(output));break;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}await new Promise(r=>setTimeout(r,100));}
  assert.ok(result,'ordinary native worker must publish real completion');assert.equal(result.pid,handle.pid);report.events.push(result);return result;
 }finally{await cleanup();}
}
async function prepare(f){const bundle=await f.prepare();await writeFile(path.join(f.directory,'approved-bundle.json'),JSON.stringify(bundle));await assertMissing(f.nativeOwnedRoot);return bundle;}

test('native Profile store is first created by this host and reopened by ordinary host under the same delivery lock', {timeout:180000},async t=>{
 const {f,report}=await setup(t),bundle=await prepare(f);
 assert.equal((await f.apply(bundle)).status,'applied');assert.equal(key(await realpath(f.authority)),key(f.authority));
 assert.equal(key(await realpath(path.join(f.authority,'objects'))),key(path.join(f.authority,'objects')));
 const before=await f.store.readAuthoritySnapshot();
 const read=await ordinary(f,report,'inspect');assert.equal(read.ok,true,JSON.stringify(read));assert.equal(key(read.directory),key(f.authority));assert.equal(read.snapshot.stamp,before.stamp);assert.equal(read.catalogSha256,before.stamp);assert.equal(read.snapshot.objectCount,bundle.objects.length);
 const retried=await ordinary(f,report,'apply');assert.equal(retried.ok,true,JSON.stringify(retried));assert.equal(retried.apply.status,'already_applied');assert.equal((await f.store.readAuthoritySnapshot()).stamp,before.stamp);
 await f.store.withAuthorityDeliveryLock(async()=>{const blocked=await ordinary(f,report,'lock');assert.equal(blocked.code,'PROCESS_OPERATION_BUSY');assert.equal(blocked.acquired,undefined);});
 assert.equal((await ordinary(f,report,'lock')).acquired,true);await assertFixtureLedgerUnchanged(f);report.passed=true;
});

test('ordinary host can first create the native Profile store and this host sees the exact same catalog and objects', {timeout:180000},async t=>{
 const {f,report}=await setup(t),bundle=await prepare(f),created=await ordinary(f,report,'apply');
 assert.equal(created.ok,true,JSON.stringify(created));assert.equal(created.apply.status,'applied');assert.equal(key(created.snapshot.physical),key(f.authority));
 const snapshot=await f.store.readAuthoritySnapshot();assert.equal(snapshot.stamp,created.snapshot.stamp);assert.equal((await readdir(path.join(f.authority,'objects'))).length,bundle.objects.length);
 assert.equal((await f.apply(bundle)).status,'already_applied');await assertFixtureLedgerUnchanged(f);report.passed=true;
});

test('a detached ordinary worker that never publishes is stopped before its fixture is removed', {timeout:30000},async t=>{
 const {f,report}=await setup(t);await assert.rejects(()=>ordinary(f,report,'hold-without-result',{waitMs:1000}),/must publish real completion/);
 assert.equal(report.workers.length,1);assert.equal(report.workers[0].processExited,true);assert.equal(await inspectProcess(report.workers[0].pid),null);report.passed=true;
});

for(const alias of ['product-parent','authority-root','objects','catalog','object'])test('native store rejects '+alias+' junction without writing the redirected destination', {timeout:120000},async t=>{
 const {f,report}=await setup(t),bundle=await prepare(f),outside=path.join(f.directory,'redirected');await mkdir(outside);
 let link;
 if(alias==='product-parent')link=f.nativeOwnedRoot;
 else if(alias==='authority-root'){await mkdir(f.nativeOwnedRoot);link=f.authority;}
 else {await mkdir(f.authority,{recursive:true});if(alias==='objects')link=path.join(f.authority,'objects');else if(alias==='catalog')link=path.join(f.authority,'catalog.v2.json');else{await mkdir(path.join(f.authority,'objects'));link=path.join(f.authority,'objects',bundle.objects[0].digest+'.blob');}}
 await symlink(outside,link,'junction');assert.equal((await lstat(link)).isSymbolicLink(),true);
 await assert.rejects(()=>f.apply(bundle),{code:'HISTORY_AUTHORITY_ALIAS_REJECTED'});assert.deepEqual(await readdir(outside),[]);
 if(alias!=='catalog')await assertMissing(path.join(f.authority,'catalog.v2.json'));
 report.alias={kind:alias,path:link,destination:outside,rejected:'HISTORY_AUTHORITY_ALIAS_REJECTED',destinationFiles:0,catalogActivated:false};await assertFixtureLedgerUnchanged(f);report.passed=true;
});

test('cached native locator does not accept a redirected existing store even when all catalog bytes match', {timeout:120000},async t=>{
 const {f,report}=await setup(t),bundle=await prepare(f);await f.apply(bundle);const before=await readFile(path.join(f.authority,'catalog.v2.json')),retained=path.join(f.nativeOwnedRoot,'retained-authority');
 assert.equal(path.dirname(retained),f.nativeOwnedRoot);assert.equal(path.dirname(f.authority),f.nativeOwnedRoot);await rename(f.authority,retained);await symlink(retained,f.authority,'junction');
 await assert.rejects(()=>f.store.inspectAuthority(),{code:'HISTORY_AUTHORITY_ALIAS_REJECTED'});assert.deepEqual(await readFile(path.join(retained,'catalog.v2.json')),before);
 report.alias={kind:'cached-existing-authority',rejected:'HISTORY_AUTHORITY_ALIAS_REJECTED',originalCatalogUnchanged:true};await assertFixtureLedgerUnchanged(f);report.passed=true;
});

test('real directory creation keeps the post-mkdir identity guard when AppData redirects only after creation', {timeout:120000},async t=>{
 const {f,report}=await setup(t),source=path.join(f.tool,'native/authority-locator/AuthorityLocator.cs');
 const original=await readFile(source,'utf8'),profileGuid='5E6C858F-0E22-4760-9AFE-EA3317B67173';assert.equal(original.split(profileGuid).length,2);
 // Test-only old-location fault: a separately rebuilt, authenticated helper
 // returns LocalAppData. Production still uses the unmodified Profile helper.
 await writeFile(source,original.replace(profileGuid,'F1B32785-6FBA-4FCF-9D55-7B8E7F157091'));
 const exe=path.join(f.tool,'native/authority-locator/bin/win32-x64/data-editor-authority-locator.exe');
 await promisify(execFile)('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+exe,source],{windowsHide:true});
 const faultHelperSha256=digest(await readFile(exe));
 await writeFile(path.join(path.dirname(exe),'authority-locator.manifest.json'),JSON.stringify({version:1,platform:'win32',arch:'x64',sourceSha256:digest(Buffer.from((await readFile(source,'utf8')).replaceAll('\r\n','\n'))),executableSha256:faultHelperSha256}));
 const local=(await promisify(execFile)(exe,['--user-profile'],{windowsHide:true})).stdout,owned=path.join(local,f.nativeSuffix),authority=path.join(owned,'deployment-authority');
 f.onCleanup(async()=>{assert.equal(path.dirname(owned),local);assert.ok(path.basename(owned).startsWith('.data-editor-authority-fixture-'));await rm(owned,{recursive:true,force:true,maxRetries:5,retryDelay:80});});
 await assertMissing(owned);const bundle=await f.prepare();await assertMissing(owned);let error=null,applied=null;
 try{applied=await f.apply(bundle);}catch(e){error=e.code??e.message;}
 const actual=await realpath(authority),redirected=key(actual)!==key(authority);
 if(redirected){assert.equal(error,'HISTORY_AUTHORITY_ALIAS_REJECTED');assert.equal(applied,null);assert.deepEqual(await readdir(path.join(authority,'objects')),[]);await assertMissing(path.join(authority,'catalog.v2.json'));}
 else{assert.equal(error,null);assert.equal(applied.status,'applied');}
 report.creationFault={kind:'test-only-LocalAppData-helper',faultHelperSha256,expected:authority,physical:actual,redirected,error,zeroObjectsBeforeRejection:redirected,catalogActivated:!redirected};await assertFixtureLedgerUnchanged(f);report.passed=true;
});
