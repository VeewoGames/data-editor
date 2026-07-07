import assert from "node:assert/strict";
import test from "node:test";
import { saveAutomationBindings, saveAutomationProfile, saveViewProfile } from "../src/api/client.ts";

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
