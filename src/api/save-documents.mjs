export async function saveDocumentsWith(items, saveDocumentFn, options = {}) {
  const savedPaths = [];
  /** @type {Record<string, string>} */
  const documentEtags = {};
  for (const item of items ?? []) {
    try {
      const contractGate = await buildContractSaveGate(item.path, options);
      const idempotencyKey = item.idempotencyKey ?? crypto.randomUUID();
      const saved = await saveDocumentFn(item.path, item.root, contractGate, item.documentEtag, idempotencyKey);
      savedPaths.push(item.path);
      if (typeof saved?.documentEtag === "string" && saved.documentEtag) documentEtags[item.path] = saved.documentEtag;
    } catch (error) {
      return {
        ok: false,
        savedPaths,
        failedPath: item.path,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode: typeof error?.code === "string" ? error.code : null,
        errorField: typeof error?.field === "string" ? error.field : null,
        documentEtags,
      };
    }
  }
  return {
    ok: true,
    savedPaths,
    failedPath: null,
    errorMessage: null,
    errorCode: null,
    errorField: null,
    documentEtags,
  };
}

async function buildContractSaveGate(documentPath, { projectId, loadDocumentContracts } = {}) {
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (!normalizedProjectId || typeof loadDocumentContracts !== "function") return { documentContracts: [] };
  const loaded = await loadDocumentContracts(normalizedProjectId, documentPath);
  if (loaded?.projectId !== normalizedProjectId || !Array.isArray(loaded?.documentContracts)) {
    const error = new Error("Document contract save gate response is invalid.");
    error.code = "DOCUMENT_CONTRACT_GATE_INVALID";
    error.field = "documentContracts";
    throw error;
  }
  return { documentContracts: loaded.documentContracts };
}
