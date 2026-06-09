import { resolveFieldRole } from "../model/field-role.mjs";
import { defaultTypeFor } from "../model/fieldTypes.mjs";
import { buildMultiSelectFieldConfig } from "../multiselect-config.mjs";

/**
 * @param {{
 *   visibleFields: string[];
 *   rows: Record<string, unknown>[];
 *   sourcePath: string | null;
 *   collectionPath: string;
 *   displayTypes: Record<string, import("../model/fieldTypes.mjs").FieldDisplayType>;
 *   fieldViewConfigs: Record<string, import("../model/viewConfig").FieldViewConfig>;
 *   relationConfigs: Record<string, import("../model/viewConfig").RelationConfig>;
 *   relationOptions: Record<string, import("../model/relations").RelationOption[]>;
 * }} input
 */
export function buildTableRuntimeDeps({
  visibleFields,
  rows,
  sourcePath,
  collectionPath,
  displayTypes,
  fieldViewConfigs,
  relationConfigs,
  relationOptions,
}) {
  /** @type {Record<string, { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> }>} */
  const fieldOptions = {};
  /** @type {Record<string, { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> }>} */
  const selectOptions = {};
  /** @type {Record<string, import("../model/relations").RelationOption[]>} */
  const relationOptionsByField = {};
  /** @type {Record<string, import("../model/viewConfig").RelationConfig | null>} */
  const relationConfigByField = {};

  for (const fieldName of visibleFields) {
    const currentDisplayType = displayTypes[fieldName] ?? defaultTypeFor(rows.find((row) => row[fieldName] != null)?.[fieldName]);
    if (currentDisplayType === "Multi-select") {
      const unique = new Map();
      for (const row of rows) {
        const value = row[fieldName];
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (item == null || (typeof item !== "string" && typeof item !== "number")) continue;
          unique.set(String(item), item);
        }
      }
      fieldOptions[fieldName] = buildMultiSelectFieldConfig([...unique.values()], fieldViewConfigs[fieldName]);
    }

    if (currentDisplayType === "Select") {
      const storedOptions = fieldViewConfigs[fieldName]?.selectOptions ?? {};
      const merged = new Map();
      for (const [value, option] of Object.entries(storedOptions)) {
        merged.set(value, { value, label: option.label, color: option.color ?? null });
      }
      for (const row of rows) {
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
