import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createPerfWorkspace,cleanupPerfWorkspace,findAvailablePort,findAvailableBridgePort,startOpenService,finalizeTempService,waitForHealth,withBrowserPage,perfFilePath} from './perf-helpers.mjs';
const workspace=await createPerfWorkspace();
const {projectRoot,registryHome}=workspace;
const port=await findAvailablePort(),bridgePort=await findAvailableBridgePort(port);
const output=path.resolve(process.argv[2]??'../load-path-profile.json');
try{
 await mkdir(path.join(projectRoot,'data/bulk'),{recursive:true});
 for(let i=0;i<249;i++)await writeFile(path.join(projectRoot,`data/bulk/file-${String(i).padStart(3,'0')}.json`),JSON.stringify([{id:'item-'+i,name:'Item '+i,description:'x'.repeat(60000)}]));
 await startOpenService({mode:'static',port,bridgePort,projectRoot,registryHome});
 const origin=`http://127.0.0.1:${port}`;await waitForHealth(origin+'/api/health');
 const registry=await(await fetch(origin+'/api/projects')).json();const projectId=registry.activeProjectId;
 const health=[],documents=[];
 for(let i=0;i<30;i++){
  let start=performance.now();const h=await fetch(origin+'/api/health');await h.text();health.push(performance.now()-start);
  start=performance.now();const d=await fetch(origin+`/api/document?projectId=${projectId}&path=${encodeURIComponent(perfFilePath)}`);assert.equal(d.status,200);await d.text();documents.push(performance.now()-start);
 }
 const browser=await withBrowserPage(origin,async page=>{
  const cold=[],warm=[],beforeFirst=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(let i=0;i<30;i++){
   // A cold sample gets a new browser context: storage, HTTP cache and page
   // state are not primed by an unmeasured navigation in this context.
   const context=await page.context().browser().newContext({baseURL:origin});
   const sample=await context.newPage();
   sample.on('pageerror',error=>errors.push(error.message));
   const requests=[];const record=request=>{if(request.url().includes('/api/document?'))requests.push(request.url());};sample.on('request',record);
   let start=performance.now();await sample.goto('/');await sample.locator('.data-table tbody tr[data-row-id]').first().waitFor();cold.push(performance.now()-start);beforeFirst.push(requests.length);sample.off('request',record);
   start=performance.now();await sample.reload();await sample.locator('.data-table tbody tr[data-row-id]').first().waitFor();warm.push(performance.now()-start);
   await context.close();
  }
  await page.goto('/');await page.locator('.data-table tbody tr[data-row-id]').first().waitFor();
  // A remembered deletion must not make a bad unrelated added file gate the
  // selected document. The synthetic old fingerprint deliberately has no match.
  const project=registry.projects.find(item=>item.id===projectId);
  const scope=JSON.stringify([projectId,project.root,project.dataSources,project.filePolicy]);
  const badFile='data/bulk/file-248.json';
  await writeFile(path.join(projectRoot,badFile),'{invalid json');
  await page.evaluate(scope=>localStorage.setItem('data-editor:__file-fingerprints:'+scope,JSON.stringify({version:1,files:{'data/removed.json':{size:10,modifiedAt:'',fingerprint:{extension:'.json',contentHash:'unknown',schemaSignature:'array'}}}})),scope);
  const failedRead=page.waitForResponse(response=>response.url().includes('/api/document?')&&response.url().includes('file-248.json')&&response.status()===500);
  const migrationStart=performance.now();await page.reload();await page.locator('.data-table tbody tr[data-row-id]').first().waitFor({timeout:10000});
  const openDuringMigrationMs=performance.now()-migrationStart;
  await failedRead;
  assert(await page.locator('.data-table tbody tr[data-row-id]').count()>0,'failed migration candidate cleared the current table');
  assert(await page.locator(`.sidebar-item[title="${perfFilePath}"]`).count()>0,'failed migration candidate cleared the file list');
  // Leaving a stalled document must let the next one open, without disconnect UI.
  await page.route('**/api/document?*path=*file-001.json*',()=>{});
  await page.locator('.sidebar-item[title="data/bulk/file-001.json"]').click();
  await page.locator(`.sidebar-item[title="${perfFilePath}"]`).click();
  await page.locator('.data-table tbody tr[data-row-id]').first().waitFor();
  assert.equal(await page.getByText('连接已断开',{exact:false}).count(),0);
  await page.unrouteAll({behavior:'ignoreErrors'});
  return {cold:summary(cold),warm:summary(warm),documentRequestsBeforeFirstFrame:summary(beforeFirst),openDuringFailedMigrationMs:+openDuringMigrationMs.toFixed(2),errors};
 });
 const result={fixture:{files:250,bytes:'approximately 15MB',generic:true,coldDefinition:'new browser context, unprimed app/storage/HTTP cache; running service',warmDefinition:'reload in the same context'},health:summary(health),documentHTTP:summary(documents),browser};
 await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await finalizeTempService({port,bridgePort,projectRoot,registryHome});await cleanupPerfWorkspace(projectRoot);}
function summary(values){const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,min:+sorted[0].toFixed(2),p50:+sorted[Math.floor(sorted.length*.5)].toFixed(2),p95:+sorted[Math.ceil(sorted.length*.95)-1].toFixed(2),max:+sorted.at(-1).toFixed(2)};}
