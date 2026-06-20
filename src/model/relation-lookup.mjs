import { getRows } from "../document-model.mjs";
import { buildRelationOptions } from "../relations.mjs";
import { buildRelationIndex } from "../validation.mjs";

/**
 * @param {{
 *   relations: Record<string, import("./viewConfig").RelationConfig>;
 *   activeFilePath?: string | null;
 *   activeModel?: import("./documentModel").DocumentModel | null;
 *   sourceFilePath?: string | null;
 *   sourceCollectionPath?: string | null;
 *   loadDocument: (path: string) => Promise<import("./documentModel").DocumentModel>;
 * }} input
 * @returns {Promise<{
 *   relationIndexes: Record<string, Set<string> | null>;
 *   relationOptions: Record<string, import("./relations").RelationOption[]>;
 * }>}
 */
export async function buildRelationLookupState({
  relations,
  activeFilePath = null,
  activeModel = null,
  sourceFilePath = null,
  sourceCollectionPath = null,
  loadDocument,
}) {
  const relationIndexes = {};
  const relationOptions = {};
  for (const [relationKey, target] of Object.entries(filterRelationsForSource(relations, sourceFilePath, sourceCollectionPath))) {
    try {
      const reference = activeFilePath && activeModel && target.targetFile === activeFilePath
        ? activeModel
        : await loadDocument(target.targetFile);
      const referenceRows = getRows(reference, target.targetCollection) ?? [];
      relationIndexes[relationKey] = buildRelationIndex(referenceRows, target.targetKey);
      relationOptions[relationKey] = buildRelationOptions(referenceRows, target.targetKey, target.titleFields);
      relationIndexes[target.targetKey] ??= relationIndexes[relationKey];
      relationOptions[target.targetKey] ??= relationOptions[relationKey];
    } catch {
      relationIndexes[relationKey] = null;
      relationOptions[relationKey] = [];
    }
  }
  return {
    relationIndexes,
    relationOptions,
  };
}

function filterRelationsForSource(relations, sourceFilePath, sourceCollectionPath) {
  if (!sourceFilePath || !sourceCollectionPath) return relations ?? {};
  const prefix = `${sourceFilePath}:${sourceCollectionPath}:`;
  return Object.fromEntries(
    Object.entries(relations ?? {}).filter(([relationKey]) => relationKey.startsWith(prefix)),
  );
}
