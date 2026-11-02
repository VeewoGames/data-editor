import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile,writeFile,realpath,mkdir,open,rename,rm,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolveDeploymentAuthorityDirectory} from './deployment-authority-locator.mjs';
import {withProjectProcessLock} from './project-process-lock.mjs';
import {digest,normalize,encode,decode,canonical,assertCatalog,assertIntent,assertEnvelope,assertManifest,assertRef,assertPolicy,authorityError as bad} from './deployment-authority-schema.mjs';
import {verifySourceProof,verifyLiveProof,verifyQuiescentProof,validateSourceConfiguration,createAuthorityReader} from './deployment-authority-proof.mjs';
import {readDeploymentArtifact} from './historical-deployment-successor.mjs';
import {verifyDeploymentPolicy,businessSnapshot} from './historical-proof.mjs';
import {legacyHistoryRequiredDeploymentFiles,managedHistoryRequiredDeploymentFiles} from './historical-required-files.mjs';
import {authorityPhysical,fixedDirectory,readPhysical,readObject as object,loadCatalog,withStoreDeliveryLock,lockRoots,ensureDirectory,persistObject,activateCatalog as activate,objectCollector} from './deployment-authority-io.mjs';
import {assertDeliveryOpen} from './deployment-delivery.mjs';
export {authorityPhysical};
const toolRoot=path.resolve(import.meta.dirname,'..');
const selection=(entry,read)=>createAuthorityReader(read).select(entry);
export async function readAuthoritySnapshot({qualification='current'}={}){
 const snapshot=await loadCatalog(false),reader=createAuthorityReader(ref=>object(snapshot.directory,ref),{qualification}),entries=[];for(const entry of snapshot.catalog.entries)entries.push(await reader.select(entry));return {...snapshot,entries,verificationStats:reader.stats()};
}
export async function assertAuthorityStamp(expected){const actual=await loadCatalog(false);if(actual.stamp!==expected)bad('HISTORY_AUTHORITY_GENERATION_STALE');await assertDeliveryOpen(actual);return actual;}
export const withAuthorityDeliveryLock=operation=>withStoreDeliveryLock(async()=>{const snapshot=await loadCatalog(true);if(snapshot.bytes)await assertDeliveryOpen(snapshot);return operation();});
export async function validateAuthorityLedger(binding,state,bytes){
 const proof=binding.authority?.proof;if(!proof)bad('HISTORY_DEPLOYMENT_REQUIRED');
 if(!bytes.equals(proof.ledgerBytes)||state.anchorId!==binding.expectedAnchorId)bad('HISTORY_SUCCESSOR_INVALID');
 await assertDeliveryOpen(await loadCatalog());
 if(binding.authority.intent.minReaderProtocol===3){const spec=decode(await object(await fixedDirectory(),binding.authority.envelope.deliverySpecRef));if(spec.installedTool!==normalize(toolRoot))bad('HISTORY_AUTHORITY_BINDING_INVALID');}
 await verifyDeploymentPolicy(binding.policy,{required:binding.authority.requiredFiles,rejectAliases:binding.authority.intent.minReaderProtocol===3});await verifyLiveProof(proof,{fullInventory:false});return proof;
}
export async function initializeEmptyAuthority(){
 return withAuthorityDeliveryLock(async()=>{const old=await loadCatalog(true);if(old.bytes!==null)bad('HISTORY_AUTHORITY_ALREADY_INITIALIZED');await ensureDirectory(old.directory);if((await readdir(old.directory)).length)bad('HISTORY_AUTHORITY_NOT_EMPTY');const c={version:2,contract:'history-authority-catalog-v2',generation:0,minReaderProtocol:2,entries:[]};await activate(old.directory,encode(c));return {status:'initialized',directory:old.directory};});
}
async function currentBaseline(pins){for(const pin of pins){if(normalize(await authorityPhysical(pin.file))!==pin.file||digest(await readFile(pin.file))!==pin.digest)bad('HISTORY_SOURCE_BASELINE_DRIFT');}}
async function makePolicy(businessFiles){const policy={contract:'managed-entry-non-replay-v1',businessFiles:[...businessFiles],deploymentFiles:await Promise.all(managedHistoryRequiredDeploymentFiles.map(async f=>({path:f,digest:digest(await readFile(path.join(toolRoot,f)))})))};return decode(encode(policy));}
export async function prepareAuthorityImport({sourceTool,projectRoot}){
 sourceTool=normalize(await realpath(sourceTool));projectRoot=normalize(await realpath(projectRoot));
 const snapshot=await loadCatalog(true);if(snapshot.catalog.minReaderProtocol>=3)bad('HISTORY_AUTHORITY_IMPORT_RETIRED');if(snapshot.catalog.entries.some(entry=>entry.intent.root===projectRoot))bad('HISTORY_AUTHORITY_ALREADY_SELECTED');const sourceFile=path.join(sourceTool,'config/historical-disposition-deployment.json'),sourceBytes=await readFile(sourceFile),config=validateSourceConfiguration(JSON.parse(sourceBytes)),matches=config.entries.filter(e=>e.projectRoot===projectRoot),source=matches[0];
 if(config.version!==1||matches.length!==1||!source?.managedNonReplay)bad('HISTORY_SOURCE_PROOF_INVALID');
 const collector=objectCollector(),sourceConfigRef=collector.add(sourceBytes),pins=[];
 const addFile=async file=>{const physical=normalize(await realpath(file));if(physical!==normalize(file))bad('HISTORY_BINDING_INVALID');const bytes=await readFile(file);pins.push({file:physical,digest:digest(bytes)});return collector.add(bytes);};
 await addFile(sourceFile);
 const ledgerRef=await addFile(path.join(source.runtime,'entry-action-dispositions/state.json'));const ledger=JSON.parse(await collector.read(ledgerRef));
 for(const f of [path.join(source.projectRoot,'.data-editor/historical-disposition-registration.json'),path.join(source.runtime,'entry-action-dispositions/anchor.json')])await addFile(f);
 for(const pin of source.managedNonReplay.deploymentFiles){const ref=await addFile(path.join(sourceTool,pin.path));if(ref.digest!==pin.digest)bad('HISTORY_DEPLOYMENT_DRIFT');}
 for(const r of Object.values(ledger.records))for(const f of r.evidence?.snapshot?.files??[]){const ref=await addFile(f.file);if(ref.digest!==f.digest)bad('HISTORY_EVIDENCE_DRIFT');}
 let sourceCertificateRef=null,sourceSnapshotRef=null;
 if(source.deploymentSuccessor){const configDir=path.join(sourceTool,'config');await readDeploymentArtifact(source.deploymentSuccessor,'certificate',configDir);sourceCertificateRef=await addFile(path.join(configDir,source.deploymentSuccessor.path));const cert=JSON.parse(await collector.read(sourceCertificateRef));await readDeploymentArtifact(cert.sourceSnapshot,'snapshot',configDir);sourceSnapshotRef=await addFile(path.join(configDir,cert.sourceSnapshot.path));}
 const targetPolicy=await makePolicy(source.managedNonReplay.businessFiles),targetPolicyRef=collector.add(encode(targetPolicy));
 const manifest={version:2,contract:'history-proof-package-v2',files:[...collector.map].map(([digest,b])=>({path:`objects/${digest}.blob`,digest,size:b.length})).sort((a,b)=>a.path.localeCompare(b.path)),sourceConfigRef,sourceSnapshotRef,sourceCertificateRef,ledgerRef,targetPolicyRef};
 const packageRef=collector.add(encode(manifest)),intent={version:2,contract:'history-selection-intent-v2',root:source.projectRoot,runtime:source.runtime,anchorId:source.anchorId,generation:snapshot.catalog.generation+1,minReaderProtocol:2,packageRef,policyRef:targetPolicyRef};
 const body={version:2,contract:'history-authority-migration-v2',intentDigest:digest(encode(intent)),sourceExpectedDigest:digest(sourceBytes),expectedGeneration:snapshot.catalog.generation};const envelope={...body,migrationId:digest(encode(body))},envelopeRef=collector.add(encode(envelope));
 const entry={intent,envelopeRef},selected=await selection(entry,collector.read),businessBaseline=await verifyQuiescentProof(selected.authority.proof,{sourceTool});
 await verifyDeploymentPolicy(targetPolicy);await currentBaseline(pins);
 const catalog={...snapshot.catalog,generation:intent.generation,entries:[...snapshot.catalog.entries.filter(e=>e.intent.root!==intent.root),entry].sort((a,b)=>a.intent.root<b.intent.root?-1:1)};assertCatalog(catalog);
 return {version:2,contract:'history-authority-import-bundle-v2',migrationId:envelope.migrationId,expectedCatalogDigest:snapshot.stamp,sourceTool,sourcePins:pins,businessBaseline,catalog,objects:collector.values()};
}
export async function applyAuthorityImport(bundle){
 if(bundle?.version!==2||bundle.contract!=='history-authority-import-bundle-v2'||Object.keys(bundle).sort().join(',')!=='businessBaseline,catalog,contract,expectedCatalogDigest,migrationId,objects,sourcePins,sourceTool,version'||!Array.isArray(bundle.objects)||!Array.isArray(bundle.sourcePins)||!bundle.sourcePins.length)bad('HISTORY_AUTHORITY_BUNDLE_INVALID');assertCatalog(bundle.catalog);
 const objects=objectCollector(bundle.objects);for(const o of bundle.objects){if(digest(Buffer.from(o.base64,'base64'))!==o.digest)bad('HISTORY_AUTHORITY_DIGEST_MISMATCH');}
 return withAuthorityDeliveryLock(async()=>{
  const old=await loadCatalog(true),target=encode(bundle.catalog),already=old.bytes?.equals(target)===true;
  if(!already&&(old.stamp!==bundle.expectedCatalogDigest||bundle.catalog.generation!==old.catalog.generation+1))bad('HISTORY_AUTHORITY_CATALOG_STALE');
  return lockRoots([...old.catalog.entries,...bundle.catalog.entries].map(e=>e.intent.root),async()=>{
   if((await loadCatalog(true)).stamp!==old.stamp)bad('HISTORY_AUTHORITY_CATALOG_STALE');
   const selections=[];for(const e of bundle.catalog.entries){const read=async r=>objects.map.has(r.digest)?objects.read(r):object(old.directory,r);selections.push(await selection(e,read));}
   const selected=selections.filter(s=>s.authority.envelope.migrationId===bundle.migrationId);if(selected.length!==1)bad('HISTORY_AUTHORITY_BUNDLE_INVALID');const chosen=selected[0];
   if(chosen.authority.intent.generation!==bundle.catalog.generation)bad('HISTORY_AUTHORITY_GENERATION_INVALID');
   for(const prior of old.catalog.entries){const next=bundle.catalog.entries.find(e=>e.intent.root===prior.intent.root);if(!next)bad('HISTORY_AUTHORITY_PROTECTION_REMOVAL');if(prior.intent.root!==chosen.projectRoot&&canonical(next)!==canonical(prior))bad('HISTORY_AUTHORITY_UNSELECTED_ENTRY_CHANGED');if(next.intent.runtime!==prior.intent.runtime||next.intent.anchorId!==prior.intent.anchorId)bad('HISTORY_AUTHORITY_BINDING_INVALID');if(prior.intent.root===chosen.projectRoot){const before=await selection(prior,r=>object(old.directory,r));if(!before.authority.proof.ledgerBytes.equals(chosen.authority.proof.ledgerBytes))bad('HISTORY_AUTHORITY_PROTECTION_REMOVAL');}}
   if(!already){
    const recomputed=await prepareAuthorityImport({sourceTool:bundle.sourceTool,projectRoot:chosen.projectRoot});if(canonical(recomputed)!==canonical(bundle))bad('HISTORY_AUTHORITY_BUNDLE_DRIFT');
    await currentBaseline(bundle.sourcePins);await verifyQuiescentProof(chosen.authority.proof,{businessBaseline:bundle.businessBaseline,sourceTool:bundle.sourceTool});await verifyDeploymentPolicy(chosen.managedNonReplay);
    const current=await loadCatalog(true);if(current.stamp!==bundle.expectedCatalogDigest)bad('HISTORY_AUTHORITY_CATALOG_STALE');
    for(const [d,b] of objects.map)await persistObject(current.directory,{path:`objects/${d}.blob`,digest:d},b);
    await currentBaseline(bundle.sourcePins);await verifyQuiescentProof(chosen.authority.proof,{businessBaseline:bundle.businessBaseline,sourceTool:bundle.sourceTool});await verifyDeploymentPolicy(chosen.managedNonReplay);
    if((await loadCatalog(true)).stamp!==bundle.expectedCatalogDigest)bad('HISTORY_AUTHORITY_CATALOG_STALE');await activate(current.directory,target);
   }
   const installed=await readAuthoritySnapshot(),active=installed.entries.find(e=>e.projectRoot===chosen.projectRoot);await verifyLiveProof(active.authority.proof,{fullInventory:true});await verifyDeploymentPolicy(active.managedNonReplay);
   return {status:already?'already_applied':'applied',generation:installed.catalog.generation,migrationId:bundle.migrationId,directory:installed.directory};
  });
 });
}
export async function inspectAuthority(){const snapshot=await readAuthoritySnapshot();const entries=[];for(const e of snapshot.entries){await verifyLiveProof(e.authority.proof,{fullInventory:true});await verifyDeploymentPolicy(e.managedNonReplay,{required:e.authority.requiredFiles});entries.push({root:e.projectRoot,runtime:e.runtime,anchorId:e.anchorId,closedRuns:[...new Set(Object.values(e.authority.proof.ledger.records).flatMap(r=>r.relatedRunIds))]});}return {generation:snapshot.catalog.generation,catalogDigest:snapshot.stamp,directory:snapshot.directory,entries};}

export const prepareAuthorityUpgrade=async options=>(await import('./deployment-upgrade.mjs')).prepareAuthorityUpgrade(options);
export const verifyAuthorityUpgrade=async bundle=>(await import('./deployment-upgrade.mjs')).verifyAuthorityUpgrade(bundle);
export const applyAuthorityUpgrade=async bundle=>(await import('./deployment-upgrade.mjs')).applyAuthorityUpgrade(bundle);
export const completeAuthorityUpgrade=async bundle=>(await import('./deployment-upgrade.mjs')).completeAuthorityUpgrade(bundle);
