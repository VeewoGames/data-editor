import assert from "node:assert/strict";
import test from "node:test";
import { saveViewProfile } from "../src/api/client.ts";

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
