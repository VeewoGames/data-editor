import { memo, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { TableTextCellEditor, type ActiveTextEditorRegistrar } from "../editing";

type TextCellSurfaceProps = {
  cellId: string;
  value: unknown;
  wrapped?: boolean;
  editable: boolean;
  active: boolean;
  onActivate: (cellId: string) => void;
  onDeactivate: (cellId: string) => void;
  onChangeValue: (value: string) => void;
  onRegisterActiveEditor?: ActiveTextEditorRegistrar;
};

function stringifyValue(value: unknown) {
  return value == null ? "" : String(value);
}

function TextCellSurfaceComponent({
  cellId,
  value,
  wrapped = false,
  editable,
  active,
  onActivate,
  onDeactivate,
  onChangeValue,
  onRegisterActiveEditor,
}: TextCellSurfaceProps) {
  const textValue = stringifyValue(value);
  const mode = !editable ? "readonly" : active ? "editable-active" : "editable-idle";

  function handleActivate(event: ReactMouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (!editable || active) return;
    onActivate(cellId);
  }

  function handleActivateByKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!editable || active) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onActivate(cellId);
  }

  return (
    <div
      className={`text-cell-surface ${active ? "is-active" : ""}`}
      data-text-cell-mode={mode}
      data-text-cell-id={cellId}
    >
      <div
        className={`table-text-cell-display text-cell-display-layer editable-cell cell-display cell-text-content ${wrapped ? "cell-text-wrap" : ""}`}
        data-cell-role="content"
        data-wrap-mode={wrapped ? "wrap" : "truncate"}
        title={textValue}
        tabIndex={editable && !active ? 0 : undefined}
        onClick={handleActivate}
        onKeyDown={handleActivateByKeyboard}
      >
        <span aria-hidden={active}>{textValue}</span>
      </div>
      {active ? (
        <div className="text-cell-editor-overlay" data-cell-role="text-editor-overlay">
          <TableTextCellEditor
            autoFocus
            cellId={cellId}
            value={value}
            wrapped={wrapped}
            onChangeValue={onChangeValue}
            onDeactivate={() => onDeactivate(cellId)}
            onRegisterActiveEditor={onRegisterActiveEditor}
          />
        </div>
      ) : null}
    </div>
  );
}

export const TextCellSurface = memo(TextCellSurfaceComponent, (previous, next) =>
  previous.cellId === next.cellId &&
  previous.value === next.value &&
  previous.wrapped === next.wrapped &&
  previous.editable === next.editable &&
  previous.active === next.active &&
  previous.onActivate === next.onActivate &&
  previous.onDeactivate === next.onDeactivate &&
  previous.onChangeValue === next.onChangeValue &&
  previous.onRegisterActiveEditor === next.onRegisterActiveEditor,
);
