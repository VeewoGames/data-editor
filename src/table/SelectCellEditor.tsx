import type { MultiSelectOptionColor, MultiSelectOptionView } from "../model/viewConfig";
import { OptionFieldEditor } from "./OptionFieldEditor";

type SelectCellEditorProps = {
  cellId: string;
  value: string | number | null;
  options: MultiSelectOptionView[];
  surface?: "table" | "detail";
  wrapped?: boolean;
  onEdit: (value: unknown) => void;
  onRenameOption: (previousValue: string | number, nextValue: string) => void;
  onDeleteOption: (optionValue: string | number) => void;
  onSetOptionColor: (optionValue: string | number, color: MultiSelectOptionColor | null) => void;
  onReorderOptions: (orderedValues: string[]) => void;
};

export function SelectCellEditor({
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
}: SelectCellEditorProps) {
  return (
    <OptionFieldEditor
      cellId={cellId}
      mode="single"
      onDeleteOption={onDeleteOption}
      onEdit={(nextValue) => onEdit(nextValue[0] ?? "")}
      onReorderOptions={onReorderOptions}
      onRenameOption={onRenameOption}
      onSetOptionColor={onSetOptionColor}
      options={options}
      placeholder="未设置"
      surface={surface}
      value={value == null || value === "" ? [] : [value]}
      wrapped={wrapped}
    />
  );
}
