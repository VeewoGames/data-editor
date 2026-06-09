import { getRows } from "../document-model.mjs";
import { findTargetRecord } from "./relation-maintenance.mjs";

/**
 * @param {{
 *   relationConfig: import("./viewConfig").RelationConfig;
 *   targetValue: string | number;
 *   activeFilePath: string | null;
 *   activeModel: import("./documentModel").DocumentModel | null;
 *   loadDocument: (path: string) => Promise<import("./documentModel").DocumentModel>;
 * }} input
 * @returns {Promise<{
 *   targetFile: string;
 *   targetCollection: string;
 *   rowIndex: number;
 *   rowId: string | null;
 * } | null>}
 */
export async function resolveRelationTargetSelection({
  relationConfig,
  targetValue,
  activeFilePath,
  activeModel,
  loadDocument,
}) {
  const targetDocument = (
    activeModel
    && activeFilePath
    && relationConfig.targetFile === activeFilePath
  )
    ? activeModel
    : await loadDocument(relationConfig.targetFile);
  const targetRows = getRows(targetDocument, relationConfig.targetCollection);
  const target = findTargetRecord(targetRows, relationConfig.targetKey, targetValue);
  if (!target) return null;
  return {
    targetFile: relationConfig.targetFile,
    targetCollection: relationConfig.targetCollection,
    rowIndex: target.rowIndex,
    rowId: target.rowId ?? null,
  };
}
