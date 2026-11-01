import path from 'node:path';
import crypto from 'node:crypto';
import {readFile,realpath,readdir} from 'node:fs/promises';
import {managedHistoryRequiredDeploymentFiles} from './historical-required-files.mjs';
import {assertPolicy} from './deployment-authority-schema.mjs';
const managedHistoryContract='managed-entry-non-replay-v1',ID=/^[A-Za-z0-9:_-]{1,160}$/;
const valid=id=>typeof id==='string'&&ID.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const bad=code=>{throw Object.assign(new Error(code),{code,status:409})};
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),stable=v=>JSON.stringify(v);
const normalize=f=>process.platform==='win32'?f.replaceAll('\\','/').toLowerCase():f;
async function physical(f){try{return await realpath(f)}catch(e){if(e.code!=='ENOENT')throw e;return path.join(await physical(path.dirname(f)),path.basename(f))}}
export async function verifyDeploymentPolicy(policy,{toolRoot=path.resolve(import.meta.dirname,'..'),required=managedHistoryRequiredDeploymentFiles,rejectAliases=false}={}){
 assertPolicy(policy);
 if(!policy||policy.contract!==managedHistoryContract)bad('HISTORY_MANAGED_POLICY_REQUIRED');
 if(required.some(file=>!policy.deploymentFiles.some(x=>x.path===file)))bad('HISTORY_DEPLOYMENT_INCOMPLETE');
 const tool=normalize(await physical(path.resolve(toolRoot)));
 if(rejectAliases&&tool!==normalize(path.resolve(toolRoot)))bad('HISTORY_DEPLOYMENT_ALIAS_REJECTED');
 for(const file of policy.deploymentFiles){
  const resolved=normalize(await physical(path.join(tool,file.path)));
  if(rejectAliases&&resolved!==normalize(path.join(tool,file.path)))bad('HISTORY_DEPLOYMENT_ALIAS_REJECTED');
  if(!resolved.startsWith(tool+'/')||sha(await readFile(resolved))!==file.digest)bad('HISTORY_DEPLOYMENT_DRIFT');
 }
 return {policy,digest:sha(stable(policy))};
}
export async function businessSnapshot(binding,policy){
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
export async function historySnapshot(binding){
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
export function obligationClosure(binding,inventory,obligations){
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
export async function validateReceiptEvidence(binding,record,{baseline=false,fullInventory=false,snapshot=null,policy}={}){
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

