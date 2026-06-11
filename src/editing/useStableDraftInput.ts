import { useCallback, useEffect, useRef, useState } from "react";

export type StableDraftInputCommitMode = "realtime" | "debounced" | "manual";

export type StableDraftInputOptions = {
  identityKey: string;
  value: unknown;
  commitMode?: StableDraftInputCommitMode;
  commitDelayMs?: number;
  onChangeValue: (value: string) => void;
};

export type StableDraftInputApi = {
  draft: string;
  composing: boolean;
  setDraftFromInput: (next: string, nativeEvent?: Event) => void;
  handleFocus: () => void;
  handleBlur: () => void;
  handleCompositionStart: () => void;
  handleCompositionEnd: (next: string) => void;
  flushDraft: () => void;
  replaceDraft: (next: string) => void;
};

function stringifyValue(value: unknown) {
  return value == null ? "" : String(value);
}

function isCompositionInput(nativeEvent?: Event) {
  return Boolean(nativeEvent && "isComposing" in nativeEvent && (nativeEvent as InputEvent).isComposing);
}

export function useStableDraftInput({
  identityKey,
  value,
  commitMode = "realtime",
  commitDelayMs = 150,
  onChangeValue,
}: StableDraftInputOptions): StableDraftInputApi {
  const initialValue = stringifyValue(value);
  const [draft, setDraft] = useState(initialValue);
  const [composing, setComposing] = useState(false);
  const draftRef = useRef(initialValue);
  const focusedRef = useRef(false);
  const composingRef = useRef(false);
  const lastCommittedDraftRef = useRef(initialValue);
  const onChangeValueRef = useRef(onChangeValue);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    onChangeValueRef.current = onChangeValue;
  }, [onChangeValue]);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const commitDraft = useCallback((next: string) => {
    clearTimer();
    if (lastCommittedDraftRef.current === next) return;
    lastCommittedDraftRef.current = next;
    onChangeValueRef.current(next);
  }, [clearTimer]);

  const scheduleCommit = useCallback((next: string) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commitDraft(next);
    }, commitDelayMs);
  }, [clearTimer, commitDelayMs, commitDraft]);

  useEffect(() => {
    const next = stringifyValue(value);
    clearTimer();
    draftRef.current = next;
    lastCommittedDraftRef.current = next;
    setDraft(next);
    composingRef.current = false;
    setComposing(false);
  }, [identityKey, clearTimer]);

  useEffect(() => {
    const next = stringifyValue(value);
    if (focusedRef.current || composingRef.current) return;
    draftRef.current = next;
    lastCommittedDraftRef.current = next;
    setDraft(next);
  }, [value]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const setDraftFromInput = useCallback((next: string, nativeEvent?: Event) => {
    draftRef.current = next;
    setDraft(next);
    if (composingRef.current || isCompositionInput(nativeEvent)) return;
    if (commitMode === "manual") return;
    if (commitMode === "debounced") {
      scheduleCommit(next);
      return;
    }
    commitDraft(next);
  }, [commitDraft, commitMode, scheduleCommit]);

  const flushDraft = useCallback(() => {
    commitDraft(draftRef.current);
  }, [commitDraft]);

  const replaceDraft = useCallback((next: string) => {
    clearTimer();
    draftRef.current = next;
    setDraft(next);
  }, [clearTimer]);

  const handleFocus = useCallback(() => {
    focusedRef.current = true;
  }, []);

  const handleBlur = useCallback(() => {
    focusedRef.current = false;
    flushDraft();
  }, [flushDraft]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    setComposing(true);
  }, []);

  const handleCompositionEnd = useCallback((next: string) => {
    composingRef.current = false;
    setComposing(false);
    draftRef.current = next;
    setDraft(next);
    if (commitMode === "manual") return;
    if (commitMode === "debounced") {
      scheduleCommit(next);
      return;
    }
    commitDraft(next);
  }, [commitDraft, commitMode, scheduleCommit]);

  return {
    draft,
    composing,
    setDraftFromInput,
    handleFocus,
    handleBlur,
    handleCompositionStart,
    handleCompositionEnd,
    flushDraft,
    replaceDraft,
  };
}
