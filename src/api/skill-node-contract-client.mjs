import { SUPPORTED_CONTRACT_VERSION } from "../skill-node-contract-version.mjs";

export class SkillNodeContractClientError extends Error {
  constructor(code, message, { status = null, details = null } = {}) {
    super(message);
    this.name = "SkillNodeContractClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createSkillNodeContractClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function.");
  const projects = new Map();

  return {
    load(projectId) {
      const normalizedProjectId = normalizeProjectId(projectId);
      const state = projectState(projects, normalizedProjectId);
      if (!state.inFlight) startProjectRequest(state, normalizedProjectId, fetchImpl);
      return state.inFlight.promise.then((entry) => cloneLoadedEntry(entry));
    },

    clear(projectId) {
      if (projectId == null) {
        for (const state of projects.values()) invalidateProjectState(state);
        projects.clear();
        return;
      }
      const normalizedProjectId = normalizeProjectId(projectId);
      const state = projects.get(normalizedProjectId);
      if (!state) return;
      invalidateProjectState(state);
      projects.delete(normalizedProjectId);
    },
  };
}

function projectState(projects, projectId) {
  let state = projects.get(projectId);
  if (!state) {
    state = { generation: 0, cache: null, inFlight: null };
    projects.set(projectId, state);
  }
  return state;
}

function startProjectRequest(state, projectId, fetchImpl) {
  const generation = state.generation + 1;
  state.generation = generation;
  const cached = state.cache;
  const headers = cached ? { "if-none-match": cached.etag } : undefined;
  const promise = Promise.resolve()
    .then(() => fetchImpl(
      `/api/skill-node-contract?projectId=${encodeURIComponent(projectId)}`,
      headers ? { headers } : undefined,
    ))
    .then(async (response) => {
      assertCurrentGeneration(state, generation);
      if (response.status === 304) {
        if (!cached) {
          throw new SkillNodeContractClientError(
            "SKILL_NODE_CONTRACT_CACHE_MISS",
            "Contract server returned 304 without a project-local cache entry.",
            { status: 304 },
          );
        }
        return { ...cached, fromCache: true };
      }

      if (!response.ok) {
        const body = await readJsonResponse(response);
        assertCurrentGeneration(state, generation);
        throw new SkillNodeContractClientError(
          typeof body?.code === "string" ? body.code : "SKILL_NODE_CONTRACT_REQUEST_FAILED",
          typeof body?.error === "string" ? body.error : `HTTP ${response.status}`,
          { status: response.status, details: body?.details ?? null },
        );
      }

      const etag = response.headers.get("etag");
      if (!etag) {
        throw new SkillNodeContractClientError(
          "SKILL_NODE_CONTRACT_ETAG_MISSING",
          "Contract response is missing its ETag.",
          { status: response.status },
        );
      }
      const contract = await readJsonResponse(response);
      assertCurrentGeneration(state, generation);
      if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
        throw new SkillNodeContractClientError("SKILL_NODE_CONTRACT_RESPONSE_INVALID", "Contract response must be an object.");
      }
      if (contract.contract_version !== SUPPORTED_CONTRACT_VERSION) {
        throw new SkillNodeContractClientError(
          "SKILL_NODE_CONTRACT_VERSION_UNSUPPORTED",
          `Unsupported skill node contract version: ${String(contract.contract_version)}.`,
          {
            status: response.status,
            details: { actual: contract.contract_version, supported: SUPPORTED_CONTRACT_VERSION },
          },
        );
      }

      const entry = deepFreeze({
        projectId,
        contract: structuredClone(contract),
        version: contract.contract_version,
        etag,
        fromCache: false,
      });
      assertCurrentGeneration(state, generation);
      state.cache = entry;
      return entry;
    })
    .finally(() => {
      if (state.inFlight?.generation === generation) state.inFlight = null;
    });
  state.inFlight = { generation, promise };
}

function invalidateProjectState(state) {
  state.generation += 1;
  state.cache = null;
  state.inFlight = null;
}

function assertCurrentGeneration(state, generation) {
  if (state.generation !== generation) {
    throw new SkillNodeContractClientError(
      "SKILL_NODE_CONTRACT_REQUEST_INVALIDATED",
      "The skill node contract request was invalidated before completion.",
    );
  }
}

function cloneLoadedEntry(entry) {
  return { ...entry, contract: structuredClone(entry.contract) };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeProjectId(projectId) {
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new SkillNodeContractClientError("SKILL_NODE_CONTRACT_PROJECT_REQUIRED", "projectId is required.");
  }
  return projectId.trim();
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new SkillNodeContractClientError(
      "SKILL_NODE_CONTRACT_RESPONSE_INVALID_JSON",
      "Contract response contains invalid JSON.",
      { status: response.status, details: error instanceof Error ? error.message : String(error) },
    );
  }
}
