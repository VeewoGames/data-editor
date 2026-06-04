import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

const sharedViewsConfigPath = ".data-editor/shared-views.json";

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

export async function saveSharedViews(projectContextOrRoot, config) {
  const context = createProjectContext(projectContextOrRoot);
  const target = resolveInsideRoot(context.projectRoot, sharedViewsConfigPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(normalizeSharedViewsConfig(config), null, 2)}\n`, "utf8");
  return { path: displayProjectPath(context, target) };
}
