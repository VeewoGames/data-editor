import type { ValidationIssue } from "../model/validation";
import type { ValidationSnapshot } from "./issue-map";

export declare function resolveValidationIssue(
  validation: ValidationSnapshot,
  rowId: string | null,
  rowIndex: number | null,
  fieldName: string,
): ValidationIssue | null;
