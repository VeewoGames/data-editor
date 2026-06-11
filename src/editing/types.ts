export type ActiveTextEditorHandle = {
  identityKey: string;
  flushDraft: () => void;
  cancelDraft?: () => void;
};

export type ActiveTextEditorRegistrar = (
  handle: ActiveTextEditorHandle | null,
  sourceHandle?: ActiveTextEditorHandle | null,
) => void;
