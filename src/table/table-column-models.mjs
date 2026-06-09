import { defaultTypeFor } from "../model/fieldTypes.mjs";

/**
 * @typedef {{
 *   fieldName: string;
 *   displayType: import("../model/fieldTypes").FieldDisplayType;
 *   roleKind: "normal" | "relation" | "backlink";
 *   allowTypeChange: boolean;
 *   relationConfigured: boolean;
 *   relationConfig: import("../model/viewConfig").RelationConfig | null;
 *   relationOptions: import("../model/relations").RelationOption[];
 *   wrapped: boolean;
 *   width: number;
 *   isNested: boolean;
 *   isTitle: boolean;
 *   isBacklink: boolean;
 *   multiSelectConfig: { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> } | undefined;
 *   selectConfig: { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> } | undefined;
 *   backlinkColumn: import("../model/backlinkGrid").BacklinkGridColumn | undefined;
 * }} TableColumnModel
 */

/**
 * @param {{
 *   visibleFields: string[];
 *   rows: import("../model/documentModel").DataRecord[];
 *   nestedFieldSet: Set<string>;
 *   displayTypes: Record<string, import("../model/fieldTypes").FieldDisplayType>;
 *   wrappedFields: Set<string>;
 *   detectedTitleField: string | null;
 *   backlinkColumns: import("../model/backlinkGrid").BacklinkGridColumn[];
 *   relationOptionsByField: Record<string, import("../model/relations").RelationOption[]>;
 *   relationConfigByField: Record<string, import("../model/viewConfig").RelationConfig | null>;
 *   fieldOptions: Record<string, { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> }>;
 *   selectOptions: Record<string, { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> }>;
 *   getColumnWidth: (fieldName: string) => number;
 * }} input
 * @returns {TableColumnModel[]}
 */
export function buildTableColumnModels({
  visibleFields,
  rows,
  nestedFieldSet,
  displayTypes,
  wrappedFields,
  detectedTitleField,
  backlinkColumns,
  relationOptionsByField,
  relationConfigByField,
  fieldOptions,
  selectOptions,
  getColumnWidth,
}) {
  return visibleFields.map((fieldName) => {
    const backlinkColumn = backlinkColumns.find((column) => column.fieldName === fieldName);
    const relationConfig = relationConfigByField[fieldName] ?? null;
    const isNested = nestedFieldSet.has(fieldName);
    const isBacklink = Boolean(backlinkColumn);
    const relationConfigured = Boolean(relationConfig);
    return {
      fieldName,
      displayType: isBacklink
        ? "Backlink"
        : relationConfigured
          ? "Relation"
          : inferColumnDisplayType(fieldName, rows, nestedFieldSet, displayTypes),
      roleKind: isBacklink ? "backlink" : relationConfigured ? "relation" : "normal",
      allowTypeChange: !isNested && !isBacklink,
      relationConfigured,
      relationConfig,
      relationOptions: relationOptionsByField[fieldName] ?? [],
      wrapped: wrappedFields.has(fieldName),
      width: getColumnWidth(fieldName),
      isNested,
      isTitle: fieldName === detectedTitleField,
      isBacklink,
      multiSelectConfig: fieldOptions[fieldName],
      selectConfig: selectOptions[fieldName],
      backlinkColumn,
    };
  });
}

/**
 * @param {string} fieldName
 * @param {TableColumnModel[]} columnModels
 * @returns {import("../model/fieldTypes").FieldDisplayType | null}
 */
export function getColumnModelDisplayType(fieldName, columnModels) {
  return columnModels.find((column) => column.fieldName === fieldName)?.displayType ?? null;
}

function inferColumnDisplayType(fieldName, rows, nestedFieldSet, displayTypes) {
  if (nestedFieldSet.has(fieldName)) return "Nested";
  if (displayTypes[fieldName]) return displayTypes[fieldName];
  const sample = rows.find((row) => row[fieldName] !== undefined && row[fieldName] !== null)?.[fieldName]
    ?? rows.find((row) => row[fieldName] !== undefined)?.[fieldName];
  return defaultTypeFor(sample);
}
