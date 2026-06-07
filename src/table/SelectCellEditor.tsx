import type { MultiSelectOptionView } from "../model/viewConfig";
import { OptionFieldEditor, type OptionFieldDraftCommit } from "./OptionFieldEditor";

type SelectCellEditorProps = {
  cellId: string;
  value: string | number | null;
  options: MultiSelectOptionView[];
  surface?: "table" | "detail";
  wrapped?: boolean;
  onCommitDraft: (patch: OptionFieldDraftCommit) => void;
};

export function SelectCellEditor({
  cellId,
  value,
  options,
  surface = "table",
  wrapped = false,
  onCommitDraft,
}: SelectCellEditorProps) {
  return (
    <OptionFieldEditor
      cellId={cellId}
      mode="single"
      onCommitDraft={onCommitDraft}
      options={options}
      placeholder="未设置"
      surface={surface}
      value={value == null || value === "" ? [] : [value]}
      wrapped={wrapped}
    />
  );
}
