import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  loadManifest,
  updateManifestItemMetadata,
} from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { importOfficialMetadataIntoManifest } from "../../scripts/streamline-export/import-streamline-official-metadata.mjs";

test("importOfficialMetadataIntoManifest matches official records by hash first", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-official-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const metadataPath = join(root, "official-metadata.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      {
        slug: "attachment-1",
        hash: "ico_attachment",
        name: "Attachment 1",
        iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
      },
      {
        slug: "binocular",
        hash: "ico_binocular",
        name: "Binocular",
        iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582",
      },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });
  await writeFile(metadataPath, JSON.stringify([
    { hash: "ico_attachment", slug: "attachment-1", tags: ["attachment", "paperclip", "affix"] },
    { hash: "ico_binocular", slug: "binocular", tags: ["optics", "view", "glass"] },
  ], null, 2));

  const result = await importOfficialMetadataIntoManifest({
    manifestPath,
    metadataPath,
  });

  assert.equal(result.success, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.matchedByHash, 2);
  const manifest = await loadManifest(manifestPath);
  assert.deepEqual(manifest.items.map((item) => item.tags), [
    ["attachment", "paperclip", "affix"],
    ["optics", "view", "glass"],
  ]);
  assert.deepEqual(manifest.items.map((item) => item.metadataStatus), ["success", "success"]);
});

test("importOfficialMetadataIntoManifest falls back to slug and skips existing metadata-success items", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-official-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const metadataPath = join(root, "official-metadata.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      {
        slug: "attachment-1",
        name: "Attachment 1",
        iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
      },
      {
        slug: "binocular",
        name: "Binocular",
        iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582",
      },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });
  await updateManifestItemMetadata({
    manifestPath,
    slug: "attachment-1",
    tags: ["existing"],
    metadataStatus: "success",
    metadataUpdatedAt: "2026-06-24T10:00:00.000Z",
  });
  await writeFile(metadataPath, JSON.stringify({
    items: [
      { slug: "attachment-1", tags: ["ignored"] },
      { slug: "binocular", tags: ["optics", "view", "glass"] },
    ],
  }, null, 2));

  const result = await importOfficialMetadataIntoManifest({
    manifestPath,
    metadataPath,
  });

  assert.equal(result.success, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.matchedBySlug, 1);
  const manifest = await loadManifest(manifestPath);
  assert.deepEqual(manifest.items[0].tags, ["existing"]);
  assert.deepEqual(manifest.items[1].tags, ["optics", "view", "glass"]);
});

test("importOfficialMetadataIntoManifest marks unresolved items failed and can retry failed items", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-official-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const metadataPath = join(root, "official-metadata.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      {
        slug: "attachment-1",
        hash: "ico_attachment",
        name: "Attachment 1",
        iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
      },
      {
        slug: "binocular",
        hash: "ico_binocular",
        name: "Binocular",
        iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582",
      },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });
  await writeFile(metadataPath, JSON.stringify([
    { hash: "ico_attachment", slug: "attachment-1", tags: ["attachment", "paperclip", "affix"] },
  ], null, 2));

  const firstRun = await importOfficialMetadataIntoManifest({
    manifestPath,
    metadataPath,
  });
  assert.equal(firstRun.success, 1);
  assert.equal(firstRun.failed, 1);

  await writeFile(metadataPath, JSON.stringify([
    { hash: "ico_attachment", slug: "attachment-1", tags: ["attachment", "paperclip", "affix"] },
    { hash: "ico_binocular", slug: "binocular", tags: ["optics", "view", "glass"] },
  ], null, 2));
  const secondRun = await importOfficialMetadataIntoManifest({
    manifestPath,
    metadataPath,
    retryFailed: true,
  });

  assert.equal(secondRun.success, 1);
  assert.equal(secondRun.failed, 0);
  const manifest = await loadManifest(manifestPath);
  assert.deepEqual(manifest.items.map((item) => item.metadataStatus), ["success", "success"]);
});
