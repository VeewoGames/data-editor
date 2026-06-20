const changeableFieldTypes = ["Text", "Select", "Document"];

/**
 * @typedef {{
 *   canChangeType: boolean;
 *   allowedTypeTargets: import("../model/fieldTypes").FieldDisplayType[];
 *   canBeTitle: boolean;
 *   canBePrimaryKey: boolean;
 *   canConfigureRelation: boolean;
 *   canConfigureDocument: boolean;
 * }} FieldMenuCapabilities
 */

/**
 * @param {{
 *   baseDisplayType: import("../model/fieldTypes").FieldDisplayType;
 *   roleKind?: "normal" | "relation" | "backlink";
 *   isNested?: boolean;
 *   isBacklink?: boolean;
 *   relationConfigured?: boolean;
 *   documentConfigured?: boolean;
 *   isTitle?: boolean;
 *   isPrimaryKey?: boolean;
 * }} input
 * @returns {FieldMenuCapabilities}
 */
export function computeFieldMenuCapabilities({
  baseDisplayType,
  roleKind = "normal",
  isNested = false,
  isBacklink = false,
  relationConfigured = false,
  documentConfigured = false,
  isTitle = false,
  isPrimaryKey = false,
}) {
  const isRelationRole = roleKind === "relation" || relationConfigured;
  const lockedByStructure = isNested || isBacklink || roleKind === "backlink";
  const isText = baseDisplayType === "Text";
  const canChangeType = !lockedByStructure && !isRelationRole && changeableFieldTypes.includes(baseDisplayType);

  return {
    canChangeType,
    allowedTypeTargets: canChangeType ? [...changeableFieldTypes] : [],
    canBeTitle: !lockedByStructure && !isRelationRole && isText,
    canBePrimaryKey: !lockedByStructure && !isRelationRole && isText,
    canConfigureRelation: !lockedByStructure && !isRelationRole && isText && !isTitle && !isPrimaryKey,
    canConfigureDocument: !lockedByStructure && !isRelationRole && (baseDisplayType === "Text" || baseDisplayType === "Document"),
  };
}
