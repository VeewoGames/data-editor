import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createProjectContext,resolveInsideRoot} from './project-context.mjs';
import {checkReadRequest,currentReadSignal,withReadSignal} from './read-request-context.mjs';
const documentCache=new Map(),inflight=new Map();
const nonempty=value=>typeof value==='string'?value.trim():'';
const cancelled=()=>Object.assign(new Error('文档索引读取已取消。'),{code:'READ_CANCELLED'});

export async function buildDocumentIndex(projectContextOrRoot,documentFiles,dataFilePath,options={}){
 const context=createProjectContext(projectContextOrRoot),docRoot=nonempty(documentFiles?.[dataFilePath]?.docRoot);
 if(!docRoot)return {docRoot:null,entries:{}};
 const cache=await getDocumentCache(context.projectRoot,docRoot,options);
 return {docRoot,entries:cache.indexEntries};
}
export async function readResolvedDocument(projectContextOrRoot,documentFiles,dataFilePath,documentId,options={}){
 const context=createProjectContext(projectContextOrRoot),docRoot=nonempty(documentFiles?.[dataFilePath]?.docRoot),id=nonempty(documentId);
 if(!docRoot||!id)return {status:'missing',id};
 const response=await readOnce(context.projectRoot,docRoot,id,options);
 if(response.status!=='missing'||options?.forceRefresh)return response;
 return readOnce(context.projectRoot,docRoot,id,{forceRefresh:true});
}
export function clearDocumentServiceCache(){documentCache.clear();for(const job of inflight.values())job.controller.abort();inflight.clear();}

async function walk(directory,relative,files){
 checkReadRequest();
 const entries=await readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 for(const entry of entries){
  checkReadRequest();const next=relative?`${relative}/${entry.name}`:entry.name;
  if(entry.isDirectory())await walk(path.join(directory,entry.name),next,files);
  else if(entry.isFile()&&path.extname(entry.name).toLowerCase()==='.md')files.push(next);
 }
}
async function buildIndex(projectRoot,docRoot){
 const files=[];await walk(resolveInsideRoot(projectRoot,docRoot),'',files);
 const grouped=new Map();
 for(const relative of files){const id=path.basename(relative,'.md');const matches=grouped.get(id)??[];matches.push(relative);grouped.set(id,matches);}
 const indexEntries={};
 for(const [id,matches]of grouped){
  checkReadRequest();
  indexEntries[id]=matches.length>1?{status:'conflict',id,matches:matches.sort()}:{status:'resolved',id,relativePath:matches[0],title:path.basename(matches[0])};
 }
 return {indexEntries};
}
async function getDocumentCache(projectRoot,docRoot,options={}){
 const key=JSON.stringify([projectRoot,docRoot]),forceRefresh=options?.forceRefresh===true;
 checkReadRequest();
 if(!forceRefresh&&documentCache.has(key))return documentCache.get(key);
 let job=inflight.get(key);
 if(!job||(forceRefresh&&!job.fresh)){
  const controller=new AbortController();job={controller,fresh:forceRefresh,consumers:0,settled:false,promise:null};
  const current=job;inflight.set(key,job);
  job.promise=withReadSignal(controller.signal,()=>buildIndex(projectRoot,docRoot)).then(cache=>{
   if(controller.signal.aborted)throw cancelled();
   if(inflight.get(key)===current){documentCache.delete(key);documentCache.set(key,cache);while(documentCache.size>32)documentCache.delete(documentCache.keys().next().value);}
   return cache;
  }).finally(()=>{current.settled=true;if(inflight.get(key)===current)inflight.delete(key);});
  void job.promise.catch(()=>{});
 }
 const signal=currentReadSignal();job.consumers++;
 try{
  if(signal?.aborted)throw cancelled();
  if(!signal)return await job.promise;
  return await new Promise((resolve,reject)=>{
   const abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});
   job.promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
 }finally{job.consumers--;if(!job.settled&&!job.consumers)job.controller.abort();}
}
async function readOnce(projectRoot,docRoot,id,options){
 const cache=await getDocumentCache(projectRoot,docRoot,options),entry=cache.indexEntries[id];
 if(!entry)return {status:'missing',id};if(entry.status!=='resolved')return entry;
 checkReadRequest();const file=resolveInsideRoot(resolveInsideRoot(projectRoot,docRoot),entry.relativePath);
 let content;
 try{
  const info=await stat(file);
  if(info.size>20*1024*1024)throw Object.assign(new Error('说明文档超过20 MB预览上限。'),{code:'READ_RESPONSE_TOO_LARGE'});
  content=await readFile(file,'utf8');
 }catch(error){if(error.code==='ENOENT'){documentCache.delete(JSON.stringify([projectRoot,docRoot]));return {status:'missing',id};}throw error;}
 checkReadRequest();const heading=content.match(/^#\s+(.+?)\s*$/m);
 const resolved={...entry,title:heading?.[1]?.trim()||path.basename(entry.relativePath)};
 cache.indexEntries[id]=resolved;
 return {...resolved,content};
}
