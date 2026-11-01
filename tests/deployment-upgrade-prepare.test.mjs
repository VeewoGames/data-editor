import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,rm,readdir,writeFile} from 'node:fs/promises';
import {createUpgradeFixture} from './helpers/upgrade-fixture.mjs';
import {assertFixtureLedgerUnchanged,digest} from './helpers/authority-fixture.mjs';
import {encode,decode} from '../src/deployment-authority-schema.mjs';
// Archived protocol-2 reader, copied unchanged from the installed baseline.
import {assertCatalog as protocol2Catalog} from './fixtures/protocol2-authority-schema.mjs';

test('prepare rejects omitted static creations/deletions and missing HTML entry resources',async t=>{
 const f=await createUpgradeFixture(t);
 await writeFile(path.join(f.bootstrap,'dist/unlisted.js'),'new resource omitted from delivery');
 await assert.rejects(()=>f.prepareUpgrade(),{code:'HISTORY_UPGRADE_STATIC_WRITESET_INCOMPLETE'});
 await rm(path.join(f.bootstrap,'dist/unlisted.js'));
 await writeFile(path.join(f.tool,'dist/obsolete.js'),'stale resource');
 await assert.rejects(()=>f.prepareUpgrade(),{code:'HISTORY_UPGRADE_STATIC_WRITESET_INCOMPLETE'});
 await rm(path.join(f.tool,'dist/obsolete.js'));
 const html=Buffer.from('<!doctype html><script type="module" src="/assets/missing.js"></script>');
 await writeFile(path.join(f.bootstrap,'dist/index.html'),html);
 const file=f.releaseManifest.files.find(file=>file.relativePath==='dist/index.html');file.afterRef={path:`objects/${digest(html)}.blob`,digest:digest(html)};file.size=html.length;
 await assert.rejects(()=>f.prepareUpgrade(),{code:'HISTORY_UPGRADE_STATIC_REFERENCE_MISSING'});
});

test('upgrade prepare uses the active v2 proof and archives every prior active pin without modifying selection',async t=>{
 const f=await createUpgradeFixture(t,{rootCount:2});
 await rm(f.sourceConfig);
 const prior=await f.store.readAuthoritySnapshot(),objects=await readdir(path.join(f.authority,'objects'));
 const bundle=await f.prepareUpgrade();
 protocol2Catalog(prior.catalog);
 assert.throws(()=>protocol2Catalog(bundle.catalog),{code:'HISTORY_AUTHORITY_CATALOG_INVALID'});
 assert.equal(bundle.contract,'history-authority-upgrade-bundle-v2');
 assert.equal(bundle.catalog.minReaderProtocol,3);assert.equal(bundle.catalog.generation,prior.catalog.generation+1);
 assert.equal(bundle.affectedRoots.length,2);
 const archived=new Set(bundle.objects.map(e=>e.digest));
 for(const entry of prior.entries)for(const pin of entry.managedNonReplay.deploymentFiles)assert(archived.has(pin.digest),`prior pin not archived: ${pin.path}`);
 assert.deepEqual((await f.store.readAuthoritySnapshot()).bytes,prior.bytes);
 assert.deepEqual(await readdir(path.join(f.authority,'objects')),objects);
 await assertFixtureLedgerUnchanged(f);
 const status=await f.upgradeStore.verifyAuthorityUpgrade(bundle);
 assert.equal(status.phase,'prepared');assert.equal(status.affectedRoots.length,2);
});

test('upgrade prepare rejects source and installation drift, alias paths and incomplete file plans',async t=>{
 const f=await createUpgradeFixture(t),file=path.join(f.tool,'server.mjs'),before=await readFile(file);
 await writeFile(file,Buffer.concat([before,Buffer.from(' drift')]));
 await assert.rejects(f.prepareUpgrade,error=>/^HISTORY_/.test(error.code));await writeFile(file,before);
 const afterFile=path.join(f.bootstrap,'server.mjs'),after=await readFile(afterFile);
 await writeFile(afterFile,Buffer.concat([after,Buffer.from(' drift')]));
 await assert.rejects(f.prepareUpgrade,error=>/^HISTORY_/.test(error.code));await writeFile(afterFile,after);
 f.releaseManifest.files[0].relativePath='../outside';
 await assert.rejects(f.prepareUpgrade,error=>/^HISTORY_/.test(error.code));
});

test('a recomputed package cannot drop prior pins, downgrade its reader, or omit an affected root',async t=>{
 const f=await createUpgradeFixture(t,{rootCount:2}),bundle=await f.prepareUpgrade();
 const forge=change=>{
  const copy=structuredClone(bundle),objects=new Map(copy.objects.map(item=>[item.digest,Buffer.from(item.base64,'base64')]));
  const read=ref=>decode(objects.get(ref.digest)),put=value=>{const bytes=encode(value),id=digest(bytes);objects.set(id,bytes);return {path:`objects/${id}.blob`,digest:id};};
  const entry=copy.catalog.entries[0],manifest=read(entry.intent.packageRef),envelope=read(entry.envelopeRef);
  change({copy,entry,manifest,envelope,read,put});
  entry.intent.packageRef=put(manifest);envelope.intentDigest=digest(encode(entry.intent));
  delete envelope.upgradeId;envelope.upgradeId=digest(encode(envelope));entry.envelopeRef=put(envelope);
  copy.objects=[...objects].map(([digest,bytes])=>({digest,base64:bytes.toString('base64')}));return copy;
 };
 for(const tampered of [
  forge(({manifest})=>manifest.priorPolicyObjects.pop()),
  forge(({entry})=>entry.intent.minReaderProtocol=2),
  {...structuredClone(bundle),catalog:{...bundle.catalog,entries:bundle.catalog.entries.slice(1)}},
  (()=>{const copy=structuredClone(bundle),skipped=copy.priorCatalog.entries[1];copy.catalog.entries[1]=skipped;copy.affectedRoots=copy.affectedRoots.filter(root=>root!==skipped.intent.root);return copy;})()
 ])await assert.rejects(()=>f.upgradeStore.verifyAuthorityUpgrade(tampered),error=>/^HISTORY_/.test(error.code));
 await assertFixtureLedgerUnchanged(f);
 assert.equal((await f.store.readAuthoritySnapshot()).stamp,bundle.expectedCatalogDigest);
});
