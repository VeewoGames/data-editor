import type { MultiSelectOptionColor, MultiSelectOptionView } from "../model/viewConfig";
import { OptionFieldEditor } from "./OptionFieldEditor";

type MultiSelectCellEditorProps = {
  cellId: string;
  value: Array<string | number>;
  options: MultiSelectOptionView[];
  surface?: "table" | "detail";
  wrapped?: boolean;
  onEdit: (value: unknown) => void;
  onRenameOption: (previousValue: string | number, nextValue: string) => void;
  onDeleteOption: (optionValue: string | number) => void;
  onSetOptionColor: (optionValue: string | number, color: MultiSelectOptionColor | null) => void;
  onReorderOptions: (orderedValues: string[]) => void;
};

export function MultiSelectCellEditor({
  cellId,
  value,
  options,
  surface = "table",
  wrapped = false,
  onEdit,
  onRenameOption,
  onDeleteOption,
  onSetOptionColor,
  onReorderOptions,
}: MultiSelectCellEditorProps) {
  return (
    <OptionFieldEditor
      cellId={cellId}
      mode="multi"
      onDeleteOption={onDeleteOption}
      onEdit={(nextValue) => onEdit(nextValue)}
      onReorderOptions={onReorderOptions}
      onRenameOption={onRenameOption}
      onSetOptionColor={onSetOptionColor}
      options={options}
      surface={surface}
      value={value}
      wrapped={wrapped}
    />
  );
}
