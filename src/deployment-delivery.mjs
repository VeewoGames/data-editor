import path from 'node:path';
import {readFile,stat,readdir,mkdir,open,rename,link,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {digest,normalize,exact,safePath,hash,assertRef,assertCatalog,decode,encode,canonical,authorityError as bad} from './deployment-authority-schema.mjs';
import {authorityPhysical,fixedDirectory,readPhysical,readObject,loadCatalog,atomicStoreWrite,ensureDirectory} from './deployment-authority-io.mjs';
import {upgradeHistoryRequiredDeploymentFiles} from './historical-required-files.mjs';
import {createProjectContext} from './project-context.mjs';
import {readTextFile} from './file-service.mjs';
const documentEtag=text=>'"'+digest(text)+'"';

export async function physicalTool(value){
 if(typeof value!=='string'||!path.isAbsolute(value))bad('HISTORY_UPGRADE_ABSOLUTE_PATH_REQUIRED');
 const resolved=path.resolve(value);if(normalize(await authorityPhysical(resolved))!==normalize(resolved))bad('HISTORY_UPGRADE_ALIAS_REJECTED');
 if(!(await stat(resolved)).isDirectory())bad('HISTORY_UPGRADE_PATH_INVALID');return normalize(resolved);
}
export async function deliveryPath(root,relative){
 if(!safePath(relative)||relative.split('/').some(part=>['.git','.claw','.data-editor','node_modules'].includes(part.toLowerCase())))bad('HISTORY_UPGRADE_PATH_INVALID');
 const file=path.resolve(root,relative);
 if(!normalize(file).startsWith(normalize(root)+'/')||normalize(await authorityPhysical(file))!==normalize(file))bad('HISTORY_UPGRADE_ALIAS_REJECTED');
 return file;
}
export async function optionalBytes(file){try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export async function staticSnapshot(tool){
 const files=[];let total=0;
 async function walk(relative){
  const directory=await deliveryPath(tool,relative);let entries;
  try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT'&&relative==='dist')return;throw error;}
  for(const entry of entries){
   const name=relative+'/'+entry.name,target=await deliveryPath(tool,name);
   if(entry.isSymbolicLink())bad('HISTORY_UPGRADE_ALIAS_REJECTED');
   if(entry.isDirectory()){await walk(name);continue;}
   const info=await stat(target);if(!info.isFile()||info.size>64*1024*1024||files.length>=10000||(total+=info.size)>256*1024*1024)bad('HISTORY_UPGRADE_STATIC_BUDGET_EXCEEDED');
   files.push({path:name,digest:digest(await readFile(target)),size:info.size});
  }
 }await walk('dist');return files.sort((a,b)=>a.path.localeCompare(b.path));
}
async function assertStaticReferences(tool,files){
 const names=new Set(files.map(file=>file.path));if(!names.has('dist/index.html'))bad('HISTORY_UPGRADE_STATIC_REFERENCE_MISSING');
 const {default:ts}=await import('typescript');
 for(const file of files){
  if(!/\.(html|css|js|mjs)$/.test(file.path))continue;
  const source=await readFile(await deliveryPath(tool,file.path),'utf8'),references=[];
  if(file.path.endsWith('.html'))for(const match of source.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi))references.push(match[1]);
  else if(file.path.endsWith('.css'))for(const match of source.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi))references.push(match[1]);
  else{
   const ast=ts.createSourceFile(file.path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
   const visit=node=>{const ref=ts.isImportDeclaration(node)||ts.isExportDeclaration(node)?node.moduleSpecifier:ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword?node.arguments[0]:null;if(ref&&ts.isStringLiteralLike(ref)&&/^[./]/.test(ref.text))references.push(ref.text);ts.forEachChild(node,visit);};visit(ast);
  }
  for(const ref of references){if(/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref))continue;
   const url=new URL(ref,'http://frozen.invalid/'+file.path.slice(5));let target;try{target='dist'+decodeURIComponent(url.pathname);}catch{bad('HISTORY_UPGRADE_STATIC_REFERENCE_MISSING');}
   if(!names.has(target))bad('HISTORY_UPGRADE_STATIC_REFERENCE_MISSING');
  }
 }
}
export async function assertStaticRelease(spec){if(canonical(await staticSnapshot(spec.installedTool))!==canonical(spec.staticFiles))bad('HISTORY_UPGRADE_STATIC_DRIFT');}
export async function assertStaticWritePlan(spec){
 const prior=await staticSnapshot(spec.installedTool),before=new Map(prior.map(file=>[file.path,file])),after=new Map(spec.staticFiles.map(file=>[file.path,file]));
 for(const relative of new Set([...before.keys(),...after.keys()])){
  const old=before.get(relative)?.digest??null,next=after.get(relative)?.digest??null;if(old===next)continue;
  const planned=spec.files.find(file=>file.relativePath===relative);
  if(!planned||planned.beforeDigest!==old||(planned.afterRef?.digest??null)!==next)bad('HISTORY_UPGRADE_STATIC_WRITESET_INCOMPLETE');
 }
}
export function validateReleaseManifest(manifest){
 if(!exact(manifest,'version,contract,files,runtime')||manifest.version!==1||manifest.contract!=='data-editor-release-manifest-v1'||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>10000)bad('HISTORY_UPGRADE_MANIFEST_INVALID');
 const seen=new Set();
 for(const file of manifest.files){
  if(!exact(file,'relativePath,beforeDigest,afterRef,mode,size')||!safePath(file.relativePath)||seen.has(file.relativePath.toLowerCase())||!Number.isSafeInteger(file.size)||file.size<0||file.size>64*1024*1024)bad('HISTORY_UPGRADE_MANIFEST_INVALID');
  seen.add(file.relativePath.toLowerCase());
  if(file.beforeDigest!==null&&!hash(file.beforeDigest))bad('HISTORY_UPGRADE_MANIFEST_INVALID');
  if(file.afterRef!==null)assertRef(file.afterRef);
  const mode=file.beforeDigest===null?'create':file.afterRef===null?'delete':'replace';
  if(file.mode!==mode||file.beforeDigest===null&&file.afterRef===null||file.afterRef===null&&file.size!==0||file.afterRef?.digest===file.beforeDigest)bad('HISTORY_UPGRADE_MANIFEST_INVALID');
 }
 const runtime=manifest.runtime;
 if(!exact(runtime,'registryHome,projectRoot,mainPort,bridgePort,readChecks')||typeof runtime.registryHome!=='string'||typeof runtime.projectRoot!=='string'||!path.isAbsolute(runtime.registryHome)||!path.isAbsolute(runtime.projectRoot)||!Number.isInteger(runtime.mainPort)||runtime.mainPort<1||runtime.mainPort>65535||!Number.isInteger(runtime.bridgePort)||runtime.bridgePort<1||runtime.bridgePort>65535||runtime.mainPort===runtime.bridgePort||!Array.isArray(runtime.readChecks)||!runtime.readChecks.length||runtime.readChecks.length>16)bad('HISTORY_UPGRADE_RUNTIME_INVALID');
 for(const check of runtime.readChecks)if(!exact(check,'projectId,sourcePath')||typeof check.projectId!=='string'||!check.projectId||check.projectId.length>160||!safePath(check.sourcePath))bad('HISTORY_UPGRADE_RUNTIME_INVALID');
}
export async function bootstrapPins(candidateTool,files){
 const {default:ts}=await import('typescript');
 const pending=[...upgradeHistoryRequiredDeploymentFiles,'package.json','package-lock.json',...files.filter(file=>file.afterRef).map(file=>file.relativePath)],seen=new Set(),pins=[];
 while(pending.length){
  const relative=pending.pop();if(seen.has(relative))continue;seen.add(relative);
  const file=await deliveryPath(candidateTool,relative),bytes=await readFile(file);
  pins.push({path:relative,digest:digest(bytes),size:bytes.length});
  // Freeze project-owned transitive imports, without walking node_modules.
  // Dependency installation remains bound to the unchanged package/lock pair.
  if(/\.(mjs|js)$/.test(relative)&&!relative.startsWith('dist/')){
   const source=ts.createSourceFile(relative,bytes.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
   const visit=node=>{
    const specifier=ts.isImportDeclaration(node)||ts.isExportDeclaration(node)?node.moduleSpecifier:
     ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword?node.arguments[0]:null;
    if(specifier&&ts.isStringLiteralLike(specifier)&&specifier.text.startsWith('.')){
     const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(relative),specifier.text));
     if(!safePath(resolved))bad('HISTORY_UPGRADE_IMPORT_OUTSIDE_TOOL');pending.push(resolved);
    }
    ts.forEachChild(node,visit);
   };visit(source);
  }
 }
 return pins.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function assertBootstrap(spec){
 if(normalize(await fixedDirectory())!==spec.authorityDirectory)bad('HISTORY_UPGRADE_AUTHORITY_CHANGED');
 const candidate=await physicalTool(spec.candidateTool);
 if(candidate!==spec.candidateTool||candidate!==normalize(path.resolve(import.meta.dirname,'..'))||spec.nodePath!==normalize(process.execPath)||digest(await readFile(spec.nodePath))!==spec.nodeDigest)bad('HISTORY_UPGRADE_BOOTSTRAP_DRIFT');
 for(const pin of spec.bootstrapPins)if(digest(await readFile(await deliveryPath(candidate,pin.path)))!==pin.digest)bad('HISTORY_UPGRADE_BOOTSTRAP_DRIFT');
 if(canonical(await staticSnapshot(candidate))!==canonical(spec.staticFiles))bad('HISTORY_UPGRADE_BOOTSTRAP_DRIFT');
 for(const file of spec.files){
  const target=normalize(await deliveryPath(spec.installedTool,file.relativePath));
  if(spec.bootstrapPins.some(pin=>normalize(path.join(candidate,pin.path))===target))bad('HISTORY_UPGRADE_BOOTSTRAP_OVERLAP');
 }
}
export function validateDeliverySpec(spec){
 if(!exact(spec,'version,contract,installedTool,candidateTool,authorityDirectory,priorCatalogDigest,files,staticFiles,bootstrapPins,nodePath,nodeDigest,runtime,businessBaselines')||spec.version!==1||spec.contract!=='history-deployment-delivery-v1'||!hash(spec.priorCatalogDigest)||!hash(spec.nodeDigest)||!Array.isArray(spec.bootstrapPins)||!Array.isArray(spec.businessBaselines)||!Array.isArray(spec.staticFiles)||!spec.staticFiles.length||spec.staticFiles.length>10000)bad('HISTORY_UPGRADE_SPEC_INVALID');
 for(const field of ['installedTool','candidateTool','authorityDirectory','nodePath'])if(typeof spec[field]!=='string'||!path.isAbsolute(spec[field])||normalize(spec[field])!==spec[field])bad('HISTORY_UPGRADE_SPEC_INVALID');
 const runtime=spec.runtime;
 if(!exact(runtime,'registryHome,projectRoot,mainPort,bridgePort,readChecks,registryDigest')||!hash(runtime.registryDigest)||!Array.isArray(runtime.readChecks))bad('HISTORY_UPGRADE_SPEC_INVALID');
 const {registryDigest,...declared}=runtime;
 for(const check of runtime.readChecks)if(!exact(check,'projectId,sourcePath,documentEtag')||typeof check.documentEtag!=='string'||!/^"[a-f0-9]{64}"$/.test(check.documentEtag))bad('HISTORY_UPGRADE_SPEC_INVALID');
 validateReleaseManifest({version:1,contract:'data-editor-release-manifest-v1',files:spec.files,runtime:{...declared,readChecks:runtime.readChecks.map(({projectId,sourcePath})=>({projectId,sourcePath}))}});
 const names=new Set();
 for(const pin of spec.bootstrapPins){if(!exact(pin,'path,digest,size')||!safePath(pin.path)||!hash(pin.digest)||!Number.isSafeInteger(pin.size)||pin.size<0||names.has(pin.path.toLowerCase()))bad('HISTORY_UPGRADE_SPEC_INVALID');names.add(pin.path.toLowerCase());}
 if(upgradeHistoryRequiredDeploymentFiles.some(file=>!names.has(file.toLowerCase())))bad('HISTORY_UPGRADE_SPEC_INVALID');
 const staticNames=new Set();let staticBytes=0;
 for(const file of spec.staticFiles){if(!exact(file,'path,digest,size')||!safePath(file.path)||!file.path.startsWith('dist/')||!hash(file.digest)||!Number.isSafeInteger(file.size)||file.size<0||file.size>64*1024*1024||staticNames.has(file.path.toLowerCase())||(staticBytes+=file.size)>256*1024*1024||!spec.bootstrapPins.some(pin=>canonical(pin)===canonical(file)))bad('HISTORY_UPGRADE_SPEC_INVALID');staticNames.add(file.path.toLowerCase());}
 if(!staticNames.has('dist/index.html'))bad('HISTORY_UPGRADE_SPEC_INVALID');
 const roots=new Set();
 for(const baseline of spec.businessBaselines){
  if(!exact(baseline,'root,files')||typeof baseline.root!=='string'||normalize(baseline.root)!==baseline.root||roots.has(baseline.root)||!Array.isArray(baseline.files)||!baseline.files.length)bad('HISTORY_UPGRADE_SPEC_INVALID');roots.add(baseline.root);
  const files=new Set();for(const file of baseline.files){if(!exact(file,'file,digest')||!hash(file.digest)||typeof file.file!=='string'||!file.file.startsWith(baseline.root+'/')||normalize(file.file)!==file.file||files.has(file.file))bad('HISTORY_UPGRADE_SPEC_INVALID');files.add(file.file);}
 }
}
export async function inspectFiles(spec){
 const files=[];
 for(const file of spec.files){
  const target=await deliveryPath(spec.installedTool,file.relativePath),bytes=await optionalBytes(target),actual=bytes===null?null:digest(bytes);
  const before=actual===file.beforeDigest,after=actual===(file.afterRef?.digest??null);
  files.push({...file,actual,state:before?'before':after?'after':'unknown'});
 }
 return files;
}
export async function buildDeliverySpec({installedTool,candidateTool,manifest,snapshot,collector}){
 validateReleaseManifest(manifest);
 installedTool=await physicalTool(installedTool);candidateTool=await physicalTool(candidateTool);
 if(installedTool===candidateTool)bad('HISTORY_UPGRADE_BOOTSTRAP_OVERLAP');
 const roots=snapshot.catalog.entries.map(entry=>entry.intent.root),authorityDirectory=normalize(await fixedDirectory());
 const staticFiles=await staticSnapshot(candidateTool);await assertStaticReferences(candidateTool,staticFiles);
 const pins=await bootstrapPins(candidateTool,[...manifest.files,...staticFiles.map(file=>({relativePath:file.path,afterRef:{path:`objects/${file.digest}.blob`,digest:file.digest}}))]),files=[...manifest.files].sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
 await assertStaticWritePlan({installedTool,files,staticFiles});
 for(const file of staticFiles)collector.add(await readFile(await deliveryPath(candidateTool,file.path)));
 for(const file of files){
  const target=normalize(await deliveryPath(installedTool,file.relativePath));
  if(target===authorityDirectory||target.startsWith(authorityDirectory+'/')||roots.some(root=>target===root||target.startsWith(root+'/')))bad('HISTORY_UPGRADE_WRITE_OUTSIDE_PRODUCT');
  const before=await optionalBytes(target);
  if((before===null?null:digest(before))!==file.beforeDigest)bad('HISTORY_UPGRADE_BEFORE_DRIFT');
  if(before)collector.add(before);
  const source=await optionalBytes(await deliveryPath(candidateTool,file.relativePath));
  if(file.afterRef){if(!source||source.length!==file.size||digest(source)!==file.afterRef.digest)bad('HISTORY_UPGRADE_PAYLOAD_DRIFT');collector.add(source);}
  else if(source!==null)bad('HISTORY_UPGRADE_PAYLOAD_DRIFT');
 }
 for(const relative of ['package.json','package-lock.json'])if(digest(await readFile(await deliveryPath(installedTool,relative)))!==digest(await readFile(await deliveryPath(candidateTool,relative))))bad('HISTORY_UPGRADE_DEPENDENCIES_CHANGED');
 const runtime={...manifest.runtime,registryHome:await physicalTool(manifest.runtime.registryHome),projectRoot:normalize(await authorityPhysical(manifest.runtime.projectRoot))};
 if(roots.some(root=>runtime.registryHome===root||runtime.registryHome.startsWith(root+'/'))||runtime.registryHome===authorityDirectory||runtime.registryHome.startsWith(authorityDirectory+'/'))bad('HISTORY_UPGRADE_RUNTIME_INVALID');
 const registryBytes=await readFile(path.join(runtime.registryHome,'projects.json'));let registry;try{registry=JSON.parse(registryBytes);}catch{bad('HISTORY_UPGRADE_RUNTIME_INVALID');}
 if(!registry.projects?.some(project=>normalize(project.root)===runtime.projectRoot))bad('HISTORY_UPGRADE_RUNTIME_INVALID');
 runtime.registryDigest=digest(registryBytes);runtime.readChecks=[];
 for(const check of manifest.runtime.readChecks){
  const project=registry.projects.find(project=>project.id===check.projectId);if(!project)bad('HISTORY_UPGRADE_RUNTIME_INVALID');
  const context=createProjectContext({projectRoot:project.root,dataSources:project.dataSources,filePolicy:project.filePolicy});
  runtime.readChecks.push({...check,documentEtag:documentEtag(await readTextFile(context,check.sourcePath))});
 }
 const spec={version:1,contract:'history-deployment-delivery-v1',installedTool,candidateTool,authorityDirectory,priorCatalogDigest:snapshot.stamp,files,staticFiles,bootstrapPins:pins,nodePath:normalize(process.execPath),nodeDigest:digest(await readFile(process.execPath)),runtime};
 await assertBootstrap(spec);
 if((await inspectFiles(spec)).some(file=>file.state!=='before'))bad('HISTORY_UPGRADE_BEFORE_DRIFT');
 return spec;
}

// The no-op is replaced only inside disposable fixture copies for interruption
// tests. No request, environment option or live callback can install a hook.
export async function deliveryCheckpoint(label) {}
export const deliveryRecordPath=id=>`deliveries/${id}.state.json`;
export const deliveryReceiptPath=id=>`deliveries/${id}.complete.json`;
export async function optionalStoreJson(directory,relative){
 try{return decode(await readPhysical(directory,relative));}catch(error){if(error.code==='HISTORY_AUTHORITY_MISSING')return null;bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');}
}
function assertPointer(pointer){
 if(!exact(pointer,'version,contract,deliveryId,bundleDigest,targetCatalogDigest')||pointer.version!==1||pointer.contract!=='history-active-delivery-v1'||!hash(pointer.deliveryId)||!hash(pointer.bundleDigest)||!hash(pointer.targetCatalogDigest))bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
}
export function assertDeliveryRecord(record,id){
 if(!exact(record,'version,contract,deliveryId,bundleDigest,priorCatalogDigest,targetCatalogDigest,specRef,bundleRef,phase,createdAt,activatedAt')||record.version!==1||record.contract!=='history-delivery-state-v1'||record.deliveryId!==id||!hash(id)||!hash(record.bundleDigest)||!hash(record.priorCatalogDigest)||!hash(record.targetCatalogDigest)||!['staged','selected','await_runtime'].includes(record.phase)||typeof record.createdAt!=='string'||record.activatedAt!==null&&typeof record.activatedAt!=='string')bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
 assertRef(record.specRef);assertRef(record.bundleRef);
 if(record.specRef.digest!==id||record.bundleRef.digest!==record.bundleDigest)bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
}
export function assertCompletion(receipt,record){
 if(!exact(receipt,'version,contract,deliveryId,bundleDigest,targetCatalogDigest,specRef,instances,completedAt')||receipt.version!==1||receipt.contract!=='history-delivery-completion-v1'||receipt.deliveryId!==record.deliveryId||receipt.bundleDigest!==record.bundleDigest||receipt.targetCatalogDigest!==record.targetCatalogDigest||canonical(receipt.specRef)!==canonical(record.specRef)||typeof receipt.completedAt!=='string'||!Array.isArray(receipt.instances)||receipt.instances.length!==2)bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
 for(const role of ['main','bridge'])if(receipt.instances.filter(instance=>instance.role===role).length!==1)bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
 for(const instance of receipt.instances)if(!exact(instance,'role,pid,creationTime,started,instanceId,command,executable,challenge')||!Number.isSafeInteger(instance.pid)||instance.pid<1||typeof instance.creationTime!=='string'||!instance.creationTime||typeof instance.instanceId!=='string'||instance.instanceId.length<20||typeof instance.challenge!=='string'||instance.challenge.length<20||typeof instance.command!=='string'||typeof instance.executable!=='string'||typeof instance.started!=='string')bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
}
export async function readDeliveryState(directory,id){
 const record=await optionalStoreJson(directory,deliveryRecordPath(id));if(!record)bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');assertDeliveryRecord(record,id);
 const receipt=await optionalStoreJson(directory,deliveryReceiptPath(id));if(receipt)assertCompletion(receipt,record);
 const pointer=await optionalStoreJson(directory,'active-delivery.json');if(pointer)assertPointer(pointer);
 return {record,receipt,pointer,completed:!!receipt&&!pointer};
}
export async function assertDeliveryOpen(snapshot){
 const pointer=await optionalStoreJson(snapshot.directory,'active-delivery.json');
 if(pointer){assertPointer(pointer);bad('HISTORY_DEPLOYMENT_MAINTENANCE');}
 for(const entry of snapshot.catalog.entries){
  if(entry.intent.minReaderProtocol!==3)continue;
  const envelope=decode(await readObject(snapshot.directory,entry.envelopeRef));
  if(envelope.contract!=='history-authority-upgrade-v2')bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
  const id=envelope.deliverySpecRef?.digest;if(!hash(id))bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
  const state=await readDeliveryState(snapshot.directory,id);
  if(!state.completed)bad('HISTORY_DEPLOYMENT_MAINTENANCE');
  if(state.record.specRef.digest!==id)bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
  const target=decode(await readObject(snapshot.directory,{path:`objects/${state.record.targetCatalogDigest}.blob`,digest:state.record.targetCatalogDigest}));assertCatalog(target);
  if(!target.entries.some(item=>canonical(item)===canonical(entry)))bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
 }
}
export async function currentDeliveryForTool(toolRoot){
 const snapshot=await loadCatalog(),pointer=await optionalStoreJson(snapshot.directory,'active-delivery.json');
 let id=pointer?.deliveryId;if(pointer)assertPointer(pointer);
 if(!id){
  // Missing active pointers cannot turn an incomplete protocol-3 selection open.
  for(const entry of snapshot.catalog.entries)if(entry.intent.minReaderProtocol===3){
   const envelope=decode(await readObject(snapshot.directory,entry.envelopeRef));
   const state=await readDeliveryState(snapshot.directory,envelope.deliverySpecRef.digest);
   if(!state.completed){id=envelope.deliverySpecRef.digest;break;}
  }
 }
 if(!id)return null;
 const state=await readDeliveryState(snapshot.directory,id),spec=decode(await readObject(snapshot.directory,state.record.specRef));validateDeliverySpec(spec);
 if(spec.installedTool!==normalize(toolRoot))bad('HISTORY_DEPLOYMENT_MAINTENANCE');
 if(!state.pointer||state.pointer.deliveryId!==id||state.pointer.bundleDigest!==state.record.bundleDigest||state.pointer.targetCatalogDigest!==state.record.targetCatalogDigest)bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
 if(snapshot.stamp!==state.record.targetCatalogDigest||state.record.phase!=='await_runtime')bad('HISTORY_DEPLOYMENT_MAINTENANCE');
 if((await inspectFiles(spec)).some(file=>file.state!=='after'))bad('HISTORY_DEPLOYMENT_MAINTENANCE');
 await assertStaticRelease(spec);
 return {...state,spec,directory:snapshot.directory,catalogDigest:snapshot.stamp};
}
export async function saveDeliveryRecord(directory,record){assertDeliveryRecord(record,record.deliveryId);await atomicStoreWrite(directory,deliveryRecordPath(record.deliveryId),encode(record));}
export async function createDeliveryPointer(directory,record){
 const pointer={version:1,contract:'history-active-delivery-v1',deliveryId:record.deliveryId,bundleDigest:record.bundleDigest,targetCatalogDigest:record.targetCatalogDigest};
 const prior=await optionalStoreJson(directory,'active-delivery.json');
 if(prior&&canonical(prior)!==canonical(pointer))bad('HISTORY_UPGRADE_OTHER_DELIVERY_ACTIVE');
 if(!prior)await atomicStoreWrite(directory,'active-delivery.json',encode(pointer));
}
export async function clearDeliveryPointer(directory,record){
 const pointer=await optionalStoreJson(directory,'active-delivery.json');
 if(!pointer)return;
 assertPointer(pointer);
 if(pointer.deliveryId!==record.deliveryId||pointer.bundleDigest!==record.bundleDigest||pointer.targetCatalogDigest!==record.targetCatalogDigest)bad('HISTORY_UPGRADE_OTHER_DELIVERY_ACTIVE');
 const file=path.join(directory,'active-delivery.json');if(normalize(await authorityPhysical(file))!==normalize(file))bad('HISTORY_AUTHORITY_ALIAS_REJECTED');
 await rm(file);
}
export async function deliverFiles(spec,collector){
 for(let index=0;index<spec.files.length;index++){
  const file=spec.files[index],target=await deliveryPath(spec.installedTool,file.relativePath),expectedAfter=file.afterRef?.digest??null;
  let current=await optionalBytes(target),actual=current===null?null:digest(current);
  if(actual===expectedAfter)continue;
  if(actual!==file.beforeDigest)bad('HISTORY_UPGRADE_FILE_DRIFT');
  await deliveryCheckpoint('before_file:'+file.relativePath);
  if(file.mode==='delete'){
   current=await optionalBytes(target);if(current===null||digest(current)!==file.beforeDigest)bad('HISTORY_UPGRADE_FILE_DRIFT');
   await rm(target);
  }else{
   const bytes=await collector.read(file.afterRef);await mkdir(path.dirname(target),{recursive:true});
   await deliveryPath(spec.installedTool,file.relativePath);
   const temporary=path.join(path.dirname(target),`.data-editor-upgrade-${digest(encode(spec))}-${index}-${randomUUID()}.tmp`);let handle;
   try{
    handle=await open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    await deliveryCheckpoint('before_publish:'+file.relativePath);
    await deliveryPath(spec.installedTool,file.relativePath);current=await optionalBytes(target);actual=current===null?null:digest(current);
    if(actual!==file.beforeDigest)bad('HISTORY_UPGRADE_FILE_DRIFT');
    if(file.mode==='create')await link(temporary,target);else await rename(temporary,target);
   }finally{await handle?.close();await rm(temporary,{force:true});}
  }
  if((await optionalBytes(target).then(bytes=>bytes===null?null:digest(bytes)))!==expectedAfter)bad('HISTORY_UPGRADE_FILE_DRIFT');
  await deliveryCheckpoint('after_file:'+file.relativePath);
 }
}

// This exception owns only the three service-registration files named by the
// frozen runtime specification. It cannot authorize project or code writes.
export async function writeDeliveryRuntimeMetadata(target,bytes){
 const snapshot=await loadCatalog(),pointer=await optionalStoreJson(snapshot.directory,'active-delivery.json');
 if(!pointer){await assertDeliveryOpen(snapshot);return false;}
 assertPointer(pointer);const state=await readDeliveryState(snapshot.directory,pointer.deliveryId),spec=decode(await readObject(snapshot.directory,state.record.specRef));validateDeliverySpec(spec);
 if(pointer.bundleDigest!==state.record.bundleDigest||pointer.targetCatalogDigest!==state.record.targetCatalogDigest)bad('HISTORY_DELIVERY_STATE_UNVERIFIABLE');
 if(state.record.phase!=='await_runtime'||snapshot.stamp!==state.record.targetCatalogDigest)bad('HISTORY_DEPLOYMENT_MAINTENANCE');
 const allowed=['service.json','controller.json','recovery-bridge.json'].map(file=>normalize(path.join(spec.runtime.registryHome,'runtime',file)));
 const actual=normalize(await authorityPhysical(target));if(actual!==normalize(target)||!allowed.includes(actual))bad('HISTORY_DEPLOYMENT_MAINTENANCE');
 await mkdir(path.dirname(target),{recursive:true});const temporary=target+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,target);}finally{await handle?.close();await rm(temporary,{force:true});}
 return true;
}
