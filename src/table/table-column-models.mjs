import { defaultTypeFor } from "../model/fieldTypes.mjs";

const emptyRelationOptions = [];

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
 *   previousByField?: Record<string, TableColumnModel>;
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
  previousByField = {},
}) {
  return visibleFields.map((fieldName) => {
    const backlinkColumn = backlinkColumns.find((column) => column.fieldName === fieldName);
    const relationConfig = relationConfigByField[fieldName] ?? null;
    const relationOptions = relationOptionsByField[fieldName] ?? emptyRelationOptions;
    const isNested = nestedFieldSet.has(fieldName);
    const isBacklink = Boolean(backlinkColumn);
    const relationConfigured = Boolean(relationConfig);
    const nextModel = {
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
      relationOptions,
      wrapped: wrappedFields.has(fieldName),
      width: getColumnWidth(fieldName),
      isNested,
      isTitle: fieldName === detectedTitleField,
      isBacklink,
      multiSelectConfig: fieldOptions[fieldName],
      selectConfig: selectOptions[fieldName],
      backlinkColumn,
    };
    const previousModel = previousByField[fieldName];
    return sameColumnModel(previousModel, nextModel) ? previousModel : nextModel;
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

function sameColumnModel(previous, next) {
  return Boolean(previous) &&
    previous.fieldName === next.fieldName &&
    previous.displayType === next.displayType &&
    previous.roleKind === next.roleKind &&
    previous.allowTypeChange === next.allowTypeChange &&
    previous.relationConfigured === next.relationConfigured &&
    previous.relationConfig === next.relationConfig &&
    previous.relationOptions === next.relationOptions &&
    previous.wrapped === next.wrapped &&
    previous.width === next.width &&
    previous.isNested === next.isNested &&
    previous.isTitle === next.isTitle &&
    previous.isBacklink === next.isBacklink &&
    previous.multiSelectConfig === next.multiSelectConfig &&
    previous.selectConfig === next.selectConfig &&
    previous.backlinkColumn === next.backlinkColumn;
}
