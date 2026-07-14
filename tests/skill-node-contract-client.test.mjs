import assert from "node:assert/strict";
import test from "node:test";
import {
  createSkillNodeContractClient,
  SkillNodeContractClientError,
} from "../src/api/skill-node-contract-client.mjs";
import {
  createSkillNodeContractEditorState,
  validateSkillNodeContractSaveToken,
} from "../src/detail/skill-node-contract-state.mjs";

test("skill node contract client caches independently by projectId and refreshes changed ETags", async () => {
  const requests = [];
  let projectARevision = 1;
  const client = createSkillNodeContractClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, ifNoneMatch: options?.headers?.["if-none-match"] ?? null });
      const projectId = new URL(url, "http://localhost").searchParams.get("projectId");
      const etag = projectId === "project-a" ? `"a-${projectARevision}"` : '"b-1"';
      if (options?.headers?.["if-none-match"] === etag) return response(null, 304, etag);
      return response({ contract_version: 1, marker: `${projectId}-${projectARevision}` }, 200, etag);
    },
  });

  const firstA = await client.load("project-a");
  const firstB = await client.load("project-b");
  const cachedA = await client.load("project-a");
  assert.equal(firstA.contract.marker, "project-a-1");
  assert.equal(firstB.contract.marker, "project-b-1");
  assert.equal(cachedA.fromCache, true);
  assert.equal(requests[2].ifNoneMatch, '"a-1"');

  projectARevision = 2;
  const refreshedA = await client.load("project-a");
  assert.equal(refreshedA.contract.marker, "project-a-2");
  assert.equal(refreshedA.etag, '"a-2"');
  assert.equal((await client.load("project-b")).contract.marker, "project-b-1");
});

test("skill node contract client blocks missing ETag and unsupported versions", async () => {
  const missingEtag = createSkillNodeContractClient({
    fetchImpl: async () => new Response(JSON.stringify({ contract_version: 1 }), { status: 200 }),
  });
  await assert.rejects(() => missingEtag.load("project-a"), (error) => {
    assert.ok(error instanceof SkillNodeContractClientError);
    assert.equal(error.code, "SKILL_NODE_CONTRACT_ETAG_MISSING");
    return true;
  });

  const versionMismatch = createSkillNodeContractClient({
    fetchImpl: async () => response({ contract_version: 2 }, 200, '"v2"'),
  });
  await assert.rejects(() => versionMismatch.load("project-a"), (error) => {
    assert.equal(error.code, "SKILL_NODE_CONTRACT_VERSION_UNSUPPORTED");
    return true;
  });
});

test("skill node contract client single-flights concurrent loads per project", async () => {
  const pending = deferred();
  let requestCount = 0;
  const client = createSkillNodeContractClient({
    fetchImpl: async () => {
      requestCount += 1;
      return pending.promise;
    },
  });
  const first = client.load("project-a");
  const second = client.load("project-a");
  await Promise.resolve();
  assert.equal(requestCount, 1);
  pending.resolve(response({ contract_version: 1, nested: { value: "shared" } }, 200, '"v1"'));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.notEqual(firstResult.contract, secondResult.contract);
  assert.deepEqual(firstResult.contract, secondResult.contract);
});

test("skill node contract client prevents stale out-of-order responses from replacing a newer cache", async () => {
  const requests = [];
  const client = createSkillNodeContractClient({
    fetchImpl: async (_url, options) => {
      const pending = deferred();
      requests.push({ pending, ifNoneMatch: options?.headers?.["if-none-match"] ?? null });
      return pending.promise;
    },
  });

  const stale = client.load("project-a");
  await waitForRequestCount(requests, 1);
  client.clear("project-a");
  const fresh = client.load("project-a");
  await waitForRequestCount(requests, 2);
  requests[1].pending.resolve(response({ contract_version: 1, marker: "new" }, 200, '"new"'));
  assert.equal((await fresh).contract.marker, "new");

  const staleRejection = assert.rejects(stale, (error) => error.code === "SKILL_NODE_CONTRACT_REQUEST_INVALIDATED");
  requests[0].pending.resolve(response({ contract_version: 1, marker: "old" }, 200, '"old"'));
  await staleRejection;

  const cached = client.load("project-a");
  await waitForRequestCount(requests, 3);
  assert.equal(requests[2].ifNoneMatch, '"new"');
  requests[2].pending.resolve(response(null, 304, '"new"'));
  assert.equal((await cached).contract.marker, "new");
});

test("skill node contract client clear invalidates all in-flight requests", async () => {
  const pending = deferred();
  const client = createSkillNodeContractClient({ fetchImpl: async () => pending.promise });
  const load = client.load("project-a");
  await Promise.resolve();
  client.clear();
  const rejection = assert.rejects(load, (error) => error.code === "SKILL_NODE_CONTRACT_REQUEST_INVALIDATED");
  pending.resolve(response({ contract_version: 1 }, 200, '"stale"'));
  await rejection;
});

test("skill node contract client rejects 304 without cache", async () => {
  const client = createSkillNodeContractClient({ fetchImpl: async () => response(null, 304, '"missing"') });
  await assert.rejects(() => client.load("project-a"), (error) => error.code === "SKILL_NODE_CONTRACT_CACHE_MISS");
});

test("skill node contract client isolates returned contracts from its frozen cache", async () => {
  let requestCount = 0;
  const client = createSkillNodeContractClient({
    fetchImpl: async (_url, options) => {
      requestCount += 1;
      if (options?.headers?.["if-none-match"] === '"v1"') return response(null, 304, '"v1"');
      return response({ contract_version: 1, nested: { value: "original" } }, 200, '"v1"');
    },
  });
  const first = await client.load("project-a");
  first.contract.nested.value = "mutated";
  const cached = await client.load("project-a");
  assert.equal(requestCount, 2);
  assert.equal(cached.fromCache, true);
  assert.equal(cached.contract.nested.value, "original");
});

test("isolated contract editor blocks loading, error, and version mismatch states", () => {
  for (const status of ["loading", "error", "version_mismatch"]) {
    const state = createSkillNodeContractEditorState({ status, error: status });
    assert.equal(state.canEdit, false);
    assert.equal(state.contract, null);
  }
  const ready = createSkillNodeContractEditorState({
    status: "ready",
    contract: { contract_version: 1 },
    version: 1,
    etag: '"ready"',
  });
  assert.equal(ready.canEdit, true);
});

test("isolated contract editor validates supported contract and response versions itself", () => {
  const base = { status: "ready", etag: '"ready"' };
  const cases = [
    [{ ...base, contract: {} }, "SKILL_NODE_CONTRACT_STATE_CONTRACT_VERSION_MISSING"],
    [{ ...base, contract: { contract_version: 2 }, version: 2 }, "SKILL_NODE_CONTRACT_STATE_VERSION_UNSUPPORTED"],
    [{ ...base, contract: { contract_version: 1 } }, "SKILL_NODE_CONTRACT_STATE_RESPONSE_VERSION_MISSING"],
    [{ ...base, contract: { contract_version: 1 }, version: 2 }, "SKILL_NODE_CONTRACT_STATE_RESPONSE_VERSION_MISMATCH"],
  ];
  for (const [input, code] of cases) {
    const state = createSkillNodeContractEditorState(input);
    assert.equal(state.canEdit, false);
    assert.equal(state.error.code, code);
  }
});

test("save token helper rejects missing, version, ETag, and document-root mismatches", () => {
  const base = {
    token: { version: 1, etag: '"etag"' },
    expectedVersion: 1,
    expectedEtag: '"etag"',
    documentRoot: { skill_node_contract_version: 1 },
  };
  assert.equal(validateSkillNodeContractSaveToken({ ...base, token: null }).code, "SKILL_NODE_CONTRACT_SAVE_TOKEN_MISSING");
  assert.equal(validateSkillNodeContractSaveToken({ ...base, token: { version: 2, etag: '"etag"' } }).code, "SKILL_NODE_CONTRACT_SAVE_TOKEN_VERSION_MISMATCH");
  assert.equal(validateSkillNodeContractSaveToken({ ...base, token: { version: 1, etag: '"old"' } }).code, "SKILL_NODE_CONTRACT_SAVE_TOKEN_ETAG_MISMATCH");
  assert.equal(validateSkillNodeContractSaveToken({ ...base, documentRoot: {} }).code, "SKILL_NODE_CONTRACT_ROOT_VERSION_MISSING");
  assert.equal(validateSkillNodeContractSaveToken({ ...base, documentRoot: { skill_node_contract_version: 2 } }).code, "SKILL_NODE_CONTRACT_ROOT_VERSION_MISMATCH");
  assert.deepEqual(validateSkillNodeContractSaveToken(base), { ok: true });
});

function response(body, status, etag) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: etag ? { etag, "content-type": "application/json" } : undefined,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForRequestCount(requests, count) {
  while (requests.length < count) await Promise.resolve();
}
