import { icons } from "../components/icons";
import type { FieldDisplayType } from "../model/fieldTypes";
import { isCompatible } from "../model/fieldTypes";
import type { RelationOption } from "../model/relations";
import type { ValidationIssue } from "../model/validation";
import { MultiSelectCellEditor } from "./MultiSelectCellEditor";
import { RelationCellEditor } from "./RelationCellEditor";
import { SelectCellEditor } from "./SelectCellEditor";
import type { MultiSelectFieldOptionConfig, SelectFieldOptionConfig } from "./DataTable";
import type { MultiSelectOptionColor, RelationMode } from "../model/viewConfig";

type CellRendererProps = {
  cellId?: string;
  value: unknown;
  displayType: FieldDisplayType;
  issue?: ValidationIssue | null;
  wrapped?: boolean;
  multiSelectConfig?: MultiSelectFieldOptionConfig;
  selectConfig?: SelectFieldOptionConfig;
  relationOptions?: RelationOption[];
  relationConfigured?: boolean;
  relationMode?: RelationMode;
  onEdit: (value: unknown) => void;
  onOpenRelationTarget?: (value: string | number) => void;
  onRenameMultiSelectOption?: (previousValue: string | number, nextValue: string) => void;
  onDeleteMultiSelectOption?: (optionValue: string | number) => void;
  onSetMultiSelectOptionColor?: (optionValue: string | number, color: MultiSelectOptionColor | null) => void;
  onReorderMultiSelectOptions?: (orderedValues: string[]) => void;
  onRenameSelectOption?: (previousValue: string | number, nextValue: string) => void;
  onDeleteSelectOption?: (optionValue: string | number) => void;
  onSetSelectOptionColor?: (optionValue: string | number, color: MultiSelectOptionColor | null) => void;
  onReorderSelectOptions?: (orderedValues: string[]) => void;
};

export function CellRenderer({
  cellId = "",
  value,
  displayType,
  issue,
  wrapped = false,
  multiSelectConfig,
  selectConfig,
  relationOptions = [],
  relationConfigured = false,
  relationMode,
  onEdit,
  onOpenRelationTarget,
  onRenameMultiSelectOption,
  onDeleteMultiSelectOption,
  onSetMultiSelectOptionColor,
  onReorderMultiSelectOptions,
  onRenameSelectOption,
  onDeleteSelectOption,
  onSetSelectOptionColor,
  onReorderSelectOptions,
}: CellRendererProps) {
  const shouldShowIssue = issue != null && !shouldSuppressRelationIssue(displayType, value);
  if (!isCompatible(displayType, value)) {
    return (
      <div className="cell-incompatible">
        <icons.incompatible size={14} />
        不兼容
      </div>
    );
  }

  if (displayType === "Checkbox") {
    return (
      <label className="checkbox-cell" onClick={(event) => event.stopPropagation()}>
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onEdit(event.target.checked)} />
        {shouldShowIssue ? <Issue issue={issue} /> : null}
      </label>
    );
  }

  if (displayType === "Multi-select" && Array.isArray(value)) {
    return (
      <>
        <MultiSelectCellEditor
          cellId={cellId}
          surface="table"
          value={value as Array<string | number>}
          options={multiSelectConfig?.options ?? []}
          wrapped={wrapped}
          onEdit={onEdit}
          onRenameOption={onRenameMultiSelectOption ?? (() => {})}
          onDeleteOption={onDeleteMultiSelectOption ?? (() => {})}
          onSetOptionColor={onSetMultiSelectOptionColor ?? (() => {})}
          onReorderOptions={onReorderMultiSelectOptions ?? (() => {})}
        />
        {shouldShowIssue ? <Issue issue={issue} /> : null}
      </>
    );
  }

  if (displayType === "Select" && (value == null || typeof value === "string" || typeof value === "number")) {
    return (
      <>
        <SelectCellEditor
          cellId={cellId}
          surface="table"
          options={selectConfig?.options ?? []}
          value={value as string | number | null}
          wrapped={wrapped}
          onEdit={onEdit}
          onRenameOption={onRenameSelectOption ?? (() => {})}
          onDeleteOption={onDeleteSelectOption ?? (() => {})}
          onSetOptionColor={onSetSelectOptionColor ?? (() => {})}
          onReorderOptions={onReorderSelectOptions ?? (() => {})}
        />
        {shouldShowIssue ? <Issue issue={issue} /> : null}
      </>
    );
  }

  if (displayType === "Relation" && (value == null || Array.isArray(value) || typeof value === "string" || typeof value === "number")) {
    return (
      <>
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
        {shouldShowIssue ? <Issue issue={issue} /> : null}
      </>
    );
  }

  const textValue = value == null ? "" : String(value);
  return (
    <div
      className={`editable-cell cell-display cell-text-content ${wrapped ? "cell-text-wrap" : ""}`}
      data-cell-role="content"
      data-wrap-mode={wrapped ? "wrap" : "truncate"}
      title={textValue}
    >
      <span>{textValue}</span>
      {shouldShowIssue ? <Issue issue={issue} /> : null}
    </div>
  );
}

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
