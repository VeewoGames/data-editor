import type { MultiSelectOptionColor, MultiSelectOptionView } from "../model/viewConfig";
import { OptionFieldEditor } from "./OptionFieldEditor";

type MultiSelectCellEditorProps = {
  cellId: string;
  value: Array<string | number>;
  options: MultiSelectOptionView[];
  optionMap: Record<string, MultiSelectOptionView>;
  wrapped?: boolean;
  onEdit: (value: unknown) => void;
  onRenameOption: (previousValue: string | number, nextValue: string) => void;
  onDeleteOption: (optionValue: string | number) => void;
  onSetOptionColor: (optionValue: string | number, color: MultiSelectOptionColor | null) => void;
};

export function MultiSelectCellEditor({
  cellId,
  value,
  options,
  wrapped = false,
  onEdit,
  onRenameOption,
  onDeleteOption,
  onSetOptionColor,
}: MultiSelectCellEditorProps) {
  return (
    <OptionFieldEditor
      cellId={cellId}
      mode="multi"
      onDeleteOption={onDeleteOption}
      onEdit={(nextValue) => onEdit(nextValue)}
      onRenameOption={onRenameOption}
      onSetOptionColor={onSetOptionColor}
      options={options}
      value={value}
      wrapped={wrapped}
    />
  );
}
