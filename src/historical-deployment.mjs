import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';

// Part of the tool delivery, never selected by request, environment or project.
export const historyDeploymentFile=path.resolve(import.meta.dirname,'../config/historical-disposition-deployment.json');
export const historyPhysicalKey=file=>process.platform==='win32'?file.replaceAll('\\','/').toLowerCase():file;
export async function historyPhysicalPath(file){try{return await realpath(file);}catch(e){if(e.code!=='ENOENT')throw e;return path.join(await historyPhysicalPath(path.dirname(file)),path.basename(file));}}
const invalid=()=>{throw Object.assign(new Error('HISTORY_DEPLOYMENT_UNVERIFIABLE'),{code:'HISTORY_DEPLOYMENT_UNVERIFIABLE',status:409});};
export async function readHistoryDeployment(){
 try{
  const physical=await realpath(historyDeploymentFile),expected=path.join(await realpath(path.resolve(import.meta.dirname,'..')),'config',path.basename(historyDeploymentFile));
  if(historyPhysicalKey(physical)!==historyPhysicalKey(expected))invalid();
  const value=JSON.parse(await readFile(physical,'utf8'));
  if(value?.version!==1||!Array.isArray(value.entries)||Object.keys(value).sort().join(',')!=='entries,version')invalid();
  const entries=[];
  for(const entry of value.entries){
   if(!entry||!['anchorId,projectRoot,runtime','anchorId,managedNonReplay,projectRoot,runtime','anchorId,deploymentSuccessor,managedNonReplay,projectRoot,runtime'].includes(Object.keys(entry).sort().join(','))||typeof entry.projectRoot!=='string'||typeof entry.runtime!=='string'||!path.isAbsolute(entry.projectRoot)||!path.isAbsolute(entry.runtime)||typeof entry.anchorId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(entry.anchorId))invalid();
   if(entry.deploymentSuccessor){
    const ref=entry.deploymentSuccessor;
    if(Object.keys(ref).sort().join(',')!=='digest,path'||!/^[a-f0-9]{64}$/.test(ref.digest)||ref.path!==`historical-deployment-upgrades/${ref.digest}.certificate.json`)invalid();
   }
   const root=historyPhysicalKey(await historyPhysicalPath(path.resolve(entry.projectRoot))),runtime=historyPhysicalKey(await historyPhysicalPath(path.resolve(entry.runtime)));
   if(entry.projectRoot!==root||entry.runtime!==runtime||!runtime.startsWith(root+'/'))invalid();
   if(entries.some(e=>e.projectRoot===root||e.projectRoot.startsWith(root+'/')||root.startsWith(e.projectRoot+'/')))invalid();
   if(entry.managedNonReplay){
    const policy=entry.managedNonReplay;
    if(policy.contract!=='managed-entry-non-replay-v1'||Object.keys(policy).sort().join(',')!=='businessFiles,contract,deploymentFiles'||!Array.isArray(policy.businessFiles)||!policy.businessFiles.length||!Array.isArray(policy.deploymentFiles)||!policy.deploymentFiles.length)invalid();
    for(const file of [...policy.businessFiles,...policy.deploymentFiles.map(x=>x?.path)])if(typeof file!=='string'||file.includes('\\')||path.isAbsolute(file)||path.posix.normalize(file)!==file||file.startsWith('../')||file.includes(':'))invalid();
    if(policy.deploymentFiles.some(x=>!x||Object.keys(x).sort().join(',')!=='digest,path'||!/^[a-f0-9]{64}$/.test(x.digest)))invalid();
    if(new Set(policy.businessFiles).size!==policy.businessFiles.length||new Set(policy.deploymentFiles.map(x=>x.path)).size!==policy.deploymentFiles.length)invalid();
   }
   entries.push({...entry});
  }
  return entries;
 }catch(e){if(e.code==='HISTORY_DEPLOYMENT_UNVERIFIABLE')throw e;invalid();}
}
