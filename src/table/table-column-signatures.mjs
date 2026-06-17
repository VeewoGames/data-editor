import { defaultTypeFor } from "../model/fieldTypes.mjs";

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
 *   documentLabelsByField: Record<string, Record<string, string>>;
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
  backlinkColumns,
  relationOptionsByField,
  relationConfigByField,
  fieldOptions,
  selectOptions,
  documentLabelsByField = {},
  widths,
  textEditable,
}) {
  return visibleFields.map((fieldName) => {
    const backlinkColumn = backlinkColumns.find((column) => column.fieldName === fieldName);
    const relationConfig = relationConfigByField[fieldName] ?? null;
    const isNested = nestedFieldSet.has(fieldName);
    const isBacklink = Boolean(backlinkColumn);
    const relationConfigured = Boolean(relationConfig);
    const displayType = isBacklink
      ? "Backlink"
      : relationConfigured
        ? "Relation"
        : inferColumnDisplayType(fieldName, rows, nestedFieldSet, displayTypes);
    return [
      fieldName,
      displayType,
      isNested ? "nested" : "plain",
      fieldName === detectedTitleField ? "title" : "body",
      wrappedFields.has(fieldName) ? "wrap" : "truncate",
      String(widths[fieldName] ?? 180),
      signatureBacklinkColumn(backlinkColumn),
      signatureRelationConfig(relationConfig),
      signatureRelationOptions(relationOptionsByField[fieldName] ?? []),
      signatureOptionConfig(fieldOptions[fieldName]),
      signatureOptionConfig(selectOptions[fieldName]),
      signatureDocumentLabels(documentLabelsByField[fieldName]),
      textEditable && displayType === "Text" && fieldName !== detectedTitleField ? "text-editable" : "text-readonly",
    ].join("::");
  }).join("||");
}

function inferColumnDisplayType(fieldName, rows, nestedFieldSet, displayTypes) {
  if (nestedFieldSet.has(fieldName)) return "Nested";
  if (displayTypes[fieldName]) return displayTypes[fieldName];
  const sample = rows.find((row) => row[fieldName] !== undefined && row[fieldName] !== null)?.[fieldName]
    ?? rows.find((row) => row[fieldName] !== undefined)?.[fieldName];
  return defaultTypeFor(sample);
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

function signatureDocumentLabels(labels) {
  if (!labels) return "";
  return Object.entries(labels).map(([value, label]) => `${value}|${label}`).join(",");
}
