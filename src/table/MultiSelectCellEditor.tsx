import type { MultiSelectOptionView } from "../model/viewConfig";
import { OptionFieldEditor, type OptionFieldDraftCommit } from "./OptionFieldEditor";

type MultiSelectCellEditorProps = {
  cellId: string;
  value: Array<string | number>;
  options: MultiSelectOptionView[];
  surface?: "table" | "detail";
  wrapped?: boolean;
  onCommitDraft: (patch: OptionFieldDraftCommit) => void;
  onOpenStateChange?: (cellId: string, open: boolean, close: () => void) => void;
};

export function MultiSelectCellEditor({
  cellId,
  value,
  options,
  surface = "table",
  wrapped = false,
  onCommitDraft,
  onOpenStateChange,
}: MultiSelectCellEditorProps) {
  return (
    <OptionFieldEditor
      cellId={cellId}
      mode="multi"
      onCommitDraft={onCommitDraft}
      onOpenStateChange={onOpenStateChange}
      options={options}
      surface={surface}
      value={value}
      wrapped={wrapped}
    />
  );
}
