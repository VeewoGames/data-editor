const failure=(code,message)=>Object.assign(new Error(message),{code});

/** @param {any} settings */
export function createReadCoordinator(settings={}) {
 const {fetchImpl=(...args)=>fetch(...args),maxConcurrent=4,maxBackground=1,maxQueued=128,maxResponseBytes=64*1024*1024}=settings;
 const jobs=new Map(),queue=[];
 let active=0,background=0,sequence=0;

 function finish(job,error,value){
  if(job.finished)return;job.finished=true;
  if(jobs.get(job.key)===job)jobs.delete(job.key);
  if(job.started){active--;if(job.priority==='background')background--;}
  else {const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);}
  const consumers=[...job.consumers];
  for(const consumer of consumers){
   try{
    if(performance.now()>=consumer.deadline)consumer.end(failure('READ_TIMEOUT','读取超时，请重试。'));
    else if(error)consumer.end(error);
    else {const copy=consumers.length===1?value:structuredClone(value);consumer.end(performance.now()>=consumer.deadline?failure('READ_TIMEOUT','读取处理超时，请重试。'):null,copy);}
   }catch(cause){consumer.end(cause);}
  }
  pump();
 }
 function pump(){
  while(active<maxConcurrent){
   let index=queue.findIndex(job=>job.priority!=='background');
   if(index<0&&background<maxBackground)index=queue.findIndex(job=>job.priority==='background');
   if(index<0)return;
   const [job]=queue.splice(index,1);job.started=true;active++;if(job.priority==='background')background++;
   void run(job);
  }
 }
 async function run(job){
  const signal=job.controller.signal;
  try{
   const headers=new Headers(job.init.headers);headers.set('x-data-editor-read-priority',job.priority);
   const response=await fetchImpl(job.url,{...job.init,headers,cache:'no-store',signal});
   if(signal.aborted||job.finished)return;
   let text;
   if(response.body?.getReader){
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
    try{
     while(true){
      const {value,done}=await reader.read();
      if(signal.aborted||job.finished)return;
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxResponseBytes){await reader.cancel();throw failure('READ_RESPONSE_TOO_LARGE','读取响应超过处理上限。');}
      chunks.push(value);
     }
     const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
     text=new TextDecoder().decode(buffer);
    }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
   }else text=await response.text();
   if(signal.aborted||job.finished)return;
   let value;try{value=JSON.parse(text);}catch(error){throw Object.assign(error,{status:response.status});}
   if(!response.ok)throw Object.assign(new Error(value.error??`HTTP ${response.status}`),{status:response.status,code:value.code??null,field:value.field??null,details:value.details??null});
   finish(job,null,value);
  }catch(error){finish(job,error);}
 }

 /** @param {string} url @param {any} options */
 function read(url,options={}){
  const {scope='',fresh=false,priority='foreground',timeoutMs=priority==='background'?30000:10000,signal,init={}}=options;
  const budget=Number(timeoutMs);
  if(!Number.isFinite(budget)||budget<=0)return Promise.reject(failure('READ_TIMEOUT','读取期限已到。'));
  if(signal?.aborted)return Promise.reject(failure('READ_CANCELLED','读取已取消。'));
  const key=JSON.stringify([scope,url,init.headers??null,fresh?++sequence:null]);
  let job=jobs.get(key);
  if(!job){
   if(queue.length>=maxQueued)return Promise.reject(failure('READ_BUSY','读取队列已满，请稍后重试。'));
   job={key,url,init,scope,priority,controller:new AbortController(),consumers:new Set(),started:false,finished:false};
   jobs.set(key,job);queue.push(job);
  }else if(priority!=='background'&&!job.started)job.priority='foreground';
  return new Promise((resolve,reject)=>{
   const deadline=performance.now()+budget;
   const consumer={deadline,end:null};let ended=false;
   const cancel=()=>consumer.end(failure('READ_CANCELLED','读取已取消。'));
   const timer=setTimeout(()=>consumer.end(failure('READ_TIMEOUT','读取超时，请重试。')),budget);
   consumer.end=(error,value)=>{
    if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);job.consumers.delete(consumer);
    if(error)reject(error);else resolve(value);
    if(!job.finished&&job.consumers.size===0){job.controller.abort();finish(job,failure('READ_CANCELLED','读取已取消。'));}
   };
   job.consumers.add(consumer);signal?.addEventListener('abort',cancel,{once:true});pump();
  });
 }
 return {read,stats:()=>({active,queued:queue.length,background}),invalidateScope(scope){for(const job of [...jobs.values()])if(job.scope===scope){job.controller.abort();finish(job,failure('READ_CANCELLED','读取作用域已失效。'));}}};
}

export const readCoordinator=createReadCoordinator();
const projectEpochs=new Map();
export function invalidateProjectReads(projectId){
 const prefix=String(projectId)+'::';
 const previous=projectEpochs.get(projectId)??0;
 projectEpochs.set(projectId,previous+1);
 readCoordinator.invalidateScope(prefix+previous);
}
const healthReads=createReadCoordinator({maxConcurrent:2});
/** @param {string} url @param {any} options */
export function readJson(url,options={}){
  const projectId=new URL(url,'http://local').searchParams.get('projectId');
 const epoch=projectId?String(projectId)+'::'+(projectEpochs.get(projectId)??0):'';
 return (url.endsWith('/api/health')||url.endsWith('/health')?healthReads:readCoordinator).read(url,{...options,scope:epoch+(options.scope??'')});
}
export const isReadInterruption=error=>['READ_TIMEOUT','READ_CANCELLED','READ_BUSY','READ_RESPONSE_TOO_LARGE'].includes(error?.code);
