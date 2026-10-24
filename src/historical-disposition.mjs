// Managed entry non-replay owner. Business results and external writers are separate facts.
import path from 'node:path';
import crypto from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile,realpath,stat,mkdir,writeFile,readdir,rm,rename,open} from 'node:fs/promises';
import {withProjectProcessLock} from './project-process-lock.mjs';
import {readHistoryDeployment,historyDeploymentFile} from './historical-deployment.mjs';
import {validateSuccessorLedger,sourceEntryFor,artifactReference,successorContract} from './historical-deployment-successor.mjs';

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
 const entries=await readHistoryDeployment(),entry=entries.find(e=>e.projectRoot===root);
 if(!entry&&entries.some(e=>root.startsWith(e.projectRoot+'/')))bad('HISTORY_BINDING_INVALID');
 if(entry&&(entry.runtime!==runtime||context.historicalDispositionAnchorId&&context.historicalDispositionAnchorId!==entry.anchorId))bad('HISTORY_BINDING_INVALID');
 return {root,runtime,key:sha(root),deployed:!!entry,expectedAnchorId:entry?.anchorId,policy:entry?.managedNonReplay,deploymentSuccessor:entry?.deploymentSuccessor,registration:path.join(root,'.data-editor/historical-disposition-registration.json'),directory:path.join(runtime,'entry-action-dispositions')};
}
// Same short lock as publication; stale ALS inherited by completion is not a permit.
export async function withHistoryProjectLock(binding,operation){
 const held=lockScope.getStore();
 if(held?.key===binding.key&&held.active)return operation();
 return withProjectProcessLock(`publication:${binding.key}`,async()=>{
  const token={key:binding.key,active:true};
  try{return await lockScope.run(token,operation);}finally{token.active=false;}
 });
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
 if(binding.deploymentSuccessor)await validateSuccessorLedger(binding,state,await readFile(path.join(binding.directory,'state.json')));
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
export async function withHistoricalRun(context,ids,operation){
 const current=scope.getStore(),binding=await historyBinding(context);
 const inherited=current?.binding.key===binding.key?(current.ids??[]):[];
 const all=[...new Set([...inherited,...ids.filter(Boolean)])];
 await assertHistoricalRunAllowed(context,all);
 return scope.run({mode:'automation',binding,context,ids:all},operation);
}
export function currentHistoricalRunId(){const current=scope.getStore();return current?.mode==='automation'?current.ids.at(-1):null;}
export async function assertHistoricalRecoveredRun(context,runId){
 const binding=await historyBinding(context);if(binding.deployed&&!runId)bad('HISTORY_RUN_CONTEXT_REQUIRED');
 return assertHistoricalRunAllowed(context,[runId].filter(Boolean));
}
// Enclose only a synchronous spawn or bounded command dispatch, never completion.
export async function withHistoricalScopeEffect(operation,context=null){
 const current=scope.getStore(),binding=context?await historyBinding(context):current?.binding;
 if(!current){
  if(context){await assertHistoricalRunAllowed(context,[]);if(binding.deployed)bad('HISTORY_RUN_CONTEXT_REQUIRED');}
  else await readHistoryDeployment();
  return operation();
 }
 if(binding&&binding.key!==current.binding.key)bad('HISTORY_BINDING_INVALID');
 if(current.mode!=='automation')bad('HISTORY_AUTHOR_SCOPE_ESCALATION');
 return withHistoryProjectLock(current.binding,async()=>{await assertHistoricalRunAllowed(current.context,current.ids);return operation();});
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
 const binding=await bindingForPath(file);if(!binding)return operation();
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
 // A historical scope authorizes its physical project only. Tool caches outside every
 // registered project keep their own owner; another registered project never inherits it.
 if(current&&discovered&&current.binding.key!==discovered.key)bad('HISTORY_BINDING_INVALID');
 if(current&&!discovered&&target!==current.binding.root&&!target.startsWith(current.binding.root+'/'))return operation();
 const binding=current?.binding??discovered;
 if(!binding)return operation();
 return withHistoryProjectLock(binding,async()=>{
  if(['author','publication'].includes(current?.mode)&&!current.active)bad('HISTORY_AUTHOR_SCOPE_EXPIRED');
  const ledger=await readLedger(binding);if(!ledger)return operation();
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
  return operation();
 });
}
// The delivery configuration fixes the guarantee. This is not a request-selected trust mode.
export const managedHistoryContract='managed-entry-non-replay-v1';
export const managedHistoryRequiredDeploymentFiles=Object.freeze([
 'src/historical-deployment-successor.mjs','scripts/historical-deployment-upgrade.mjs',
 'src/historical-disposition.mjs','src/historical-deployment.mjs','src/atomic-file.mjs','src/field-write-policy.mjs','server.mjs',
 'src/automation-profile.mjs','src/automation-bindings.mjs','src/durable-identity-coordinator.mjs',
 'src/entry-action-exact-artifact-store.mjs','src/entry-action-group-commit.mjs',
 'src/entry-action-policy-migration.mjs','src/entry-action-proposal-commit.mjs',
 'src/entry-action-recovery.mjs','src/entry-actions.mjs','src/fencing-lock.mjs',
 'src/job-supervisor.mjs','src/project-command-recovery.mjs','src/project-command-runner.mjs','src/project-skill-action-service.mjs',
 'src/project-skill-followup.mjs','src/project-skill-run-guard.mjs',
 'src/publication-window-obligations.mjs','src/publication-window-runtime.mjs','src/publication-window-state.mjs'
]);
const stable=value=>JSON.stringify(value);
async function managedPolicy(binding){
 return verifyDeploymentPolicy(binding.policy);
}
async function verifyDeploymentPolicy(policy){
 if(!policy||policy.contract!==managedHistoryContract)bad('HISTORY_MANAGED_POLICY_REQUIRED');
 if(managedHistoryRequiredDeploymentFiles.some(file=>!policy.deploymentFiles.some(x=>x.path===file)))bad('HISTORY_DEPLOYMENT_INCOMPLETE');
 const tool=normalize(await physical(path.resolve(import.meta.dirname,'..')));
 for(const file of policy.deploymentFiles){
  const resolved=normalize(await physical(path.join(tool,file.path)));
  if(!resolved.startsWith(tool+'/')||sha(await readFile(resolved))!==file.digest)bad('HISTORY_DEPLOYMENT_DRIFT');
 }
 return {policy,digest:sha(stable(policy))};
}
async function businessSnapshot(binding,policy){
 const files=[];
 for(const relative of [...policy.businessFiles].sort()){
  const file=normalize(await physical(path.join(binding.root,relative)));
  if(!file.startsWith(binding.root+'/')||file.startsWith(binding.root+'/.data-editor/'))bad('HISTORY_BUSINESS_BASELINE_INVALID');
  files.push({file,digest:sha(await readFile(file))});
 }
 return files;
}
const historyDirectories=['entry-actions','entry-action-commit-journal','entry-action-group-journal','identity-promotion-journal','pending-entry-actions','entry-action-fencing'];
// Inventory the whole denominator; preparation derives the obligation and relationship closure.
async function historySnapshot(binding){
 const files=[],runIds=new Set(),groups=new Set();
 function references(value){
  if(!value||typeof value!=='object')return;
  for(const [key,item]of Object.entries(value)){
   if(['runId','parentRunId','childRunId'].includes(key)&&typeof item==='string'){if(!valid(item))bad('HISTORY_RUN_INVALID');runIds.add(item);}
   if(key==='runIds'&&Array.isArray(item))for(const id of item){if(!valid(id))bad('HISTORY_RUN_INVALID');runIds.add(id);}
   if(key==='groupId'&&typeof item==='string')groups.add(item);
   references(item);
  }
 }
 async function walk(directory){
  for(const entry of (await readdir(directory,{withFileTypes:true}).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e))).sort((a,b)=>a.name.localeCompare(b.name))){
   const file=path.join(directory,entry.name),resolved=normalize(await physical(file));
   if(!resolved.startsWith(binding.runtime+'/'))bad('HISTORY_BINDING_INVALID');
   if(entry.isSymbolicLink())bad('HISTORY_STATE_UNVERIFIABLE');
   if(entry.isDirectory()){await walk(file);continue;}
   if(!entry.isFile())bad('HISTORY_STATE_UNVERIFIABLE');
   const bytes=await readFile(file);
   try{references(JSON.parse(bytes));}catch(e){if(e.code)throw e;}
   // Filename identity covers old files without a runId payload.
   if(path.basename(directory)==='entry-actions'){
    const id=entry.name.split('.')[0];if(valid(id))runIds.add(id);
   }
   // Reparse locally so repeated references remain represented in each original file.
   const localRuns=new Set(),localGroups=new Set();
   function local(v){if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){if(['runId','parentRunId','childRunId'].includes(k)&&typeof x==='string')localRuns.add(x);if(k==='runIds'&&Array.isArray(x))for(const id of x)localRuns.add(id);if(k==='groupId'&&typeof x==='string')localGroups.add(x);local(x);}}
   try{local(JSON.parse(bytes));}catch{}
   if(path.basename(directory)==='entry-actions'){const id=entry.name.split('.')[0];if(valid(id))localRuns.add(id);}
   files.push({file:resolved,digest:sha(bytes),runIds:[...localRuns].sort(),groupIds:[...localGroups].sort()});
  }
 }
 for(const directory of historyDirectories)await walk(path.join(binding.runtime,directory));
 return {files:files.sort((a,b)=>a.file.localeCompare(b.file)),runIds:[...runIds].sort(),groupIds:[...groups].sort()};
}
function obligationClosure(binding,inventory,obligations){
 const runIds=new Set(obligations.map(x=>x.runId).filter(Boolean)),groupIds=new Set(),selected=new Set();
 for(const obligation of obligations){
  let file=obligation.file;
  if(file&&!path.isAbsolute(file))file=path.join(binding.runtime,obligation.kind,file);
  if(file){file=normalize(path.resolve(file));for(const item of inventory.files)if(item.file===file||item.file.startsWith(file+'/'))selected.add(item.file);}
 }
 let changed=true;
 while(changed){
  changed=false;
  for(const file of inventory.files){
   if(!selected.has(file.file)&&!file.runIds.some(id=>runIds.has(id))&&!file.groupIds.some(id=>groupIds.has(id)))continue;
   if(!selected.has(file.file)){selected.add(file.file);changed=true;}
   for(const id of file.runIds)if(!runIds.has(id)){runIds.add(id);changed=true;}
   for(const id of file.groupIds)if(!groupIds.has(id)){groupIds.add(id);changed=true;}
  }
 }
 return {files:inventory.files.filter(x=>selected.has(x.file)),runIds:[...runIds].sort(),groupIds:[...groupIds].sort()};
}
async function privateWrite(file,value){
 const temp=file+'.'+crypto.randomUUID()+'.tmp';let handle;
 try{handle=await open(temp,'wx');await handle.writeFile(stable(value)+'\n');await handle.sync();await handle.close();handle=null;await rename(temp,file);}
 finally{await handle?.close();await rm(temp,{force:true});}
}
export async function initializeHistoricalDisposition(context){
 const binding=await historyBinding(context);
 return withHistoryProjectLock(binding,async()=>{
  await managedPolicy(binding);
  if(!binding.deployed)bad('HISTORY_DEPLOYMENT_REQUIRED');
  const registration={schemaVersion:1,anchorId:binding.expectedAnchorId,root:binding.root,runtime:binding.runtime};
  const existing=await optional(binding.registration);
  const initialAnchor=await optional(path.join(binding.directory,'anchor.json')),initialState=await optional(path.join(binding.directory,'state.json'));
  if(existing||initialAnchor||initialState){await readLedger(binding);return {contract:managedHistoryContract,anchorId:binding.expectedAnchorId};}
  if(existing&&stable(existing)!==stable(registration))bad('HISTORY_BINDING_INVALID');
  await mkdir(binding.directory,{recursive:true});
  // Registration and anchor are immutable; interrupted initialization resumes only the exact binding.
  if(!existing)await writeFile(binding.registration,stable(registration),{flag:'wx'});
  const anchorFile=path.join(binding.directory,'anchor.json'),anchor=await optional(anchorFile);
  if(anchor&&stable(anchor)!==stable(registration))bad('HISTORY_BINDING_INVALID');
  if(!anchor)await writeFile(anchorFile,stable(registration),{flag:'wx'});
  const stateFile=path.join(binding.directory,'state.json');
  if(!await optional(stateFile))await privateWrite(stateFile,{schemaVersion:1,anchorId:binding.expectedAnchorId,revision:0,records:{}});
  await readLedger(binding);return {contract:managedHistoryContract,anchorId:binding.expectedAnchorId};
 });
}
export async function prepareHistoricalDisposition(context){
 const binding=await historyBinding(context);
 return withHistoryProjectLock(binding,async()=>{
  const {policy,digest:deploymentDigest}=await managedPolicy(binding),state=await readLedger(binding);
  if(!state)bad('HISTORY_REGISTRATION_REQUIRED');
  const {inventoryPublicationObligations}=await import('./publication-window-obligations.mjs');
  const obligations=await inventoryPublicationObligations(binding),snapshot=obligationClosure(binding,await historySnapshot(binding),obligations);
  if(!obligations.length||!snapshot.runIds.length)bad('HISTORY_NO_OBLIGATIONS');
  // One immutable decision freezes all current obligations. Recovery resumes this original intent.
  const pending=Object.values(state.records).find(r=>r.contract===managedHistoryContract&&r.phase==='intent');
  if(pending)return {dispositionId:pending.dispositionId,phase:'intent',evidenceDigest:pending.evidenceDigest};
  if(Object.values(state.records).some(r=>r.contract===managedHistoryContract))bad('HISTORY_ALREADY_DISPOSED');
  for(const id of snapshot.runIds)if(state.records[id])bad('HISTORY_RECORD_CONFLICT');
  const evidence={contract:managedHistoryContract,root:binding.root,runtime:binding.runtime,anchorId:state.anchorId,deploymentDigest,
   snapshot,obligations,businessBaseline:await businessSnapshot(binding,policy),externalRiskAcceptance:'same-account-direct-writers-unknown-programs-manual-restore-outside-guarantee'};
  const record={runId:snapshot.runIds[0],phase:'intent',contract:managedHistoryContract,dispositionId:crypto.randomUUID(),relatedRunIds:snapshot.runIds,evidenceDigest:sha(stable(evidence)),evidence};
  state.records[record.runId]=record;state.revision++;
  await privateWrite(path.join(binding.directory,'state.json'),state);
  return {dispositionId:record.dispositionId,phase:record.phase,evidenceDigest:record.evidenceDigest};
 });
}
async function validateManagedReceipt(binding,record,{baseline=false,fullInventory=false,snapshot=null}={}){
 if(record.contract!==managedHistoryContract||!record.evidence||record.evidenceDigest!==sha(stable(record.evidence)))bad('HISTORY_PROOF_UNSUPPORTED');
 const evidence=record.evidence,{policy,digest:deploymentDigest}=await managedPolicy(binding);
 if(evidence.deploymentDigest!==deploymentDigest){
  if(!binding.deploymentSuccessor)bad('HISTORY_BINDING_INVALID');
  const bytes=await readFile(path.join(binding.directory,'state.json'));
  const certificate=await validateSuccessorLedger(binding,JSON.parse(bytes),bytes);
  if(certificate.sourcePolicyDigest!==evidence.deploymentDigest)bad('HISTORY_BINDING_INVALID');
 }
 return validateReceiptEvidence(binding,record,{baseline,fullInventory,snapshot,policy});
}
async function validateReceiptEvidence(binding,record,{baseline=false,fullInventory=false,snapshot=null,policy}={}){
 if(record.contract!==managedHistoryContract||!record.evidence||record.evidenceDigest!==sha(stable(record.evidence)))bad('HISTORY_PROOF_UNSUPPORTED');
 const evidence=record.evidence;
 if(evidence.contract!==managedHistoryContract||evidence.root!==binding.root||evidence.runtime!==binding.runtime||evidence.anchorId!==binding.expectedAnchorId||stable(record.relatedRunIds)!==stable(evidence.snapshot.runIds))bad('HISTORY_BINDING_INVALID');
 const original=evidence.snapshot;
 if(fullInventory){
  const current=snapshot??await historySnapshot(binding),byFile=new Map(current.files.map(file=>[file.file,file])),originalFiles=new Set(original.files.map(file=>file.file)),runs=new Set(record.relatedRunIds),groups=new Set(original.groupIds);
  for(const file of original.files){const found=byFile.get(file.file);if(!found||stable(found)!==stable(file))bad('HISTORY_EVIDENCE_DRIFT');}
  for(const file of current.files)if(!originalFiles.has(file.file)&&(file.runIds.some(id=>runs.has(id))||file.groupIds.some(id=>groups.has(id))))bad('HISTORY_EVIDENCE_DRIFT');
 }else{
  // Ordinary reads/effects rehash the exact original evidence, not unrelated history.
  // Newly added external relations are detected at the next full admission/inventory.
  await Promise.all(original.files.map(async file=>{
   try{if(normalize(await physical(file.file))!==file.file||sha(await readFile(file.file))!==file.digest)bad('HISTORY_EVIDENCE_DRIFT');}
   catch(error){if(error.code==='HISTORY_EVIDENCE_DRIFT')throw error;bad('HISTORY_EVIDENCE_DRIFT');}
  }));
 }
 if(baseline&&stable(await businessSnapshot(binding,policy))!==stable(evidence.businessBaseline))bad('HISTORY_BUSINESS_BASELINE_DRIFT');
 return evidence;
}

// Administrative preview only: returns a proof bound to unchanged originals.
// The caller must hold the project lock through final config CAS when applying.
export async function prepareHistoricalDeploymentUpgrade(context,sourceSnapshotBytes){
 const binding=await historyBinding(context);
 return withHistoryProjectLock(binding,async()=>{
  const source=sourceEntryFor(sourceSnapshotBytes,binding),sourcePolicy=source.managedNonReplay;
  const origin=sha(stable(sourcePolicy)),state=await readLedger(binding);
  if(!state||!Object.keys(state.records).length||Object.values(state.records).some(r=>r.phase!=='receipt'||r.evidence?.deploymentDigest!==origin))bad('HISTORY_UPGRADE_SOURCE_INVALID');
  const publication=await optional(path.join(binding.root,'.data-editor/publication-admission/state.json'));
  const map=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  if(!publication||publication.state!=='OPEN'||publication.windowId!==null||!map(publication.accepted)||!map(publication.continuations)
   ||Object.values(publication.accepted).some(x=>!map(x)||x.settled!==true)||Object.keys(publication.continuations).length)bad('HISTORY_UPGRADE_NOT_QUIESCENT');
  const {publicationBinding,readPublicationState}=await import('./publication-window-state.mjs');
  await readPublicationState(await publicationBinding(context));
  const snapshot=await historySnapshot(binding);
  for(const record of Object.values(state.records))await validateReceiptEvidence(binding,record,{fullInventory:true,snapshot,policy:sourcePolicy});
  const {inventoryPublicationObligations}=await import('./publication-window-obligations.mjs');
  const covered=new Set(Object.values(state.records).flatMap(record=>record.evidence.obligations.map(stable)));
  if((await inventoryPublicationObligations(binding)).some(item=>!covered.has(stable(item))))bad('HISTORY_UPGRADE_NEW_OBLIGATIONS');
  const files=[...new Set([...binding.policy.deploymentFiles.map(file=>file.path),...managedHistoryRequiredDeploymentFiles])];
  const targetPolicy={...binding.policy,deploymentFiles:await Promise.all(files.map(async file=>({path:file,digest:sha(await readFile(path.join(path.dirname(historyDeploymentFile),'..',file)))})))};
  const {digest:targetPolicyDigest}=await verifyDeploymentPolicy(targetPolicy);
  const ledgerBytes=await readFile(path.join(binding.directory,'state.json'));
  const certificate={version:1,contract:successorContract,root:binding.root,runtime:binding.runtime,anchorId:binding.expectedAnchorId,
   ledgerDigest:sha(ledgerBytes),receipts:Object.values(state.records).map(record=>({runId:record.runId,recordDigest:sha(stable(record)),evidenceDigest:record.evidenceDigest})),
   sourceSnapshot:artifactReference(sourceSnapshotBytes,'snapshot'),sourcePolicyDigest:origin,targetPolicyDigest};
  return {certificate,targetPolicy,businessBaseline:await businessSnapshot(binding,targetPolicy)};
 });
}
export async function commitHistoricalDisposition(context,request){
 if(!request||Object.keys(request).join(',')!=='dispositionId'||!valid(request.dispositionId))bad('HISTORY_DISPOSITION_REQUEST_INVALID');
 const binding=await historyBinding(context);
 return withHistoryProjectLock(binding,async()=>{
  const state=await readLedger(binding),record=Object.values(state?.records??{}).find(r=>r.dispositionId===request.dispositionId);
  if(!record)bad('HISTORY_DISPOSITION_NOT_FOUND');
  await validateManagedReceipt(binding,record,{baseline:record.phase!=='receipt',fullInventory:true});
  if(record.phase==='receipt')return structuredClone(record);
  // No transactional result is changed. Receipt only commits the managed non-replay projection.
  record.phase='receipt';state.revision++;await privateWrite(path.join(binding.directory,'state.json'),state);
  return structuredClone(record);
 });
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

// Explicit bootstrap restricted to this candidate's test fixtures. No general initializer.
export async function initializeHistoryTestFixture(context,records={}){
 const fixtureRoot=path.resolve(import.meta.dirname,'../tests/history-fixtures');
 const root=await physical(path.resolve(context.projectRoot));
 if(path.dirname(root)!==fixtureRoot)bad('HISTORY_FIXTURE_SCOPE_ONLY');
 const binding=await historyBinding(context),anchorId=crypto.randomUUID();
 await mkdir(binding.directory,{recursive:true});
 const registration={schemaVersion:1,anchorId,root:binding.root,runtime:binding.runtime};
 await writeFile(binding.registration,JSON.stringify(registration),{flag:'wx'});
 await writeFile(path.join(binding.directory,'anchor.json'),JSON.stringify(registration),{flag:'wx'});
 await writeFile(path.join(binding.directory,'state.json'),JSON.stringify({schemaVersion:1,anchorId,revision:0,records}),{flag:'wx'});
 await testDeploymentEntry({projectRoot:binding.root,runtime:binding.runtime,anchorId});
 context.historicalDispositionAnchorId=anchorId;
 return historyBinding(context);
}
async function testDeploymentEntry(entry,remove=false){
 return withProjectProcessLock('history-test-deployment:'+historyDeploymentFile,async()=>{
  const entries=await readHistoryDeployment(),next=entries.filter(e=>e.projectRoot!==entry.projectRoot);if(!remove)next.push(entry);
  const temporary=historyDeploymentFile+'.'+crypto.randomUUID()+'.tmp';
  try{await writeFile(temporary,JSON.stringify({version:1,entries:next}));const{atomicReplace}=await import('./atomic-file.mjs');await atomicReplace(temporary,historyDeploymentFile,{maxRetries:100,retryDelayMs:10});}
  finally{await rm(temporary,{force:true});}
 });
}
export async function removeHistoryTestFixtureDeployment(context){
 const root=normalize(await physical(path.resolve(context.projectRoot))),fixtureRoot=normalize(await physical(path.resolve(import.meta.dirname,'../tests/history-fixtures')));
 if(path.dirname(root).replaceAll('\\','/')!==fixtureRoot)bad('HISTORY_FIXTURE_SCOPE_ONLY');
 await testDeploymentEntry({projectRoot:root},true);
}
