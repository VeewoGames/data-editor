import {AsyncLocalStorage} from 'node:async_hooks';
const reads=new AsyncLocalStorage();
const cancelled=()=>Object.assign(new Error('读取已取消。'),{code:'READ_CANCELLED',status:499});
export function checkReadRequest(){const state=reads.getStore();if(state?.signal?.aborted)throw typeof state.signal.reason?.code==='string'?state.signal.reason:cancelled();}
export function currentReadSignal(){return reads.getStore()?.signal;}
export function withReadSignal(signal,operation){return reads.run({signal},operation);}
export function withoutReadRequest(operation){return reads.exit(operation);}

export function createReadExecutor({concurrency=8,maxQueued=128,maxBackground=2}={}){
 const queue=[];let active=0,background=0;
 const pump=()=>{
  while(active<concurrency){
   let index=queue.findIndex(item=>item.priority!=='background');
   if(index<0&&background<maxBackground)index=queue.findIndex(item=>item.priority==='background');
   if(index<0)return;
   const [item]=queue.splice(index,1);item.signal?.removeEventListener('abort',item.cancel);
   if(item.signal?.aborted){item.reject(cancelled());continue;}
   active++;if(item.priority==='background')background++;
   void reads.run({signal:item.signal},async()=>{checkReadRequest();return item.operation();}).then(item.resolve,item.reject).finally(()=>{active--;if(item.priority==='background')background--;pump();});
  }
 };
 return {run(operation,{signal,priority='foreground'}={}){
  if(signal?.aborted)return Promise.reject(cancelled());
  if(queue.length>=maxQueued)return Promise.reject(Object.assign(new Error('读取队列已满。'),{code:'READ_BUSY',status:503}));
  return new Promise((resolve,reject)=>{
   const item={operation,signal,priority,resolve,reject,cancel:null};
   item.cancel=()=>{const index=queue.indexOf(item);if(index>=0){queue.splice(index,1);reject(cancelled());}};
   signal?.addEventListener('abort',item.cancel,{once:true});queue.push(item);pump();
  });
 },stats:()=>({active,queued:queue.length,background})};
}
