import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {readAuthoritySnapshot} from './deployment-authority-store.mjs';
import {createAuthorityReader,verifyLiveProof,verifyQuiescentProof} from './deployment-authority-proof.mjs';
import {verifyDeploymentPolicy} from './historical-proof.mjs';
import {encode,decode,digest,canonical,exact,assertCatalog,assertPolicy,assertRef,authorityError as bad} from './deployment-authority-schema.mjs';
import {readObject,loadCatalog,objectCollector,withStoreDeliveryLock,lockRoots,persistObject,activateCatalog,createStoreFile} from './deployment-authority-io.mjs';
import {buildDeliverySpec,bootstrapPins,deliveryPath,assertBootstrap,inspectFiles,assertStaticRelease,assertStaticWritePlan,validateDeliverySpec,assertDeliveryOpen,optionalStoreJson,assertDeliveryRecord,readDeliveryState,saveDeliveryRecord,createDeliveryPointer,clearDeliveryPointer,deliverFiles,deliveryCheckpoint,deliveryRecordPath,deliveryReceiptPath} from './deployment-delivery.mjs';
import {assertServicesStopped,verifyRuntimeDelivery} from './deployment-runtime.mjs';

async function archiveSnapshot(snapshot,collector){
 collector.add(snapshot.bytes);
 for(const entry of snapshot.entries){
  for(const ref of [entry.authority.entry.envelopeRef,entry.authority.intent.packageRef,...entry.authority.manifest.files])collector.add(await readObject(snapshot.directory,{path:ref.path,digest:ref.digest}));
 }
}
export async function prepareAuthorityUpgrade({installedTool,candidateTool,releaseManifest}){
 const snapshot=await readAuthoritySnapshot({qualification:'upgrade-prior'});
 await assertDeliveryOpen(snapshot);
 if(!snapshot.entries.length)bad('HISTORY_UPGRADE_NO_PROTECTED_PROJECTS');
 for(const entry of snapshot.entries){
  await verifyDeploymentPolicy(entry.managedNonReplay,{toolRoot:installedTool,required:entry.authority.requiredFiles});
  await verifyLiveProof(entry.authority.proof,{fullInventory:true});
 }
 const collector=objectCollector();await archiveSnapshot(snapshot,collector);
 const spec=await buildDeliverySpec({installedTool,candidateTool,manifest:releaseManifest,snapshot,collector});
 spec.businessBaselines=[];
 for(const entry of snapshot.entries)spec.businessBaselines.push({root:entry.projectRoot,files:await verifyQuiescentProof(entry.authority.proof)});
 const policyPins=await bootstrapPins(spec.candidateTool,[]),nextPolicies=new Map(),priorObjects=new Map();
 for(const entry of snapshot.entries){
  const saved=[];
  for(const pin of entry.managedNonReplay.deploymentFiles){
   const bytes=await readFile(await deliveryPath(spec.installedTool,pin.path));if(digest(bytes)!==pin.digest)bad('HISTORY_DEPLOYMENT_DRIFT');
   collector.add(bytes);saved.push({path:pin.path,digest:pin.digest,size:bytes.length});
  }
  priorObjects.set(entry.projectRoot,saved);
  const names=new Set([...entry.managedNonReplay.deploymentFiles.map(pin=>pin.path),...policyPins.map(pin=>pin.path)]),deploymentFiles=[];
  for(const relative of [...names].sort()){
   const bytes=await readFile(await deliveryPath(spec.candidateTool,relative)),id=digest(bytes),planned=spec.files.find(file=>file.relativePath===relative);
   if(planned){if(planned.afterRef?.digest!==id)bad('HISTORY_UPGRADE_WRITESET_INCOMPLETE');}
   else if(digest(await readFile(await deliveryPath(spec.installedTool,relative)))!==id)bad('HISTORY_UPGRADE_WRITESET_INCOMPLETE');
   collector.add(bytes);deploymentFiles.push({path:relative,digest:id});
  }
  nextPolicies.set(entry.projectRoot,{contract:entry.managedNonReplay.contract,businessFiles:[...entry.managedNonReplay.businessFiles],deploymentFiles});
 }
 // Every release changes this shared installation, even if only frontend bytes change.
 // Rebind every protected root to the delivery; an unchanged policy is not an unchanged release.
 const affectedRoots=snapshot.entries.map(entry=>entry.projectRoot).sort();
 const specRef=collector.add(encode(spec)),priorCatalogRef=collector.add(snapshot.bytes),entries=[];
 for(const prior of snapshot.catalog.entries){
  const targetPolicyRef=collector.add(encode(nextPolicies.get(prior.intent.root)));
  const manifest={version:2,contract:'history-upgrade-proof-package-v2',files:[...collector.map].map(([id,bytes])=>({path:`objects/${id}.blob`,digest:id,size:bytes.length})).sort((a,b)=>a.path.localeCompare(b.path)),priorCatalogRef,priorEntryDigest:digest(encode(prior)),priorPolicyObjects:priorObjects.get(prior.intent.root),ledgerRef:collector.add(snapshot.entries.find(entry=>entry.projectRoot===prior.intent.root).authority.proof.ledgerBytes),targetPolicyRef,deliverySpecRef:specRef};
  const packageRef=collector.add(encode(manifest)),intent={...prior.intent,generation:snapshot.catalog.generation+1,minReaderProtocol:3,packageRef,policyRef:targetPolicyRef};
  const body={version:2,contract:'history-authority-upgrade-v2',intentDigest:digest(encode(intent)),priorCatalogDigest:snapshot.stamp,priorEntryDigest:manifest.priorEntryDigest,deliverySpecRef:specRef,expectedGeneration:snapshot.catalog.generation};
  const envelope={...body,upgradeId:digest(encode(body))};entries.push({intent,envelopeRef:collector.add(encode(envelope))});
 }
 const catalog={...snapshot.catalog,generation:snapshot.catalog.generation+1,minReaderProtocol:3,entries};assertCatalog(catalog);
 const bundle={version:2,contract:'history-authority-upgrade-bundle-v2',deliveryId:specRef.digest,expectedCatalogDigest:snapshot.stamp,priorCatalog:snapshot.catalog,catalog,affectedRoots,deliverySpecRef:specRef,objects:collector.values()};
 await validateUpgradeBundle(bundle);
 if((await loadCatalog()).stamp!==snapshot.stamp)bad('HISTORY_AUTHORITY_CATALOG_STALE');
 await assertBootstrap(spec);
 return bundle;
}

export async function validateUpgradeBundle(bundle){
 if(!exact(bundle,'version,contract,deliveryId,expectedCatalogDigest,priorCatalog,catalog,affectedRoots,deliverySpecRef,objects')||bundle.version!==2||bundle.contract!=='history-authority-upgrade-bundle-v2'||!Array.isArray(bundle.objects)||bundle.objects.length>100000||!Array.isArray(bundle.affectedRoots)||!bundle.affectedRoots.length)bad('HISTORY_UPGRADE_BUNDLE_INVALID');
 assertCatalog(bundle.priorCatalog);assertCatalog(bundle.catalog);assertRef(bundle.deliverySpecRef);
 if(bundle.deliveryId!==bundle.deliverySpecRef.digest||bundle.expectedCatalogDigest!==digest(encode(bundle.priorCatalog))||bundle.catalog.generation!==bundle.priorCatalog.generation+1||bundle.catalog.minReaderProtocol!==3)bad('HISTORY_UPGRADE_BUNDLE_INVALID');
 for(const item of bundle.objects)if(!exact(item,'digest,base64')||typeof item.base64!=='string')bad('HISTORY_UPGRADE_BUNDLE_INVALID');
 const collector=objectCollector(bundle.objects),spec=decode(await collector.read(bundle.deliverySpecRef));validateDeliverySpec(spec);
 if(spec.contract!=='history-deployment-delivery-v1'||spec.priorCatalogDigest!==bundle.expectedCatalogDigest)bad('HISTORY_UPGRADE_BUNDLE_INVALID');
 const priorReader=createAuthorityReader(collector.read,{qualification:'upgrade-prior'}),targetReader=createAuthorityReader(collector.read),before=[],after=[];
 for(const entry of bundle.priorCatalog.entries)before.push(await priorReader.select(entry));
 for(const entry of bundle.catalog.entries)after.push(await targetReader.select(entry));
 if(before.length!==after.length)bad('HISTORY_AUTHORITY_PROTECTION_REMOVAL');
 if(canonical([...spec.businessBaselines.map(item=>item.root)].sort())!==canonical([...before.map(entry=>entry.projectRoot)].sort()))bad('HISTORY_UPGRADE_SPEC_INVALID');
 const affected=[];
 for(const prior of before){
  const next=after.find(entry=>entry.projectRoot===prior.projectRoot);if(!next)bad('HISTORY_AUTHORITY_PROTECTION_REMOVAL');
  if(canonical(prior.authority.entry)===canonical(next.authority.entry)){
   for(const pin of prior.managedNonReplay.deploymentFiles){const changed=spec.files.find(file=>file.relativePath===pin.path);if(changed&&changed.afterRef?.digest!==pin.digest)bad('HISTORY_AUTHORITY_UNSELECTED_ENTRY_CHANGED');}
   continue;
  }
  affected.push(prior.projectRoot);
  if(next.authority.intent.minReaderProtocol!==3||next.authority.intent.generation!==bundle.catalog.generation||next.authority.manifest.priorCatalogRef.digest!==bundle.expectedCatalogDigest||next.authority.envelope.deliverySpecRef.digest!==bundle.deliveryId||next.runtime!==prior.runtime||next.anchorId!==prior.anchorId||!next.authority.proof.ledgerBytes.equals(prior.authority.proof.ledgerBytes))bad('HISTORY_AUTHORITY_PROTECTION_REMOVAL');
  assertPolicy(next.managedNonReplay);
  for(const pin of next.managedNonReplay.deploymentFiles){
   const bytes=await collector.read({path:`objects/${pin.digest}.blob`,digest:pin.digest});
   const change=spec.files.find(file=>file.relativePath===pin.path);
   if(change&&change.afterRef?.digest!==digest(bytes))bad('HISTORY_UPGRADE_PAYLOAD_DRIFT');
  }
 }
 if(canonical(affected.sort())!==canonical(before.map(entry=>entry.projectRoot).sort())||canonical(affected)!==canonical([...bundle.affectedRoots].sort())||new Set(bundle.affectedRoots).size!==bundle.affectedRoots.length)bad('HISTORY_UPGRADE_AFFECTED_SET_INVALID');
 for(const file of spec.files)if(file.afterRef){const bytes=await collector.read(file.afterRef);if(bytes.length!==file.size)bad('HISTORY_UPGRADE_PAYLOAD_DRIFT');}
 return {bundle,collector,spec,before,after,targetDigest:digest(encode(bundle.catalog)),bundleDigest:digest(encode(bundle))};
}
export async function verifyAuthorityUpgrade(bundle){
 const verified=await validateUpgradeBundle(bundle),snapshot=await loadCatalog();
 let phase=snapshot.stamp===bundle.expectedCatalogDigest?'prepared':snapshot.stamp===verified.targetDigest?'selected':'superseded';
 if(phase==='superseded')bad('HISTORY_AUTHORITY_CATALOG_STALE');
 if(phase==='selected'){
  const state=await readDeliveryState(snapshot.directory,bundle.deliveryId);assertMatchingRecord(state.record,verified);
  if(state.completed){await verifyAfter(verified,{quiescent:false});phase='completed';}
  else{if(!state.pointer||state.pointer.deliveryId!==bundle.deliveryId||state.pointer.targetCatalogDigest!==verified.targetDigest||state.pointer.bundleDigest!==verified.bundleDigest)bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');phase=state.record.phase;}
 }
 if(phase!=='completed')await assertBootstrap(verified.spec);
 const files=await inspectFiles(verified.spec);
 if(phase==='prepared'&&files.some(file=>file.state!=='before')||files.some(file=>file.state==='unknown'))bad('HISTORY_UPGRADE_FILE_DRIFT');
 if(phase==='prepared')await verifyBefore(verified);
 return {phase,bundleDigest:verified.bundleDigest,deliveryId:bundle.deliveryId,affectedRoots:bundle.affectedRoots,files:files.map(({relativePath,state})=>({relativePath,state})),activation:'requires-explicit-apply'};
}

async function verifyBefore(verified){
 await assertBootstrap(verified.spec);
 await assertStaticWritePlan(verified.spec);
 const {spec}=verified;
 for(const file of spec.files){
  const target=await deliveryPath(spec.installedTool,file.relativePath);
  if(target===spec.authorityDirectory||target.startsWith(spec.authorityDirectory+'/')||verified.before.some(entry=>target===entry.projectRoot||target.startsWith(entry.projectRoot+'/')))bad('HISTORY_UPGRADE_WRITE_OUTSIDE_PRODUCT');
 }
 for(const entry of verified.after)for(const pin of entry.managedNonReplay.deploymentFiles){
  if(!spec.files.some(file=>file.relativePath===pin.path)&&digest(await readFile(await deliveryPath(spec.installedTool,pin.path)))!==pin.digest)bad('HISTORY_UPGRADE_WRITESET_INCOMPLETE');
 }
 for(const relative of ['package.json','package-lock.json'])if(digest(await readFile(await deliveryPath(spec.installedTool,relative)))!==spec.bootstrapPins.find(pin=>pin.path===relative)?.digest)bad('HISTORY_UPGRADE_DEPENDENCIES_CHANGED');
 if((await inspectFiles(verified.spec)).some(file=>file.state!=='before'))bad('HISTORY_UPGRADE_BEFORE_DRIFT');
 if(digest(await readFile(path.join(verified.spec.runtime.registryHome,'projects.json')))!==verified.spec.runtime.registryDigest)bad('HISTORY_UPGRADE_RUNTIME_REGISTRY_CHANGED');
 for(const entry of verified.before){
  await verifyDeploymentPolicy(entry.managedNonReplay,{toolRoot:verified.spec.installedTool,required:entry.authority.requiredFiles});
  await verifyQuiescentProof(entry.authority.proof,{businessBaseline:verified.spec.businessBaselines.find(item=>item.root===entry.projectRoot).files});
 }
}
async function verifyAfter(verified,{quiescent=true}={}){
 if((await inspectFiles(verified.spec)).some(file=>file.state!=='after'))bad('HISTORY_UPGRADE_FILE_DRIFT');
 await assertStaticRelease(verified.spec);
 for(const entry of verified.after){
  await verifyDeploymentPolicy(entry.managedNonReplay,{toolRoot:verified.spec.installedTool,required:entry.authority.requiredFiles,rejectAliases:true});
  if(quiescent)await verifyQuiescentProof(entry.authority.proof,{businessBaseline:verified.spec.businessBaselines.find(item=>item.root===entry.projectRoot).files});
  else await verifyLiveProof(entry.authority.proof,{fullInventory:true});
 }
}
function assertMatchingRecord(record,verified){
 assertDeliveryRecord(record,verified.bundle.deliveryId);
 if(record.bundleDigest!==verified.bundleDigest||record.priorCatalogDigest!==verified.bundle.expectedCatalogDigest||record.targetCatalogDigest!==verified.targetDigest||canonical(record.specRef)!==canonical(verified.bundle.deliverySpecRef))bad('HISTORY_UPGRADE_OTHER_DELIVERY_ACTIVE');
}
export async function applyAuthorityUpgrade(bundle){
 const verified=await validateUpgradeBundle(bundle);
 return withStoreDeliveryLock(()=>lockRoots(bundle.priorCatalog.entries.map(entry=>entry.intent.root),async()=>{
  const snapshot=await loadCatalog(),existing=await optionalStoreJson(snapshot.directory,deliveryRecordPath(bundle.deliveryId));
  if(snapshot.stamp!==bundle.expectedCatalogDigest&&snapshot.stamp!==verified.targetDigest)bad('HISTORY_AUTHORITY_CATALOG_STALE');
  if(existing){
   assertMatchingRecord(existing,verified);
   if(snapshot.stamp===verified.targetDigest){
    const state=await readDeliveryState(snapshot.directory,bundle.deliveryId);
    if(state.completed){await verifyAfter(verified,{quiescent:false});return {status:'already_applied',deliveryId:bundle.deliveryId,generation:bundle.catalog.generation};}
    if(!state.pointer||state.pointer.deliveryId!==bundle.deliveryId||state.pointer.bundleDigest!==verified.bundleDigest)bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
   }
  }else if(snapshot.stamp===verified.targetDigest)bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
  await assertBootstrap(verified.spec);
  await assertServicesStopped(verified.spec,bundle.priorCatalog.entries.map(entry=>entry.intent.root));
  let record=existing;
  if(snapshot.stamp===bundle.expectedCatalogDigest){
   if(record&&record.phase!=='staged')bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
   await verifyBefore(verified);
   const pointer=await optionalStoreJson(snapshot.directory,'active-delivery.json');
   if(pointer&&(pointer.deliveryId!==bundle.deliveryId||pointer.bundleDigest!==verified.bundleDigest))bad('HISTORY_UPGRADE_OTHER_DELIVERY_ACTIVE');
   for(const [id,bytes] of verified.collector.map)await persistObject(snapshot.directory,{path:`objects/${id}.blob`,digest:id},bytes);
   const targetBytes=encode(bundle.catalog);await persistObject(snapshot.directory,{path:`objects/${verified.targetDigest}.blob`,digest:verified.targetDigest},targetBytes);
   const bundleRef={path:`objects/${verified.bundleDigest}.blob`,digest:verified.bundleDigest};await persistObject(snapshot.directory,bundleRef,encode(bundle));
   await deliveryCheckpoint('after_objects');
   if(!record){record={version:1,contract:'history-delivery-state-v1',deliveryId:bundle.deliveryId,bundleDigest:verified.bundleDigest,priorCatalogDigest:bundle.expectedCatalogDigest,targetCatalogDigest:verified.targetDigest,specRef:bundle.deliverySpecRef,bundleRef,phase:'staged',createdAt:new Date().toISOString(),activatedAt:null};await saveDeliveryRecord(snapshot.directory,record);}
   await deliveryCheckpoint('after_record');
   await createDeliveryPointer(snapshot.directory,record);await deliveryCheckpoint('after_pointer');
   await verifyBefore(verified);
   if((await loadCatalog()).stamp!==bundle.expectedCatalogDigest)bad('HISTORY_AUTHORITY_CATALOG_STALE');
   await deliveryCheckpoint('before_selector');await activateCatalog(snapshot.directory,targetBytes);await deliveryCheckpoint('after_selector');
  }
  if((await loadCatalog()).stamp!==verified.targetDigest)bad('HISTORY_AUTHORITY_CATALOG_STALE');
  if((await inspectFiles(verified.spec)).some(file=>file.state==='unknown'))bad('HISTORY_UPGRADE_FILE_DRIFT');
  record={...record,phase:'selected',activatedAt:record.activatedAt??new Date().toISOString()};await saveDeliveryRecord(snapshot.directory,record);
  await deliverFiles(verified.spec,verified.collector);
  await assertBootstrap(verified.spec);await verifyAfter(verified);
  if((await loadCatalog()).stamp!==verified.targetDigest)bad('HISTORY_AUTHORITY_CATALOG_STALE');
  await deliveryCheckpoint('before_runtime_ready');record={...record,phase:'await_runtime'};await saveDeliveryRecord(snapshot.directory,record);await deliveryCheckpoint('after_runtime_ready');
  return {status:'delivered_pending_runtime_verification',deliveryId:bundle.deliveryId,generation:bundle.catalog.generation};
 }));
}
export async function completeAuthorityUpgrade(bundle){
 const verified=await validateUpgradeBundle(bundle);
 return withStoreDeliveryLock(()=>lockRoots(bundle.catalog.entries.map(entry=>entry.intent.root),async()=>{
  const snapshot=await loadCatalog();if(snapshot.stamp!==verified.targetDigest)bad('HISTORY_AUTHORITY_CATALOG_STALE');
  const state=await readDeliveryState(snapshot.directory,bundle.deliveryId);assertMatchingRecord(state.record,verified);
  if(state.completed){await verifyAfter(verified,{quiescent:false});return {status:'already_applied',deliveryId:bundle.deliveryId,generation:bundle.catalog.generation};}
  if(!state.pointer||state.pointer.deliveryId!==bundle.deliveryId||state.pointer.bundleDigest!==verified.bundleDigest||state.record.phase!=='await_runtime')bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
  await assertBootstrap(verified.spec);await verifyAfter(verified);
  if(!state.receipt){
   const instances=await verifyRuntimeDelivery(verified.spec,{deliveryId:bundle.deliveryId,targetCatalogDigest:verified.targetDigest});
   await verifyAfter(verified);if((await loadCatalog()).stamp!==verified.targetDigest)bad('HISTORY_AUTHORITY_CATALOG_STALE');
   const receipt={version:1,contract:'history-delivery-completion-v1',deliveryId:bundle.deliveryId,bundleDigest:verified.bundleDigest,targetCatalogDigest:verified.targetDigest,specRef:bundle.deliverySpecRef,instances,completedAt:new Date().toISOString()};
   await deliveryCheckpoint('before_completion_receipt');
   await createStoreFile(snapshot.directory,deliveryReceiptPath(bundle.deliveryId),encode(receipt));
   await deliveryCheckpoint('after_completion_receipt');
  }
  await clearDeliveryPointer(snapshot.directory,state.record);await deliveryCheckpoint('after_pointer_clear');
  return {status:'completed',deliveryId:bundle.deliveryId,generation:bundle.catalog.generation};
 }));
}
