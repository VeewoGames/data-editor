import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const app=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile);
async function invoke(module,env={}){
 const code=`try{const m=await import(${JSON.stringify(pathToFileURL(module).href)});console.log(JSON.stringify({directory:await m.resolveDeploymentAuthorityDirectory()}))}catch(e){console.log(JSON.stringify({code:e.code}))}`;
 return JSON.parse((await exec(process.execPath,['--input-type=module','-e',code],{windowsHide:true,env:{...process.env,...env}})).stdout);
}
test('native Known Folder ignores home, registry and cwd environment overrides',async()=>{
 const file=path.join(app,'src/deployment-authority-locator.mjs'),first=await invoke(file);
 assert.ok(path.isAbsolute(first.directory));
 const altered=await invoke(file,{LOCALAPPDATA:'Z:\\nonexistent',APPDATA:'Z:\\nonexistent',USERPROFILE:'Z:\\nonexistent',DATA_EDITOR_HOME:'Z:\\nonexistent',DATA_EDITOR_HISTORY_DEPLOYMENT_FILE:'Z:\\fake.json',DATA_EDITOR_AUTHORITY_DIR:'Z:\\fake'});
 assert.deepEqual(altered,first);
});
test('fixed native locator rejects source, executable and manifest drift',async t=>{
 const parent=path.join(app,'tests/.scratch');await mkdir(parent,{recursive:true});
 const root=await mkdtemp(path.join(parent,'locator-'));
 t.after(async()=>{assert.equal(path.dirname(root),parent);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:30});});
 await mkdir(path.join(root,'src'));await cp(path.join(app,'src/deployment-authority-locator.mjs'),path.join(root,'src/deployment-authority-locator.mjs'));
 await cp(path.join(app,'native/authority-locator'),path.join(root,'native/authority-locator'),{recursive:true});
 const module=path.join(root,'src/deployment-authority-locator.mjs');assert.ok((await invoke(module)).directory);
 for(const relative of ['AuthorityLocator.cs','bin/win32-x64/data-editor-authority-locator.exe','bin/win32-x64/authority-locator.manifest.json']){
  const file=path.join(root,'native/authority-locator',relative),original=await readFile(file);await writeFile(file,Buffer.concat([original,Buffer.from('x')]));
  assert.equal((await invoke(module)).code,'HISTORY_AUTHORITY_LOCATOR_UNVERIFIABLE');await writeFile(file,original);
 }
});
