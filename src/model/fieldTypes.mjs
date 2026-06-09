import {
  defaultTypeFor as defaultTypeForCore,
  fieldTypes as fieldTypesCore,
  isCompatible as isCompatibleCore,
} from "../field-types.mjs";

export const fieldTypes = fieldTypesCore;

export function isCompatible(type, value) {
  return isCompatibleCore(type, value);
}

export function defaultTypeFor(value) {
  return defaultTypeForCore(value);
}
