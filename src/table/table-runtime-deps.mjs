import { resolveFieldRole } from "../model/field-role.mjs";
import { resolveCompatibleDisplayType } from "../model/fieldTypes.mjs";
import { buildMultiSelectFieldConfigFromRows } from "../multiselect-config.mjs";

/**
 * @param {{
 *   visibleFields: string[];
 *   rows: Record<string, unknown>[];
 *   optionRows?: Record<string, unknown>[];
 *   sourcePath: string | null;
 *   collectionPath: string;
 *   primaryKeyField?: string | null;
 *   displayTypes: Record<string, import("../model/fieldTypes.mjs").FieldDisplayType>;
 *   fieldViewConfigs: Record<string, import("../model/viewConfig").FieldViewConfig>;
 *   relationConfigs: Record<string, import("../model/viewConfig").RelationConfig>;
 *   relationOptions: Record<string, import("../model/relations").RelationOption[]>;
 *   documentIndexEntries?: Record<string, import("../api/client").DocumentIndexEntry>;
 * }} input
 */
export function buildTableRuntimeDeps({
  visibleFields,
  rows,
  optionRows = rows,
  sourcePath,
  collectionPath,
  primaryKeyField = null,
  displayTypes,
  fieldViewConfigs,
  relationConfigs,
  relationOptions,
  documentIndexEntries = {},
}) {
  /** @type {Record<string, { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> }>} */
  const fieldOptions = {};
  /** @type {Record<string, { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> }>} */
  const selectOptions = {};
  /** @type {Record<string, import("../model/relations").RelationOption[]>} */
  const relationOptionsByField = {};
  /** @type {Record<string, import("../model/viewConfig").RelationConfig | null>} */
  const relationConfigByField = {};
  /** @type {Record<string, Record<string, string>>} */
  const documentLabelsByField = {};

  for (const fieldName of visibleFields) {
    const sample = rows.find((row) => row[fieldName] !== undefined && row[fieldName] !== null)?.[fieldName]
      ?? rows.find((row) => row[fieldName] !== undefined)?.[fieldName];
    const currentDisplayType = resolveCompatibleDisplayType(displayTypes[fieldName], sample);
    if (currentDisplayType === "Multi-select") {
      fieldOptions[fieldName] = buildMultiSelectFieldConfigFromRows(optionRows, fieldName, fieldViewConfigs[fieldName]);
    }

    if (currentDisplayType === "Select") {
      const storedOptions = fieldViewConfigs[fieldName]?.selectOptions ?? {};
      const merged = new Map();
      for (const [value, option] of Object.entries(storedOptions)) {
        merged.set(value, { value, label: option.label, color: option.color ?? null });
      }
      for (const row of optionRows) {
        const value = row[fieldName];
        if (value == null) continue;
        const normalized = String(value).trim();
        if (!normalized || merged.has(normalized)) continue;
        merged.set(normalized, { value: normalized, label: normalized, color: null });
      }
      const normalizedOptions = [...merged.values()];
      selectOptions[fieldName] = {
        options: normalizedOptions,
        optionMap: Object.fromEntries(normalizedOptions.map((option) => [option.value, option])),
      };
    }

    if (currentDisplayType === "Document") {
      const labels = {};
      for (const row of rows) {
        const value = primaryKeyField ? row[primaryKeyField] : null;
        if (value == null) continue;
        const normalized = String(value).trim();
        if (!normalized || labels[normalized]) continue;
        const entry = documentIndexEntries[normalized];
        labels[normalized] = entry?.status === "resolved"
          ? (entry.title ?? normalized)
          : normalized;
      }
      documentLabelsByField[fieldName] = labels;
    }

    const role = getFieldRole(sourcePath, collectionPath, fieldName, relationConfigs);
    relationOptionsByField[fieldName] = role.kind === "relation"
      ? (relationOptions[role.relationKey] ?? [])
      : [];
    relationConfigByField[fieldName] = role.kind === "relation" ? role.config : null;
  }

  return {
    fieldOptions,
    selectOptions,
    relationOptionsByField,
    relationConfigByField,
    documentLabelsByField,
  };
}

function getFieldRole(sourcePath, collectionPath, fieldName, relationConfigs) {
  if (!sourcePath) return { kind: "normal" };
  return resolveFieldRole({
    sourceFile: sourcePath,
    sourceCollection: collectionPath,
    fieldName,
    viewConfig: {
      fields: {},
      primaryKeys: {},
      backlinks: {},
      relations: relationConfigs,
      relationsVersion: 0,
    },
  });
}
