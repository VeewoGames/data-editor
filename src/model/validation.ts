export type ValidationIssue = {
  severity: "error" | "warning" | "neutral";
  message: string;
  rowIndex?: number;
  fieldName?: string;
};

import {
  buildRelationIndex,
  isRequiredField,
  isUniqueField,
  validateRelationValue,
  validateRequired,
  validateUnique,
} from "../validation.mjs";

export { buildRelationIndex, isRequiredField, isUniqueField };

export function validateRequiredTyped(value: unknown, fieldName: string): ValidationIssue | null {
  return validateRequired(value, fieldName) as ValidationIssue | null;
}

export function validateUniqueTyped(rows: Record<string, unknown>[], fieldName: string): ValidationIssue[] {
  return validateUnique(rows, fieldName) as ValidationIssue[];
}

export function validateRelationValueTyped(value: unknown, index: Set<string>): ValidationIssue | null {
  return validateRelationValue(value, index) as ValidationIssue | null;
}
