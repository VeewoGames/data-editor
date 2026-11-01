import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,rm,writeFile} from 'node:fs/promises';
import {createUpgradeFixture} from './helpers/upgrade-fixture.mjs';
import {assertFixtureLedgerUnchanged,digest} from './helpers/authority-fixture.mjs';

test('upgrade applies exact product bytes and keeps all effects fenced until real runtime completion',async t=>{
 const f=await createUpgradeFixture(t,{rootCount:2}),bundle=await f.prepareUpgrade();
 const result=await f.upgradeStore.applyAuthorityUpgrade(bundle);
 assert.equal(result.status,'delivered_pending_runtime_verification');
 assert.equal((await f.store.readAuthoritySnapshot()).catalog.minReaderProtocol,3);
 for(const file of f.releaseManifest.files)assert.equal(digest(await readFile(path.join(f.tool,file.relativePath))),file.afterRef.digest);
 await assertFixtureLedgerUnchanged(f);
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),{code:'HISTORY_DEPLOYMENT_MAINTENANCE'});
 await assert.rejects(()=>f.upgradeStore.completeAuthorityUpgrade(bundle,{runtime:{ok:true}}),error=>/^HISTORY_UPGRADE_RUNTIME_/.test(error.code));
 await rm(path.join(f.authority,'active-delivery.json'));
 await assert.rejects(()=>f.mod.assertHistoricalRunAllowed(f.context,['fresh']),error=>['HISTORY_DEPLOYMENT_MAINTENANCE','HISTORY_DELIVERY_STATE_UNVERIFIABLE'].includes(error.code));
});

test('unknown installation bytes are never overwritten or accepted as resumed progress',async t=>{
 const f=await createUpgradeFixture(t),bundle=await f.prepareUpgrade(),file=path.join(f.tool,'server.mjs');
 await writeFile(file,'unrecognized external source');
 await assert.rejects(()=>f.upgradeStore.applyAuthorityUpgrade(bundle),error=>/^HISTORY_/.test(error.code));
 assert.equal(await readFile(file,'utf8'),'unrecognized external source');
 assert.equal((await f.store.readAuthoritySnapshot()).stamp,bundle.expectedCatalogDigest);
});
