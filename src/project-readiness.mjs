import { withoutReadRequest } from './read-request-context.mjs';
// A completed preparation is a UI/read lifecycle fact, never a write permit.
// Every canonical writer keeps its own fresh authority/contract checks.
export function createProjectReadiness({prepare}) {
 const projects=new Map();
 let tail=Promise.resolve();
 const key=project=>JSON.stringify([project.id,project.root,project.dataSources,project.filePolicy]);
 function entry(project){
  const scope=key(project);let state=projects.get(project.id);
  if(!state||state.scope!==scope){state={projectId:project.id,scope,state:'initializing',promise:null,error:null};projects.set(project.id,state);}
  return state;
 }
 function ensure(project,{retry=false}={}){
  const state=entry(project);
  if(state.state==='ready')return Promise.resolve();
  if(state.promise)return state.promise;
  if(state.state==='failed'&&!retry)return Promise.reject(Object.assign(new Error(state.error.message),state.error));
  state.state='initializing';state.error=null;
  const operation=tail.then(()=>withoutReadRequest(()=>prepare(project)));
  tail=operation.catch(()=>{});
  state.promise=operation.then(result=>{
   if(result?.recovered===false&&result.reason==='publication_window_closed')throw Object.assign(new Error('项目发布窗口尚未开放。'),{code:'PROJECT_RECOVERY_PENDING',status:503});
   state.state='ready';
  }).catch(error=>{state.state='failed';state.error={code:error.code??'PROJECT_PREPARATION_FAILED',message:error.message,status:error.status??503};throw error;}).finally(()=>{state.promise=null;});
  return state.promise;
 }
 return {
  ensure,
  inspect(project){const s=entry(project);return {projectId:s.projectId,state:s.state,error:s.error};},
  invalidate(projectId){const s=projects.get(projectId);if(s&&!s.promise){s.state='initializing';s.error=null;}},
  invalidateAll(){for(const id of projects.keys())this.invalidate(id);},
  async settled(){await tail;},
 };
}
