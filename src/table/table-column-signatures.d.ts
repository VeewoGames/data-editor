import type { BacklinkGridColumn } from "../model/backlinkGrid";
import type { DataRecord } from "../model/documentModel";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { RelationOption } from "../model/relations";
import type { MultiSelectOptionView, RelationConfig } from "../model/viewConfig";

type OptionConfig = {
  options: MultiSelectOptionView[];
  optionMap: Record<string, MultiSelectOptionView>;
};

export function buildTableColumnModelsSignature(input: {
  visibleFields: string[];
  rows: DataRecord[];
  nestedFieldSet: Set<string>;
  displayTypes: Record<string, FieldDisplayType>;
  wrappedFields: Set<string>;
  detectedTitleField: string | null;
  backlinkColumns: BacklinkGridColumn[];
  relationOptionsByField: Record<string, RelationOption[]>;
  relationConfigByField: Record<string, RelationConfig | null>;
  fieldOptions: Record<string, OptionConfig>;
  selectOptions: Record<string, OptionConfig>;
  widths: Record<string, number>;
  textEditable: boolean;
}): string;
