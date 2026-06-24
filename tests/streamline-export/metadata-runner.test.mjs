import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  updateManifestItemMetadata,
} from "../../scripts/streamline-export/lib/manifest-store.mjs";
import {
  runStreamlineMetadataExtractionFromNodeRepl,
  runStreamlineMetadataExtractionLoopFromNodeRepl,
  runStreamlineMetadataHybridLoop,
  runStreamlineMetadataSyncLoopFromMcp,
} from "../../scripts/streamline-export/run-streamline-metadata-session.mjs";
import { DEFAULT_STREAMLINE_HUMAN_METADATA_PACING } from "../../scripts/streamline-export/lib/streamline-metadata-session.mjs";

test("runStreamlineMetadataExtractionFromNodeRepl delegates to browser runner", async () => {
  const calls = [];
  const acquireTab = async () => ({ id: "tab-1" });
  const result = await runStreamlineMetadataExtractionFromNodeRepl({
    manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-full.manifest.json",
    sessionName: "metadata-runner",
    waitMs: 700,
    maxItems: 5,
    force: true,
    concurrency: 4,
    acquireTab,
    connectBrowser: async () => {
      calls.push(["connectBrowser"]);
      return { id: "browser-2" };
    },
    runWithBrowser: async (options) => {
      calls.push(["runWithBrowser", options]);
      return { success: 5, failed: 0 };
    },
    syncRegistry: async (value) => {
      calls.push(["syncRegistry", value]);
    },
  });

  assert.deepEqual(result, { success: 5, failed: 0 });
  assert.equal(calls[0][0], "connectBrowser");
  assert.deepEqual(calls[1], [
    "runWithBrowser",
    {
      browser: { id: "browser-2" },
      manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-full.manifest.json",
      sessionName: "metadata-runner",
      waitMs: 700,
      postLoadJitterMs: undefined,
      preNavigationDelayMs: undefined,
      preNavigationJitterMs: undefined,
      postItemDelayMs: undefined,
      postItemJitterMs: undefined,
      maxItems: 5,
      force: true,
      retryFailed: false,
      itemIds: undefined,
      concurrency: 4,
      humanMode: false,
      acquireTab,
    },
  ]);
  assert.deepEqual(calls[2], [
    "syncRegistry",
    "C:/Code/data-editor/artifacts/streamline-export/micro-solid-full.manifest.json",
  ]);
});

test("runStreamlineMetadataExtractionLoopFromNodeRepl batches until metadata manifest is complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-loop-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://example.test/attachment-1" },
      { slug: "binocular", name: "Binocular", iconUrl: "https://example.test/binocular" },
      { slug: "bomb", name: "Bomb", iconUrl: "https://example.test/bomb" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const connectCalls = [];
  const runCalls = [];
  const syncCalls = [];
  const batches = [
    ["attachment-1", "binocular"],
    ["bomb"],
  ];

  const result = await runStreamlineMetadataExtractionLoopFromNodeRepl({
    manifestPath,
    batchSize: 2,
    maxBatches: 3,
    concurrency: 2,
    connectBrowser: async () => {
      const browser = { id: `browser-meta-${connectCalls.length + 1}` };
      connectCalls.push(browser.id);
      return browser;
    },
    runWithBrowser: async (options) => {
      runCalls.push({ browser: options.browser, maxItems: options.maxItems, concurrency: options.concurrency });
      for (const slug of batches.shift() ?? []) {
        await updateManifestItemMetadata({
          manifestPath,
          slug,
          tags: [slug, "tagged"],
          metadataStatus: "success",
          metadataUpdatedAt: "2026-06-24T10:00:00.000Z",
        });
      }
      return { success: options.maxItems, failed: 0 };
    },
    syncRegistry: async (value) => {
      syncCalls.push(value);
    },
  });

  assert.deepEqual(connectCalls, ["browser-meta-1", "browser-meta-2"]);
  assert.equal(runCalls.length, 2);
  assert.equal(runCalls[0].maxItems, 2);
  assert.equal(runCalls[0].concurrency, 2);
  assert.deepEqual(syncCalls, [manifestPath]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.after, {
    total: 3,
    pending: 0,
    success: 3,
    failed: 0,
    withTags: 3,
  });
});

test("runStreamlineMetadataExtractionLoopFromNodeRepl can reuse one browser across batches", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-loop-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://example.test/attachment-1" },
      { slug: "binocular", name: "Binocular", iconUrl: "https://example.test/binocular" },
      { slug: "bomb", name: "Bomb", iconUrl: "https://example.test/bomb" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const sharedBrowser = { id: "browser-shared" };
  const runCalls = [];
  const batches = [
    ["attachment-1", "binocular"],
    ["bomb"],
  ];

  const result = await runStreamlineMetadataExtractionLoopFromNodeRepl({
    manifestPath,
    batchSize: 2,
    maxBatches: 3,
    concurrency: 2,
    reuseBrowser: true,
    connectBrowser: async () => sharedBrowser,
    runWithBrowser: async (options) => {
      runCalls.push(options.browser);
      for (const slug of batches.shift() ?? []) {
        await updateManifestItemMetadata({
          manifestPath,
          slug,
          tags: [slug, "tagged"],
          metadataStatus: "success",
          metadataUpdatedAt: "2026-06-24T10:00:00.000Z",
        });
      }
      return { success: options.maxItems, failed: 0 };
    },
  });

  assert.deepEqual(runCalls, [sharedBrowser, sharedBrowser]);
  assert.equal(result.complete, true);
});

test("runStreamlineMetadataExtractionFromNodeRepl applies recommended human mode pacing defaults", async () => {
  const calls = [];
  const syncCalls = [];
  await runStreamlineMetadataExtractionFromNodeRepl({
    manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-full.manifest.json",
    humanMode: true,
    concurrency: 4,
    connectBrowser: async () => ({ id: "browser-human" }),
    runWithBrowser: async (options) => {
      calls.push(options);
      return { success: 1, failed: 0 };
    },
    syncRegistry: async (value) => {
      syncCalls.push(value);
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].concurrency, 1);
  assert.equal(calls[0].humanMode, true);
  assert.equal(calls[0].waitMs, DEFAULT_STREAMLINE_HUMAN_METADATA_PACING.waitMs);
  assert.equal(calls[0].preNavigationDelayMs, DEFAULT_STREAMLINE_HUMAN_METADATA_PACING.preNavigationDelayMs);
  assert.equal(calls[0].postItemDelayMs, DEFAULT_STREAMLINE_HUMAN_METADATA_PACING.postItemDelayMs);
  assert.deepEqual(syncCalls, ["C:/Code/data-editor/artifacts/streamline-export/micro-solid-full.manifest.json"]);
});

test("runStreamlineMetadataSyncLoopFromMcp batches until metadata manifest is complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-mcp-loop-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", hash: "ico_attachment", name: "Attachment 1", iconUrl: "https://example.test/attachment-1" },
      { slug: "binocular", hash: "ico_binocular", name: "Binocular", iconUrl: "https://example.test/binocular" },
      { slug: "bomb", hash: "ico_bomb", name: "Bomb", iconUrl: "https://example.test/bomb" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const calls = [];
  const syncCalls = [];
  const batches = [
    ["attachment-1", "binocular"],
    ["bomb"],
  ];

  const result = await runStreamlineMetadataSyncLoopFromMcp({
    manifestPath,
    apiKey: "test-key",
    batchSize: 2,
    maxBatches: 3,
    concurrency: 2,
    syncWithMcp: async (options) => {
      calls.push({
        maxItems: options.maxItems,
        concurrency: options.concurrency,
      });
      for (const slug of batches.shift() ?? []) {
        await updateManifestItemMetadata({
          manifestPath,
          slug,
          tags: [slug, "official"],
          metadataStatus: "success",
          metadataUpdatedAt: "2026-06-24T10:00:00.000Z",
        });
      }
      return { success: options.maxItems, failed: 0 };
    },
    syncRegistry: async (value) => {
      syncCalls.push(value);
    },
  });

  assert.deepEqual(calls, [
    { maxItems: 2, concurrency: 2 },
    { maxItems: 1, concurrency: 2 },
  ]);
  assert.deepEqual(syncCalls, [manifestPath]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.after, {
    total: 3,
    pending: 0,
    success: 3,
    failed: 0,
    withTags: 3,
  });
});

test("runStreamlineMetadataHybridLoop falls back to browser for MCP no-tag failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-hybrid-loop-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "flip-down", hash: "ico_flip_down", name: "Flip Down", iconUrl: "https://example.test/flip-down" },
      { slug: "folder", hash: "ico_folder", name: "Folder", iconUrl: "https://example.test/folder" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const mcpCalls = [];
  const browserCalls = [];
  const syncCalls = [];
  const result = await runStreamlineMetadataHybridLoop({
    manifestPath,
    apiKey: "test-key",
    connectBrowser: async () => ({ id: "browser-1" }),
    batchSize: 2,
    maxBatches: 1,
    syncWithMcp: async (options) => {
      mcpCalls.push({ maxItems: options.maxItems, concurrency: options.concurrency });
      await updateManifestItemMetadata({
        manifestPath,
        slug: "folder",
        tags: ["folder", "directory"],
        metadataStatus: "success",
        metadataUpdatedAt: "2026-06-24T10:00:00.000Z",
      });
      await updateManifestItemMetadata({
        manifestPath,
        slug: "flip-down",
        tags: [],
        metadataStatus: "failed",
        metadataError: "Official MCP metadata returned no tags for hash ico_flip_down",
        metadataUpdatedAt: "2026-06-24T10:00:00.000Z",
      });
      return {
        success: 1,
        failed: 1,
        results: [
          { itemId: "flip-down", slug: "flip-down", ok: false, error: "Official MCP metadata returned no tags for hash ico_flip_down" },
          { itemId: "folder", slug: "folder", ok: true, tags: ["folder", "directory"] },
        ],
      };
    },
    runBrowserBatch: async (options) => {
      browserCalls.push({
        maxItems: options.maxItems,
        retryFailed: options.retryFailed,
        itemIds: options.itemIds,
      });
      await updateManifestItemMetadata({
        manifestPath,
        slug: "flip-down",
        tags: ["flip", "down"],
        metadataStatus: "success",
        metadataUpdatedAt: "2026-06-24T10:00:01.000Z",
      });
      return { success: 1, failed: 0 };
    },
    syncRegistry: async (value) => {
      syncCalls.push(value);
    },
  });

  assert.deepEqual(mcpCalls, [{ maxItems: 2, concurrency: 4 }]);
  assert.deepEqual(browserCalls, [{
    maxItems: 1,
    retryFailed: true,
    itemIds: ["flip-down"],
  }]);
  assert.deepEqual(syncCalls, [manifestPath]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.after, {
    total: 2,
    pending: 0,
    success: 2,
    failed: 0,
    withTags: 2,
  });
});
