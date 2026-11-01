import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {createUpgradeFixture} from './helpers/upgrade-fixture.mjs';
import {digest,assertFixtureLedgerUnchanged} from './helpers/authority-fixture.mjs';

test('one frozen bundle resumes forward across each durable apply boundary and file create/replace/delete', {timeout:240000},async t=>{
 let marker;
 const f=await createUpgradeFixture(t,{rootCount:2,prepareBootstrap:async({f,bootstrap,manifest})=>{
 marker=path.join(f.directory,'interrupt-at');
 const relative='src/deployment-delivery.mjs',original=await readFile(path.join(f.tool,relative)),file=path.join(bootstrap,relative);
 const source=await readFile(file,'utf8');assert.ok(source.includes('export async function deliveryCheckpoint(label) {}'));
 await writeFile(file,source.replace('export async function deliveryCheckpoint(label) {}',`export async function deliveryCheckpoint(label) {let selected;try{selected=await readFile(${JSON.stringify(marker)},'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(selected===label){await rm(${JSON.stringify(marker)});throw Object.assign(new Error('fixture interruption'),{code:'FIXTURE_INTERRUPTED'});}}`));
 const after=await readFile(file);
 manifest.files.push({relativePath:relative,beforeDigest:digest(original),afterRef:{path:`objects/${digest(after)}.blob`,digest:digest(after)},mode:'replace',size:after.length});
 }});
 await writeFile(path.join(f.tool,'dist/obsolete.js'),'obsolete asset');
 await writeFile(path.join(f.bootstrap,'dist/created.js'),'new asset');
 const created=Buffer.from('new asset');
 f.releaseManifest.files.push({relativePath:'dist/created.js',beforeDigest:null,afterRef:{path:`objects/${digest(created)}.blob`,digest:digest(created)},mode:'create',size:created.length},{relativePath:'dist/obsolete.js',beforeDigest:digest('obsolete asset'),afterRef:null,mode:'delete',size:0});
 const bundle=await f.prepareUpgrade();
 const phases=['after_objects','after_record','after_pointer','before_selector','after_selector'];
 const spec=JSON.parse(Buffer.from(bundle.objects.find(item=>item.digest===bundle.deliveryId).base64,'base64'));
 for(const entry of spec.files)phases.push('before_file:'+entry.relativePath,...entry.afterRef?['before_publish:'+entry.relativePath]:[],'after_file:'+entry.relativePath);
 phases.push('before_runtime_ready','after_runtime_ready');
 for(const phase of phases){
  await writeFile(marker,phase);
  await assert.rejects(()=>f.upgradeStore.applyAuthorityUpgrade(bundle),{code:'FIXTURE_INTERRUPTED'},phase);
  await assertFixtureLedgerUnchanged(f);
 }
 assert.equal((await f.upgradeStore.applyAuthorityUpgrade(bundle)).status,'delivered_pending_runtime_verification');
 assert.equal((await f.upgradeStore.verifyAuthorityUpgrade(bundle)).phase,'await_runtime');
 await assert.rejects(()=>readFile(path.join(f.tool,'dist/obsolete.js')),{code:'ENOENT'});
 assert.equal(await readFile(path.join(f.tool,'dist/created.js'),'utf8'),'new asset');
 await writeFile(path.join(f.tool,'server.mjs'),'unknown after partial delivery');
 await assert.rejects(()=>f.upgradeStore.applyAuthorityUpgrade(bundle),{code:'HISTORY_UPGRADE_FILE_DRIFT'});
 assert.equal(await readFile(path.join(f.tool,'server.mjs'),'utf8'),'unknown after partial delivery');
 await rm(path.join(f.authority,'active-delivery.json'));
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['new']),error=>['HISTORY_DEPLOYMENT_MAINTENANCE','HISTORY_DELIVERY_STATE_UNVERIFIABLE'].includes(error.code));
});
