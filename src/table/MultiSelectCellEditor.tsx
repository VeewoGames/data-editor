import type { MultiSelectOptionView } from "../model/viewConfig";
import { OptionFieldEditor, type OptionFieldDraftCommit } from "./OptionFieldEditor";

type MultiSelectCellEditorProps = {
  cellId: string;
  value: Array<string | number>;
  options: MultiSelectOptionView[];
  surface?: "table" | "detail";
  wrapped?: boolean;
  onCommitDraft: (patch: OptionFieldDraftCommit) => void;
};

export function MultiSelectCellEditor({
  cellId,
  value,
  options,
  surface = "table",
  wrapped = false,
  onCommitDraft,
}: MultiSelectCellEditorProps) {
  return (
    <OptionFieldEditor
      cellId={cellId}
      mode="multi"
      onCommitDraft={onCommitDraft}
      options={options}
      surface={surface}
      value={value}
      wrapped={wrapped}
    />
  );
}
