import { defaultTypeFor } from "../model/fieldTypes.mjs";
import { computeFieldMenuCapabilities } from "./field-capabilities.mjs";

const emptyRelationOptions = [];

/**
 * @typedef {{
 *   fieldName: string;
 *   baseDisplayType: import("../model/fieldTypes").FieldDisplayType;
 *   effectiveDisplayType: import("../model/fieldTypes").FieldDisplayType;
 *   roleKind: "normal" | "relation" | "backlink";
 *   capabilities: import("./field-capabilities").FieldMenuCapabilities;
 *   allowTypeChange: boolean;
 *   relationConfigured: boolean;
 *   documentConfigured: boolean;
 *   relationConfig: import("../model/viewConfig").RelationConfig | null;
 *   relationOptions: import("../model/relations").RelationOption[];
 *   wrapped: boolean;
 *   width: number;
 *   isNested: boolean;
 *   isTitle: boolean;
 *   isPrimaryKey: boolean;
 *   isBacklink: boolean;
 *   multiSelectConfig: { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> } | undefined;
 *   selectConfig: { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> } | undefined;
 *   documentLabels: Record<string, string> | undefined;
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
 *   primaryKeyField?: string | null;
 *   backlinkColumns: import("../model/backlinkGrid").BacklinkGridColumn[];
 *   relationOptionsByField: Record<string, import("../model/relations").RelationOption[]>;
 *   relationConfigByField: Record<string, import("../model/viewConfig").RelationConfig | null>;
 *   fieldOptions: Record<string, { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> }>;
 *   selectOptions: Record<string, { options: import("../model/viewConfig").MultiSelectOptionView[]; optionMap: Record<string, import("../model/viewConfig").MultiSelectOptionView> }>;
 *   documentLabelsByField: Record<string, Record<string, string>>;
 *   documentConfiguredFields?: Set<string>;
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
  primaryKeyField = null,
  backlinkColumns,
  relationOptionsByField,
  relationConfigByField,
  fieldOptions,
  selectOptions,
  documentLabelsByField = {},
  documentConfiguredFields = new Set(),
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
    const documentConfigured = documentConfiguredFields.has(fieldName);
    const baseDisplayType = inferColumnDisplayType(fieldName, rows, nestedFieldSet, displayTypes);
    const effectiveDisplayType = isBacklink
      ? "Backlink"
      : relationConfigured
        ? "Relation"
        : baseDisplayType;
    const roleKind = isBacklink ? "backlink" : relationConfigured ? "relation" : "normal";
    const isTitle = fieldName === detectedTitleField;
    const isPrimaryKey = fieldName === primaryKeyField;
    const capabilities = computeFieldMenuCapabilities({
      baseDisplayType,
      roleKind,
      isNested,
      isBacklink,
      relationConfigured,
      documentConfigured,
      isTitle,
      isPrimaryKey,
    });
    const nextModel = {
      fieldName,
      baseDisplayType,
      effectiveDisplayType,
      roleKind,
      capabilities,
      allowTypeChange: capabilities.canChangeType,
      relationConfigured,
      documentConfigured,
      relationConfig,
      relationOptions,
      wrapped: wrappedFields.has(fieldName),
      width: getColumnWidth(fieldName),
      isNested,
      isTitle,
      isPrimaryKey,
      isBacklink,
      multiSelectConfig: fieldOptions[fieldName],
      selectConfig: selectOptions[fieldName],
      documentLabels: documentLabelsByField[fieldName],
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
  return columnModels.find((column) => column.fieldName === fieldName)?.effectiveDisplayType ?? null;
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
    previous.baseDisplayType === next.baseDisplayType &&
    previous.effectiveDisplayType === next.effectiveDisplayType &&
    previous.roleKind === next.roleKind &&
    sameCapabilities(previous.capabilities, next.capabilities) &&
    previous.allowTypeChange === next.allowTypeChange &&
    previous.relationConfigured === next.relationConfigured &&
    previous.documentConfigured === next.documentConfigured &&
    previous.relationConfig === next.relationConfig &&
    previous.relationOptions === next.relationOptions &&
    previous.wrapped === next.wrapped &&
    previous.width === next.width &&
    previous.isNested === next.isNested &&
    previous.isTitle === next.isTitle &&
    previous.isPrimaryKey === next.isPrimaryKey &&
    previous.isBacklink === next.isBacklink &&
    previous.multiSelectConfig === next.multiSelectConfig &&
    previous.selectConfig === next.selectConfig &&
    previous.documentLabels === next.documentLabels &&
    previous.backlinkColumn === next.backlinkColumn;
}

function sameCapabilities(previous, next) {
  return previous.canChangeType === next.canChangeType &&
    previous.canBeTitle === next.canBeTitle &&
    previous.canBePrimaryKey === next.canBePrimaryKey &&
    previous.canConfigureRelation === next.canConfigureRelation &&
    previous.canConfigureDocument === next.canConfigureDocument &&
    previous.allowedTypeTargets.length === next.allowedTypeTargets.length &&
    previous.allowedTypeTargets.every((value, index) => next.allowedTypeTargets[index] === value);
}
