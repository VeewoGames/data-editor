import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {inspectProjectProcess,processCommandArgs} from './project-process-instance.mjs';
import {readServiceProcessIdentity} from './service-process-identity.mjs';
import {currentDeliveryForTool,readDeliveryState,assertDeliveryOpen,assertStaticRelease} from './deployment-delivery.mjs';
import {loadCatalog} from './deployment-authority-io.mjs';
import {normalize,digest,canonical,authorityError as bad} from './deployment-authority-schema.mjs';

export const deploymentRuntimeProtocol=1;
const exec=promisify(execFile);
async function listening(port){
 if(process.platform!=='win32')bad('HISTORY_UPGRADE_RUNTIME_PLATFORM_UNSUPPORTED');
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; $items=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq ${port}); ConvertTo-Json -Compress -InputObject @($items | ForEach-Object { $_.OwningProcess })`],{windowsHide:true,timeout:10000,maxBuffer:1024*1024});
 const values=JSON.parse(stdout.trim());if(!Array.isArray(values)||values.some(id=>!Number.isSafeInteger(id)||id<1))bad('HISTORY_UPGRADE_RUNTIME_PORT_UNVERIFIABLE');
 return [...new Set(values)];
}
function option(args,key){const matches=args.flatMap((value,index)=>value===key?[args[index+1]]:[]);return matches.length===1?matches[0]:null;}
function matchesIdentity(identity,spec,role){
 const argv=processCommandArgs(identity?.command??''),entry=path.join(spec.installedTool,role==='main'?'server.mjs':'recovery-bridge.mjs');
 if(!identity?.executable||normalize(identity.executable)!==spec.nodePath||!path.isAbsolute(argv[1]??'')||normalize(argv[1])!==normalize(entry))return false;
 if(normalize(option(argv,'--registry-home')??'')!==spec.runtime.registryHome||normalize(option(argv,'--project')??'')!==spec.runtime.projectRoot)return false;
 if(option(argv,'--port')!==String(role==='main'?spec.runtime.mainPort:spec.runtime.bridgePort))return false;
 if(role==='main')return option(argv,'--static')==='dist'&&option(argv,'--bridge-port')===String(spec.runtime.bridgePort)&&(!argv.includes('--tool-root')||normalize(option(argv,'--tool-root')??'')===spec.installedTool);
 return normalize(option(argv,'--tool-root')??'')===spec.installedTool&&option(argv,'--service-port')===String(spec.runtime.mainPort)&&option(argv,'--service-mode')==='static';
}
export async function assertServicesStopped(spec,roots){
 try{
  for(const port of [spec.runtime.mainPort,spec.runtime.bridgePort])if((await listening(port)).length)bad('HISTORY_UPGRADE_RUNTIME_SERVICES_RUNNING');
  for(const item of await inspectProjectProcess()){
   const argv=processCommandArgs(item.command??''),script=argv[1]??'',basename=path.basename(script).toLowerCase();
   if(!['server.mjs','recovery-bridge.mjs','dev.mjs'].includes(basename))continue;
   const ownedScript=path.isAbsolute(script)&&normalize(path.dirname(script))===spec.installedTool;
   const ownedRegistry=normalize(option(argv,'--registry-home')??'')===spec.runtime.registryHome;
   const project=option(argv,'--project')??option(argv,'--root');
   if(ownedScript||ownedRegistry||project&&roots.includes(normalize(project)))bad('HISTORY_UPGRADE_RUNTIME_SERVICES_RUNNING');
  }
 }catch(error){if(error.code?.startsWith('HISTORY_'))throw error;bad('HISTORY_UPGRADE_RUNTIME_STOP_UNVERIFIABLE');}
}
async function json(url){
 const response=await fetch(url,{signal:AbortSignal.timeout(10000),cache:'no-store'});if(!response.ok)bad('HISTORY_UPGRADE_RUNTIME_RESPONSE_INVALID');return response.json();
}
async function startupDigest(spec){
 const pins=[];
 for(const pin of spec.bootstrapPins){const actual=digest(await readFile(path.join(spec.installedTool,pin.path)));if(actual!==pin.digest)bad('HISTORY_UPGRADE_RUNTIME_SOURCE_DRIFT');pins.push({path:pin.path,digest:actual});}
 return digest(Buffer.from(canonical(pins)));
}
export async function verifyRuntimeDelivery(spec,expected){
 try{
  if(digest(await readFile(spec.nodePath))!==spec.nodeDigest)bad('HISTORY_UPGRADE_RUNTIME_NODE_DRIFT');
  const frozenStartup=await startupDigest(spec),instances=[];
  for(const role of ['main','bridge']){
   const port=role==='main'?spec.runtime.mainPort:spec.runtime.bridgePort,pids=await listening(port);
   if(pids.length!==1)bad('HISTORY_UPGRADE_RUNTIME_INSTANCE_REQUIRED');
   const identity=await inspectProjectProcess(pids[0]),creation=await readServiceProcessIdentity(pids[0]);
   if(!creation||!matchesIdentity(identity,spec,role))bad('HISTORY_UPGRADE_RUNTIME_IDENTITY_MISMATCH');
   const challenge=randomUUID(),endpoint=role==='main'?'/api/deployment-attestation':'/deployment-attestation';
   const proof=await json(`http://127.0.0.1:${port}${endpoint}?challenge=${challenge}`);
   if(proof.role!==role||proof.pid!==identity.pid||proof.creationTime!==creation.creationTime||proof.challenge!==challenge||proof.deliveryId!==expected.deliveryId||proof.targetCatalogDigest!==expected.targetCatalogDigest||proof.startupDigest!==frozenStartup||proof.toolRoot!==spec.installedTool||typeof proof.instanceId!=='string'||proof.instanceId.length<20)bad('HISTORY_UPGRADE_RUNTIME_ATTESTATION_MISMATCH');
   if(!(await json(`http://127.0.0.1:${port}${role==='main'?'/api/health':'/health'}`)).ok)bad('HISTORY_UPGRADE_RUNTIME_HEALTH_INVALID');
   const after=await readServiceProcessIdentity(identity.pid);if(!after||after.creationTime!==creation.creationTime)bad('HISTORY_UPGRADE_RUNTIME_INSTANCE_CHANGED');
   instances.push({role,pid:identity.pid,creationTime:creation.creationTime,started:identity.started,instanceId:proof.instanceId,command:identity.command,executable:identity.executable,challenge});
  }
  if(digest(await readFile(path.join(spec.runtime.registryHome,'projects.json')))!==spec.runtime.registryDigest)bad('HISTORY_UPGRADE_RUNTIME_REGISTRY_CHANGED');
  for(const check of spec.runtime.readChecks){const url=new URL(`http://127.0.0.1:${spec.runtime.mainPort}/api/document-metadata`);url.searchParams.set('projectId',check.projectId);url.searchParams.set('path',check.sourcePath);const document=await json(url);if(document.sourcePath!==check.sourcePath||document.documentEtag!==check.documentEtag)bad('HISTORY_UPGRADE_RUNTIME_READ_MISMATCH');}
  await assertStaticRelease(spec);
  for(const file of spec.staticFiles){const relative=file.path==='dist/index.html'?'':file.path.slice(5).split('/').map(encodeURIComponent).join('/');const response=await fetch(`http://127.0.0.1:${spec.runtime.mainPort}/${relative}`,{signal:AbortSignal.timeout(10000),cache:'no-store'});if(!response.ok||Number(response.headers.get('content-length'))>file.size||digest(Buffer.from(await response.arrayBuffer()))!==file.digest)bad('HISTORY_UPGRADE_RUNTIME_STATIC_MISMATCH');}
  return instances;
 }catch(error){if(error.code?.startsWith('HISTORY_UPGRADE_RUNTIME_'))throw error;bad('HISTORY_UPGRADE_RUNTIME_UNVERIFIABLE');}
}

// Normal requests use memory. Only a pending verification instance observes
// completion in the fixed store; ordinary GETs never walk authority proofs.
export async function createDeploymentRuntime(role,toolRoot){
 const snapshot=await loadCatalog(true);if(snapshot.bytes===null)return {maintenance:false,refresh:async()=>false,attest:()=>bad('HISTORY_UPGRADE_RUNTIME_NOT_PENDING')};
 const delivery=await currentDeliveryForTool(toolRoot);
 if(!delivery){await assertDeliveryOpen(snapshot);return {maintenance:false,refresh:async()=>false,attest:()=>bad('HISTORY_UPGRADE_RUNTIME_NOT_PENDING')};}
 const identity=await readServiceProcessIdentity();if(!identity)bad('HISTORY_UPGRADE_RUNTIME_IDENTITY_UNVERIFIABLE');
 const own=await inspectProjectProcess(process.pid);if(!matchesIdentity(own,delivery.spec,role))bad('HISTORY_UPGRADE_RUNTIME_IDENTITY_MISMATCH');
 const frozen=Object.freeze({role,toolRoot:normalize(toolRoot),pid:process.pid,creationTime:identity.creationTime,deliveryId:delivery.record.deliveryId,targetCatalogDigest:delivery.record.targetCatalogDigest,instanceId:randomUUID(),startupDigest:await startupDigest(delivery.spec)});
 const runtime={maintenance:true,async refresh(){
  if(!runtime.maintenance)return false;
  const current=await loadCatalog();if(current.stamp!==delivery.catalogDigest)bad('HISTORY_DEPLOYMENT_MAINTENANCE');
  const state=await readDeliveryState(current.directory,delivery.record.deliveryId);
  if(state.completed){await assertDeliveryOpen(current);runtime.maintenance=false;return true;}return false;
 },attest(challenge){if(typeof challenge!=='string'||!/^[a-zA-Z0-9-]{20,128}$/.test(challenge))bad('HISTORY_UPGRADE_RUNTIME_CHALLENGE_INVALID');return {...frozen,challenge};}};
 return runtime;
}
