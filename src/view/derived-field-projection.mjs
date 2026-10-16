const metadata = new WeakMap();
export function generatedFieldState(row, fieldName) { return metadata.get(row)?.[fieldName] ?? null; }
export function copyGeneratedMetadata(source, target) { const value = metadata.get(source); if (value) metadata.set(target, value); return target; }
/** @param {string} fieldName @param {import("./generated-fields-types").DerivedFieldProjectionContext} context */
export function isDerivedField(fieldName, context = {}) {
  return (context.generated?.fields ?? []).some((field) => field.name === fieldName) || Boolean(generatedFieldState(context.row, fieldName));
}
/** @param {string[]} fields @param {import("./generated-fields-types").DerivedFieldProjectionContext} context */
export function discoverProjectedFields(fields, context = {}) {
  return [...new Set([...(fields ?? []), ...(context.generated?.fields ?? []).map((field) => field.name)])];
}
/** @param {import("../model/documentModel").DataRecord} row @param {import("./generated-fields-types").DerivedFieldProjectionContext} context */
export function projectDerivedFields(row, context = {}) {
  if (!row || !context.generated?.fields?.length) return row;
  const copy = { ...row }; const states = Object.create(null);
  for (const binding of context.generated.bindings ?? []) {
    const result = binding.rows.find((candidate) => candidate.id === row[binding.identityField]);
    for (const field of binding.fields) {
      if (Object.hasOwn(row, field.name)) { states[field.name] = { ready: false, reason: "生成字段与源字段冲突" }; continue; }
      const ready = !context.dirty && binding.state === "ready" && result?.state === "ready" && typeof result.values?.[field.name] === "boolean";
      copy[field.name] = ready ? result.values[field.name] : null;
      states[field.name] = { ready, reason: context.dirty ? "保存后计算" : result?.reason ?? binding.reason ?? "尚未计算" };
    }
  }
  metadata.set(copy, states); return copy;
}
export function projectViewEngineRows(rows, context = {}) { return rows.map((entry) => ({ ...entry, row: projectDerivedFields(entry.row, context) })); }

/** Before the first declaration response, only absent-field Boolean rules are
 * unresolved. Existing ordinary fields (including null values) keep their
 * normal semantics; polling does not set this pending gate again.
 */
export function projectPendingGeneratedComparisons(rows, filters) {
  const fields = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.children)) { node.children.forEach(visit); return; }
    if ((node.operator === "is" || node.operator === "is_not") && typeof node.value === "boolean" && typeof node.field === "string"
      && !rows.some((entry) => Object.hasOwn(entry.row, node.field))) fields.add(node.field);
  };
  (filters?.topLevelRules ?? filters?.rules ?? []).forEach(visit); visit(filters?.advancedRoot);
  if (!fields.size) return rows;
  return rows.map((entry) => {
    const row = { ...entry.row };
    const states = { ...(metadata.get(entry.row) ?? {}) };
    for (const field of fields) states[field] = { ready: false, reason: "正在解析生成字段声明" };
    metadata.set(row, states);
    return { ...entry, row };
  });
}
