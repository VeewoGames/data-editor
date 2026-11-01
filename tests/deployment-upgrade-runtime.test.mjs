import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,cp,readdir,mkdir,symlink,rm} from 'node:fs/promises';
import {createUpgradeFixture} from './helpers/upgrade-fixture.mjs';
import {digest,assertFixtureLedgerUnchanged,moduleUrl,oldRun} from './helpers/authority-fixture.mjs';

const exec=promisify(execFile);
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function waitHealth(child,port,route,output){
 for(let i=0;i<150;i++){
  if(child.exitCode!==null)throw Error('fixture service exited: '+output());
  try{if((await fetch(`http://127.0.0.1:${port}${route}`,{signal:AbortSignal.timeout(500)})).ok)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error('fixture service timeout: '+output());
}
async function start(t,f){
 const children=[];
 f.onCleanup(Object.assign(async()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null){await new Promise((resolve,reject)=>{child.once('exit',resolve);child.kill();setTimeout(()=>reject(Error('fixture process still alive')),10000).unref();});}},{fixtureDeletionBarrier:true}));
 for(const role of ['main','bridge']){
  const r=f.releaseManifest.runtime,args=role==='main'?[path.join(f.tool,'server.mjs'),'--project',f.root,'--registry-home',f.registryHome,'--port',String(r.mainPort),'--bridge-port',String(r.bridgePort),'--static','dist']:[path.join(f.tool,'recovery-bridge.mjs'),'--tool-root',f.tool,'--project',f.root,'--registry-home',f.registryHome,'--port',String(r.bridgePort),'--service-port',String(r.mainPort),'--service-mode','static'];
  const child=spawn(process.execPath,args,{cwd:f.tool,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  await waitHealth(child,role==='main'?r.mainPort:r.bridgePort,role==='main'?'/api/health':'/health',()=>output);
 }
 return children;
}
test('offline CLI delivers and independently completes real main/bridge instances; retries write nothing', {timeout:180000},async t=>{
 const f=await createUpgradeFixture(t,{rootCount:2,successor:true}),r=f.releaseManifest.runtime;r.mainPort=await freePort();r.bridgePort=await freePort();
 const marker=path.join(f.directory,'completion-interrupt'),deliveryPath=path.join(f.bootstrap,'src/deployment-delivery.mjs');
 const beforeDelivery=await readFile(deliveryPath),deliveryText=beforeDelivery.toString().replace('export async function deliveryCheckpoint(label) {}',`export async function deliveryCheckpoint(label) {let selected;try{selected=await readFile(${JSON.stringify(marker)},'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(label===selected){await rm(${JSON.stringify(marker)});throw Object.assign(new Error('fixture interrupt'),{code:'FIXTURE_INTERRUPTED'});}}`);
 await writeFile(deliveryPath,deliveryText);const afterDelivery=Buffer.from(deliveryText);
 f.releaseManifest.files.push({relativePath:'src/deployment-delivery.mjs',beforeDigest:digest(beforeDelivery),afterRef:{path:`objects/${digest(afterDelivery)}.blob`,digest:digest(afterDelivery)},mode:'replace',size:afterDelivery.length});
 const asset=Buffer.from('// first frozen static asset'),html=Buffer.from('<!doctype html><script type="module" src="/release-first.js"></script>');
 await writeFile(path.join(f.bootstrap,'dist/release-first.js'),asset);await writeFile(path.join(f.bootstrap,'dist/index.html'),html);
 const htmlFile=f.releaseManifest.files.find(file=>file.relativePath==='dist/index.html');htmlFile.afterRef={path:`objects/${digest(html)}.blob`,digest:digest(html)};htmlFile.size=html.length;
 f.releaseManifest.files.push({relativePath:'dist/release-first.js',beforeDigest:null,afterRef:{path:`objects/${digest(asset)}.blob`,digest:digest(asset)},mode:'create',size:asset.length});
 const manifestFile=path.join(f.directory,'release.json'),bundleFile=path.join(f.directory,'upgrade.json');await writeFile(manifestFile,JSON.stringify(f.releaseManifest));
 const cli=async args=>{const result=await exec(process.execPath,[path.join(f.bootstrap,'scripts/deployment-authority.mjs'),...args],{cwd:f.bootstrap,windowsHide:true,timeout:90000,maxBuffer:1024*1024});return JSON.parse(result.stdout);};
 const prepared=await cli(['upgrade-prepare','--installed-tool',f.tool,'--candidate-tool',f.bootstrap,'--release-manifest',manifestFile,'--output',bundleFile]);
 const bundleArgs=['--bundle',bundleFile,'--bundle-digest',prepared.bundleDigest];assert.equal((await cli(['upgrade-verify',...bundleArgs])).phase,'prepared');
 assert.equal((await cli(['upgrade-apply',...bundleArgs])).status,'delivered_pending_runtime_verification');
 const children=await start(t,f);
 const denied=await fetch(`http://127.0.0.1:${r.mainPort}/api/save`,{method:'POST',body:'{}'});assert.equal(denied.status,503);
 assert.equal((await fetch(`http://127.0.0.1:${r.bridgePort}/start`,{method:'POST'})).status,503);
 await writeFile(path.join(f.tool,'dist/release-first.js'),'unknown resource after startup');
 await assert.rejects(()=>cli(['upgrade-complete',...bundleArgs]),error=>['HISTORY_UPGRADE_STATIC_DRIFT','HISTORY_UPGRADE_FILE_DRIFT'].includes(JSON.parse(error.stdout).code));
 await writeFile(path.join(f.tool,'dist/release-first.js'),asset);
 await writeFile(marker,'after_completion_receipt');
 await assert.rejects(()=>cli(['upgrade-complete',...bundleArgs]),error=>error.stdout.includes('FIXTURE_INTERRUPTED'));
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh-after-receipt']),{code:'HISTORY_DEPLOYMENT_MAINTENANCE'});
 assert.equal((await cli(['upgrade-complete',...bundleArgs])).status,'completed');
 const receipt=await readFile(path.join(f.authority,'deliveries',prepared.deliveryId+'.complete.json'));
 const selector=await readFile(path.join(f.authority,'catalog.v2.json'));
 assert.equal((await cli(['upgrade-complete',...bundleArgs])).status,'already_applied');
 assert.equal((await cli(['upgrade-apply',...bundleArgs])).status,'already_applied');
 assert.deepEqual(await readFile(path.join(f.authority,'deliveries',prepared.deliveryId+'.complete.json')),receipt);
 assert.deepEqual(await readFile(path.join(f.authority,'catalog.v2.json')),selector);
 assert.equal((await cli(['upgrade-verify',...bundleArgs])).phase,'completed');
 await f.mod.assertHistoricalRunAllowed(f.context,['fresh-after-complete']);
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,[oldRun]),{code:'HISTORY_RUN_CLOSED'});
 // Retired source configuration is never consulted by either upgrade generation.
 await rm(f.sourceTool,{recursive:true,force:true});
 for(const child of children)if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
 const secondBootstrap=path.join(f.directory,'bootstrap-second');await mkdir(secondBootstrap);
 for(const entry of await readdir(f.tool))if(entry!=='node_modules')await cp(path.join(f.tool,entry),path.join(secondBootstrap,entry),{recursive:true});
 await symlink(path.join(f.tool,'node_modules'),path.join(secondBootstrap,'node_modules'),'junction');
 // A later static-only release must work with an unchanged protocol-3 backend policy.
 const secondManifest={...f.releaseManifest,files:[]};
 const secondHtml=Buffer.from('<!doctype html><script type="module" src="/release-second.js"></script>'),secondAsset=Buffer.from('// second frozen asset');
 await writeFile(path.join(secondBootstrap,'dist/index.html'),secondHtml);await rm(path.join(secondBootstrap,'dist/release-first.js'));await writeFile(path.join(secondBootstrap,'dist/release-second.js'),secondAsset);
 secondManifest.files.push({relativePath:'dist/index.html',beforeDigest:digest(html),afterRef:{path:`objects/${digest(secondHtml)}.blob`,digest:digest(secondHtml)},mode:'replace',size:secondHtml.length},{relativePath:'dist/release-first.js',beforeDigest:digest(asset),afterRef:null,mode:'delete',size:0},{relativePath:'dist/release-second.js',beforeDigest:null,afterRef:{path:`objects/${digest(secondAsset)}.blob`,digest:digest(secondAsset)},mode:'create',size:secondAsset.length});
 const secondStore=await import(moduleUrl(secondBootstrap,'src/deployment-authority-store.mjs'));
 const second=await secondStore.prepareAuthorityUpgrade({installedTool:f.tool,candidateTool:secondBootstrap,releaseManifest:secondManifest});
 assert.equal(second.catalog.generation,JSON.parse(selector).generation+1);
 assert.equal(second.affectedRoots.length,2);
 for(const prior of JSON.parse(selector).entries){
  const next=second.catalog.entries.find(entry=>entry.intent.root===prior.intent.root);
  assert.deepEqual(next.intent.policyRef,prior.intent.policyRef,'frontend release preserves backend policy');
  assert.notDeepEqual(next.envelopeRef,prior.envelopeRef,'frontend release renews the delivery envelope');
 }
 // A same-policy root still needs the new delivery selection; a forged omission must fail.
 const skipped=structuredClone(second),oldSelection=skipped.priorCatalog.entries[1];
 skipped.catalog.entries[1]=oldSelection;skipped.affectedRoots=skipped.affectedRoots.filter(root=>root!==oldSelection.intent.root);
 await assert.rejects(()=>secondStore.verifyAuthorityUpgrade(skipped),{code:'HISTORY_UPGRADE_AFFECTED_SET_INVALID'});
 assert.equal((await secondStore.applyAuthorityUpgrade(second)).status,'delivered_pending_runtime_verification');
 const previousBundle=JSON.parse(await readFile(bundleFile));
 await assert.rejects(()=>f.upgradeStore.applyAuthorityUpgrade(previousBundle),{code:'HISTORY_AUTHORITY_CATALOG_STALE'});
 const secondChildren=await start(t,f);
 await writeFile(marker,'after_pointer_clear');
 await assert.rejects(()=>secondStore.completeAuthorityUpgrade(second),{code:'FIXTURE_INTERRUPTED'});
 assert.equal((await secondStore.completeAuthorityUpgrade(second)).status,'already_applied');
 await f.mod.assertHistoricalRunAllowed(f.context,['fresh-second-generation']);
 // A second consecutive static-only release proves that identical policy identities can recur in the chain.
 for(const child of secondChildren)if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
 const thirdBootstrap=path.join(f.directory,'bootstrap-third');await mkdir(thirdBootstrap);
 for(const entry of await readdir(f.tool))if(entry!=='node_modules')await cp(path.join(f.tool,entry),path.join(thirdBootstrap,entry),{recursive:true});
 await symlink(path.join(f.tool,'node_modules'),path.join(thirdBootstrap,'node_modules'),'junction');
 const thirdHtml=Buffer.from(secondHtml.toString()+'<title>Third release</title>');await writeFile(path.join(thirdBootstrap,'dist/index.html'),thirdHtml);
 const thirdManifest={...secondManifest,files:[{relativePath:'dist/index.html',beforeDigest:digest(secondHtml),afterRef:{path:'objects/'+digest(thirdHtml)+'.blob',digest:digest(thirdHtml)},mode:'replace',size:thirdHtml.length}]};
 const thirdStore=await import(moduleUrl(thirdBootstrap,'src/deployment-authority-store.mjs'));
 const third=await thirdStore.prepareAuthorityUpgrade({installedTool:f.tool,candidateTool:thirdBootstrap,releaseManifest:thirdManifest});
 assert.equal(third.catalog.generation,second.catalog.generation+1);
 for(const entry of third.catalog.entries)assert.deepEqual(entry.intent.policyRef,second.catalog.entries.find(prior=>prior.intent.root===entry.intent.root).intent.policyRef);
 assert.equal((await thirdStore.applyAuthorityUpgrade(third)).status,'delivered_pending_runtime_verification');
 await start(t,f);assert.equal((await thirdStore.completeAuthorityUpgrade(third)).status,'completed');
 await assert.rejects(()=>secondStore.applyAuthorityUpgrade(second),{code:'HISTORY_AUTHORITY_CATALOG_STALE'});
 const sourceFile=path.join(f.root,'data/items.json');await writeFile(sourceFile,'[{"id":"one","draft":"later legitimate edit"}]');
 assert.equal((await thirdStore.completeAuthorityUpgrade(third)).status,'already_applied');
 assert.equal(await readFile(sourceFile,'utf8'),'[{"id":"one","draft":"later legitimate edit"}]');
 await assertFixtureLedgerUnchanged(f);assert.equal(children.length,2);assert.equal(digest(await readFile(bundleFile)),prepared.bundleDigest);
});
