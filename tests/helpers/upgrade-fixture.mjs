import path from 'node:path';
import {cp,mkdir,readFile,writeFile,readdir,symlink,rm} from 'node:fs/promises';
import {createAuthorityFixture,digest,moduleUrl} from './authority-fixture.mjs';

export async function createUpgradeFixture(t,options={}){
 const f=await createAuthorityFixture(t,options);
 const bootstrap=path.join(f.directory,'bootstrap');await mkdir(bootstrap);
 for(const entry of await readdir(f.tool,{withFileTypes:true})){
  if(entry.name==='node_modules')continue;
  await cp(path.join(f.tool,entry.name),path.join(bootstrap,entry.name),{recursive:true});
 }
 await symlink(path.join(f.tool,'node_modules'),path.join(bootstrap,'node_modules'),'junction');
 await mkdir(path.join(f.tool,'dist'),{recursive:true});await mkdir(path.join(bootstrap,'dist'),{recursive:true});
 await writeFile(path.join(f.tool,'dist/index.html'),'<!doctype html><title>Before</title>');
 await writeFile(path.join(bootstrap,'dist/index.html'),'<!doctype html><title>After</title>');
 await writeFile(path.join(bootstrap,'server.mjs'),Buffer.concat([await readFile(path.join(bootstrap,'server.mjs')),Buffer.from('\n// fixture release after\n')]));
 const registryHome=path.join(f.directory,'service-registry');await mkdir(registryHome);
 await writeFile(path.join(registryHome,'projects.json'),JSON.stringify({version:2,activeProjectId:'fixture-0',projects:f.projects.map((p,i)=>({id:'fixture-'+i,name:'Fixture '+i,root:p.root,dataSources:[{id:'data',path:'data',kind:'relative'}],filePolicy:{includeExtensions:['.json','.csv']}}))}));
 const files=[];
 for(const relativePath of ['server.mjs','dist/index.html']){
  const before=await readFile(path.join(f.tool,relativePath)),after=await readFile(path.join(bootstrap,relativePath));
  files.push({relativePath,beforeDigest:digest(before),afterRef:{path:`objects/${digest(after)}.blob`,digest:digest(after)},mode:'replace',size:after.length});
 }
 const manifest={version:1,contract:'data-editor-release-manifest-v1',files,runtime:{registryHome,projectRoot:f.root,mainPort:43210,bridgePort:43211,readChecks:[{projectId:'fixture-0',sourcePath:'data/items.json'}]}};
 if(options.prepareBootstrap)await options.prepareBootstrap({f,bootstrap,manifest,registryHome});
 const store=await import(moduleUrl(bootstrap,'src/deployment-authority-store.mjs'));
 const prepare=()=>store.prepareAuthorityUpgrade({installedTool:f.tool,candidateTool:bootstrap,releaseManifest:manifest});
 return {...f,bootstrap,upgradeStore:store,releaseManifest:manifest,registryHome,prepareUpgrade:prepare};
}
