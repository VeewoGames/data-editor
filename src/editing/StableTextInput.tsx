import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEventHandler } from "react";
import { useStableDraftInput, type StableDraftInputApi, type StableDraftInputCommitMode } from "./useStableDraftInput";

export type StableTextInputHandle = Pick<StableDraftInputApi, "flushDraft" | "replaceDraft">;

export type StableTextInputProps = {
  identityKey: string;
  value: unknown;
  className?: string;
  title?: string;
  placeholder?: string;
  commitMode?: StableDraftInputCommitMode;
  commitDelayMs?: number;
  onChangeValue: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
};

export type StableTextareaProps = Omit<StableTextInputProps, "onKeyDown"> & {
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
};

export const StableTextInput = forwardRef<StableTextInputHandle, StableTextInputProps>(function StableTextInput(
  {
    identityKey,
    value,
    className,
    title,
    placeholder,
    commitMode,
    commitDelayMs,
    onChangeValue,
    onFocus,
    onBlur,
    onKeyDown,
  },
  ref,
) {
  const api = useStableDraftInput({ identityKey, value, commitMode, commitDelayMs, onChangeValue });
  useImperativeHandle(ref, () => ({
    flushDraft: api.flushDraft,
    replaceDraft: api.replaceDraft,
  }), [api.flushDraft, api.replaceDraft]);
  return (
    <input
      className={className}
      title={title}
      placeholder={placeholder}
      value={api.draft}
      onFocus={() => {
        api.handleFocus();
        onFocus?.();
      }}
      onBlur={() => {
        api.handleBlur();
        onBlur?.();
      }}
      onInput={(event) => api.setDraftFromInput(event.currentTarget.value, event.nativeEvent)}
      onCompositionStart={api.handleCompositionStart}
      onCompositionEnd={(event) => api.handleCompositionEnd(event.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  );
});

export const StableTextarea = forwardRef<StableTextInputHandle, StableTextareaProps>(function StableTextarea(
  {
    identityKey,
    value,
    className,
    title,
    placeholder,
    commitMode,
    commitDelayMs,
    onChangeValue,
    onFocus,
    onBlur,
    onKeyDown,
  },
  ref,
) {
  const api = useStableDraftInput({ identityKey, value, commitMode, commitDelayMs, onChangeValue });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function syncHeight(node: HTMLTextAreaElement | null = textareaRef.current) {
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${node.scrollHeight}px`;
  }

  useImperativeHandle(ref, () => ({
    flushDraft: api.flushDraft,
    replaceDraft: api.replaceDraft,
  }), [api.flushDraft, api.replaceDraft]);

  useLayoutEffect(() => {
    syncHeight();
  }, [api.draft]);

  return (
    <textarea
      className={className}
      title={title}
      placeholder={placeholder}
      value={api.draft}
      onFocus={() => {
        api.handleFocus();
        onFocus?.();
      }}
      onBlur={() => {
        api.handleBlur();
        onBlur?.();
      }}
      onInput={(event) => {
        syncHeight(event.currentTarget);
        api.setDraftFromInput(event.currentTarget.value, event.nativeEvent);
      }}
      onCompositionStart={api.handleCompositionStart}
      onCompositionEnd={(event) => api.handleCompositionEnd(event.currentTarget.value)}
      onKeyDown={onKeyDown}
      ref={(node) => {
        textareaRef.current = node;
        syncHeight(node);
      }}
      rows={1}
      style={{ overflowY: "hidden" }}
    />
  );
});

