import {resolveConfigurationSaveTarget} from './project-context.mjs';
import {managedHistoryRequiredDeploymentFiles} from './historical-required-files.mjs';
import {verifyDeploymentPolicy,historySnapshot,validateReceiptEvidence} from './historical-proof.mjs';
// Managed entry non-replay owner. Business results and external writers are separate facts.
import path from 'node:path';
import crypto from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile,realpath,stat,readdir} from 'node:fs/promises';
import {withProjectProcessLock} from './project-process-lock.mjs';
import {readHistoryDeployment} from './historical-deployment.mjs';
import {readAuthoritySnapshot,assertAuthorityStamp,withAuthorityDeliveryLock,validateAuthorityLedger} from './deployment-authority-store.mjs';

const scope=new AsyncLocalStorage(),lockScope=new AsyncLocalStorage();
const ID=/^[A-Za-z0-9:_-]{1,160}$/;
const bad=code=>{throw Object.assign(new Error(code),{code,status:409});};
const valid=id=>typeof id==='string'&&ID.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
async function physical(file){try{return await realpath(file);}catch(e){if(e.code!=='ENOENT')throw e;return path.join(await physical(path.dirname(file)),path.basename(file));}}
const normalize=file=>process.platform==='win32'?file.replaceAll('\\','/').toLowerCase():file;
async function optional(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;bad('HISTORY_STATE_UNVERIFIABLE');}}
export async function historyBinding(context){
 const root=normalize(await physical(path.resolve(typeof context==='string'?context:context.projectRoot)));
 const runtime=normalize(await physical(path.resolve(root,context.runtimeDir??'.data-editor/runtime')));
 if(!runtime.startsWith(root+'/'))bad('HISTORY_BINDING_INVALID');
 const snapshot=await readAuthoritySnapshot(),entries=snapshot.entries,entry=entries.find(e=>e.projectRoot===root);
 if(!entry&&entries.some(e=>root.startsWith(e.projectRoot+'/')))bad('HISTORY_BINDING_INVALID');
 if(entry&&(entry.runtime!==runtime||context.historicalDispositionAnchorId&&context.historicalDispositionAnchorId!==entry.anchorId))bad('HISTORY_BINDING_INVALID');
 return {root,runtime,key:sha(root),authorityStamp:snapshot.stamp,authority:entry?.authority,deployed:!!entry,expectedAnchorId:entry?.anchorId,policy:entry?.managedNonReplay,registration:path.join(root,'.data-editor/historical-disposition-registration.json'),directory:path.join(runtime,'entry-action-dispositions')};
}
// Same short lock as publication; stale ALS inherited by completion is not a permit.
export async function withHistoryProjectLock(binding,operation){
 if(binding.authorityStamp===undefined)binding=await historyBinding({projectRoot:binding.root,runtimeDir:binding.runtime});
 const held=lockScope.getStore();
 if(held?.key===binding.key&&held.active){await assertAuthorityStamp(binding.authorityStamp);return operation();}
 const acquire=()=>withProjectProcessLock(`publication:${binding.key}`,async()=>{
  await assertAuthorityStamp(binding.authorityStamp);
  const token={key:binding.key,active:true};
  try{return await lockScope.run(token,operation);}finally{token.active=false;}
 });
 return binding.deployed?acquire():withAuthorityDeliveryLock(acquire);
}
async function readLedger(binding){
 const registration=await optional(binding.registration);
 const exists=await stat(binding.directory).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
 if(!registration){if(exists||binding.expectedAnchorId)bad('HISTORY_REGISTRATION_REQUIRED');return null;}
 if(!binding.deployed)bad('HISTORY_DEPLOYMENT_REQUIRED');
 if(binding.expectedAnchorId&&registration.anchorId!==binding.expectedAnchorId)bad('HISTORY_BINDING_INVALID');
 if(registration.schemaVersion!==1||registration.root!==binding.root||registration.runtime!==binding.runtime||!valid(registration.anchorId))bad('HISTORY_BINDING_INVALID');
 const [anchor,state]=await Promise.all(['anchor.json','state.json'].map(f=>optional(path.join(binding.directory,f))));
 if(!anchor||!state||anchor.anchorId!==registration.anchorId||state.anchorId!==registration.anchorId||anchor.root!==binding.root||anchor.runtime!==binding.runtime||state.schemaVersion!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!state.records||Array.isArray(state.records))bad('HISTORY_STATE_UNVERIFIABLE');
 for(const [id,record]of Object.entries(state.records)){
  if(!valid(id)||record.runId!==id||!['intent','receipt'].includes(record.phase)||!Array.isArray(record.relatedRunIds)||!record.relatedRunIds.includes(id)||!record.relatedRunIds.every(valid)||typeof record.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(record.evidenceDigest))bad('HISTORY_STATE_UNVERIFIABLE');
 }
 if(binding.authority)await validateAuthorityLedger(binding,state,await readFile(path.join(binding.directory,'state.json')));
 return state;
}
async function ancestors(binding,ids){
 const result=new Set(ids.filter(x=>x!==null&&x!==undefined));
 if([...result].some(id=>!valid(id)))bad('HISTORY_RUN_INVALID');
 const directory=path.join(binding.runtime,'entry-actions');
 const names=await readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
 const links=[];
 for(const name of names.filter(n=>n.endsWith('.followup.json'))){const intent=await optional(path.join(directory,name));if(intent)links.push({intent,parent:name.slice(0,-'.followup.json'.length)});}
 for(const start of [...result]){
  let id=start;const seen=new Set();
  while(id){
   if(seen.has(id))bad('HISTORY_RELATION_INVALID');seen.add(id);
   const handoff=await optional(path.join(binding.runtime,'entry-actions',`${id}.json`));
   if(handoff?.runId!==undefined&&handoff.runId!==id)bad('HISTORY_RELATION_INVALID');
   const first=handoff?.projectSkillLifecycle?.parentRunId,second=handoff?.parentRunId;
   if(first&&second&&first!==second)bad('HISTORY_RELATION_INVALID');
   const matching=links.filter(l=>l.intent.childRunId===id);
   if(matching.length>1)bad('HISTORY_RELATION_INVALID');
   const link=matching[0];
   const parent=first??second??link?.parent;
   if(link){
    if(parent!==link.parent||link.intent.parentRunId!==parent)bad('HISTORY_RELATION_INVALID');
    const original=await optional(path.join(directory,`${parent}.json`)),spec=original?.projectSkillLifecycle?.followup,entry=original?.entry;
    if(!spec||!entry||!handoff&&!ids.includes(parent))bad('HISTORY_RELATION_INVALID');
    if(handoff&&!first&&!second)bad('HISTORY_RELATION_INVALID');
    const key=sha(JSON.stringify([parent,spec.actionId,entry.sourcePath,entry.collectionPath,entry.rowId]));
    const hex=key.slice(0,12)+'4'+key.slice(13,16)+'8'+key.slice(17,32),child=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    if(id!==child||link.intent.key!==key||link.intent.actionId!==spec.actionId||link.intent.configDigest!==original.projectSkillLifecycle.configDigest||JSON.stringify(link.intent.target)!==JSON.stringify({sourcePath:entry.sourcePath,collectionPath:entry.collectionPath,rowId:entry.rowId}))bad('HISTORY_RELATION_INVALID');
   }else if(parent)bad('HISTORY_RELATION_INVALID');
   if(!parent)break;if(!valid(parent))bad('HISTORY_RELATION_INVALID');result.add(parent);id=parent;
  }
 }
 return result;
}
export async function assertHistoricalRunAllowed(context,ids=[],{fullInventory=false}={}){
 const binding=await historyBinding(context);
 return withHistoryProjectLock(binding,async()=>{
  const ledger=await readLedger(binding);if(!ledger)return;
  const requested=Array.isArray(ids)?ids:[ids];
  const records=Object.values(ledger.records),closedRuns=new Set(records.flatMap(r=>r.relatedRunIds));
  // A durable refusal needs no expensive receipt proof to remain a refusal.
  if(requested.some(id=>closedRuns.has(id)))bad('HISTORY_RUN_CLOSED');
  const runs=await ancestors(binding,requested);
  if(!runs.size&&records.length)bad('HISTORY_RUN_CONTEXT_REQUIRED');
  if([...runs].some(id=>closedRuns.has(id)))bad('HISTORY_RUN_CLOSED');
  const snapshot=fullInventory&&records.some(r=>r.phase==='receipt')?await historySnapshot(binding):null;
  for(const record of records.filter(r=>r.phase==='receipt'))await validateManagedReceipt(binding,record,{fullInventory,snapshot});
 });
}
function assertScopeActive(current){if(current&&current.active===false)bad(current.mode==='automation'?'HISTORY_RUN_SCOPE_EXPIRED':'HISTORY_AUTHOR_SCOPE_EXPIRED');}
export async function withHistoricalRun(context,ids,operation,{ownedCompletion=false}={}){
 const current=scope.getStore(),binding=await historyBinding(context);
 if(current&&current.active===false)bad('HISTORY_RUN_SCOPE_EXPIRED');
 if(current&&current.mode!=='automation')bad('HISTORY_AUTHOR_SCOPE_ESCALATION');
 const inherited=current?.binding.key===binding.key?(current.ids??[]):[];
 const all=[...new Set([...inherited,...ids.filter(Boolean)])];
 await assertHistoricalRunAllowed(context,all);
 assertScopeActive(current);
 const token={mode:'automation',active:true,binding,context,ids:all};
 let retained=false;
 try{
  const result=await scope.run(token,operation);
  if(ownedCompletion&&result?.completion?.then){
   const completion=Promise.resolve(result.completion).finally(()=>{token.active=false;});
   void completion.catch(()=>{});retained=true;return {...result,completion};
  }
  return result;
 }finally{if(!retained)token.active=false;}
}
export function currentHistoricalRunId(){const current=scope.getStore();return current?.mode==='automation'?current.ids.at(-1):null;}
export async function assertHistoricalRecoveredRun(context,runId){
 const binding=await historyBinding(context);if(binding.deployed&&!runId)bad('HISTORY_RUN_CONTEXT_REQUIRED');
 return assertHistoricalRunAllowed(context,[runId].filter(Boolean));
}
// Enclose only a synchronous spawn or bounded command dispatch, never completion.
export async function withHistoricalScopeEffect(operation,context=null){
 const current=scope.getStore(),binding=context?await historyBinding(context):current?.binding;
 if(current&&current.active===false)bad(current.mode==='automation'?'HISTORY_RUN_SCOPE_EXPIRED':'HISTORY_AUTHOR_SCOPE_EXPIRED');
 if(!current){
  if(context){await assertHistoricalRunAllowed(context,[]);if(binding.deployed)bad('HISTORY_RUN_CONTEXT_REQUIRED');}
  else return withAuthorityDeliveryLock(async()=>{await readAuthoritySnapshot();return operation();});
  return withHistoryProjectLock(binding,()=>operation());
 }
 if(binding&&binding.key!==current.binding.key)bad('HISTORY_BINDING_INVALID');
 if(current.mode!=='automation')bad('HISTORY_AUTHOR_SCOPE_ESCALATION');
 return withHistoryProjectLock(current.binding,async()=>{assertScopeActive(current);await assertHistoricalRunAllowed(current.context,current.ids);assertScopeActive(current);return operation();});
}
export async function cleanupHistoricalRun(operation){
 try{return await withHistoricalScopeEffect(operation);}catch(error){if(String(error.code).startsWith('HISTORY_'))return {retained:true,reason:error.code};throw error;}
}
export async function withHistoricalLaunch(cwd,operation){
 if(!cwd)return withHistoricalScopeEffect(operation);
 return withHistoricalFileEffect(path.join(cwd,'_historical-launch'),null,()=>withHistoricalScopeEffect(operation));
}
export async function withHistoricalAuthorSave(context,{sourceFile,journalFile},operation){
 if(scope.getStore())bad('HISTORY_AUTHOR_SCOPE_ESCALATION');
 const binding=await historyBinding(context),source=normalize(await physical(path.resolve(sourceFile))),journal=normalize(await physical(path.resolve(journalFile)));
 if(!source.startsWith(binding.root+'/')||source.startsWith(binding.runtime+'/')||source.startsWith(binding.root+'/.data-editor/')||!['.json','.csv'].includes(path.extname(source))||path.dirname(journal).replaceAll('\\','/')!==binding.runtime+'/commit-journal'||!/^[A-Za-z0-9_-]+\.json$/.test(path.basename(journal)))bad('HISTORY_AUTHOR_WRITESET_INVALID');
 await withHistoryProjectLock(binding,()=>readLedger(binding));
 const token={mode:'author',active:true,binding,context,ids:[],files:[source,journal]};
 try{return await scope.run(token,operation);}finally{token.active=false;}
}
// Precise ordinary configuration ownership; no automation run is synthesized.
export async function withHistoricalConfigurationSave(input,descriptor,operation){
 if(scope.getStore())bad('HISTORY_AUTHOR_SCOPE_ESCALATION');
 const {context,target:declared}=resolveConfigurationSaveTarget(input,descriptor);
 const binding=await historyBinding(context),target=normalize(await physical(declared));
 if(target!==normalize(path.resolve(declared)))bad('HISTORY_CONFIGURATION_ALIAS_REJECTED');
 const snapshot=await readAuthoritySnapshot(),authorityDirectory=normalize(await physical(snapshot.directory));
 const inside=(file,root)=>file===root||file.startsWith(root+'/');
 const forbidden=[binding.runtime,authorityDirectory,binding.root+'/.data-editor/publication-admission',binding.root+'/.data-editor/entry-action-contracts.json',binding.root+'/.data-editor/historical-disposition-registration.json'];
 for(const source of context.dataSources){
  const sourceRoot=normalize(await physical(source.kind==='absolute'?path.resolve(source.path):path.resolve(context.projectRoot,source.path)));
  // A root data source also contains reserved configuration metadata. Only the
  // precise category target is granted; runtime/ledger checks remain above.
  if(sourceRoot===binding.root&&target.startsWith(binding.root+'/.data-editor/'))continue;
  forbidden.push(sourceRoot);
 }
 for(const relative of binding.policy?.businessFiles??[])forbidden.push(normalize(await physical(path.resolve(binding.root,relative))));
 if(forbidden.some(root=>inside(target,root)))bad('HISTORY_CONFIGURATION_WRITESET_INVALID');
 const discovered=await bindingForPath(declared);
 if(discovered&&discovered.key!==binding.key)bad('HISTORY_BINDING_INVALID');
 // This admission lock is released before the existing configuration lock is acquired.
 await withHistoryProjectLock(binding,()=>readLedger(binding));
 const token={mode:'configuration',active:true,binding,context,ids:[],files:[target]};
 try{return await scope.run(token,()=>operation(declared));}finally{token.active=false;}
}
// Publication owner can write only its two metadata files, never business or run state.
export async function withHistoricalPublicationState(context,operation){
 if(scope.getStore())return operation();
 const binding=await historyBinding(context);
 await readLedger(binding);
 const directory=binding.root+'/.data-editor/publication-admission';
 const token={mode:'publication',active:true,binding,context,ids:[],files:[directory+'/anchor.json',directory+'/state.json']};
 try{return await scope.run(token,operation);}finally{token.active=false;}
}
export async function withHistoricalFileRun(file,ids,operation){
 if(!file)return operation(); // Pure callback primitives have no physical project binding.
 const binding=await bindingForPath(file);if(!binding)return withAuthorityDeliveryLock(async()=>{const discovered=await bindingForPath(file);if(discovered)return withHistoricalRun({projectRoot:discovered.root,runtimeDir:discovered.runtime},ids,operation);await readAuthoritySnapshot();return operation();});
 return withHistoricalRun({projectRoot:binding.root,runtimeDir:binding.runtime},ids,operation);
}
async function bindingForPath(file){
 const target=normalize(await physical(path.resolve(file)));
 const deployed=(await readHistoryDeployment()).find(e=>target===e.projectRoot||target.startsWith(e.projectRoot+'/'));
 if(deployed)return historyBinding({projectRoot:deployed.projectRoot,runtimeDir:deployed.runtime});
 let directory=path.dirname(target);
 while(true){
  const registration=await optional(path.join(directory,'.data-editor/historical-disposition-registration.json'));
  if(registration)return historyBinding({projectRoot:directory,runtimeDir:registration.runtime});
  if(await stat(path.join(directory,'.data-editor/runtime/entry-action-dispositions')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))bad('HISTORY_REGISTRATION_REQUIRED');
  const parent=path.dirname(directory);if(parent===directory)return null;directory=parent;
 }
}
function runReferences(value,ids=[],groups=[]){
 if(!value||typeof value!=='object')return {ids,groups};
 for(const [key,item]of Object.entries(value)){
  if(['runId','parentRunId','childRunId'].includes(key)&&typeof item==='string')ids.push(item);
  if(key==='runIds'&&Array.isArray(item))ids.push(...item);
  if(key==='groupId'&&typeof item==='string')groups.push(item);
  runReferences(item,ids,groups);
 }
 return {ids,groups};
}
export async function withHistoricalFileEffect(file,payload,operation){
 const current=scope.getStore(),discovered=await bindingForPath(file),target=normalize(await physical(path.resolve(file)));
 if(current&&current.active===false)bad(current.mode==='automation'?'HISTORY_RUN_SCOPE_EXPIRED':'HISTORY_AUTHOR_SCOPE_EXPIRED');
 // A historical scope authorizes its physical project only. Tool caches outside every
 // registered project keep their own owner; another registered project never inherits it.
 if(current&&discovered&&current.binding.key!==discovered.key)bad('HISTORY_BINDING_INVALID');
 // Check even external profile effects before the generic external-cache fast path.
 if(current?.mode==='configuration')return withHistoryProjectLock(current.binding,async()=>{
  assertScopeActive(current);
  if(!current.files.includes(target)||target!==normalize(path.resolve(file)))bad('HISTORY_CONFIGURATION_WRITESET_INVALID');
  await readLedger(current.binding);assertScopeActive(current);return operation();
 });
 if(current&&!discovered&&target!==current.binding.root&&!target.startsWith(current.binding.root+'/'))return withHistoryProjectLock(current.binding,async()=>{await readLedger(current.binding);assertScopeActive(current);return operation();});
 const binding=current?.binding??discovered;
 if(!binding)return withAuthorityDeliveryLock(async()=>{const discovered=await bindingForPath(file);if(discovered)return withHistoricalFileEffect(file,payload,operation);await readAuthoritySnapshot();return operation();});
 return withHistoryProjectLock(binding,async()=>{
  assertScopeActive(current);
  if(['author','publication'].includes(current?.mode)&&!current.active)bad('HISTORY_AUTHOR_SCOPE_EXPIRED');
  const ledger=await readLedger(binding);if(!ledger){assertScopeActive(current);return operation();}
  let value=payload;
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{value=null;}}
  const refs=runReferences(value),ids=[...(current?.ids??[]),...refs.ids].filter(Boolean),groups=refs.groups;
  const context=current?.context??{projectRoot:binding.root,runtimeDir:binding.runtime};
  const protectedRuntime=target.startsWith(binding.runtime+'/');
  if(['author','publication'].includes(current?.mode)){
   if(!current.active)bad('HISTORY_AUTHOR_SCOPE_EXPIRED');
   if(!current.files.includes(target))bad('HISTORY_AUTHOR_WRITESET_INVALID');
   return operation();
  }
  if(protectedRuntime){
   // A caller must not relabel an existing pending/result file with a new run.
   const runStorage=['entry-actions','pending-entry-actions','entry-action-commit-journal','entry-action-group-journal','entry-action-fencing'].some(dir=>target.startsWith(binding.runtime+'/'+dir+'/'));
   if(runStorage&&target.endsWith('.json')){const existing=await optional(file);const prior=runReferences(existing);ids.push(...prior.ids);groups.push(...prior.groups);}
   if(target.startsWith(binding.runtime+'/entry-actions/')){
    const id=path.basename(target).split('.')[0];if(valid(id))ids.push(id);
   }
  }
  if(Object.values(ledger.records).some(r=>r.evidence?.snapshot?.groupIds?.some(id=>groups.includes(id))))bad('HISTORY_RUN_CLOSED');
  await assertHistoricalRunAllowed(context,ids);
  if(!current)bad('HISTORY_RUN_CONTEXT_REQUIRED');
  assertScopeActive(current);
  return operation();
 });
}
// The delivery configuration fixes the guarantee. This is not a request-selected trust mode.
export const managedHistoryContract='managed-entry-non-replay-v1';
export {managedHistoryRequiredDeploymentFiles} from './historical-required-files.mjs';
const stable=value=>JSON.stringify(value);
async function managedPolicy(binding){
 return verifyDeploymentPolicy(binding.policy);
}
async function validateManagedReceipt(binding,record,{baseline=false,fullInventory=false,snapshot=null}={}){
 if(record.contract!==managedHistoryContract||!record.evidence||record.evidenceDigest!==sha(stable(record.evidence)))bad('HISTORY_PROOF_UNSUPPORTED');
 const evidence=record.evidence,{policy,digest:deploymentDigest}=await managedPolicy(binding);
 if(evidence.deploymentDigest!==deploymentDigest&&binding.authority?.proof.originDigest!==evidence.deploymentDigest)bad('HISTORY_BINDING_INVALID');
 return validateReceiptEvidence(binding,record,{baseline,fullInventory,snapshot,policy});
}
// Request-local scan reuse is valid only inside the caller's same project lock.
async function scanReceipt(binding,record,validation){
 const key=sha(stable(record));
 if(validation?.receipts.has(key)){
  const value=validation.receipts.get(key);if(value.error)throw value.error;return value.evidence;
 }
 try{
  const snapshot=validation?(validation.snapshot??=await historySnapshot(binding)):null;
  const evidence=await validateManagedReceipt(binding,record,{fullInventory:true,snapshot});
  validation?.receipts.set(key,{evidence});return evidence;
 }catch(error){validation?.receipts.set(key,{error});throw error;}
}
// An unknown business outcome is preserved separately from eligibility to execute/recover.
export async function projectHistoricalRunActivity(context,runs){
 const binding=await historyBinding(context);
 return withHistoryProjectLock(binding,async()=>{
  const ledger=await readLedger(binding),closed=new Set();
  for(const record of Object.values(ledger?.records??{}))if(record.phase==='receipt'&&record.contract===managedHistoryContract){
   try{await validateManagedReceipt(binding,record);for(const id of record.relatedRunIds)closed.add(id);}catch{}
  }
  const active=[],historicalRuns=[];
  for(const run of runs){
   if(closed.has(run.runId))historicalRuns.push({...run,historicalDisposition:{guarantee:managedHistoryContract,blocking:false,businessOutcome:'unchanged'}});
   else active.push(run);
  }
  return {runs:active,historicalRuns};
 });
}
export async function historicalObligations(binding,validation=null){
 binding=await historyBinding({projectRoot:binding.root,runtimeDir:binding.runtime});
 return withHistoryProjectLock(binding,async()=>{
  const ledger=await readLedger(binding);if(!ledger)return [];
  const output=[];
  for(const record of Object.values(ledger.records)){
   let reason=record.phase==='intent'?'intent_pending':'proof_unsupported',blocking=true;
   if(record.phase==='receipt'&&record.contract===managedHistoryContract){
    try{await scanReceipt(binding,record,validation);blocking=false;reason='managed_entry_non_replay';}catch(e){reason=e.code??'HISTORY_STATE_UNVERIFIABLE';}
   }
   output.push({kind:'historical_disposition',runId:record.runId,relatedRunIds:record.relatedRunIds,blocking,reason,guarantee:record.contract??null,businessOutcome:'unchanged'});
  }
  return output;
 });
}
export async function projectHistoricalObligations(binding,obligations,validation=null){
 binding=await historyBinding({projectRoot:binding.root,runtimeDir:binding.runtime});
 return withHistoryProjectLock(binding,async()=>{
  const ledger=await readLedger(binding);if(!ledger)return obligations;
  const covered=[];
  for(const record of Object.values(ledger.records))if(record.phase==='receipt'&&record.contract===managedHistoryContract){
   try{covered.push(...(await scanReceipt(binding,record,validation)).obligations);}catch{}
  }
  const coveredKeys=new Set(covered.map(stable));
  return obligations.map(item=>coveredKeys.has(stable(item))?{...item,blocking:false,guarantee:managedHistoryContract,businessOutcome:'unchanged'}:{...item,blocking:true});
 });
}

