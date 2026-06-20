import type { FilterOperator } from "../../api/client";
import type { FieldDisplayType } from "../../model/fieldTypes";
import type { FieldViewConfig, MultiSelectOptionView } from "../../model/viewConfig";

export const textOperatorOptions: Array<{ value: FilterOperator; label: string; needsValue: boolean }> = [
  { value: "contains", label: "包含", needsValue: true },
  { value: "does_not_contain", label: "不包含", needsValue: true },
  { value: "is", label: "等于", needsValue: true },
  { value: "is_not", label: "不等于", needsValue: true },
  { value: "is_empty", label: "为空", needsValue: false },
  { value: "is_not_empty", label: "不为空", needsValue: false },
];

export const discreteOperatorOptions: Array<{ value: FilterOperator; label: string; needsValue: boolean }> = [
  { value: "contains", label: "包含", needsValue: true },
  { value: "does_not_contain", label: "不包含", needsValue: true },
  { value: "is_empty", label: "为空", needsValue: false },
  { value: "is_not_empty", label: "不为空", needsValue: false },
];

export const checkboxOperatorOptions: Array<{ value: FilterOperator; label: string; needsValue: boolean }> = [
  { value: "is", label: "是", needsValue: true },
  { value: "is_not", label: "不是", needsValue: true },
  { value: "is_empty", label: "为空", needsValue: false },
  { value: "is_not_empty", label: "不为空", needsValue: false },
];

export function resolveFieldType(
  field: string,
  displayTypes: Record<string, FieldDisplayType>,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  fieldTypes: Record<string, FieldDisplayType>,
): FieldDisplayType {
  if (fieldTypes[field] === "Relation") return "Relation";
  return displayTypes[field] ?? fieldTypes[field] ?? fieldViewConfigs[field]?.type ?? "Text";
}

export function optionsForField(
  field: string,
  fieldType: FieldDisplayType,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]> = {},
): MultiSelectOptionView[] {
  if (fieldType === "Relation") {
    return relationFilterOptions[field] ?? [];
  }
  const config = fieldViewConfigs[field];
  const optionSource = fieldType === "Select" ? config?.selectOptions : config?.multiSelectOptions;
  const configuredOptions = Object.entries(optionSource ?? {}).map(([value, option]) => ({
    value,
    label: option.label,
    color: option.color,
  }));
  const optionByValue = new Map(configuredOptions.map((option) => [option.value, option]));
  for (const option of relationFilterOptions[field] ?? []) {
    if (!optionByValue.has(option.value)) optionByValue.set(option.value, option);
  }
  return [...optionByValue.values()];
}

export function normalizeSelectedValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

export function mergeSelectedOptions(options: MultiSelectOptionView[], selectedValues: string[]) {
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  for (const value of selectedValues) {
    if (!optionByValue.has(value)) optionByValue.set(value, { value, label: value, color: null });
  }
  return [...optionByValue.values()];
}

export function filterOptions(options: MultiSelectOptionView[], search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle));
}

export function optionForValue(options: MultiSelectOptionView[], value: string) {
  return options.find((option) => option.value === value);
}
