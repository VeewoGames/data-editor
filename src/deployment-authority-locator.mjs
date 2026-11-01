import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const base=path.resolve(import.meta.dirname,'../native/authority-locator');
const key=p=>p.replaceAll('\\','/').toLowerCase();
const hash=b=>createHash('sha256').update(b).digest('hex');
const bad=()=>{throw Object.assign(new Error('HISTORY_AUTHORITY_LOCATOR_UNVERIFIABLE'),{code:'HISTORY_AUTHORITY_LOCATOR_UNVERIFIABLE',status:409});};
let directoryPromise;
async function discover(){
 if(process.platform!=='win32'||process.arch!=='x64')bad();
 try{
  const source=path.join(base,'AuthorityLocator.cs'),exe=path.join(base,'bin/win32-x64/data-editor-authority-locator.exe'),manifest=path.join(base,'bin/win32-x64/authority-locator.manifest.json');
  for(const file of [source,exe,manifest])if(key(await realpath(file))!==key(file))bad();
  const m=JSON.parse((await readFile(manifest,'utf8')).replace(/^\uFEFF/,''));
  if(Object.keys(m).sort().join(',')!=='arch,executableSha256,platform,sourceSha256,version'||m.version!==1||m.platform!=='win32'||m.arch!=='x64'||hash(Buffer.from((await readFile(source,'utf8')).replaceAll('\r\n','\n')))!==m.sourceSha256||hash(await readFile(exe))!==m.executableSha256)bad();
  const {stdout}=await promisify(execFile)(exe,['--user-profile'],{windowsHide:true,timeout:5000,maxBuffer:16384});
  if(!stdout||stdout!==stdout.trim()||!path.isAbsolute(stdout))bad();
  const root=path.resolve(stdout);
  if(key(await realpath(root))!==key(root))bad();
  // Keep the product suffix uncanonicalized: the store rejects redirected
  // descendants before reads and again after every directory creation.
  return path.join(root,'.data-editor','deployment-authority');
 }catch{bad();}
}
export function resolveDeploymentAuthorityDirectory(){return directoryPromise??=(discover().catch(e=>{directoryPromise=null;throw e;}));}
