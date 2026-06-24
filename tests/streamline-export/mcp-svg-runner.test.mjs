import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  markManifestItemFailed,
  markManifestItemSuccess,
} from "../../scripts/streamline-export/lib/manifest-store.mjs";
import {
  buildStreamlineMcpSvgPreflight,
  runStreamlineMcpSvgImportLoop,
} from "../../scripts/streamline-export/run-streamline-mcp-svg-session.mjs";

test("runStreamlineMcpSvgImportLoop batches imports and verifies after each batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-mcp-loop-"));
  const manifestPath = join(root, "core-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "core-solid",
    items: [
      { slug: "alpha", hash: "hash-alpha", name: "Alpha", iconUrl: "https://example.test/alpha" },
      { slug: "beta", hash: "hash-beta", name: "Beta", iconUrl: "https://example.test/beta" },
      { slug: "gamma", hash: "hash-gamma", name: "Gamma", iconUrl: "https://example.test/gamma" },
    ],
    outputDir: "vendor/streamline-svg/core-solid",
  });

  const slugBatches = [
    ["alpha", "beta"],
    ["gamma"],
  ];
  const verifyCalls = [];

  const result = await runStreamlineMcpSvgImportLoop({
    manifestPath,
    apiKey: "test-key",
    batchSize: 2,
    maxBatches: 3,
    importSvg: async ({ maxItems }) => {
      for (const slug of slugBatches.shift() ?? []) {
        await markManifestItemSuccess({ manifestPath, slug, extractedAt: "2026-06-24T12:00:00.000Z" });
      }
      return { success: maxItems, failed: 0 };
    },
    verifyManifest: async ({ manifestPath: receivedManifestPath }) => {
      verifyCalls.push(receivedManifestPath);
      return { family: "core-solid", successMissingFiles: [], pendingExistingFiles: [], failedExistingFiles: [] };
    },
  });

  assert.equal(result.complete, true);
  assert.equal(result.batches.length, 2);
  assert.equal(result.batches[0].requested, 2);
  assert.equal(result.batches[1].requested, 1);
  assert.deepEqual(result.after, {
    total: 3,
    pending: 0,
    success: 3,
    failed: 0,
  });
  assert.deepEqual(verifyCalls, [manifestPath, manifestPath, manifestPath]);
});

test("runStreamlineMcpSvgImportLoop stops on first failed batch by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-mcp-loop-"));
  const manifestPath = join(root, "core-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "core-solid",
    items: [
      { slug: "alpha", hash: "hash-alpha", name: "Alpha", iconUrl: "https://example.test/alpha" },
      { slug: "beta", hash: "hash-beta", name: "Beta", iconUrl: "https://example.test/beta" },
    ],
    outputDir: "vendor/streamline-svg/core-solid",
  });

  const result = await runStreamlineMcpSvgImportLoop({
    manifestPath,
    apiKey: "test-key",
    batchSize: 2,
    importSvg: async () => {
      await markManifestItemSuccess({ manifestPath, slug: "alpha", extractedAt: "2026-06-24T12:00:00.000Z" });
      await markManifestItemFailed({ manifestPath, slug: "beta", error: "no svg" });
      return { success: 1, failed: 1 };
    },
    verifyManifest: async () => ({ family: "core-solid" }),
  });

  assert.equal(result.complete, false);
  assert.equal(result.batches.length, 1);
  assert.deepEqual(result.after, {
    total: 2,
    pending: 0,
    success: 1,
    failed: 1,
  });
});

test("buildStreamlineMcpSvgPreflight reports key readiness, hash coverage, and pending head", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-mcp-preflight-"));
  const manifestPath = join(root, "core-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "core-solid",
    items: [
      { slug: "alpha", hash: "hash-alpha", name: "Alpha", iconUrl: "https://example.test/alpha" },
      { slug: "beta", name: "Beta", iconUrl: "https://example.test/beta" },
      { slug: "gamma", hash: "hash-gamma", name: "Gamma", iconUrl: "https://example.test/gamma" },
    ],
    outputDir: "vendor/streamline-svg/core-solid",
  });

  const result = await buildStreamlineMcpSvgPreflight({
    manifestPath,
    apiKeyPresent: false,
    pendingHeadLimit: 2,
    verifyManifest: async () => ({
      successMissingFiles: [],
      successInvalidSvg: [],
      successEmptyFiles: [],
      pendingExistingFiles: [],
      failedExistingFiles: [],
    }),
  });

  assert.equal(result.family, "core-solid");
  assert.equal(result.apiKeyPresent, false);
  assert.equal(result.total, 3);
  assert.equal(result.withHash, 2);
  assert.equal(result.missingHashCount, 1);
  assert.deepEqual(result.missingHashHead, ["beta"]);
  assert.deepEqual(result.pendingHead, ["alpha", "beta"]);
  assert.deepEqual(result.blockers, [
    "STREAMLINE_API_KEY missing",
    "Missing official hash for 1 items",
  ]);
  assert.equal(result.canRunImport, false);
});
