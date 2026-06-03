import {
  defaultTypeFor as defaultTypeForCore,
  fieldTypes as fieldTypesCore,
  isCompatible as isCompatibleCore,
} from "../field-types.mjs";

export type FieldDisplayType =
  | "Text"
  | "Number"
  | "Checkbox"
  | "Select"
  | "Multi-select"
  | "Relation"
  | "Backlink"
  | "Date"
  | "JSON"
  | "Nested";

export const fieldTypes = fieldTypesCore as readonly FieldDisplayType[];

export function isCompatible(type: FieldDisplayType, value: unknown): boolean {
  return isCompatibleCore(type, value);
}

export function defaultTypeFor(value: unknown): FieldDisplayType {
  return defaultTypeForCore(value) as FieldDisplayType;
}
