import type { FieldDisplayType } from "../model/fieldTypes";
import type { RelationOption } from "../model/relations";
import type { FieldViewConfig, MultiSelectOptionView, RelationConfig } from "../model/viewConfig";

export type TableFieldOptionConfig = {
  options: MultiSelectOptionView[];
  optionMap: Record<string, MultiSelectOptionView>;
};

export function buildTableRuntimeDeps(input: {
  visibleFields: string[];
  rows: Record<string, unknown>[];
  sourcePath: string | null;
  collectionPath: string;
  displayTypes: Record<string, FieldDisplayType>;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  relationConfigs: Record<string, RelationConfig>;
  relationOptions: Record<string, RelationOption[]>;
}): {
  fieldOptions: Record<string, TableFieldOptionConfig>;
  selectOptions: Record<string, TableFieldOptionConfig>;
  relationOptionsByField: Record<string, RelationOption[]>;
  relationConfigByField: Record<string, RelationConfig | null>;
};
