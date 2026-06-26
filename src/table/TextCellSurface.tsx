import { memo, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { TableTextCellEditor, type ActiveTextEditorRegistrar } from "../editing";

type TextCellSurfaceProps = {
  cellId: string;
  displayType?: "Text" | "Number";
  value: unknown;
  wrapped?: boolean;
  editable: boolean;
  active: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  normalizeInput?: (value: string) => string;
  onEnableEditing?: () => void;
  onActivate: (cellId: string) => void;
  onDeactivate: (cellId: string) => void;
  onChangeValue: (value: string) => void;
  onRegisterActiveEditor?: ActiveTextEditorRegistrar;
};

function stringifyValue(value: unknown) {
  return value == null ? "" : String(value);
}

function isZeroNumberValue(value: unknown) {
  if (value == null) return false;
  const normalized = String(value).trim();
  if (normalized === "") return false;
  return Number(normalized) === 0;
}

function TextCellSurfaceComponent({
  cellId,
  displayType = "Text",
  value,
  wrapped = false,
  editable,
  active,
  inputMode,
  normalizeInput,
  onEnableEditing,
  onActivate,
  onDeactivate,
  onChangeValue,
  onRegisterActiveEditor,
}: TextCellSurfaceProps) {
  const textValue = stringifyValue(value);
  const mode = !editable ? "readonly" : active ? "editable-active" : "editable-idle";
  const isZeroValue = displayType === "Number" && isZeroNumberValue(value);
  const pendingActivationTimeoutRef = useRef<number | null>(null);

  function clearPendingActivation() {
    if (pendingActivationTimeoutRef.current == null) return;
    window.clearTimeout(pendingActivationTimeoutRef.current);
    pendingActivationTimeoutRef.current = null;
  }

  function handleActivate(event: ReactMouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (!editable || active) return;
    clearPendingActivation();
    pendingActivationTimeoutRef.current = window.setTimeout(() => {
      pendingActivationTimeoutRef.current = null;
      onActivate(cellId);
    }, 220);
  }

  function handleActivateByKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!editable || active) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onActivate(cellId);
  }

  function handleRequestEnableEditing(event: ReactMouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    clearPendingActivation();
    if (editable) return;
    onEnableEditing?.();
  }

  useEffect(() => () => {
    clearPendingActivation();
  }, []);

  return (
    <div
      className={`text-cell-surface ${active ? "is-active" : ""}`}
      data-text-cell-mode={mode}
      data-text-cell-id={cellId}
    >
      <div
        className={`table-text-cell-display text-cell-display-layer editable-cell cell-display cell-text-content ${wrapped ? "cell-text-wrap" : ""}`}
        data-cell-role="content"
        data-display-type={displayType.toLowerCase()}
        data-wrap-mode={wrapped ? "wrap" : "truncate"}
        data-zero-value={isZeroValue ? "true" : "false"}
        tabIndex={editable && !active ? 0 : undefined}
        onClick={handleActivate}
        onDoubleClick={handleRequestEnableEditing}
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
            inputMode={inputMode}
            normalizeInput={normalizeInput}
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
  previous.inputMode === next.inputMode &&
  previous.normalizeInput === next.normalizeInput &&
  previous.onEnableEditing === next.onEnableEditing &&
  previous.onActivate === next.onActivate &&
  previous.onDeactivate === next.onDeactivate &&
  previous.onChangeValue === next.onChangeValue &&
  previous.onRegisterActiveEditor === next.onRegisterActiveEditor,
);
