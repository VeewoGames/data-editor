import type { FieldDisplayType } from "../model/fieldTypes";
import type { MultiSelectOptionView, RelationMode } from "../model/viewConfig";

export function buildSelectionRect(
  anchor: { visibleRowIndex: number; visibleColumnIndex: number },
  focus: { visibleRowIndex: number; visibleColumnIndex: number },
): {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
};

export function isCellInsideRect(
  rect: { rowStart: number; rowEnd: number; columnStart: number; columnEnd: number },
  coord: { visibleRowIndex: number; visibleColumnIndex: number },
): boolean;

export function resolveClearValueByDisplayType(
  displayType: FieldDisplayType,
  relationMode?: RelationMode | null,
): "" | false | null | Array<string | number> | undefined;

export function buildOptionFieldClearPatch(input: {
  mode: "single" | "multi";
  options: MultiSelectOptionView[];
  selectedValues: Array<string | number>;
}): {
  createdOptionValues: Array<string | number>;
  deletedOptionValues: Array<string | number>;
  nextOptionOrder: Array<string | number>;
  nextOptions: MultiSelectOptionView[];
  nextSelectedValues: Array<string | number>;
  optionsChanged: boolean;
  orderChanged: boolean;
  renamedOptions: Array<unknown>;
  valueChanged: boolean;
};
