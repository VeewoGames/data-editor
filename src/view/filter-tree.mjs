export function createAdvancedRoot() {
  return {
    kind: "group",
    id: "advanced-root",
    op: "and",
    children: [],
  };
}

export function mergeTopLevelRuleIntoAdvancedRoot(filters, ruleId) {
  const topLevelRules = topLevelRulesOf(filters);
  const rule = topLevelRules.find((item) => item.id === ruleId);
  if (!rule) return filters;
  const advancedRoot = filters?.advancedRoot ?? createAdvancedRoot();
  return {
    topLevelRules: topLevelRules.filter((item) => item.id !== ruleId),
    advancedRoot: {
      ...advancedRoot,
      children: [...advancedRoot.children, rule],
    },
  };
}

export function duplicateNodeInAdvancedRoot(filters, nodeId) {
  const usedIds = collectAllFilterNodeIds(filters);
  return {
    topLevelRules: topLevelRulesOf(filters),
    advancedRoot: pruneEmptyGroups(updateGroupNode(filters?.advancedRoot, nodeId, usedIds)),
  };
}

export function canCreateChildGroup(filters, groupId) {
  return getGroupDepth(filters?.advancedRoot, groupId, 1) < 3;
}

export function addRuleToGroup(filters, groupId, rule) {
  return {
    topLevelRules: topLevelRulesOf(filters),
    advancedRoot: appendNodeToGroup(filters?.advancedRoot, groupId, rule),
  };
}

export function addGroupToGroup(filters, groupId, group) {
  return {
    topLevelRules: topLevelRulesOf(filters),
    advancedRoot: appendNodeToGroup(filters?.advancedRoot, groupId, group),
  };
}

export function updateGroupOp(filters, groupId, op) {
  return {
    topLevelRules: topLevelRulesOf(filters),
    advancedRoot: updateGroupOpInTree(filters?.advancedRoot, groupId, op),
  };
}

export function convertRuleToGroup(filters, ruleId) {
  const usedIds = collectAllFilterNodeIds(filters);
  return {
    topLevelRules: topLevelRulesOf(filters),
    advancedRoot: convertRuleNodeToGroup(filters?.advancedRoot, ruleId, usedIds),
  };
}

export function replaceNodeInFilters(filters, nextNode) {
  const topLevelRules = topLevelRulesOf(filters);
  if (topLevelRules.some((rule) => rule?.id === nextNode?.id)) {
    return {
      topLevelRules: topLevelRules.map((rule) => rule?.id === nextNode.id ? nextNode : rule),
      advancedRoot: filters?.advancedRoot ?? null,
    };
  }
  return {
    topLevelRules,
    advancedRoot: pruneEmptyGroups(replaceNodeInGroup(filters?.advancedRoot, nextNode)),
  };
}

export function removeNodeFromFilters(filters, nodeId) {
  const topLevelRules = topLevelRulesOf(filters);
  if (topLevelRules.some((rule) => rule?.id === nodeId)) {
    return {
      topLevelRules: topLevelRules.filter((rule) => rule?.id !== nodeId),
      advancedRoot: filters?.advancedRoot ?? null,
    };
  }
  return {
    topLevelRules,
    advancedRoot: pruneEmptyGroups(removeNodeFromGroup(filters?.advancedRoot, nodeId)),
  };
}

function topLevelRulesOf(filters) {
  if (Array.isArray(filters?.topLevelRules)) return filters.topLevelRules;
  if (Array.isArray(filters?.rules)) return filters.rules;
  return [];
}

function updateGroupNode(group, nodeId, usedIds) {
  if (!group || typeof group !== "object") return group ?? null;
  const children = Array.isArray(group.children) ? group.children : [];
  let changed = false;
  const nextChildren = [];
  for (const child of children) {
    if (child?.id === nodeId) {
      nextChildren.push(child);
      nextChildren.push(cloneNodeWithFreshIds(child, usedIds));
      changed = true;
      continue;
    }
    if (child?.kind === "group") {
      const nextChild = updateGroupNode(child, nodeId, usedIds);
      if (nextChild !== child) changed = true;
      nextChildren.push(nextChild);
      continue;
    }
    nextChildren.push(child);
  }
  if (!changed) return group;
  return {
    ...group,
    children: nextChildren,
  };
}

function appendNodeToGroup(group, groupId, node) {
  if (!group || typeof group !== "object") return group ?? null;
  if (group.id === groupId) {
    return {
      ...group,
      children: [...(Array.isArray(group.children) ? group.children : []), node],
    };
  }
  let changed = false;
  const nextChildren = (group.children ?? []).map((child) => {
    if (child?.kind !== "group") return child;
    const nextChild = appendNodeToGroup(child, groupId, node);
    if (nextChild !== child) changed = true;
    return nextChild;
  });
  if (!changed) return group;
  return {
    ...group,
    children: nextChildren,
  };
}

function updateGroupOpInTree(group, groupId, op) {
  if (!group || typeof group !== "object") return group ?? null;
  if (group.id === groupId) {
    return {
      ...group,
      op,
    };
  }
  let changed = false;
  const nextChildren = (group.children ?? []).map((child) => {
    if (child?.kind !== "group") return child;
    const nextChild = updateGroupOpInTree(child, groupId, op);
    if (nextChild !== child) changed = true;
    return nextChild;
  });
  if (!changed) return group;
  return {
    ...group,
    children: nextChildren,
  };
}

function convertRuleNodeToGroup(group, ruleId, usedIds) {
  if (!group || typeof group !== "object") return group ?? null;
  let changed = false;
  const nextChildren = (group.children ?? []).map((child) => {
    if (child?.id === ruleId && child?.kind === "rule") {
      changed = true;
      return {
        kind: "group",
        id: uniqueGroupId(usedIds),
        op: group.op ?? "and",
        children: [child],
      };
    }
    if (child?.kind !== "group") return child;
    const nextChild = convertRuleNodeToGroup(child, ruleId, usedIds);
    if (nextChild !== child) changed = true;
    return nextChild;
  });
  if (!changed) return group;
  return {
    ...group,
    children: nextChildren,
  };
}

function replaceNodeInGroup(group, nextNode) {
  if (!group || typeof group !== "object") return group ?? null;
  if (group.id === nextNode?.id && nextNode?.kind === "group") return nextNode;
  let changed = false;
  const nextChildren = (group.children ?? []).map((child) => {
    if (child?.id === nextNode?.id) {
      changed = true;
      return nextNode;
    }
    if (child?.kind !== "group") return child;
    const nextChild = replaceNodeInGroup(child, nextNode);
    if (nextChild !== child) changed = true;
    return nextChild;
  });
  if (!changed) return group;
  return {
    ...group,
    children: nextChildren,
  };
}

function removeNodeFromGroup(group, nodeId) {
  if (!group || typeof group !== "object") return group ?? null;
  let changed = false;
  const nextChildren = [];
  for (const child of group.children ?? []) {
    if (child?.id === nodeId) {
      changed = true;
      continue;
    }
    if (child?.kind === "group") {
      const nextChild = removeNodeFromGroup(child, nodeId);
      if (nextChild !== child) changed = true;
      nextChildren.push(nextChild);
      continue;
    }
    nextChildren.push(child);
  }
  if (!changed) return group;
  return {
    ...group,
    children: nextChildren,
  };
}

function cloneNodeWithFreshIds(node, usedIds) {
  const nextId = uniqueCopyId(node.id, usedIds);
  if (node?.kind === "group") {
    return {
      ...node,
      id: nextId,
      children: (node.children ?? []).map((child) => cloneNodeWithFreshIds(child, usedIds)),
    };
  }
  return {
    ...node,
    id: nextId,
  };
}

function uniqueCopyId(baseId, usedIds) {
  let candidate = `${baseId}:copy`;
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = `${baseId}:copy:${index}`;
    index += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

export function collectAllFilterNodeIds(filters) {
  const ids = new Set();
  for (const rule of filters?.topLevelRules ?? []) {
    if (rule?.id) ids.add(rule.id);
  }
  collectGroupIds(filters?.advancedRoot, ids);
  return ids;
}

function uniqueGroupId(usedIds) {
  let candidate = "group:1";
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = `group:${index}`;
    index += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function collectGroupIds(group, ids) {
  if (!group || typeof group !== "object") return;
  if (group.id) ids.add(group.id);
  for (const child of group.children ?? []) {
    if (child?.kind === "group") collectGroupIds(child, ids);
    else if (child?.id) ids.add(child.id);
  }
}

function getGroupDepth(group, groupId, depth) {
  if (!group || typeof group !== "object") return 0;
  if (group.id === groupId) return depth;
  for (const child of group.children ?? []) {
    if (child?.kind !== "group") continue;
    const result = getGroupDepth(child, groupId, depth + 1);
    if (result) return result;
  }
  return 0;
}

function pruneEmptyGroups(group, isRoot = true) {
  if (!group || typeof group !== "object") return group ?? null;
  const nextChildren = (group.children ?? [])
    .map((child) => child?.kind === "group" ? pruneEmptyGroups(child, false) : child)
    .filter(Boolean);
  if (nextChildren.length === 0) return isRoot ? null : null;
  return {
    ...group,
    children: nextChildren,
  };
}
