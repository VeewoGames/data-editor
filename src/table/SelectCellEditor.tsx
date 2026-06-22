import type { MultiSelectOptionView } from "../model/viewConfig";
import { OptionFieldEditor, type OptionFieldDraftCommit } from "./OptionFieldEditor";

type SelectCellEditorProps = {
  cellId: string;
  value: string | number | null;
  options: MultiSelectOptionView[];
  surface?: "table" | "detail";
  wrapped?: boolean;
  onCommitDraft: (patch: OptionFieldDraftCommit) => void;
  onOpenStateChange?: (cellId: string, open: boolean, close: () => void) => void;
};

export function SelectCellEditor({
  cellId,
  value,
  options,
  surface = "table",
  wrapped = false,
  onCommitDraft,
  onOpenStateChange,
}: SelectCellEditorProps) {
  return (
    <OptionFieldEditor
      cellId={cellId}
      mode="single"
      onCommitDraft={onCommitDraft}
      onOpenStateChange={onOpenStateChange}
      options={options}
      surface={surface}
      value={value == null || value === "" ? [] : [value]}
      wrapped={wrapped}
    />
  );
}
