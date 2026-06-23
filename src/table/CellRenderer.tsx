import { memo } from "react";
import { icons } from "../components/icons";
import type { FieldDisplayType } from "../model/fieldTypes";
import { isCompatible } from "../model/fieldTypes";
import type { RelationOption } from "../model/relations";
import type { ValidationIssue } from "../model/validation";
import { MultiSelectCellEditor } from "./MultiSelectCellEditor";
import { forwardOptionFieldSurfaceClick, type OptionFieldDraftCommit } from "./OptionFieldEditor";
import { RelationCellEditor } from "./RelationCellEditor";
import { SelectCellEditor } from "./SelectCellEditor";
import { TextCellSurface } from "./TextCellSurface";
import type { MultiSelectFieldOptionConfig, SelectFieldOptionConfig } from "./DataTable";
import type { RelationMode } from "../model/viewConfig";
import type { ActiveTextEditorRegistrar } from "../editing";
import { parseNumberDraft, sanitizeNumberDraft } from "../editing/number-draft";

type CellRendererProps = {
  cellId?: string;
  value: unknown;
  displayType: FieldDisplayType;
  issue?: ValidationIssue | null;
  wrapped?: boolean;
  multiSelectConfig?: MultiSelectFieldOptionConfig;
  selectConfig?: SelectFieldOptionConfig;
  documentLabel?: string | null;
  relationOptions?: RelationOption[];
  relationConfigured?: boolean;
  relationMode?: RelationMode;
  textEditable?: boolean;
  textEditingActive?: boolean;
  onRegisterActiveEditor?: ActiveTextEditorRegistrar;
  onActivateTextCell?: (cellId: string) => void;
  onDeactivateTextCell?: (cellId: string) => void;
  onOptionFieldOpenStateChange?: (cellId: string, open: boolean, close: () => void) => void;
  onEdit: (value: unknown) => void;
  onOpenRelationTarget?: (value: string | number) => void;
  onCommitMultiSelectDraft?: (patch: OptionFieldDraftCommit) => void;
  onCommitSelectDraft?: (patch: OptionFieldDraftCommit) => void;
};

function CellRendererComponent({
  cellId = "",
  value,
  displayType,
  issue,
  wrapped = false,
  multiSelectConfig,
  selectConfig,
  documentLabel,
  relationOptions = [],
  relationConfigured = false,
  relationMode,
  textEditable = false,
  textEditingActive = false,
  onRegisterActiveEditor,
  onActivateTextCell,
  onDeactivateTextCell,
  onOptionFieldOpenStateChange,
  onEdit,
  onOpenRelationTarget,
  onCommitMultiSelectDraft,
  onCommitSelectDraft,
}: CellRendererProps) {
  const shouldShowIssue = issue != null && !shouldSuppressRelationIssue(displayType, value);
  const issueNode = shouldShowIssue ? <Issue issue={issue} /> : null;
  if (!isCompatible(displayType, value)) {
    return (
      <div className="table-cell-content-main">
        <div className="cell-incompatible">
          <icons.incompatible size={14} />
          不兼容
        </div>
      </div>
    );
  }

  if (displayType === "Checkbox") {
    return (
      <>
        <div className="table-cell-content-main">
          <label className="checkbox-cell" onClick={(event) => event.stopPropagation()}>
            <input type="checkbox" checked={Boolean(value)} onChange={(event) => onEdit(event.target.checked)} />
          </label>
        </div>
        {issueNode ? <span className="table-cell-issue-slot">{issueNode}</span> : null}
      </>
    );
  }

  if (displayType === "Multi-select" && Array.isArray(value)) {
    return (
      <>
        <div className="table-cell-content-main option-field-click-surface" onClick={forwardOptionFieldSurfaceClick}>
          <MultiSelectCellEditor
            cellId={cellId}
            onCommitDraft={onCommitMultiSelectDraft ?? (() => {})}
            onOpenStateChange={onOptionFieldOpenStateChange}
            surface="table"
            value={value as Array<string | number>}
            options={multiSelectConfig?.options ?? []}
            wrapped={wrapped}
          />
        </div>
        {issueNode ? <span className="table-cell-issue-slot">{issueNode}</span> : null}
      </>
    );
  }

  if (displayType === "Select" && (value == null || typeof value === "string" || typeof value === "number")) {
    return (
      <>
        <div className="table-cell-content-main option-field-click-surface" onClick={forwardOptionFieldSurfaceClick}>
          <SelectCellEditor
            cellId={cellId}
            onCommitDraft={onCommitSelectDraft ?? (() => {})}
            onOpenStateChange={onOptionFieldOpenStateChange}
            surface="table"
            options={selectConfig?.options ?? []}
            value={value as string | number | null}
            wrapped={wrapped}
          />
        </div>
        {issueNode ? <span className="table-cell-issue-slot">{issueNode}</span> : null}
      </>
    );
  }

  if (displayType === "Relation" && (value == null || Array.isArray(value) || typeof value === "string" || typeof value === "number")) {
    return (
      <>
        <div className="table-cell-content-main">
          <RelationCellEditor
            cellId={cellId}
            configured={relationConfigured}
            mode={relationMode}
            options={relationOptions}
            surface="table"
            value={value as string | number | null | Array<string | number>}
            wrapped={wrapped}
            onOpenTarget={onOpenRelationTarget}
            onEdit={onEdit}
          />
        </div>
        {issueNode ? <span className="table-cell-issue-slot">{issueNode}</span> : null}
      </>
    );
  }

  if (displayType === "Document" && (value == null || typeof value === "string" || typeof value === "number")) {
    const displayLabel = documentLabel ?? (value == null || value === "" ? "未关联文档" : String(value));
    return (
      <>
        <div className="table-cell-content-main">
          <div className={`document-cell-display cell-display cell-text-content ${wrapped ? "cell-text-wrap" : ""}`}>
            <icons.jsonFile size={14} />
            <span>{displayLabel}</span>
          </div>
        </div>
        {issueNode ? <span className="table-cell-issue-slot">{issueNode}</span> : null}
      </>
    );
  }

  const textValue = value == null ? "" : String(value);
  if (
    displayType === "Text" &&
    (value == null || typeof value === "string" || typeof value === "number")
  ) {
    return (
      <>
        <div className="table-cell-content-main">
          <TextCellSurface
            cellId={cellId}
            displayType="Text"
            editable={textEditable}
            active={textEditingActive}
            value={value}
            wrapped={wrapped}
            onActivate={onActivateTextCell ?? (() => {})}
            onDeactivate={onDeactivateTextCell ?? (() => {})}
            onChangeValue={(next) => onEdit(next)}
            onRegisterActiveEditor={onRegisterActiveEditor}
          />
        </div>
        {issueNode ? <span className="table-cell-issue-slot">{issueNode}</span> : null}
      </>
    );
  }
  if (
    displayType === "Number" &&
    (value == null || typeof value === "string" || typeof value === "number")
  ) {
    return (
      <>
        <div className="table-cell-content-main">
          <TextCellSurface
            cellId={cellId}
            displayType="Number"
            editable={textEditable}
            active={textEditingActive}
            value={value}
            wrapped={wrapped}
            inputMode="decimal"
            normalizeInput={sanitizeNumberDraft}
            onActivate={onActivateTextCell ?? (() => {})}
            onDeactivate={onDeactivateTextCell ?? (() => {})}
            onChangeValue={(next) => onEdit(parseNumberDraft(next))}
            onRegisterActiveEditor={onRegisterActiveEditor}
          />
        </div>
        {issueNode ? <span className="table-cell-issue-slot">{issueNode}</span> : null}
      </>
    );
  }
  return (
    <>
      <div className="table-cell-content-main">
        <div
          className={`table-text-cell-display editable-cell cell-display cell-text-content ${wrapped ? "cell-text-wrap" : ""}`}
          data-cell-role="content"
          data-wrap-mode={wrapped ? "wrap" : "truncate"}
        >
          <span>{textValue}</span>
        </div>
      </div>
      {issueNode ? <span className="table-cell-issue-slot">{issueNode}</span> : null}
    </>
  );
}

export const CellRenderer = memo(CellRendererComponent, (previous, next) =>
  previous.cellId === next.cellId &&
  previous.value === next.value &&
  previous.displayType === next.displayType &&
  previous.issue === next.issue &&
  previous.wrapped === next.wrapped &&
  previous.multiSelectConfig === next.multiSelectConfig &&
  previous.selectConfig === next.selectConfig &&
  previous.documentLabel === next.documentLabel &&
  previous.relationOptions === next.relationOptions &&
  previous.relationConfigured === next.relationConfigured &&
  previous.relationMode === next.relationMode &&
  previous.textEditable === next.textEditable &&
  previous.textEditingActive === next.textEditingActive &&
  previous.onRegisterActiveEditor === next.onRegisterActiveEditor &&
  previous.onActivateTextCell === next.onActivateTextCell &&
  previous.onDeactivateTextCell === next.onDeactivateTextCell &&
  previous.onOptionFieldOpenStateChange === next.onOptionFieldOpenStateChange &&
  previous.onEdit === next.onEdit &&
  previous.onOpenRelationTarget === next.onOpenRelationTarget &&
  previous.onCommitMultiSelectDraft === next.onCommitMultiSelectDraft &&
  previous.onCommitSelectDraft === next.onCommitSelectDraft,
);

function shouldSuppressRelationIssue(displayType: FieldDisplayType, value: unknown) {
  if (displayType !== "Relation") return false;
  if (value == null || value === "") return true;
  return Array.isArray(value) && value.length === 0;
}

function Issue({ issue }: { issue: ValidationIssue }) {
  return (
    <span className={`issue ${issue.severity}`} title={issue.message}>
      <icons.incompatible size={13} />
    </span>
  );
}
