import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  loadManifest,
  markManifestItemFailed,
  markManifestItemSuccess,
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
  assert.equal(manifest.items[0].status, "pending");
  assert.equal(manifest.items[0].outputPath, "vendor/streamline-svg/micro-solid/attachment-1.svg");
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
