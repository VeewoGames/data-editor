import {isDeepStrictEqual} from 'node:util';
import {withProjectProcessLock} from './project-process-lock.mjs';
import {configurationIdentity,physicalConfigurationPath,readConfigurationVersion} from './configuration-version.mjs';

export async function withConfigurationTargetLock(target,operation){
 const identity=configurationIdentity(await physicalConfigurationPath(target));
 if(identity!==configurationIdentity(target))throw Object.assign(new Error('配置路径别名不可写入。'),{code:'CONFIG_ALIAS_REJECTED',status:409});
 const key='configuration:'+identity;
 return withProjectProcessLock(key,async()=>{
  if(configurationIdentity(await physicalConfigurationPath(target))!==identity)throw Object.assign(new Error('配置物理路径已变化。'),{code:'CONFIG_RESOURCE_CHANGED',status:409});
  return operation();
 });
}

// Both ordinary raw-version saves and internal normalized-preimage migrations
// compare inside the same physical target lock; neither can skip attempt guards.
export function withConfigWrite(target,options,readCurrent,write){
 return withConfigurationTargetLock(target,async()=>{
  await options.validateAttempt?.();
  if(Object.hasOwn(options,'expectedVersion')&&!isDeepStrictEqual(await readConfigurationVersion(target),options.expectedVersion)){
   throw Object.assign(new Error('配置已在其他窗口发生变化，改动已保留。'),{code:'CONFIG_VERSION_CHANGED',status:409});
  }
  if(Object.hasOwn(options,'expected')&&!isDeepStrictEqual(JSON.parse(JSON.stringify(await readCurrent())),JSON.parse(JSON.stringify(options.expected)))){
   throw Object.assign(new Error('配置已在其他窗口发生变化，未执行自动路径迁移，请刷新。'),{code:'CONFIG_PREIMAGE_CHANGED',status:409});
  }
  return write();
 });
}
