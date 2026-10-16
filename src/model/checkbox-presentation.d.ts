import type { CSSProperties } from "react";
import type { CheckboxPresentation, FieldPresentation } from "./viewConfig";

export function normalizeCheckboxPresentation(value: unknown): CheckboxPresentation | undefined;
export function isValidCheckboxPresentation(value: unknown): boolean;
export function checkboxCheckedStyle(checked: boolean, presentation?: FieldPresentation): CSSProperties | undefined;
