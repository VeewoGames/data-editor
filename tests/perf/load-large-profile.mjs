import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createPerfWorkspace,cleanupPerfWorkspace,findAvailablePort,findAvailableBridgePort,startOpenService,finalizeTempService,waitForHealth,withBrowserPage,perfFilePath} from './perf-helpers.mjs';

const workspace=await createPerfWorkspace();
const {projectRoot,registryHome}=workspace;
const port=await findAvailablePort(),bridgePort=await findAvailableBridgePort(port);
const files=[];
try{
 const rows=Array.from({length:100000},(_,i)=>({id:`large-${i}`,name:`Large record ${i}`,description:'x'.repeat(132)}));
 const forms=[['array.json',JSON.stringify(rows)],['map.json',JSON.stringify(Object.fromEntries(rows.slice(0,75000).map(row=>[row.id,row])))],['nested.json',JSON.stringify({records:rows})],['records.csv','id,name,description\n'+rows.map(row=>`${row.id},${row.name},${row.description}`).join('\n')]];
 for(const [name,text] of forms){const bytes=Buffer.byteLength(text);assert(bytes<=20*1024*1024);const file=`data/${name}`;await writeFile(path.join(projectRoot,file),text);files.push({file,bytes});}
 await startOpenService({mode:'static',port,bridgePort,projectRoot,registryHome});
 const origin=`http://127.0.0.1:${port}`;await waitForHealth(origin+'/api/health');
 const measurements=await withBrowserPage(origin,async page=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.locator('.data-table tbody tr[data-row-id]').first().waitFor();
  await page.evaluate(()=>{window.__loadLongTasks=[];new PerformanceObserver(list=>window.__loadLongTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});});
  const result=[];
  for(const fixture of files){
   const samples=[];
   for(let i=0;i<3;i++){
    await page.locator(`.sidebar-item[title="${perfFilePath}"]`).click();
    await page.locator('.data-table tbody tr[data-row-id]').filter({hasText:'Record 1'}).first().waitFor();
    await page.evaluate(()=>{window.__loadLongTasks=[];});
    const start=performance.now();
    await page.locator(`.sidebar-item[title="${fixture.file}"]`).click();
    await page.locator('.data-table tbody tr[data-row-id]').filter({hasText:'Large record 0'}).first().waitFor({timeout:15000});
    const openMs=performance.now()-start;
    const state=await page.evaluate(()=>({longTasks:window.__loadLongTasks,renderedRows:document.querySelectorAll('.data-table tbody tr[data-row-id]').length}));
    assert(state.renderedRows<500,'large collection must stay virtualized');
    samples.push({openMs:+openMs.toFixed(2),...state});
   }
   result.push({...fixture,samples});
  }
  assert.deepEqual(errors,[]);
  return {result,errors};
 });
 const output=path.resolve(process.argv[2]??'../load-large-profile.json');
 await writeFile(output,JSON.stringify(measurements,null,2));console.log(JSON.stringify(measurements));
}finally{await finalizeTempService({port,bridgePort,projectRoot,registryHome});await cleanupPerfWorkspace(projectRoot);}
