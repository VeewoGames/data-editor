import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,realpath,mkdir,open,rename,link,rm,readdir,stat} from 'node:fs/promises';
import {resolveDeploymentAuthorityDirectory} from './deployment-authority-locator.mjs';
import {withProjectProcessLock} from './project-process-lock.mjs';
import {normalize,digest,decode,assertCatalog,assertRef,authorityError as bad} from './deployment-authority-schema.mjs';

const scope=new AsyncLocalStorage();
export async function authorityPhysical(file){
 try{return await realpath(file);}catch(error){if(error.code!=='ENOENT')throw error;return path.join(await authorityPhysical(path.dirname(file)),path.basename(file));}
}
export async function fixedDirectory(){
 const directory=await resolveDeploymentAuthorityDirectory();
 if(normalize(await authorityPhysical(directory))!==normalize(directory))bad('HISTORY_AUTHORITY_ALIAS_REJECTED');
 return directory;
}
export async function readPhysical(directory,relative){
 const file=path.resolve(directory,relative);
 if(!normalize(file).startsWith(normalize(directory)+'/')||normalize(await authorityPhysical(file))!==normalize(file))bad('HISTORY_AUTHORITY_ALIAS_REJECTED');
 try{if((await stat(file)).size>64*1024*1024)bad('HISTORY_AUTHORITY_OBJECT_TOO_LARGE');return await readFile(file);}
 catch(error){if(error.code?.startsWith('HISTORY_'))throw error;bad(error.code==='ENOENT'?'HISTORY_AUTHORITY_MISSING':'HISTORY_AUTHORITY_UNVERIFIABLE');}
}
export async function readObject(directory,ref){assertRef(ref);const bytes=await readPhysical(directory,ref.path);if(digest(bytes)!==ref.digest)bad('HISTORY_AUTHORITY_DIGEST_MISMATCH');return bytes;}
export async function loadCatalog(allowMissing=false){
 const directory=await fixedDirectory(),file=path.join(directory,'catalog.v2.json');let bytes;
 try{bytes=await readPhysical(directory,'catalog.v2.json');}catch(error){if(!allowMissing||error.code!=='HISTORY_AUTHORITY_MISSING')throw error;return {directory,file,bytes:null,stamp:null,catalog:{version:2,contract:'history-authority-catalog-v2',generation:0,minReaderProtocol:2,entries:[]}};}
 const catalog=decode(bytes);assertCatalog(catalog);return {directory,file,bytes,stamp:digest(bytes),catalog};
}
export async function withStoreDeliveryLock(operation){
 const directory=await fixedDirectory(),key='history-delivery:'+normalize(path.join(directory,'catalog.v2.json')),held=scope.getStore();
 if(held?.key===key&&held.active)return operation();
 return withProjectProcessLock(key,async()=>{const token={key,active:true};try{return await scope.run(token,operation);}finally{token.active=false;}});
}
export async function lockRoots(roots,operation){const sorted=[...new Set(roots)].sort();const step=index=>index===sorted.length?operation():withProjectProcessLock('publication:'+digest(sorted[index]),()=>step(index+1));return step(0);}
export async function ensureDirectory(directory){if(normalize(await authorityPhysical(directory))!==normalize(directory))bad('HISTORY_AUTHORITY_ALIAS_REJECTED');await mkdir(directory,{recursive:true});if(normalize(await realpath(directory))!==normalize(directory))bad('HISTORY_AUTHORITY_ALIAS_REJECTED');}
export async function persistObject(directory,ref,bytes){
 if(normalize(directory)!==normalize(await fixedDirectory()))bad('HISTORY_AUTHORITY_BINDING_INVALID');
 assertRef(ref);if(digest(bytes)!==ref.digest)bad('HISTORY_AUTHORITY_DIGEST_MISMATCH');await ensureDirectory(path.join(directory,'objects'));
 const file=path.join(directory,ref.path);if(normalize(await authorityPhysical(file))!==normalize(file))bad('HISTORY_AUTHORITY_ALIAS_REJECTED');
 await createStoreFile(directory,ref.path,bytes);
 if(!(await readObject(directory,ref)).equals(bytes))bad('HISTORY_AUTHORITY_DIGEST_MISMATCH');
}
export async function createStoreFile(directory,relative,bytes){
 if(normalize(directory)!==normalize(await fixedDirectory()))bad('HISTORY_AUTHORITY_BINDING_INVALID');
 const target=path.resolve(directory,relative);if(!normalize(target).startsWith(normalize(directory)+'/'))bad('HISTORY_AUTHORITY_BINDING_INVALID');
 await ensureDirectory(path.dirname(target));if(normalize(await authorityPhysical(target))!==normalize(target))bad('HISTORY_AUTHORITY_ALIAS_REJECTED');
 const temporary=target+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;}
  if(!(await readPhysical(directory,relative)).equals(bytes))bad('HISTORY_AUTHORITY_DIGEST_MISMATCH');
 }finally{await handle?.close();await rm(temporary,{force:true});}
}
export async function atomicStoreWrite(directory,relative,bytes){
 if(normalize(directory)!==normalize(await fixedDirectory()))bad('HISTORY_AUTHORITY_BINDING_INVALID');
 await ensureDirectory(path.dirname(path.join(directory,relative)));const target=path.join(directory,relative);
 if(normalize(await authorityPhysical(target))!==normalize(target))bad('HISTORY_AUTHORITY_ALIAS_REJECTED');
 const temporary=target+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,target);}
 finally{await handle?.close();await rm(temporary,{force:true});}
}
export const activateCatalog=(directory,bytes)=>atomicStoreWrite(directory,'catalog.v2.json',bytes);
export function objectCollector(initial=[]){
 if(initial.length>100000||initial.reduce((sum,item)=>sum+(typeof item.base64==='string'?item.base64.length:Infinity),0)>Math.ceil(1024*1024*1024*4/3))bad('HISTORY_AUTHORITY_BUDGET_EXCEEDED');
 const map=new Map();for(const item of initial){const bytes=Buffer.from(item.base64,'base64');if(digest(bytes)!==item.digest||bytes.toString('base64')!==item.base64||map.has(item.digest))bad('HISTORY_AUTHORITY_DIGEST_MISMATCH');map.set(item.digest,bytes);}
 return {map,add(bytes){const id=digest(bytes);map.set(id,Buffer.from(bytes));return {path:`objects/${id}.blob`,digest:id};},async read(ref){assertRef(ref);const bytes=map.get(ref.digest);if(!bytes||digest(bytes)!==ref.digest)bad('HISTORY_AUTHORITY_DIGEST_MISMATCH');return bytes;},values:()=>[...map].sort((a,b)=>a[0].localeCompare(b[0])).map(([digest,bytes])=>({digest,base64:bytes.toString('base64')}))};
}
