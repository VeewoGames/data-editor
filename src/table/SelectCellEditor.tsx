import type { MultiSelectOptionColor, MultiSelectOptionView } from "../model/viewConfig";
import { OptionFieldEditor } from "./OptionFieldEditor";

type SelectCellEditorProps = {
  cellId: string;
  value: string | number | null;
  options: MultiSelectOptionView[];
  onEdit: (value: unknown) => void;
  onRenameOption: (previousValue: string | number, nextValue: string) => void;
  onDeleteOption: (optionValue: string | number) => void;
  onSetOptionColor: (optionValue: string | number, color: MultiSelectOptionColor | null) => void;
};

export function SelectCellEditor({
  cellId,
  value,
  options,
  onEdit,
  onRenameOption,
  onDeleteOption,
  onSetOptionColor,
}: SelectCellEditorProps) {
  return (
    <OptionFieldEditor
      cellId={cellId}
      mode="single"
      onDeleteOption={onDeleteOption}
      onEdit={(nextValue) => onEdit(nextValue[0] ?? "")}
      onRenameOption={onRenameOption}
      onSetOptionColor={onSetOptionColor}
      options={options}
      placeholder="未设置"
      value={value == null || value === "" ? [] : [value]}
    />
  );
}
