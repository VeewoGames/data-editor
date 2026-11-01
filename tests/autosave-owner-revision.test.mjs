import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions=new Map();
(function visit(node){if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node.getText(ast));ts.forEachChild(node,visit);})(ast);
const names=['handleToggleFavoriteSharedViewIcon','markAutosaveDirty','collectAutosaveDirtyDomains','commitProfileSave','flushPendingProfileSave','flushBeforeDocumentTransition','handleSelectViewProfile','flushAutosaveTargets'];const js=ts.transpileModule(names.map(name=>functions.get(name)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness(){const ref=current=>({current}),writes=[],state={dirty:true,status:'',autosave:'',selected:'User'},c={Error,Promise,String,cloneDataRoot:structuredClone,normalizeUserViewProfile:x=>x,
 activeProjectIdRef:ref('p'),selectedViewProfileNameRef:ref('User'),selectedViewProfileRef:ref({sidebarWidth:200}),saveRevisionRef:ref({document:0,'project-config':0,profile:1}),saveScopeEpochRef:ref(0),profileSavePromiseRef:ref(null),profileDirtyRef:ref(true),dataDirtyRef:ref(false),viewConfigDirtyRef:ref(false),missingCurrentProjectRef:ref(false),
 modelRef:ref({root:{value:'old'},documentEtag:'etag-old'}),selectedPathRef:ref('data/a.json'),viewConfigRef:ref({fields:{}}),primaryKeySyncPlanRef:ref(null),autosaveInFlightRef:ref(false),savedDocumentRootRef:ref(null),commandSavingRef:ref(false),closingRef:ref(false),rebuildingRef:ref(false),restartingRef:ref(false),
 saveCoordinator:{markDirty:()=>{},flush:async()=>({outcome:'idle'})},flushActiveTextEditorDraft:()=>{},setProfileDirty:value=>state.dirty=value,setStatus:value=>state.status=value,setAutosaveState:value=>state.autosave=value,setSelectedViewProfileName:value=>state.selected=value,setDataDirty:()=>{},setViewConfigDirty:()=>{},
 resolvePrimaryKeySyncPlanForFlush:async()=>null,shouldInterceptPrimaryKeySyncPlan:()=>false,localProfileOptionValue:'__local__',
 saveViewProfile:(name,snapshot,projectId)=>{const g=gate();writes.push({name,snapshot,projectId,...g});return g.promise;},
 saveDocument:async()=>({documentEtag:'new'}),saveViewConfig:async()=>{},
 };vm.createContext(c);vm.runInContext(js,c);return {c,writes,state};}

test('an older profile acknowledgement cannot clear a newer revision and queued requests retain captured owner',async()=>{
 const {c,writes,state}=harness();const a=c.commitProfileSave('User',{sidebarWidth:210});await settle();c.markAutosaveDirty('profile');const b=c.commitProfileSave('User',{sidebarWidth:220});writes[0].resolve({});await a;assert.equal(state.dirty,true);await settle();assert.equal(writes[1].snapshot.sidebarWidth,220);assert.equal(writes[1].projectId,'p');writes[1].resolve({});await b;assert.equal(state.dirty,false);
});
test('failed direct profile writes retain dirty/error and retry can acknowledge the latest snapshot',async()=>{
 const {c,writes,state}=harness();const a=c.commitProfileSave('User',{sidebarWidth:210});await settle();writes[0].reject(new Error('disk denied'));await assert.rejects(a,/disk denied/);assert.equal(c.profileDirtyRef.current,true);assert.equal(state.autosave,'error');const retry=c.commitProfileSave('User',{sidebarWidth:230});await settle();writes[1].resolve({});await retry;assert.equal(state.dirty,false);
});
test('a late acknowledgement from another scope cannot change current dirty state',async()=>{
 const {c,writes,state}=harness();const a=c.commitProfileSave('User',{sidebarWidth:210});c.activeProjectIdRef.current='other';c.saveScopeEpochRef.current++;await settle();assert.equal(writes[0].projectId,'p');writes[0].resolve({});await a;assert.equal(state.dirty,true);
});
test('profile navigation preserves the current owner for blocked deferred or failed flushes',async()=>{
 for(const outcome of ['blocked-confirmation','deferred','error']){const {c,state}=harness();c.saveCoordinator.flush=async()=>({outcome});await c.handleSelectViewProfile('Other');assert.equal(state.selected,'User');assert.equal(c.selectedViewProfileNameRef.current,'User');}
});
test('navigation waits for direct profile promises and changes owner only after successful confirmation',async()=>{
 const {c,writes,state}=harness();const pending=c.commitProfileSave('User',{sidebarWidth:220});await settle();const change=c.handleSelectViewProfile('Other');await settle();assert.equal(state.selected,'User');writes[0].resolve({});await pending;await change;assert.equal(state.selected,'Other');assert.equal(c.saveScopeEpochRef.current,1);
});
test('document save snapshots and acknowledgements cannot consume an edit made during the request',async()=>{
 const {c}=harness();c.dataDirtyRef.current=true;const g=gate();let sent;c.saveDocument=async(_path,root)=>{sent=root;return g.promise;};const pending=c.flushAutosaveTargets('dirty',['document']);await settle();c.modelRef.current.root.value='new edit';c.markAutosaveDirty('document');assert.equal(sent.value,'old');g.resolve({documentEtag:'etag-new'});await pending;assert.equal(c.dataDirtyRef.current,true);assert.equal(c.savedDocumentRootRef.current.value,'old');assert.equal(c.modelRef.current.documentEtag,'etag-new');
});
test('project configuration save cannot clear a newer configuration edit',async()=>{
 const {c}=harness();c.viewConfigDirtyRef.current=true;const g=gate();c.saveViewConfig=()=>g.promise;const pending=c.flushAutosaveTargets('dirty',['project-config']);await settle();c.markAutosaveDirty('project-config');g.resolve({});await pending;assert.equal(c.viewConfigDirtyRef.current,true);
});

test('favorite icons use the dirty queue without an unhandled direct write',()=>{const {c,writes}=harness();let dirty=0;c.selectedViewProfileName='User';c.Set=Set;c.mutateSelectedViewProfile=fn=>{fn(c.selectedViewProfileRef.current);c.markAutosaveDirty('profile');dirty++;return c.selectedViewProfileRef.current;};c.handleToggleFavoriteSharedViewIcon('star');assert.equal(dirty,1);assert.equal(writes.length,0);assert.deepEqual(Array.from(c.selectedViewProfileRef.current.favoriteSharedViewIconIds),['star']);});

test('save failures identify the failed domain and preserve its dirty state',async()=>{for(const domain of ['document','project-config','profile']){const {c,writes,state}=harness();c.dataDirtyRef.current=domain==='document';c.viewConfigDirtyRef.current=domain==='project-config';c.profileDirtyRef.current=domain==='profile';c.saveDocument=async()=>{throw new Error('disk denied');};c.saveViewConfig=async()=>{throw new Error('disk denied');};const task=c.flushAutosaveTargets('flush',[domain]);if(domain==='profile'){await settle();writes[0].reject(new Error('disk denied'));}await assert.rejects(task,/disk denied/);assert.match(state.status,new RegExp((domain==='document'?'数据内容':domain==='profile'?'视图设置':'项目配置')+'保存失败'));assert.equal(c[domain==='document'?'dataDirtyRef':domain==='profile'?'profileDirtyRef':'viewConfigDirtyRef'].current,true);}});
