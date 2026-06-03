export async function saveDocumentsWith(items, saveDocumentFn) {
  const savedPaths = [];
  for (const item of items ?? []) {
    try {
      await saveDocumentFn(item.path, item.root);
      savedPaths.push(item.path);
    } catch (error) {
      return {
        ok: false,
        savedPaths,
        failedPath: item.path,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    ok: true,
    savedPaths,
    failedPath: null,
    errorMessage: null,
  };
}
