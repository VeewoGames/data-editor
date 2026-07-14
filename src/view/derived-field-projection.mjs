export const derivedFieldNames = Object.freeze([
  "@selection_type",
  "@selection_distance",
  "@selection_relations",
  "@area_shape",
  "@affects_relations",
  "@movement_mode",
]);

const removedTargetingDisplayFields = new Set([
  "range_type_show",
  "range_value_show",
]);

export const derivedFieldTypes = Object.freeze({
  "@selection_type": "Select",
  "@selection_distance": "Number",
  "@selection_relations": "Multi-select",
  "@area_shape": "Select",
  "@affects_relations": "Multi-select",
  "@movement_mode": "Multi-select",
});

export function shouldProjectSkillTargetingFields(sourcePath, collectionPath) {
  const normalizedPath = String(sourcePath ?? "").replaceAll("\\", "/").toLowerCase();
  return normalizedPath.endsWith("data/content/skills.json") && collectionPath === "skills";
}

export function isDerivedField(fieldName) {
  return derivedFieldNames.includes(fieldName);
}

export function discoverProjectedFields(fields, { sourcePath, collectionPath } = {}) {
  const baseFields = Array.isArray(fields) ? fields : [];
  if (!shouldProjectSkillTargetingFields(sourcePath, collectionPath)) return [...new Set(baseFields)];
  return [...new Set([
    ...baseFields.filter((fieldName) => !removedTargetingDisplayFields.has(fieldName)),
    ...derivedFieldNames,
  ])];
}

export function projectDerivedFields(row, { sourcePath, collectionPath } = {}) {
  if (!shouldProjectSkillTargetingFields(sourcePath, collectionPath) || !isPlainObject(row)) return row;
  const nodes = Array.isArray(row.nodes) ? row.nodes : [];
  const targetingNodes = [];
  const movementModes = [];
  walkNodes(nodes, (node) => {
    if (node.type === "targeting") targetingNodes.push(node);
    if (node.type === "movement" && typeof node.mode === "string" && node.mode) movementModes.push(node.mode);
  });
  const targeting = targetingNodes[0] ?? null;
  const selection = isPlainObject(targeting?.selection) ? targeting.selection : null;
  const area = isPlainObject(targeting?.area) ? targeting.area : null;
  const affects = effectiveAffects(targeting, selection);
  return {
    ...row,
    "@selection_type": stringOrNull(selection?.type),
    "@selection_distance": numberOrNull(selection?.distance),
    "@selection_relations": stringArray(selection?.relations),
    "@area_shape": stringOrNull(area?.shape),
    "@affects_relations": stringArray(affects?.relations),
    "@movement_mode": uniqueStrings(movementModes),
  };
}

function effectiveAffects(targeting, selection) {
  if (isPlainObject(targeting?.affects) && Object.keys(targeting.affects).length > 0) return targeting.affects;
  if (selection?.type !== "entity") return null;
  return {
    relations: stringArray(selection.relations),
    entity_types: stringArray(selection.entity_types),
  };
}

export function projectViewEngineRows(rows, context) {
  if (!shouldProjectSkillTargetingFields(context?.sourcePath, context?.collectionPath)) return rows;
  return rows.map((entry) => ({ ...entry, row: projectDerivedFields(entry.row, context) }));
}

function walkNodes(value, visit) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    visit(item);
    for (const child of Object.values(item)) {
      if (Array.isArray(child) && child.some((entry) => isPlainObject(entry) && typeof entry.type === "string")) {
        walkNodes(child, visit);
      }
    }
  }
}

function stringArray(value) {
  return Array.isArray(value) ? uniqueStrings(value) : [];
}

function uniqueStrings(value) {
  return [...new Set(value.filter((item) => typeof item === "string" && item.length > 0))];
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
