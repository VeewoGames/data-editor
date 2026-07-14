export const skillDocumentPath = "data/content/skills.json";

export async function saveDocumentsWith(items, saveDocumentFn, options = {}) {
  const savedPaths = [];
  for (const item of items ?? []) {
    try {
      const contractGate = await buildContractSaveGate(item.path, options);
      await saveDocumentFn(item.path, item.root, contractGate);
      savedPaths.push(item.path);
    } catch (error) {
      return {
        ok: false,
        savedPaths,
        failedPath: item.path,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode: typeof error?.code === "string" ? error.code : null,
        errorField: typeof error?.field === "string" ? error.field : null,
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
  };
}

export function isSkillDocumentPath(documentPath) {
  if (typeof documentPath !== "string") return false;
  return documentPath.replaceAll("\\", "/").replace(/^\.\//, "") === skillDocumentPath;
}

async function buildContractSaveGate(documentPath, { projectId, loadSkillNodeContract } = {}) {
  if (!isSkillDocumentPath(documentPath)) return null;
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (!normalizedProjectId) {
    throw saveGateError(
      "SKILL_NODE_CONTRACT_SAVE_PROJECT_REQUIRED",
      "projectId is required to save the skill document.",
      "projectId",
    );
  }
  if (typeof loadSkillNodeContract !== "function") {
    throw saveGateError(
      "SKILL_NODE_CONTRACT_SAVE_GATE_UNAVAILABLE",
      "The skill node contract save gate is unavailable.",
      "saveToken",
    );
  }

  const loaded = await loadSkillNodeContract(normalizedProjectId);
  if (loaded?.projectId !== normalizedProjectId) {
    throw saveGateError(
      "SKILL_NODE_CONTRACT_SAVE_TOKEN_PROJECT_MISMATCH",
      "The loaded contract belongs to a different project.",
      "saveToken.projectId",
    );
  }
  if (!Number.isInteger(loaded?.version)) {
    throw saveGateError(
      "SKILL_NODE_CONTRACT_SAVE_VERSION_MISSING",
      "The loaded contract is missing its version.",
      "contractVersion",
    );
  }
  if (typeof loaded?.etag !== "string" || !loaded.etag) {
    throw saveGateError(
      "SKILL_NODE_CONTRACT_SAVE_ETAG_MISSING",
      "The loaded contract is missing its ETag.",
      "contractEtag",
    );
  }

  return {
    contractVersion: loaded.version,
    contractEtag: loaded.etag,
    saveToken: {
      projectId: normalizedProjectId,
      contractVersion: loaded.version,
      etag: loaded.etag,
    },
  };
}

function saveGateError(code, message, field) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}
