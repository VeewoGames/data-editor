import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSkillNodeContractCache,
  loadAutomationSkillCatalog,
  runEntryAction,
  saveAutomationBindings,
  saveAutomationProfile,
  saveDocument,
  saveViewProfile,
  validateAutomationBindings,
} from "../src/api/client.ts";

test("entry action client preserves structured protocol-disabled errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: "条目自动化写回协议正在安全升级，当前禁止启动新任务。",
    code: "ENTRY_ACTION_PROTOCOL_DISABLED",
    field: "entryAction",
    details: { protocolMode: "legacy-disabled" },
  }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });

  try {
    await assert.rejects(
      () => runEntryAction({
        projectId: "project-1",
        actionId: "recheck",
        sourcePath: "data/items.json",
        collectionPath: "items",
        rowId: "items:1",
        sourceRowIndex: 1,
      }),
      (error) => {
        assert.equal(error.message, "条目自动化写回协议正在安全升级，当前禁止启动新任务。");
        assert.equal(error.code, "ENTRY_ACTION_PROTOCOL_DISABLED");
        assert.equal(error.status, 503);
        assert.equal(error.field, "entryAction");
        assert.deepEqual(error.details, { protocolMode: "legacy-disabled" });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("skill document saves carry contract version, ETag, and a project-scoped token", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  clearSkillNodeContractCache();
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).startsWith("/api/skill-node-contract")) {
      return new Response(JSON.stringify({ contract_version: 1 }), {
        status: 200,
        headers: { "content-type": "application/json", etag: '"contract-a"' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await saveDocument(
      "data/content/skills.json",
      { skill_node_contract_version: 1, skills: [] },
      "project-a",
      '"document-a"',
    );
  } finally {
    globalThis.fetch = originalFetch;
    clearSkillNodeContractCache();
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/skill-node-contract?projectId=project-a");
  assert.equal(calls[1].url, "/api/save");
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.contractVersion, 1);
  assert.equal(body.contractEtag, '"contract-a"');
  assert.equal(body.documentEtag, '"document-a"');
  assert.deepEqual(body.saveToken, {
    projectId: "project-a",
    contractVersion: 1,
    etag: '"contract-a"',
  });
});

test("non-skill document saves do not load or carry the skill contract gate", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  clearSkillNodeContractCache();
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await saveDocument("data/content/traits.json", { traits: [] }, "project-a");
  } finally {
    globalThis.fetch = originalFetch;
    clearSkillNodeContractCache();
  }

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal("contractVersion" in body, false);
  assert.equal("contractEtag" in body, false);
  assert.equal("saveToken" in body, false);
});

test("saveViewProfile does not use keepalive for profile autosave requests", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      },
    };
  };

  try {
    await saveViewProfile("Lans", {
      sidebarWidth: null,
      detailPanelWidth: null,
      detailDocumentPanelOpen: null,
      detailDocumentPanelWidth: null,
      fileOrder: [],
      sidebarTree: { childOrderByParent: {}, expandedNodeIds: [] },
      lastActiveViews: {},
      viewDrafts: {},
      viewOrderDrafts: {},
      viewLayouts: {},
      collections: {},
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/view-profile");
  assert.equal("keepalive" in calls[0].options, false);
});

test("saveAutomationProfile posts the profile payload without keepalive", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      },
    };
  };

  try {
    await saveAutomationProfile({
      rules: [
        {
          id: "recheck",
          label: "Recheck",
          icon: "refresh",
          enabled: true,
          targets: [{ file: "data/skills.json", collection: "skills" }],
          payload: { includeRow: true, includeNeighbors: true },
        },
      ],
    }, "project-1");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/automation-profile");
  assert.equal("keepalive" in calls[0].options, false);
});

test("saveAutomationBindings posts the bindings payload", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      },
    };
  };

  try {
    await saveAutomationBindings({
      bindings: {
        recheck: {
          provider: "codex",
          skill: "recheck",
          enabled: true,
        },
      },
    }, "project-1");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/automation-bindings");
  assert.equal("keepalive" in calls[0].options, false);
});

test("validateAutomationBindings posts validateOnly to the bindings endpoint", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, validated: true };
      },
    };
  };

  try {
    await validateAutomationBindings({
      bindings: {
        recheck: {
          provider: "codex",
          skill: "recheck",
          enabled: true,
        },
      },
    }, "project-1");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/automation-bindings");
  const body = JSON.parse(String(calls[0].options.body));
  assert.equal(body.validateOnly, true);
});

test("loadAutomationSkillCatalog reads the catalog endpoint with projectId", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { provider: "codex", loadedAt: "2026-07-08T12:00:00.000Z", skills: [] };
      },
    };
  };

  try {
    await loadAutomationSkillCatalog("project-1");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/automation-skill-catalog?projectId=project-1");
});
