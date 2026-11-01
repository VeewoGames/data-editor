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



export async function loadSharedViews(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  const target = resolveInsideRoot(context.projectRoot, sharedViewsConfigPath);
  try {
    const parsed = JSON.parse(await readFile(target, "utf8"));
    return normalizeSharedViewsConfig(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return emptySharedViewsConfig();
    throw error;
  }
}

export async function saveSharedViews(projectContextOrRoot, config, options={}) {
 const context=createProjectContext(projectContextOrRoot);
 return withHistoricalConfigurationSave(context,{kind:'shared-views'},target=>withConfigWrite(target,options,()=>loadSharedViews(context),async()=>{
  await mkdir(path.dirname(target),{recursive:true});
  await atomicWrite(target,JSON.stringify(normalizeSharedViewsConfig(config),null,2)+'\n');
  return { path: displayProjectPath(context,target) };
 }));
}
