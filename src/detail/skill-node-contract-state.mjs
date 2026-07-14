import { SUPPORTED_CONTRACT_VERSION } from "../skill-node-contract-version.mjs";

export function createSkillNodeContractEditorState({ status, contract = null, version = null, etag = null, error = null }) {
  if (!["loading", "ready", "error", "version_mismatch"].includes(status)) {
    throw new TypeError(`Unsupported skill node contract editor status: ${String(status)}.`);
  }
  if (status !== "ready") return blockedEditorState(status, error);
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return blockedEditorState("error", stateError(
      "SKILL_NODE_CONTRACT_STATE_CONTRACT_MISSING",
      "The ready editor state is missing its contract.",
    ));
  }
  if (!Number.isInteger(contract.contract_version)) {
    return blockedEditorState("version_mismatch", stateError(
      "SKILL_NODE_CONTRACT_STATE_CONTRACT_VERSION_MISSING",
      "The loaded contract is missing contract_version.",
    ));
  }
  if (contract.contract_version !== SUPPORTED_CONTRACT_VERSION) {
    return blockedEditorState("version_mismatch", stateError(
      "SKILL_NODE_CONTRACT_STATE_VERSION_UNSUPPORTED",
      `Unsupported skill node contract version: ${String(contract.contract_version)}.`,
      { actual: contract.contract_version, supported: SUPPORTED_CONTRACT_VERSION },
    ));
  }
  if (!Number.isInteger(version)) {
    return blockedEditorState("version_mismatch", stateError(
      "SKILL_NODE_CONTRACT_STATE_RESPONSE_VERSION_MISSING",
      "The contract response is missing its version.",
    ));
  }
  if (version !== contract.contract_version) {
    return blockedEditorState("version_mismatch", stateError(
      "SKILL_NODE_CONTRACT_STATE_RESPONSE_VERSION_MISMATCH",
      "The contract response version does not match contract.contract_version.",
      { contractVersion: contract.contract_version, responseVersion: version },
    ));
  }
  if (typeof etag !== "string" || etag.length === 0) {
    return blockedEditorState("error", stateError(
      "SKILL_NODE_CONTRACT_STATE_ETAG_MISSING",
      "The ready editor state is missing its ETag.",
    ));
  }
  return Object.freeze({
    status: "ready",
    canEdit: true,
    contract,
    version,
    etag,
    error: null,
  });
}

function blockedEditorState(status, error) {
  return Object.freeze({ status, canEdit: false, contract: null, version: null, etag: null, error });
}

function stateError(code, message, details = null) {
  return Object.freeze({ code, message, details });
}

export function validateSkillNodeContractSaveToken({ token, documentRoot, expectedVersion, expectedEtag }) {
  if (!token || typeof token !== "object" || !Number.isInteger(token.version) || typeof token.etag !== "string" || !token.etag) {
    return rejection("SKILL_NODE_CONTRACT_SAVE_TOKEN_MISSING", "A complete {version, etag} save token is required.");
  }
  if (token.version !== expectedVersion) {
    return rejection("SKILL_NODE_CONTRACT_SAVE_TOKEN_VERSION_MISMATCH", "The save token version does not match the loaded contract.");
  }
  if (token.etag !== expectedEtag) {
    return rejection("SKILL_NODE_CONTRACT_SAVE_TOKEN_ETAG_MISMATCH", "The save token ETag does not match the loaded contract.");
  }
  if (!documentRoot || typeof documentRoot !== "object" || Array.isArray(documentRoot)
    || !Number.isInteger(documentRoot.skill_node_contract_version)) {
    return rejection("SKILL_NODE_CONTRACT_ROOT_VERSION_MISSING", "The document root is missing skill_node_contract_version.");
  }
  if (documentRoot.skill_node_contract_version !== token.version) {
    return rejection("SKILL_NODE_CONTRACT_ROOT_VERSION_MISMATCH", "The document root contract version does not match the save token.");
  }
  return { ok: true };
}

function rejection(code, message) {
  return { ok: false, code, message };
}
