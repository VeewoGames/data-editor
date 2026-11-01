import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import {mkdir,mkdtemp,cp,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const app=path.resolve(import.meta.dirname,'../..');
export const normalize=file=>process.platform==='win32'?path.resolve(file).replaceAll('\\','/').toLowerCase():path.resolve(file);
export const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const oldRun='10000000-0000-4000-8000-000000000001';
export const childRun='10000000-0000-4000-8000-000000000002';
export const moduleUrl=(tool,file)=>pathToFileURL(path.join(tool,file)).href;
export const fixtureEnvironment=directory=>({...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DATA_EDITOR_'))),APPDATA:path.join(directory,'machine-home'),DATA_EDITOR_HOME:path.join(directory,'registry')});

// The only locator seam exists in disposable copies. No production module,
// project config, context, environment variable or real authority is selected.
async function copyTool(target,authority,nativeSuffix=null){
 await mkdir(target,{recursive:true});
 for(const name of ['src','scripts','native','server.mjs','open.mjs','stop.mjs','dev.mjs','recovery-bridge.mjs','package.json'])await cp(path.join(app,name),path.join(target,name),{recursive:true});
 const required=await import(moduleUrl(target,'src/historical-required-files.mjs'));
 for(const file of new Set([...required.managedHistoryRequiredDeploymentFiles,...required.upgradeHistoryRequiredDeploymentFiles,'package-lock.json'])){await mkdir(path.dirname(path.join(target,file)),{recursive:true});await cp(path.join(app,file),path.join(target,file));}
 await symlink(path.join(app,'node_modules'),path.join(target,'node_modules'),'junction');
 await mkdir(path.join(target,'config'));
 if(nativeSuffix){
  const file=path.join(target,'src/deployment-authority-locator.mjs'),source=await readFile(file,'utf8'),marker="path.join(root,'.data-editor','deployment-authority')";
  assert.equal(source.split(marker).length,2,'native fixture changes only the fixed product suffix');
  await writeFile(file,source.replace(marker,`path.join(root,${JSON.stringify(nativeSuffix)},'deployment-authority')`));
 }else await writeFile(path.join(target,'src/deployment-authority-locator.mjs'),`export function resolveDeploymentAuthorityDirectory(){return Promise.resolve(${JSON.stringify(authority)});}`);
}
async function writeJson(file,value){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value));}
async function policyFor(tool,files,businessFiles){return {contract:'managed-entry-non-replay-v1',businessFiles,deploymentFiles:await Promise.all(files.map(async file=>({path:file,digest:digest(await readFile(path.join(tool,file)))})))};}

export async function createAuthorityFixture(t,{installed=true,empty=false,rootCount=1,successor=false,seed=null,nativeLocator=false}={}){
 const scratch=path.join(app,'tests/.scratch');await mkdir(scratch,{recursive:true});
 const directory=await mkdtemp(path.join(scratch,'authority-')),tool=path.join(directory,'target'),sourceTool=path.join(directory,'source');
 let authority=path.join(directory,'authority'),nativeSuffix=null,nativeOwnedRoot=null,profile=null;
 if(nativeLocator){
  const exe=path.join(app,'native/authority-locator/bin/win32-x64/data-editor-authority-locator.exe');
  profile=(await promisify(execFile)(exe,['--user-profile'],{windowsHide:true})).stdout;
  assert.equal(profile,profile.trim());assert.ok(path.isAbsolute(profile));
  nativeSuffix='.data-editor-authority-fixture-'+crypto.randomUUID();nativeOwnedRoot=path.join(profile,nativeSuffix);authority=path.join(nativeOwnedRoot,'deployment-authority');
 }
 const cleanupCallbacks=[],cleanupState={directoryDeletionBlocked:false};
 t.after(async()=>{
  const errors=[];
  for(const cleanup of cleanupCallbacks.reverse())try{await cleanup();}catch(e){errors.push(e);if(cleanup.fixtureDeletionBarrier)cleanupState.directoryDeletionBlocked=true;}
  if(!cleanupState.directoryDeletionBlocked){
   try{if(nativeOwnedRoot){assert.equal(path.dirname(nativeOwnedRoot),profile);assert.ok(path.basename(nativeOwnedRoot).startsWith('.data-editor-authority-fixture-'));await rm(nativeOwnedRoot,{recursive:true,force:true,maxRetries:10,retryDelay:80});}}catch(e){errors.push(e);}
   try{assert.equal(path.dirname(directory),scratch);assert.ok(path.basename(directory).startsWith('authority-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:80});}catch(e){errors.push(e);}
  }
  if(errors.length)throw new AggregateError(errors,'authority fixture cleanup failed');
 });
 await copyTool(tool,authority,nativeSuffix);await copyTool(sourceTool,authority);
 const load=file=>import(moduleUrl(tool,file)),sourceLoad=file=>import(moduleUrl(sourceTool,file));
 const store=await load('src/deployment-authority-store.mjs');
 const required=await sourceLoad('src/historical-required-files.mjs');
 const proof=await sourceLoad('src/historical-proof.mjs'),scan=await sourceLoad('src/publication-window-obligations.mjs'),pub=await sourceLoad('src/publication-window-state.mjs');
 const projects=[],entries=[];
 for(let index=0;index<rootCount;index++){
  const root=path.join(directory,`project-${index}`),runtimeRoot=path.join(root,'.data-editor/runtime'),actions=path.join(runtimeRoot,'entry-actions'),anchorId=`fixture-anchor-${index}`;
  const context={projectRoot:root,projectId:`fixture-${index}`,runtimeDir:'.data-editor/runtime'};
  await mkdir(actions,{recursive:true});await mkdir(path.join(root,'data'));await mkdir(path.join(root,'docs'));
  const sourceFile=path.join(root,'data/items.json');
  await writeFile(sourceFile,JSON.stringify([{id:'one',draft:'original',description:'保留草稿',description_zh:'已验文案',count:1}]));
  await writeFile(path.join(root,'docs/approved.md'),'approved document');
  await writeJson(path.join(actions,oldRun+'.started.json'),{runId:oldRun});
  await writeJson(path.join(actions,childRun+'.started.json'),{runId:childRun,parentRunId:oldRun});
  await writeJson(path.join(runtimeRoot,'entry-action-group-journal/group.json'),{runId:oldRun,runIds:[oldRun,childRun],groupId:'group-a',stage:'unknown'});
  const binding={root:normalize(root),runtime:normalize(runtimeRoot),expectedAnchorId:anchorId,registration:path.join(root,'.data-editor/historical-disposition-registration.json'),directory:path.join(runtimeRoot,'entry-action-dispositions')};
  const registration={schemaVersion:1,anchorId,root:binding.root,runtime:binding.runtime};
  await writeJson(binding.registration,registration);await writeJson(path.join(binding.directory,'anchor.json'),registration);
  const project={root,context,runtimeRoot,actions,old:oldRun,child:childRun,sourceFile,binding};
  if(seed)await seed(project,{load:sourceLoad,digest});
  const policy=await policyFor(sourceTool,required.legacyHistoryRequiredDeploymentFiles,['data/items.json','docs/approved.md']);
  binding.policy=policy;
  const obligations=await scan.inventoryPublicationObligations(binding),snapshot=proof.obligationClosure(binding,await proof.historySnapshot(binding),obligations);
  const evidence={contract:policy.contract,root:binding.root,runtime:binding.runtime,anchorId,deploymentDigest:digest(JSON.stringify(policy)),snapshot,obligations,businessBaseline:await proof.businessSnapshot(binding,policy),externalRiskAcceptance:'same-account-direct-writers-unknown-programs-manual-restore-outside-guarantee'};
  const record={runId:snapshot.runIds[0],phase:'receipt',contract:policy.contract,dispositionId:crypto.randomUUID(),relatedRunIds:snapshot.runIds,evidenceDigest:digest(JSON.stringify(evidence)),evidence};
  const state={schemaVersion:1,anchorId,revision:2,records:{[record.runId]:record}};
  const ledgerFile=path.join(binding.directory,'state.json');await writeJson(ledgerFile,state);
  const publication=await pub.publicationBinding(context),publicationAnchorId=crypto.randomUUID();
  await writeJson(publication.anchor,{schemaVersion:1,anchorId:publicationAnchorId,binding:{root:publication.root,profile:publication.profile,contracts:publication.contracts,runtime:publication.runtime}});
  await writeJson(publication.file,{schemaVersion:1,anchorId:publicationAnchorId,generation:0,revision:1,state:'OPEN',windowId:null,publisher:null,accepted:{},continuations:{},package:[]});
  entries.push({projectRoot:binding.root,runtime:binding.runtime,anchorId,managedNonReplay:policy});
  projects.push({...project,record,state,ledgerFile,ledgerBytes:await readFile(ledgerFile),publicationFile:publication.file});
 }
 const sourceConfig=path.join(sourceTool,'config/historical-disposition-deployment.json');
 const originalConfig={version:1,entries};const originalBytes=Buffer.from(JSON.stringify(originalConfig));
 if(successor){
  await writeFile(path.join(sourceTool,'server.mjs'),Buffer.concat([await readFile(path.join(sourceTool,'server.mjs')),Buffer.from('\n// fixture historical successor release\n')]));
  const upgrade=await sourceLoad('src/historical-deployment-successor.mjs');
  for(let index=0;index<entries.length;index++){
   const entry=entries[index],project=projects[index],origin=entry.managedNonReplay,targetPolicy=await policyFor(sourceTool,required.legacyHistoryRequiredDeploymentFiles,origin.businessFiles);
   const sourceSnapshot=upgrade.artifactReference(originalBytes,'snapshot');
   const certificate={version:1,contract:'managed-deployment-successor-v1',root:entry.projectRoot,runtime:entry.runtime,anchorId:entry.anchorId,ledgerDigest:digest(project.ledgerBytes),receipts:[{runId:project.record.runId,recordDigest:digest(JSON.stringify(project.record)),evidenceDigest:project.record.evidenceDigest}],sourceSnapshot,sourcePolicyDigest:digest(JSON.stringify(origin)),targetPolicyDigest:digest(JSON.stringify(targetPolicy))};
   const certificateBytes=Buffer.from(JSON.stringify(certificate)),ref=upgrade.artifactReference(certificateBytes,'certificate');
   await mkdir(path.dirname(path.join(sourceTool,'config',ref.path)),{recursive:true});
   await writeFile(path.join(sourceTool,'config',sourceSnapshot.path),originalBytes);
   await writeFile(path.join(sourceTool,'config',ref.path),certificateBytes);
   entry.managedNonReplay=targetPolicy;entry.deploymentSuccessor=ref;
  }
 }
 await writeJson(sourceConfig,{version:1,entries});
 const f={onCleanup:callback=>cleanupCallbacks.push(callback),cleanupState,directory,tool,app:tool,sourceTool,authority,nativeOwnedRoot,profile,nativeSuffix,store,sourceConfig,config:sourceConfig,projects,load,sourceLoad,...projects[0]};
 f.prepare=project=>store.prepareAuthorityImport({sourceTool,projectRoot:(project??projects[0]).root});
 f.apply=bundle=>store.applyAuthorityImport(bundle);
 f.install=async()=>{for(const project of projects)await f.apply(await f.prepare(project));return f;};
 if(empty)await store.initializeEmptyAuthority();else if(installed)await f.install();
 f.mod=await load('src/historical-disposition.mjs');f.pub=await load('src/publication-window-state.mjs');f.runtime=await load('src/publication-window-runtime.mjs');f.scan=await load('src/publication-window-obligations.mjs');f.atomic=await load('src/atomic-file.mjs');
 f.inventory=()=>f.scan.scanPublicationObligations(f.binding);
 return f;
}

export async function invokeFixture(f,body,env={}){
 const prelude=`const app=${JSON.stringify(f.tool)},root=${JSON.stringify(f.root)},context=${JSON.stringify(f.context)};`;
 const code=prelude+`try{${body};process.stdout.write(JSON.stringify({ok:true}));}catch(e){process.stdout.write(JSON.stringify({code:e.code??e.message}));}`;
 return JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{windowsHide:true,env:{...fixtureEnvironment(f.directory),...env},maxBuffer:1024*1024})).stdout);
}
export async function assertFixtureLedgerUnchanged(f){for(const project of f.projects)assert.deepEqual(await readFile(project.ledgerFile),project.ledgerBytes);}
export async function assertMissing(file){await assert.rejects(access(file),{code:'ENOENT'});}
