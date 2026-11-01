import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {withProjectProcessLock} from './project-process-lock.mjs';

// All writers of a configuration share this lock. Only automatic migrations
// request a preimage check; ordinary saves keep their existing replacement contract.
export function withConfigWrite(target,options,readCurrent,write){
 const identity=path.resolve(target).replaceAll('\\','/');
 const key='configuration:'+(process.platform==='win32'?identity.toLowerCase():identity);
 return withProjectProcessLock(key,async()=>{
  if(Object.hasOwn(options,'expected')&&!isDeepStrictEqual(JSON.parse(JSON.stringify(await readCurrent())),JSON.parse(JSON.stringify(options.expected)))){
   throw Object.assign(new Error('配置已在其他窗口发生变化，未执行自动路径迁移，请刷新。'),{code:'CONFIG_PREIMAGE_CHANGED',status:409});
  }
  return write();
 });
}
