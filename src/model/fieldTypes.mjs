import {
  defaultTypeFor as defaultTypeForCore,
  fieldTypes as fieldTypesCore,
  isCompatible as isCompatibleCore,
  resolveCompatibleDisplayType as resolveCompatibleDisplayTypeCore,
} from "../field-types.mjs";

export const fieldTypes = fieldTypesCore;

export function isCompatible(type, value) {
  return isCompatibleCore(type, value);
}

export function defaultTypeFor(value) {
  return defaultTypeForCore(value);
}

export function resolveCompatibleDisplayType(type, value) {
  return resolveCompatibleDisplayTypeCore(type, value);
}
