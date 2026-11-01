import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {buildBacklinkLookupState} from '../src/model/backlink-lookup.mjs';
import {getBacklinkColumnsForView} from '../src/model/backlink-grid.mjs';
import {buildRelationLookupState,relationLookupScope} from '../src/model/relation-lookup.mjs';
import {buildDocumentModel} from '../src/document-model.mjs';
import {reuseEquivalentRelationIndexes} from '../src/validation/stable-inputs.mjs';

// Execute the actual App loaders and effect callbacks, not a test copy of their logic.
const source=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions=new Map(),effects=[];
function visit(node){
 if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node.getText(ast));
 if(ts.isCallExpression(node)&&['useEffect','useLayoutEffect'].includes(node.expression.getText(ast))&&node.arguments[0])effects.push(node.arguments[0].getText(ast));
 ts.forEachChild(node,visit);
}visit(ast);
const code=ts.transpileModule(`
${functions.get('scheduleDeferredTask')}
${functions.get('cancelDeferredTask')}
function render({activeProjectId,selectedPath,collectionPath,model,viewConfig,dependencyLoadContext}) {
 ${functions.get('invalidateDependencyLoads')}
 ${functions.get('isDependencyContextCurrent')}
 ${functions.get('loadRelationIndexes')}
 ${functions.get('loadBacklinkGridData')}
 return {invalidateDependencyLoads,loadRelationIndexes,loadBacklinkGridData,
 contextEffect:${effects.find(s=>s.includes('dependencyLoadContextRef.current = dependencyLoadContext'))},
 relationEffect:${effects.find(s=>s.includes('const scheduledRequest = relationIndexRequestRef.current'))},
 backlinkEffect:${effects.find(s=>s.includes('const scheduledRequest = backlinkRequestRef.current'))}};
}
`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const relation={targetFile:'data/target.json',targetCollection:'$',targetKey:'id',titleFields:['name']};
const config={relations:{'data/a.json:$:target_id':relation},backlinks:{},primaryKeys:{}};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness({idle=true,backlinkBuild=buildBacklinkLookupState,relationBuild=buildRelationLookupState}={}){
 const state={status:{},columns:[],values:{},indexes:{},options:{},finalized:0,history:[],reads:0},timers=[];
 const ref=value=>({current:value});
 const context={AbortController,Error,Object,String,Set,Map,
  dependencyLoadContextRef:ref(null),activeProjectIdRef:ref('p'),selectedPathRef:ref('data/a.json'),
  relationIndexRequestRef:ref(0),backlinkRequestRef:ref(0),relationReadAbortRef:ref(null),backlinkReadAbortRef:ref(null),
  relationWarmupHandleRef:ref(null),backlinkWarmupHandleRef:ref(null),deferRelationWarmupRef:ref(true),deferBacklinkWarmupRef:ref(true),
  detailReorderPerfRef:ref({active:true,awaitingBacklinks:true,generation:0}),
  setDependencyLoadState:fn=>{state.status=typeof fn==='function'?fn(state.status):fn;state.history.push({...state.status});},
  setBacklinkColumns:value=>state.columns=value,setBacklinkValuesByRowIdState:value=>state.values=value,
  setRelationIndexes:value=>state.indexes=typeof value==='function'?value(state.indexes):value,setRelationOptions:value=>state.options=value,setLoadedRelationScope:()=>{},
  finalizeDetailReorderAsyncSegment:()=>state.finalized++,markPerf:()=>{},
  getRows:model=>model.root,buildBacklinkLookupState:backlinkBuild,buildRelationLookupState:relationBuild,
  getBacklinkColumnsForView,relationLookupScope,reuseEquivalentRelationIndexes,
  loadDocument:async()=>{state.reads++;return buildDocumentModel([{id:'t',name:'Target'}],'json');},
  window:{setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},cancelIdleCallback:()=>{}}
 };
 if(idle)context.window.requestIdleCallback=context.window.setTimeout;
 vm.createContext(context);vm.runInContext(code,context);
 const render=(options={})=>{const input={activeProjectId:'p',selectedPath:'data/a.json',collectionPath:'$',model:buildDocumentModel([{id:'a',target_id:'t'}],'json'),viewConfig:config,dependencyLoadContext:{},...options};context.dependencyLoadContextRef.current=input.dependencyLoadContext;context.activeProjectIdRef.current=input.activeProjectId;context.selectedPathRef.current=input.selectedPath;const r=context.render(input);r.contextEffect();return r;};
 return {state,context,timers,render};
}
for(const idle of [true,false])test(`null-model warmup cannot overwrite a completed model (${idle?'idle':'timeout'})`,async()=>{
 const h=harness({idle});const empty=h.render({model:null});empty.backlinkEffect();assert.equal(h.timers.length,0);
 const ready=h.render();ready.backlinkEffect();h.timers[0]();await settle();assert.equal(h.state.status.backlinks,'');assert.equal(h.state.reads,0);
 await empty.loadBacklinkGridData();assert.equal(h.state.status.backlinks,'');
});
for(const kind of ['backlink','relation'])test(`${kind}: canceled delayed callbacks and old contexts cannot abort or publish`,async()=>{
 const gate=deferred();let calls=0;
 const result=kind==='backlink'?{backlinkColumns:[],backlinkValuesByRowId:{},errors:[]}:{relationIndexes:{},relationOptions:{},errors:[]};
 const h=harness({[kind==='backlink'?'backlinkBuild':'relationBuild']:async()=>{calls++;return gate.promise;}});
 const a=h.render();const cleanup=a[kind+'Effect']();const old=h.timers.at(-1);cleanup();
 const b=h.render({activeProjectId:'q'});b[kind+'Effect']();const next=h.timers.at(-1);next();const abort=h.context[kind==='backlink'?'backlinkReadAbortRef':'relationReadAbortRef'].current;
 old();await a[kind==='backlink'?'loadBacklinkGridData':'loadRelationIndexes'](config);assert.equal(abort.signal.aborted,false);assert.equal(calls,1);
 gate.resolve(result);await settle();assert.equal(h.state.status[kind==='backlink'?'backlinks':'relations'],'');
});
for(const kind of ['backlink','relation'])test(`${kind}: retry isolates late success, errors and cancellation swallowed by builder`,async()=>{
 const gates=[deferred(),deferred(),deferred()];let calls=0;
 const h=harness({[kind==='backlink'?'backlinkBuild':'relationBuild']:()=>gates[calls++].promise});
 const r=h.render();const load=()=>kind==='backlink'?r.loadBacklinkGridData():r.loadRelationIndexes(config);
 const first=load(),second=load();const key=kind==='backlink'?'backlinks':'relations';const before=h.state.status[key];
 gates[0].resolve(kind==='backlink'?{backlinkColumns:['old'],backlinkValuesByRowId:{},errors:[{message:'cancel'}]}:{relationIndexes:{old:true},relationOptions:{},errors:[{message:'cancel'}]});await first;
 assert.equal(h.state.status[key],before);assert.equal(h.state.finalized,0);
 gates[1].reject(new Error('build failed'));await second;assert.match(h.state.status[key],/加载失败.*build failed/);
 const third=load();gates[2].resolve(kind==='backlink'?{backlinkColumns:[],backlinkValuesByRowId:{},errors:[]}:{relationIndexes:{},relationOptions:{},errors:[]});await third;assert.equal(h.state.status[key],'');
});
test('context changes discard completed data even before a replacement request starts',async()=>{
 for(const options of [{activeProjectId:'q'},{selectedPath:'data/b.json'},{collectionPath:'$.other'},{model:buildDocumentModel([], 'json')},{viewConfig:{...config,relations:{}}},{}]){
  const gate=deferred();const h=harness({backlinkBuild:()=>gate.promise});const a=h.render();const pending=a.loadBacklinkGridData();h.render(options);
  gate.resolve({backlinkColumns:['stale'],backlinkValuesByRowId:{},errors:[]});await pending;assert.equal(h.state.columns.length,0);assert.equal(h.state.finalized,0);
 }
});
test('synchronous invalidation rejects in-flight commits and late failure after unmount',async()=>{
 const gate=deferred(),h=harness({backlinkBuild:()=>gate.promise});const r=h.render();const pending=r.loadBacklinkGridData();r.invalidateDependencyLoads();const count=h.state.history.length;
 gate.reject(new Error('late'));await pending;assert.equal(h.state.history.length,count);assert.equal(h.state.finalized,0);
});
test('no declarations never displays loading; partial failures remain visible',async()=>{
 const h=harness(),r=h.render({viewConfig:{relations:{},backlinks:{},primaryKeys:{}}});await r.loadBacklinkGridData();await r.loadRelationIndexes({relations:{}});
 assert.ok(h.state.history.every(x=>!Object.values(x).some(v=>v.includes('加载中'))));assert.equal(h.state.reads,0);
 const broken=harness({relationBuild:async()=>({relationIndexes:{key:null},relationOptions:{},errors:[{message:'missing source'}]})});await broken.render().loadRelationIndexes(config);assert.match(broken.state.status.relations,/部分加载失败/);assert.equal(broken.state.indexes.key,null);
});
test('old performance segment cannot finish a newly started reorder',async()=>{
 const gate=deferred(),h=harness({backlinkBuild:()=>gate.promise});const pending=h.render().loadBacklinkGridData();h.context.detailReorderPerfRef.current.generation++;
 gate.resolve({backlinkColumns:[],backlinkValuesByRowId:{},errors:[]});await pending;assert.equal(h.state.finalized,0);
});

test('layout invalidates immediately but dependency computation only runs on its deferred turn',async()=>{
 let builds=0;const h=harness({relationBuild:async()=>{builds++;return {relationIndexes:{},relationOptions:{},errors:[]};}});
 h.context.deferRelationWarmupRef.current=false;const r=h.render();r.relationEffect();assert.equal(builds,0);h.timers.at(-1)();await settle();assert.equal(builds,1);
});
