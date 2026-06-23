import test from "node:test";
import assert from "node:assert/strict";
import {
  claimStreamlineTab,
  findPreferredStreamlineTab,
  runStreamlineSvgExtractionWithBrowser,
} from "../../scripts/streamline-export/lib/chrome-session.mjs";

test("findPreferredStreamlineTab prefers Streamline detail pages", () => {
  const tab = findPreferredStreamlineTab([
    { id: "1", url: "https://www.streamlinehq.com/profile" },
    { id: "2", url: "https://www.streamlinehq.com/icons/download/cut-scissor--26582" },
  ]);

  assert.equal(tab.id, "2");
});

test("findPreferredStreamlineTab falls back to generic Streamline tab", () => {
  const tab = findPreferredStreamlineTab([
    { id: "1", url: "https://www.example.com/" },
    { id: "2", url: "https://www.streamlinehq.com/icons/micro-solid" },
  ]);

  assert.equal(tab.id, "2");
});

test("claimStreamlineTab claims the preferred tab", async () => {
  const claimed = { id: "claimed-tab" };
  const browser = {
    user: {
      async openTabs() {
        return [{ id: "2", url: "https://www.streamlinehq.com/icons/download/cut-scissor--26582" }];
      },
      async claimTab(tab) {
        assert.equal(tab.id, "2");
        return claimed;
      },
    },
  };

  const tab = await claimStreamlineTab(browser);
  assert.equal(tab, claimed);
});

test("runStreamlineSvgExtractionWithBrowser finalizes after extraction", async () => {
  const calls = [];
  const browser = {
    async nameSession(name) {
      calls.push(["nameSession", name]);
    },
    user: {
      async openTabs() {
        calls.push(["openTabs"]);
        return [{ id: "2", url: "https://www.streamlinehq.com/icons/download/cut-scissor--26582" }];
      },
      async claimTab(tab) {
        calls.push(["claimTab", tab.id]);
        return { id: "claimed" };
      },
    },
    tabs: {
      async finalize(options) {
        calls.push(["finalize", options]);
      },
    },
  };

  const result = await runStreamlineSvgExtractionWithBrowser({
    browser,
    manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-pilot.manifest.json",
    sessionName: "test-session",
    runManifestExtraction: async ({ manifestPath, tab, attempts, waitMs }) => {
      calls.push(["runManifestExtraction", manifestPath, tab.id, attempts, waitMs]);
      return { success: 10, failed: 0 };
    },
    attempts: 8,
    waitMs: 123,
  });

  assert.deepEqual(result, { success: 10, failed: 0 });
  assert.deepEqual(calls, [
    ["nameSession", "test-session"],
    ["openTabs"],
    ["claimTab", "2"],
    ["runManifestExtraction", "C:/Code/data-editor/artifacts/streamline-export/micro-solid-pilot.manifest.json", "claimed", 8, 123],
    ["finalize", { keep: [] }],
  ]);
});
