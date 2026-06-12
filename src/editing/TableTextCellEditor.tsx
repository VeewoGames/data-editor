import { useEffect, useRef, type KeyboardEvent } from "react";
import { StableTextarea, StableTextInput, type StableTextInputHandle } from "./StableTextInput";
import type { ActiveTextEditorHandle, ActiveTextEditorRegistrar } from "./types";

export type TableTextCellEditorProps = {
  cellId: string;
  value: unknown;
  wrapped?: boolean;
  autoFocus?: boolean;
  onChangeValue: (value: string) => void;
  onDeactivate?: () => void;
  onRegisterActiveEditor?: ActiveTextEditorRegistrar;
};

function stringifyValue(value: unknown) {
  return value == null ? "" : String(value);
}

export function TableTextCellEditor({
  cellId,
  value,
  wrapped = false,
  autoFocus = false,
  onChangeValue,
  onDeactivate,
  onRegisterActiveEditor,
}: TableTextCellEditorProps) {
  const inputRef = useRef<StableTextInputHandle | null>(null);
  const initialValueOnFocusRef = useRef(stringifyValue(value));
  const handleRef = useRef<ActiveTextEditorHandle | null>(null);

  function registerActiveEditor() {
    initialValueOnFocusRef.current = stringifyValue(value);
    const handle: ActiveTextEditorHandle = {
      identityKey: cellId,
      flushDraft: () => inputRef.current?.flushDraft(),
      cancelDraft: () => {
        inputRef.current?.replaceDraft(initialValueOnFocusRef.current);
        onChangeValue(initialValueOnFocusRef.current);
      },
    };
    handleRef.current = handle;
    onRegisterActiveEditor?.(handle);
  }

  function clearActiveEditor() {
    onRegisterActiveEditor?.(null, handleRef.current);
    handleRef.current = null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement> | KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      const initial = initialValueOnFocusRef.current;
      inputRef.current?.replaceDraft(initial);
      event.currentTarget.blur();
    }
  }

  useEffect(() => () => {
    onRegisterActiveEditor?.(null, handleRef.current);
  }, [onRegisterActiveEditor]);

  return (
    <div
      className={`table-text-cell-editor editable-cell cell-display cell-text-content ${wrapped ? "cell-text-wrap" : ""}`}
      data-cell-role="editor"
      data-wrap-mode={wrapped ? "wrap" : "truncate"}
      onClick={(event) => event.stopPropagation()}
    >
      {wrapped ? (
        <StableTextarea
          autoFocus={autoFocus}
          ref={inputRef}
          identityKey={cellId}
          value={value}
          commitMode="manual"
          onChangeValue={onChangeValue}
          onFocus={registerActiveEditor}
          onBlur={() => {
            inputRef.current?.flushDraft();
            clearActiveEditor();
            onDeactivate?.();
          }}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <StableTextInput
          autoFocus={autoFocus}
          ref={inputRef}
          identityKey={cellId}
          value={value}
          commitMode="manual"
          onChangeValue={onChangeValue}
          onFocus={registerActiveEditor}
          onBlur={() => {
            inputRef.current?.flushDraft();
            clearActiveEditor();
            onDeactivate?.();
          }}
          onKeyDown={handleKeyDown}
        />
      )}
    </div>
  );
}
