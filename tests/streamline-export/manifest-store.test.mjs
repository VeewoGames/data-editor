import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  loadManifest,
  loadManifestSummary,
  markManifestItemFailed,
  markManifestItemSuccess,
  saveManifest,
  updateManifestItemMetadata,
  updateManifestItemsMetadataBatch,
} from "../../scripts/streamline-export/lib/manifest-store.mjs";

test("createManifest writes pending items with stable output paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath: path,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://example.test/attachment-1" },
      { slug: "attachment-2", name: "Attachment 2", iconUrl: "https://example.test/attachment-2" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const manifest = JSON.parse(await readFile(path, "utf8"));
  assert.equal(manifest.family, "micro-solid");
  assert.equal(manifest.items[0].itemId, "attachment-1");
  assert.equal(manifest.items[0].hash, null);
  assert.equal(manifest.items[0].status, "pending");
  assert.equal(manifest.items[0].outputPath, "vendor/streamline-svg/micro-solid/attachment-1.svg");
});

test("createManifest preserves official hash when source items include it", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath: path,
    family: "micro-solid",
    items: [
      {
        slug: "attachment-1",
        hash: "ico_attachment",
        name: "Attachment 1",
        iconUrl: "https://example.test/attachment-1",
      },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const manifest = JSON.parse(await readFile(path, "utf8"));
  assert.equal(manifest.items[0].hash, "ico_attachment");
});

test("createManifest suffixes variant collision outputs with source ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-line.manifest.json");
  await createManifest({
    manifestPath: path,
    family: "micro-line",
    items: [
      { slug: "leaf", name: "Leaf A", iconUrl: "https://example.test/icons/download/leaf--26423" },
      { slug: "leaf", name: "Leaf B", iconUrl: "https://example.test/icons/download/leaf--26448" },
    ],
    outputDir: "vendor/streamline-svg/micro-line",
  });

  const manifest = JSON.parse(await readFile(path, "utf8"));
  assert.equal(manifest.items[0].itemId, "leaf--26423");
  assert.equal(manifest.items[1].itemId, "leaf--26448");
  assert.equal(manifest.items[0].outputPath, "vendor/streamline-svg/micro-line/leaf-26423.svg");
  assert.equal(manifest.items[1].outputPath, "vendor/streamline-svg/micro-line/leaf-26448.svg");
});

test("createManifest seeds empty tags and pending metadata status", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath: path,
    family: "micro-solid",
    items: [
      { slug: "attachment", name: "Attachment", iconUrl: "https://example.test/icons/download/attachment--26409" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const manifest = await loadManifest(path);
  assert.deepEqual(manifest.items[0].tags, []);
  assert.equal(manifest.items[0].metadataStatus, "pending");
  assert.equal(manifest.items[0].metadataError, null);
  assert.equal(manifest.items[0].metadataUpdatedAt, null);
});

test("loadManifest normalizes missing metadata fields on historical manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-line.manifest.json");
  await saveManifest(path, {
    family: "micro-line",
    generatedAt: "2026-06-24T00:00:00.000Z",
    items: [
      {
        itemId: "attachment",
        slug: "attachment",
        sourceId: "26409",
        name: "Attachment",
        iconUrl: "https://example.test/icons/download/attachment--26409",
        status: "success",
        attempts: 0,
        outputPath: "vendor/streamline-svg/micro-line/attachment.svg",
        error: null,
        extractedAt: "2026-06-24T00:00:00.000Z",
      },
    ],
  });

  const manifest = await loadManifest(path);
  assert.deepEqual(manifest.items[0].tags, []);
  assert.equal(manifest.items[0].metadataStatus, "pending");
  assert.equal(manifest.items[0].metadataError, null);
  assert.equal(manifest.items[0].metadataUpdatedAt, null);
});

test("updateManifestItemMetadata persists tags and metadata timestamps", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath: path,
    family: "micro-solid",
    items: [
      { slug: "attachment", name: "Attachment", iconUrl: "https://example.test/icons/download/attachment--26409" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  await updateManifestItemMetadata({
    manifestPath: path,
    itemId: "attachment",
    tags: ["paperclip", "affix"],
    metadataStatus: "success",
    metadataUpdatedAt: "2026-06-24T08:10:00.000Z",
  });

  const manifest = await loadManifest(path);
  assert.deepEqual(manifest.items[0].tags, ["paperclip", "affix"]);
  assert.equal(manifest.items[0].metadataStatus, "success");
  assert.equal(manifest.items[0].metadataError, null);
  assert.equal(manifest.items[0].metadataUpdatedAt, "2026-06-24T08:10:00.000Z");
});

test("loadManifest sanitizes persisted fenced-code tag pollution", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await saveManifest(path, {
    family: "micro-solid",
    generatedAt: "2026-06-24T00:00:00.000Z",
    items: [
      {
        itemId: "call-alert",
        slug: "call-alert",
        sourceId: "26631",
        name: "Call Alert",
        iconUrl: "https://example.test/icons/download/call-alert--26631",
        status: "success",
        attempts: 0,
        outputPath: "vendor/streamline-svg/micro-solid/call-alert.svg",
        error: null,
        extractedAt: "2026-06-24T00:00:00.000Z",
        tags: ["```plaintext\ncall", "alert", "attention\n```"],
        metadataStatus: "success",
        metadataError: null,
        metadataUpdatedAt: "2026-06-24T00:01:00.000Z",
      },
    ],
  });

  const manifest = await loadManifest(path);
  assert.deepEqual(manifest.items[0].tags, ["call", "alert", "attention"]);
});

test("updateManifestItemsMetadataBatch persists multiple metadata updates in one save", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath: path,
    family: "micro-solid",
    items: [
      { slug: "attachment", name: "Attachment", iconUrl: "https://example.test/icons/download/attachment--26409" },
      { slug: "binocular", name: "Binocular", iconUrl: "https://example.test/icons/download/binocular--26409" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  await updateManifestItemsMetadataBatch({
    manifestPath: path,
    updates: [
      {
        itemId: "attachment",
        tags: ["paperclip", "affix"],
        metadataStatus: "success",
        metadataUpdatedAt: "2026-06-24T08:10:00.000Z",
      },
      {
        itemId: "binocular",
        tags: [],
        metadataStatus: "failed",
        metadataError: "Error: payload not found",
        metadataUpdatedAt: "2026-06-24T08:11:00.000Z",
      },
    ],
  });

  const manifest = await loadManifest(path);
  assert.deepEqual(manifest.items.map((item) => item.tags), [["paperclip", "affix"], []]);
  assert.deepEqual(manifest.items.map((item) => item.metadataStatus), ["success", "failed"]);
  assert.equal(manifest.items[1].metadataError, "Error: payload not found");
  assert.equal(manifest.items[1].metadataUpdatedAt, "2026-06-24T08:11:00.000Z");
});

test("markManifestItemSuccess persists timestamp and output path", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await writeFile(path, JSON.stringify({
    family: "micro-solid",
    generatedAt: "2026-06-23T00:00:00.000Z",
    items: [
      { itemId: "attachment-1", slug: "attachment-1", status: "pending", attempts: 0, outputPath: "vendor/streamline-svg/micro-solid/attachment-1.svg", error: null, extractedAt: null }
    ]
  }, null, 2));

  await markManifestItemSuccess({
    manifestPath: path,
    itemId: "attachment-1",
    extractedAt: "2026-06-23T10:00:00.000Z",
  });

  const manifest = await loadManifest(path);
  assert.equal(manifest.items[0].status, "success");
  assert.equal(manifest.items[0].extractedAt, "2026-06-23T10:00:00.000Z");
  assert.equal(manifest.items[0].error, null);
});

test("markManifestItemFailed increments attempts and stores error", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await writeFile(path, JSON.stringify({
    family: "micro-solid",
    generatedAt: "2026-06-23T00:00:00.000Z",
    items: [
      { itemId: "attachment-1", slug: "attachment-1", status: "pending", attempts: 0, outputPath: "vendor/streamline-svg/micro-solid/attachment-1.svg", error: null, extractedAt: null }
    ]
  }, null, 2));

  await markManifestItemFailed({
    manifestPath: path,
    itemId: "attachment-1",
    error: "svg-not-found",
  });

  const manifest = await loadManifest(path);
  assert.equal(manifest.items[0].status, "failed");
  assert.equal(manifest.items[0].attempts, 1);
  assert.equal(manifest.items[0].error, "svg-not-found");
});

test("loadManifest retries transient Windows open failures", async () => {
  let attempts = 0;
  const manifestText = JSON.stringify({
    family: "core-solid",
    generatedAt: "2026-06-24T00:00:00.000Z",
    items: [],
  });

  const manifest = await loadManifest("C:/tmp/core-solid.manifest.json", {
    readFileImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("UNKNOWN: unknown error, open 'C:\\tmp\\core-solid.manifest.json'");
        error.code = "UNKNOWN";
        throw error;
      }
      return manifestText;
    },
    retryCount: 3,
    retryDelayMs: 0,
  });

  assert.equal(manifest.family, "core-solid");
  assert.equal(attempts, 3);
});

test("saveManifest retries transient Windows write failures", async () => {
  let mkdirCalls = 0;
  let writeAttempts = 0;
  let savedText = "";

  await saveManifest("C:/tmp/core-solid.manifest.json", {
    family: "core-solid",
    generatedAt: "2026-06-24T00:00:00.000Z",
    items: [],
  }, {
    mkdirImpl: async () => {
      mkdirCalls += 1;
    },
    writeFileImpl: async (_path, text) => {
      writeAttempts += 1;
      if (writeAttempts < 3) {
        const error = new Error("UNKNOWN: unknown error, open 'C:\\tmp\\core-solid.manifest.json'");
        error.code = "UNKNOWN";
        throw error;
      }
      savedText = text;
    },
    retryCount: 3,
    retryDelayMs: 0,
  });

  assert.equal(mkdirCalls, 1);
  assert.equal(writeAttempts, 3);
  assert.match(savedText, /"family": "core-solid"/);
});
