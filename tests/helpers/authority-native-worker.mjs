import path from 'node:path';
import os from 'node:os';
import {readFile,writeFile,realpath,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [specFile,output]=process.argv.slice(2),spec=JSON.parse(await readFile(specFile));
if(spec.operation==='hold-without-result')await new Promise(resolve=>setTimeout(resolve,300000));
const load=file=>import(pathToFileURL(path.join(spec.tool,file)).href),sha=b=>createHash('sha256').update(b).digest('hex');
let result={pid:process.pid,user:os.userInfo(),cwd:process.cwd(),operation:spec.operation};
try{
 const store=await load('src/deployment-authority-store.mjs'),locator=await load('src/deployment-authority-locator.mjs');
 result.directory=await locator.resolveDeploymentAuthorityDirectory();
 if(spec.operation==='lock'){
  await store.withAuthorityDeliveryLock(async()=>{result.acquired=true;});
 }else{
  if(spec.operation==='apply')result.apply=await store.applyAuthorityImport(JSON.parse(await readFile(spec.bundleFile)));
  const snapshot=await store.readAuthoritySnapshot(),entry=snapshot.entries[0];
  const history=await load('src/historical-disposition.mjs');let code=null;try{await history.assertHistoricalRunAllowed(spec.context,[spec.oldRun]);}catch(e){code=e.code;}
  if(code!=='HISTORY_RUN_CLOSED')throw Error('OLD_RUN_NOT_CLOSED');
  result.snapshot={generation:snapshot.catalog.generation,stamp:snapshot.stamp,physical:await realpath(snapshot.directory),objectCount:(await readdir(path.join(snapshot.directory,'objects'))).length,oldRunCode:code};
  result.catalogSha256=sha(await readFile(path.join(snapshot.directory,'catalog.v2.json')));
 }
 result.ok=true;
}catch(e){result={...result,ok:false,code:e.code??e.message};}
await writeFile(output,JSON.stringify(result,null,2)+'\n');
