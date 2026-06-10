function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function compareNodes(left, right) {
  return `${left.kind}:${left.label}`.localeCompare(`${right.kind}:${right.label}`, undefined, { numeric: true });
}

function emptyChildMapNode(node) {
  const { _childMap, ...rest } = node;
  return rest;
}

function findFirstFilePath(nodes) {
  for (const node of nodes ?? []) {
    if (node.kind === "file") return node.filePath;
    const nested = findFirstFilePath(node.children);
    if (nested) return nested;
  }
  return null;
}

function findAncestorIds(nodes, targetPath, ancestors = []) {
  for (const node of nodes ?? []) {
    if (node.kind === "file" && node.filePath === targetPath) return ancestors;
    const result = findAncestorIds(node.children, targetPath, node.kind === "file" ? ancestors : [...ancestors, node.id]);
    if (result) return result;
  }
  return null;
}

export function buildSidebarTreePreferences(value = {}) {
  const childOrderByParent = {};
  for (const [parentId, order] of Object.entries(value?.childOrderByParent ?? {})) {
    const normalizedParentId = String(parentId ?? "").trim();
    if (!normalizedParentId) continue;
    const normalizedOrder = normalizeStringArray(order);
    if (normalizedOrder.length) childOrderByParent[normalizedParentId] = normalizedOrder;
  }
  return {
    childOrderByParent,
    expandedNodeIds: normalizeStringArray(value?.expandedNodeIds),
  };
}

export function buildSidebarTree(files) {
  const sourceMap = new Map();
  for (const file of files ?? []) {
    const filePath = normalizePath(file?.path);
    if (!filePath) continue;
    const dataSourceId = String(file?.dataSourceId ?? "").trim() || "default";
    const dataSourceLabel = String(file?.dataSourceLabel ?? dataSourceId).trim() || dataSourceId;
    const sourceId = `source:${dataSourceId}`;
    let source = sourceMap.get(sourceId);
    if (!source) {
      source = {
        kind: "source",
        id: sourceId,
        label: dataSourceLabel,
        parentId: null,
        dataSourceId,
        children: [],
        _childMap: new Map(),
      };
      sourceMap.set(sourceId, source);
    }

    const displayPath = normalizePath(file?.displayPath ?? filePath);
    const parts = displayPath.split("/").filter(Boolean);
    const fileName = parts.at(-1) ?? filePath.split("/").at(-1) ?? filePath;
    let parent = source;
    let folderPath = "";
    for (const part of parts.slice(0, -1)) {
      folderPath = folderPath ? `${folderPath}/${part}` : part;
      const folderId = `folder:${dataSourceId}/${folderPath}`;
      let folder = parent._childMap.get(folderId);
      if (!folder) {
        folder = {
          kind: "folder",
          id: folderId,
          label: part,
          parentId: parent.id,
          dataSourceId,
          folderPath,
          children: [],
          _childMap: new Map(),
        };
        parent._childMap.set(folderId, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }

    parent.children.push({
      kind: "file",
      id: `file:${filePath}`,
      label: fileName,
      parentId: parent.id,
      dataSourceId,
      filePath,
      file,
    });
  }

  return [...sourceMap.values()].map(finalizeNode).sort(compareNodes);
}

function finalizeNode(node) {
  return {
    ...emptyChildMapNode(node),
    children: (node.children ?? []).map(finalizeNode).sort(compareNodes),
  };
}

export function applySidebarTreePreferences(tree, preferences) {
  const normalized = buildSidebarTreePreferences(preferences);
  return (tree ?? []).map((node) => applyNodePreferences(node, normalized.childOrderByParent));
}

function applyNodePreferences(node, childOrderByParent) {
  if (!node.children?.length) return node;
  const childMap = new Map(node.children.map((child) => [child.id, child]));
  const orderedIds = childOrderByParent[node.id] ?? [];
  const orderedChildren = [];
  const seen = new Set();

  for (const childId of orderedIds) {
    const child = childMap.get(childId);
    if (!child || seen.has(childId)) continue;
    seen.add(childId);
    orderedChildren.push(child);
  }
  for (const child of node.children) {
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    orderedChildren.push(child);
  }

  return {
    ...node,
    children: orderedChildren.map((child) => applyNodePreferences(child, childOrderByParent)),
  };
}

export function reorderSidebarSiblingIds(siblingIds, draggedId, targetId, placement = "before") {
  const normalizedSiblingIds = normalizeStringArray(siblingIds);
  if (!draggedId || !targetId || draggedId === targetId) return normalizedSiblingIds;
  const fromIndex = normalizedSiblingIds.indexOf(draggedId);
  const targetIndex = normalizedSiblingIds.indexOf(targetId);
  if (fromIndex === -1 || targetIndex === -1) return normalizedSiblingIds;

  const nextIds = [...normalizedSiblingIds];
  nextIds.splice(fromIndex, 1);
  const adjustedTargetIndex = nextIds.indexOf(targetId);
  const insertIndex = placement === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  nextIds.splice(insertIndex, 0, draggedId);
  return nextIds;
}

export function findSidebarNodeAncestorIds(tree, filePath) {
  return findAncestorIds(tree ?? [], normalizePath(filePath)) ?? [];
}

export function findSidebarFallbackFilePath(tree, currentPath) {
  const normalizedCurrentPath = normalizePath(currentPath);
  if (normalizedCurrentPath && findAncestorIds(tree ?? [], normalizedCurrentPath) != null) {
    return normalizedCurrentPath;
  }
  return findFirstFilePath(tree ?? []);
}
