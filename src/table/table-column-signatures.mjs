import { resolveCompatibleDisplayType } from "../model/fieldTypes.mjs";
import { computeFieldMenuCapabilities } from "./field-capabilities.mjs";

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
 *   widths: Record<string, number>;
 *   textEditable: boolean;
 * }} input
 */
export function buildTableColumnModelsSignature({
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
  widths,
  textEditable,
}) {
  return visibleFields.map((fieldName) => {
    const backlinkColumn = backlinkColumns.find((column) => column.fieldName === fieldName);
    const relationConfig = relationConfigByField[fieldName] ?? null;
    const isNested = nestedFieldSet.has(fieldName);
    const isBacklink = Boolean(backlinkColumn);
    const relationConfigured = Boolean(relationConfig);
    const baseDisplayType = inferColumnDisplayType(fieldName, rows, nestedFieldSet, displayTypes);
    const effectiveDisplayType = isBacklink
      ? "Backlink"
      : relationConfigured
        ? "Relation"
        : baseDisplayType;
    const roleKind = isBacklink ? "backlink" : relationConfigured ? "relation" : "normal";
    const capabilities = computeFieldMenuCapabilities({
      baseDisplayType,
      roleKind,
      isNested,
      isBacklink,
      relationConfigured,
      documentConfigured: documentConfiguredFields.has(fieldName),
      isTitle: fieldName === detectedTitleField,
      isPrimaryKey: fieldName === primaryKeyField,
    });
    return [
      fieldName,
      baseDisplayType,
      effectiveDisplayType,
      roleKind,
      isNested ? "nested" : "plain",
      fieldName === detectedTitleField ? "title" : "body",
      fieldName === primaryKeyField ? "primary-key" : "not-primary-key",
      wrappedFields.has(fieldName) ? "wrap" : "truncate",
      String(widths[fieldName] ?? 180),
      signatureCapabilities(capabilities),
      signatureBacklinkColumn(backlinkColumn),
      signatureRelationConfig(relationConfig),
      signatureRelationOptions(relationOptionsByField[fieldName] ?? []),
      signatureOptionConfig(fieldOptions[fieldName]),
      signatureOptionConfig(selectOptions[fieldName]),
      signatureDocumentLabels(documentLabelsByField[fieldName]),
      textEditable && effectiveDisplayType === "Text" && fieldName !== detectedTitleField ? "text-editable" : "text-readonly",
    ].join("::");
  }).join("||");
}

function inferColumnDisplayType(fieldName, rows, nestedFieldSet, displayTypes) {
  if (nestedFieldSet.has(fieldName)) return "Nested";
  const sample = rows.find((row) => row[fieldName] !== undefined && row[fieldName] !== null)?.[fieldName]
    ?? rows.find((row) => row[fieldName] !== undefined)?.[fieldName];
  return resolveCompatibleDisplayType(displayTypes[fieldName], sample);
}

function signatureBacklinkColumn(backlinkColumn) {
  if (!backlinkColumn) return "";
  return [
    backlinkColumn.backlinkKey,
    backlinkColumn.fieldName,
    backlinkColumn.sourceRelation,
    backlinkColumn.targetKey,
    backlinkColumn.status,
    backlinkColumn.message ?? "",
  ].join("|");
}

function signatureRelationConfig(relationConfig) {
  if (!relationConfig) return "";
  return [
    relationConfig.targetFile,
    relationConfig.targetCollection,
    relationConfig.targetKey,
    relationConfig.mode,
    relationConfig.allowMissing ? "1" : "0",
    relationConfig.titleFields.join(","),
  ].join("|");
}

function signatureRelationOptions(options) {
  return options.map((option) => [option.value, option.label, option.description ?? ""].join("|")).join(",");
}

function signatureOptionConfig(config) {
  if (!config) return "";
  return config.options.map((option) => [option.value, option.label, option.color ?? ""].join("|")).join(",");
}

function signatureCapabilities(capabilities) {
  return [
    capabilities.canChangeType ? "1" : "0",
    capabilities.canBeTitle ? "1" : "0",
    capabilities.canBePrimaryKey ? "1" : "0",
    capabilities.canConfigureRelation ? "1" : "0",
    capabilities.canConfigureDocument ? "1" : "0",
    capabilities.allowedTypeTargets.join(","),
  ].join("|");
}

function signatureDocumentLabels(labels) {
  if (!labels) return "";
  return Object.entries(labels).map(([value, label]) => `${value}|${label}`).join(",");
}
