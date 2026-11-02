import {readConfigurationSnapshot,verifyConfigurationWrite} from './configuration-version.mjs';
import {sharedViewsConfigPath} from './project-context.mjs';
import {withHistoricalConfigurationSave} from './historical-disposition.mjs';
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {atomicWrite} from './atomic-file.mjs';
import {withConfigWrite} from './config-write-precondition.mjs';
import { createProjectContext, displayProjectPath, resolveInsideRoot } from "./project-context.mjs";
export {
  emptySharedViewDraftState,
  emptySharedViewsConfig,
  normalizeCollectionView,
  normalizeCollectionViewDraft,
  normalizeSharedViewDraftState,
  normalizeSharedViewsConfig,
} from "./view/shared-view-normalize.mjs";
import {
  emptySharedViewsConfig,
  normalizeSharedViewsConfig,
} from "./view/shared-view-normalize.mjs";



export async function loadSharedViewsSnapshot(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  const target = resolveInsideRoot(context.projectRoot, sharedViewsConfigPath);
  return readConfigurationSnapshot(target, normalizeSharedViewsConfig, emptySharedViewsConfig);
}

export async function loadSharedViews(projectContextOrRoot) {
  return (await loadSharedViewsSnapshot(projectContextOrRoot)).value;
}

export async function saveSharedViews(projectContextOrRoot, config, options={}) {
 const context=createProjectContext(projectContextOrRoot);
 return withHistoricalConfigurationSave(context,{kind:'shared-views'},target=>withConfigWrite(target,options,()=>loadSharedViews(context),async()=>{
  await mkdir(path.dirname(target),{recursive:true});
  const text=JSON.stringify(normalizeSharedViewsConfig(config),null,2)+'\n';
  await atomicWrite(target,text);
  const configuration=await verifyConfigurationWrite(target,text,normalizeSharedViewsConfig,emptySharedViewsConfig);
  return { path: displayProjectPath(context,target), configuration };
 }));
}
