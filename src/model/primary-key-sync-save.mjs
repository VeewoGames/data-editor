import { buildDocumentModel, getRows } from "../document-model.mjs";

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function cloneDataRoot(value) {
  return value == null ? value : structuredClone(value);
}

/**
 * @param {import("./relationMaintenance").PrimaryKeySyncPlan} plan
 * @returns {string}
 */
export function describePrimaryKeySyncBlockingIssues(plan) {
  return plan.blockingIssues.map((issue) => {
    if (issue === "unchanged-primary-key") return "主键值没有发生变化。";
    if (issue === "empty-primary-key") return "新主键不能为空。";
    if (issue === "duplicate-primary-key") return "新主键与当前集合中的已有主键冲突。";
    if (issue === "source-document-load-failed") return "存在来源文件读取失败，当前不能执行同步保存。";
    if (issue === "invalid-relation-config") return "存在损坏的 relation 配置，当前不能执行同步保存。";
    return issue;
  }).join(" ");
}

/**
 * @param {import("../api/client").SaveDocumentsResult} result
 * @returns {string}
 */
export function describePrimaryKeySyncSaveResult(result) {
  if (result.ok) return `已同步保存 ${result.savedPaths.length} 个文件。`;
  const saved = result.savedPaths.length ? `已成功：${result.savedPaths.join("、")}。` : "尚未成功写入任何文件。";
  const failed = result.failedPath ? `失败文件：${result.failedPath}。` : "";
  const reason = result.errorMessage ? `原因：${result.errorMessage}` : "";
  return `${saved}${failed}${reason} 当前磁盘状态可能已部分更新。`;
}

/**
 * @param {{
 *   plan: import("./relationMaintenance").PrimaryKeySyncPlan;
 *   currentModel: import("./documentModel").DocumentModel;
 *   currentPath: string;
 *   loadDocument: (path: string) => Promise<import("./documentModel").DocumentModel>;
 * }} input
 * @returns {Promise<{
 *   plan: import("./relationMaintenance").PrimaryKeySyncPlan;
 *   pendingSaves: import("../api/client").PendingDocumentSave[];
 * }>}
 */
export async function buildPrimaryKeySyncSaveSnapshot({
  plan,
  currentModel,
  currentPath,
  loadDocument,
}) {
  /** @type {Map<string, { root: unknown; format: import("./documentModel").DocumentModel["format"] }>} */
  const rootsByPath = new Map([
    [currentPath, { root: cloneDataRoot(currentModel.root), format: currentModel.format }],
  ]);

  for (const sourceFile of plan.sourceFiles) {
    if (rootsByPath.has(sourceFile)) continue;
    const documentModel = await loadDocument(sourceFile);
    rootsByPath.set(sourceFile, {
      root: cloneDataRoot(documentModel.root),
      format: documentModel.format,
    });
  }

  for (const rewrite of plan.rewrites) {
    const sourceSnapshot = rootsByPath.get(rewrite.sourceFile);
    if (!sourceSnapshot) throw new Error(`无法加载来源文件：${rewrite.sourceFile}`);
    if (rewrite.fieldPath.length !== 1) continue;
    const sourceModel = buildDocumentModel(sourceSnapshot.root, sourceSnapshot.format, rewrite.sourceFile);
    const rows = getRows(sourceModel, rewrite.sourceCollection);
    const row = rows[rewrite.rowIndex];
    if (row) row[rewrite.fieldPath[0]] = rewrite.newValue;
  }

  /** @type {import("../api/client").PendingDocumentSave[]} */
  const pendingSaves = [{ path: currentPath, root: rootsByPath.get(currentPath)?.root ?? null }];
  for (const sourceFile of plan.sourceFiles) {
    if (sourceFile === currentPath) continue;
    const sourceSnapshot = rootsByPath.get(sourceFile);
    if (!sourceSnapshot) throw new Error(`无法加载来源文件：${sourceFile}`);
    pendingSaves.push({ path: sourceFile, root: sourceSnapshot.root });
  }
  return { plan, pendingSaves };
}
