export function resolveChargeDerivedState(contract, skill) {
  if (!isPlainObject(contract) || !isPlainObject(skill)) return null;
  const chargeNode = collectSkillNodes(contract, skill.nodes)
    .find((entry) => entry.node?.type === "movement" && entry.node?.mode === "charge");
  if (!chargeNode) return null;

  const rule = contract.runtime_rules?.movement?.derived_rules?.charge;
  if (!isPlainObject(rule)) return null;
  const targetingEntry = collectSkillNodes(contract, skill.nodes)
    .find((entry) => entry.node?.type === "targeting");
  const targeting = targetingEntry?.node ?? null;
  const selection = isPlainObject(targeting?.selection) ? targeting.selection : null;
  return { chargeNode, rule, targetingEntry, targeting, selection };
}

export function buildChargeDerivedSummary(contract, skill) {
  const state = resolveChargeDerivedState(contract, skill);
  if (!state) return [];
  return [
    { label: "选取形状", value: formatPattern(state.rule.pattern) },
    { label: "允许方向", value: formatDirections(state.rule.directions) },
    { label: "路径规则", value: formatPath(state.rule.path) },
    { label: "目标规则", value: formatTargetRule(state.rule) },
  ];
}

export function validateSkillNodeDerivedRuleConflicts(contract, documentRoot) {
  if (!isPlainObject(documentRoot) || !Array.isArray(documentRoot.skills)) return { ok: true, issues: [] };
  const issues = documentRoot.skills.flatMap((skill, skillIndex) => (
    validateChargeSkill(contract, skill, `skills[${skillIndex}]`)
  ));
  return { ok: issues.length === 0, issues };
}

function validateChargeSkill(contract, skill, skillPath) {
  const state = resolveChargeDerivedState(contract, skill);
  if (!state) return [];
  const skillId = typeof skill.skill_id === "string" && skill.skill_id ? skill.skill_id : skillPath;
  const issues = [];
  const selectionPath = state.targetingEntry ? `${skillPath}.${state.targetingEntry.path}.selection` : `${skillPath}.nodes.targeting.selection`;

  if (!state.selection) {
    issues.push(issue(skillId, selectionPath, "冲锋必须配置 targeting.selection。"));
    return issues;
  }
  if (state.selection.type !== state.rule.selection_type) {
    issues.push(issue(skillId, `${selectionPath}.type`, `冲锋的目标类型由合同派生为 ${String(state.rule.selection_type)}，不能显式改为 ${String(state.selection.type ?? "空")}。`));
  }
  for (const fieldName of state.rule.forbid ?? []) {
    if (Object.hasOwn(state.selection, fieldName)) {
      issues.push(issue(skillId, `${selectionPath}.${fieldName}`, `冲锋的 ${fieldName} 由共享合同派生，必须删除技能中的显式配置。`));
    }
  }
  if (!Number.isInteger(state.selection.distance) || state.selection.distance < Number(state.rule.min_distance ?? 0)) {
    issues.push(issue(skillId, `${selectionPath}.distance`, `冲锋距离必须通过 selection.distance 配置，且不得小于 ${String(state.rule.min_distance ?? 0)}。`));
  }
  if (!Array.isArray(state.selection.relations) || state.selection.relations.length === 0) {
    issues.push(issue(skillId, `${selectionPath}.relations`, "冲锋必须通过 selection.relations 配置可选目标关系。"));
  } else {
    for (const relation of state.rule.forbidden_relations ?? []) {
      if (state.selection.relations.includes(relation)) {
        issues.push(issue(skillId, `${selectionPath}.relations`, `冲锋不允许选择关系 ${String(relation)}。`));
      }
    }
  }

  const validFields = new Set(contract.runtime_rules?.movement?.valid_fields?.charge ?? ["mode"]);
  for (const fieldName of Object.keys(state.chargeNode.node)) {
    if (fieldName === "type" || validFields.has(fieldName)) continue;
    issues.push(issue(
      skillId,
      `${skillPath}.${state.chargeNode.path}.${fieldName}`,
      `冲锋节点不允许配置 ${fieldName}；距离统一读取 targeting.selection.distance。`,
    ));
  }
  return issues;
}

function collectSkillNodes(contract, nodes, parentPath = "nodes") {
  if (!Array.isArray(nodes)) return [];
  const entries = [];
  nodes.forEach((node, index) => {
    if (!isPlainObject(node)) return;
    const path = `${parentPath}[${index}]`;
    entries.push({ node, path });
    const nodeContract = contract.nodes?.[node.type];
    for (const field of nodeContract?.fields ?? []) {
      if (field?.type === "array" && field.items?.type === "node") {
        entries.push(...collectSkillNodes(contract, node[field.name], `${path}.${field.name}`));
      }
    }
  });
  return entries;
}

function issue(skillId, fieldPath, message) {
  return { code: "SKILL_NODE_CHARGE_DERIVED_FIELD_CONFLICT", skillId, fieldPath, message };
}

function formatPattern(pattern) {
  return pattern === "cardinal" ? "四方向直线" : String(pattern ?? "未定义");
}

function formatDirections(directions) {
  const labels = { up: "上", right: "右", down: "下", left: "左" };
  return Array.isArray(directions) ? directions.map((direction) => labels[direction] ?? direction).join(" / ") : "未定义";
}

function formatPath(path) {
  return path === "straight_passable" ? "直线且路径可通行" : String(path ?? "未定义");
}

function formatTargetRule(rule) {
  const target = rule.target === "primary" ? "主目标" : String(rule.target ?? "目标");
  if (rule.min_targets === 1 && rule.max_targets === 1) return `单个${target}`;
  return `${String(rule.min_targets ?? 0)}-${String(rule.max_targets ?? "不限")} 个${target}`;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
