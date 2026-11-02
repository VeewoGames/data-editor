import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {assertPolicy,assertCatalog,assertManifest,assertIntent,assertEnvelope,assertRef,decode,encode,digest,normalize,hash,exact,canonical,authorityError as bad} from './deployment-authority-schema.mjs';
import {validateSuccessorLedger} from './historical-deployment-successor.mjs';
import {verifyDeploymentPolicy,validateReceiptEvidence,historySnapshot,businessSnapshot} from './historical-proof.mjs';
import {legacyHistoryRequiredDeploymentFiles,requiredFilesForProtocol,priorProtocol3Qualification} from './historical-required-files.mjs';
const stable=v=>JSON.stringify(v);

// This cache belongs to one fresh snapshot only. It is never an effect permit.
export function createAuthorityReader(readObject,{qualification='current'}={}){
 if(!['current','upgrade-prior'].includes(qualification))bad('HISTORY_AUTHORITY_QUALIFICATION_INVALID');
 const objects=new Map(),nodes=new Map(),visiting=new Set();let bytesRead=0;
 async function object(ref){
  assertRef(ref);if(objects.has(ref.digest))return objects.get(ref.digest);
  if(objects.size>=100000)bad('HISTORY_AUTHORITY_BUDGET_EXCEEDED');
  const bytes=await readObject(ref);bytesRead+=bytes.length;
  if(bytesRead>1024*1024*1024)bad('HISTORY_AUTHORITY_BUDGET_EXCEEDED');
  if(digest(bytes)!==ref.digest)bad('HISTORY_AUTHORITY_DIGEST_MISMATCH');
  objects.set(ref.digest,bytes);return bytes;
 }
 async function select(entry,depth=0,role=qualification){
  assertIntent(entry.intent);if(depth>256)bad('HISTORY_AUTHORITY_BUDGET_EXCEEDED');
  const key=digest(encode(entry))+':'+role;if(visiting.has(key))bad('HISTORY_AUTHORITY_CHAIN_INVALID');if(nodes.has(key))return nodes.get(key);
  visiting.add(key);
  try{
   const intent=entry.intent,envelope=decode(await object(entry.envelopeRef));assertEnvelope(envelope,intent);
   const manifest=decode(await object(intent.packageRef));assertManifest(manifest);
   const upgrade=envelope.contract==='history-authority-upgrade-v2';
   if(upgrade!==(manifest.contract==='history-upgrade-proof-package-v2')||canonical(intent.policyRef)!==canonical(manifest.targetPolicyRef))bad('HISTORY_AUTHORITY_BINDING_INVALID');
   const index=new Map(manifest.files.map(file=>[file.path,file])),closure=new Set([entry.envelopeRef.digest,intent.packageRef.digest]);
   const read=async ref=>{assertRef(ref);const pin=index.get(ref.path);if(!pin||pin.digest!==ref.digest)bad('HISTORY_AUTHORITY_PACKAGE_INVALID');const bytes=await object(ref);if(bytes.length!==pin.size)bad('HISTORY_AUTHORITY_PACKAGE_INVALID');closure.add(ref.digest);return bytes;};
   const policy=decode(await read(intent.policyRef));assertPolicy(policy);
   let requiredFiles=requiredFilesForProtocol(intent.minReaderProtocol);
   if(intent.minReaderProtocol===3&&role!=='current'){
    const modulePin=policy.deploymentFiles.find(pin=>pin.path==='src/historical-required-files.mjs');
    if(modulePin?.digest===priorProtocol3Qualification.moduleDigest){
     // Authenticate the archived definition through this package's index,
     // digest and size checks. Never execute an installed older module.
     await read({path:`objects/${modulePin.digest}.blob`,digest:modulePin.digest});
     requiredFiles=priorProtocol3Qualification.requiredFiles;
    }else if(requiredFiles.some(file=>!policy.deploymentFiles.some(pin=>pin.path===file)))bad('HISTORY_AUTHORITY_RELEASE_UNSUPPORTED');
   }
   if(requiredFiles.some(file=>!policy.deploymentFiles.some(pin=>pin.path===file)))bad('HISTORY_DEPLOYMENT_INCOMPLETE');
   let proof;
   if(!upgrade){
    if(manifest.sourceConfigRef.digest!==envelope.sourceExpectedDigest)bad('HISTORY_AUTHORITY_BINDING_INVALID');
    proof=await verifySourceProof({manifest,read},intent);
   }else{
    if(manifest.priorCatalogRef.digest!==envelope.priorCatalogDigest||manifest.priorEntryDigest!==envelope.priorEntryDigest||canonical(manifest.deliverySpecRef)!==canonical(envelope.deliverySpecRef))bad('HISTORY_AUTHORITY_CHAIN_INVALID');
    const priorCatalog=decode(await read(manifest.priorCatalogRef));assertCatalog(priorCatalog);
    if(priorCatalog.generation+1!==intent.generation)bad('HISTORY_AUTHORITY_CHAIN_INVALID');
    const priorEntry=priorCatalog.entries.find(item=>item.intent.root===intent.root);
    if(!priorEntry||digest(encode(priorEntry))!==manifest.priorEntryDigest||priorEntry.intent.generation>=intent.generation)bad('HISTORY_AUTHORITY_CHAIN_INVALID');
    const prior=await select(priorEntry,depth+1,'historical');
    for(const id of prior.authority.closure)await read({path:`objects/${id}.blob`,digest:id});
    if(prior.runtime!==intent.runtime||prior.anchorId!==intent.anchorId||canonical(prior.managedNonReplay.businessFiles)!==canonical(policy.businessFiles)||!Buffer.from(await read(manifest.ledgerRef)).equals(prior.authority.proof.ledgerBytes))bad('HISTORY_AUTHORITY_PROTECTION_REMOVAL');
    if(manifest.priorPolicyObjects.length!==prior.managedNonReplay.deploymentFiles.length)bad('HISTORY_AUTHORITY_CHAIN_INVALID');
    for(const pin of prior.managedNonReplay.deploymentFiles){
     const saved=manifest.priorPolicyObjects.find(item=>item.path===pin.path);
     if(!saved||saved.digest!==pin.digest||!policy.deploymentFiles.some(item=>item.path===pin.path))bad('HISTORY_AUTHORITY_PROTECTION_REMOVAL');
     if((await read({path:`objects/${pin.digest}.blob`,digest:pin.digest})).length!==saved.size)bad('HISTORY_AUTHORITY_CHAIN_INVALID');
    }
    const spec=decode(await read(manifest.deliverySpecRef));
    if(spec.contract!=='history-deployment-delivery-v1'||spec.priorCatalogDigest!==manifest.priorCatalogRef.digest)bad('HISTORY_AUTHORITY_CHAIN_INVALID');
    proof=prior.authority.proof;
   }
   if(canonical(policy.businessFiles)!==canonical(proof.sourceBinding.policy.businessFiles))bad('HISTORY_AUTHORITY_BINDING_INVALID');
   const result={projectRoot:intent.root,runtime:intent.runtime,anchorId:intent.anchorId,managedNonReplay:policy,authority:{intent,envelope,manifest,proof,entry,requiredFiles,closure:[...closure]}};
   nodes.set(key,result);return result;
  }finally{visiting.delete(key);}
 }
 return {select:entry=>select(entry,0,qualification),objects,stats:()=>({objects:objects.size,bytesRead,nodes:nodes.size})};
}
export function validateSourceConfiguration(source){
 if(!exact(source,'version,entries')||source.version!==1||!Array.isArray(source.entries))bad('HISTORY_SOURCE_PROOF_INVALID');
 const roots=[];
 for(const e of source.entries){
  if(!e||!['anchorId,projectRoot,runtime','anchorId,managedNonReplay,projectRoot,runtime','anchorId,deploymentSuccessor,managedNonReplay,projectRoot,runtime'].includes(Object.keys(e).sort().join(','))||typeof e.projectRoot!=='string'||!path.isAbsolute(e.projectRoot)||normalize(e.projectRoot)!==e.projectRoot||typeof e.runtime!=='string'||normalize(e.runtime)!==e.runtime||!e.runtime.startsWith(e.projectRoot+'/')||typeof e.anchorId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(e.anchorId)||roots.some(r=>r===e.projectRoot||r.startsWith(e.projectRoot+'/')||e.projectRoot.startsWith(r+'/')))bad('HISTORY_SOURCE_PROOF_INVALID');
  roots.push(e.projectRoot);if(e.managedNonReplay)assertPolicy(e.managedNonReplay);
  if(e.deploymentSuccessor&&(!exact(e.deploymentSuccessor,'path,digest')||!hash(e.deploymentSuccessor.digest)||e.deploymentSuccessor.path!==`historical-deployment-upgrades/${e.deploymentSuccessor.digest}.certificate.json`))bad('HISTORY_SUCCESSOR_INVALID');
 }
 return source;
}
export async function verifySourceProof({manifest,read},intent){
 let source,ledger;const sourceBytes=await read(manifest.sourceConfigRef),ledgerBytes=await read(manifest.ledgerRef);
 try{source=JSON.parse(sourceBytes);ledger=JSON.parse(ledgerBytes);}catch{bad('HISTORY_SOURCE_PROOF_INVALID');}
 validateSourceConfiguration(source);
 const entries=source.entries.filter(e=>e.projectRoot===intent.root),entry=entries[0];
 if(entries.length!==1||entry.runtime!==intent.runtime||entry.anchorId!==intent.anchorId)bad('HISTORY_BINDING_INVALID');
 assertPolicy(entry.managedNonReplay);
 if(legacyHistoryRequiredDeploymentFiles.some(p=>!entry.managedNonReplay.deploymentFiles.some(f=>f.path===p)))bad('HISTORY_DEPLOYMENT_INCOMPLETE');
 for(const pin of entry.managedNonReplay.deploymentFiles)await read({path:`objects/${pin.digest}.blob`,digest:pin.digest});
 const binding={root:entry.projectRoot,runtime:entry.runtime,expectedAnchorId:entry.anchorId,policy:entry.managedNonReplay,deploymentSuccessor:entry.deploymentSuccessor};
 let certificate=null,originDigest=digest(stable(entry.managedNonReplay));
 if(entry.deploymentSuccessor){
  if(!manifest.sourceCertificateRef||entry.deploymentSuccessor.digest!==manifest.sourceCertificateRef.digest)bad('HISTORY_SUCCESSOR_INVALID');
  certificate=JSON.parse(await read(manifest.sourceCertificateRef));
  if(!manifest.sourceSnapshotRef||certificate.sourceSnapshot.digest!==manifest.sourceSnapshotRef.digest)bad('HISTORY_SUCCESSOR_INVALID');
  certificate=await validateSuccessorLedger(binding,ledger,ledgerBytes,async(ref,kind)=>{
   const r=kind==='certificate'?manifest.sourceCertificateRef:manifest.sourceSnapshotRef;if(ref.digest!==r.digest)bad('HISTORY_SUCCESSOR_INVALID');return read(r);
  });originDigest=certificate.sourcePolicyDigest;
 }else if(manifest.sourceCertificateRef!==null||manifest.sourceSnapshotRef!==null)bad('HISTORY_SUCCESSOR_INVALID');
 if(ledger?.schemaVersion!==1||ledger.anchorId!==entry.anchorId||!Number.isSafeInteger(ledger.revision)||ledger.revision<0||!ledger.records||Array.isArray(ledger.records)||!Object.keys(ledger.records).length)bad('HISTORY_STATE_UNVERIFIABLE');
 for(const [id,r] of Object.entries(ledger.records)){
  const e=r.evidence;
  if(r.runId!==id||r.phase!=='receipt'||r.contract!=='managed-entry-non-replay-v1'||!e||r.evidenceDigest!==digest(stable(e))||e.deploymentDigest!==originDigest||e.root!==intent.root||e.runtime!==intent.runtime||e.anchorId!==intent.anchorId||!Array.isArray(r.relatedRunIds)||!r.relatedRunIds.includes(id)||stable(r.relatedRunIds)!==stable(e.snapshot?.runIds)||!Array.isArray(e.snapshot?.files)||!Array.isArray(e.obligations))bad('HISTORY_PROOF_UNSUPPORTED');
  for(const f of e.snapshot.files){if(typeof f.file!=='string'||normalize(f.file)!==f.file||!f.file.startsWith(intent.runtime+'/'))bad('HISTORY_BINDING_INVALID');await read({path:`objects/${f.digest}.blob`,digest:f.digest});}
 }
 return {sourceBytes,sourceEntry:entry,sourceBinding:binding,originDigest,ledger,ledgerBytes,certificate};
}
export async function verifyLiveProof(proof,{fullInventory=true,baseline=false,verifySourceCodeAt=null}={}){
 const b=proof.sourceBinding;
 const physicalRoot=normalize(await realpath(b.root)),physicalRuntime=normalize(await realpath(b.runtime));if(physicalRoot!==b.root||physicalRuntime!==b.runtime)bad('HISTORY_BINDING_INVALID');
 let registration,anchor,bytes;
 for(const f of [path.join(b.root,'.data-editor/historical-disposition-registration.json'),path.join(b.runtime,'entry-action-dispositions/anchor.json'),path.join(b.runtime,'entry-action-dispositions/state.json')]){
  let actual;try{actual=normalize(await realpath(f));}catch{bad('HISTORY_REGISTRATION_REQUIRED');}
  if(actual!==normalize(f))bad('HISTORY_BINDING_INVALID');
 }
 try{registration=JSON.parse(await readFile(path.join(b.root,'.data-editor/historical-disposition-registration.json')));anchor=JSON.parse(await readFile(path.join(b.runtime,'entry-action-dispositions/anchor.json')));bytes=await readFile(path.join(b.runtime,'entry-action-dispositions/state.json'));}catch{bad('HISTORY_REGISTRATION_REQUIRED');}
 if(registration.schemaVersion!==1||anchor.schemaVersion!==1||registration.root!==b.root||registration.runtime!==b.runtime||anchor.root!==b.root||anchor.runtime!==b.runtime||registration.anchorId!==b.expectedAnchorId||anchor.anchorId!==b.expectedAnchorId)bad('HISTORY_BINDING_INVALID');
 if(!bytes.equals(proof.ledgerBytes))bad('HISTORY_SUCCESSOR_INVALID');
 if(verifySourceCodeAt)await verifyDeploymentPolicy(b.policy,{toolRoot:verifySourceCodeAt,required:legacyHistoryRequiredDeploymentFiles});
 const snapshot=fullInventory?await historySnapshot(b):null;
 for(const r of Object.values(proof.ledger.records))await validateReceiptEvidence(b,r,{baseline,fullInventory,snapshot,policy:b.policy});
 return b;
}
export async function verifyQuiescentProof(proof,{businessBaseline=null,sourceTool=null}={}){
 const b=await verifyLiveProof(proof,{fullInventory:true,verifySourceCodeAt:sourceTool});
 const {publicationBinding,readPublicationState}=await import('./publication-window-state.mjs');
 const state=await readPublicationState(await publicationBinding({projectRoot:b.root,runtimeDir:path.relative(b.root,b.runtime)}));
 const map=value=>value!==null&&Object.getPrototypeOf(value)===Object.prototype;
 if(!state||state.state!=='OPEN'||state.windowId!==null||!map(state.continuations)||!map(state.accepted)||Object.keys(state.continuations).length||Object.values(state.accepted).some(x=>!map(x)||x.settled!==true))bad('HISTORY_UPGRADE_NOT_QUIESCENT');
 const {inventoryPublicationObligations}=await import('./publication-window-obligations.mjs');
 const covered=new Set(Object.values(proof.ledger.records).flatMap(r=>r.evidence.obligations.map(stable)));
 if((await inventoryPublicationObligations(b)).some(o=>!covered.has(stable(o))))bad('HISTORY_UPGRADE_NEW_OBLIGATIONS');
 const current=await businessSnapshot(b,b.policy);if(businessBaseline&&canonical(current)!==canonical(businessBaseline))bad('HISTORY_BUSINESS_BASELINE_DRIFT');return current;
}
