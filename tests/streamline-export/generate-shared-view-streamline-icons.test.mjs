import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  markManifestItemSuccess,
  updateManifestItemMetadata,
} from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { generateSharedViewStreamlineIcons } from "../../scripts/streamline-export/generate-shared-view-streamline-icons.mjs";

test("generateSharedViewStreamlineIcons writes runtime and type outputs from successful manifest items", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-registry-"));
  const manifestPath = join(root, "micro-line.manifest.json");
  const runtimeOutputPath = join(root, "streamline-shared-view-icons.mjs");
  const typesOutputPath = join(root, "streamline-shared-view-icons.d.ts");

  await createManifest({
    manifestPath,
    family: "micro-line",
    items: [
      { slug: "align-top", name: "Align Top", iconUrl: "https://example.test/align-top" },
      { slug: "atom", name: "Atom", iconUrl: "https://example.test/atom" },
    ],
    outputDir: "vendor/streamline-svg/micro-line",
  });
  await markManifestItemSuccess({ manifestPath, slug: "align-top", extractedAt: "2026-06-23T10:00:00.000Z" });
  await markManifestItemSuccess({ manifestPath, slug: "atom", extractedAt: "2026-06-23T10:01:00.000Z" });

  const result = await generateSharedViewStreamlineIcons({
    manifestPaths: [manifestPath],
    runtimeOutputPath,
    typesOutputPath,
  });

  assert.equal(result.icons, 2);
  assert.equal(result.groups, 1);

  const runtimeSource = await readFile(runtimeOutputPath, "utf8");
  const typesSource = await readFile(typesOutputPath, "utf8");

  assert.match(runtimeSource, /streamlineMicroLineAlignTop/);
  assert.match(runtimeSource, /streamlineMicroLineAtom/);
  assert.match(runtimeSource, /streamlineSharedViewIconGroups/);
  assert.match(runtimeSource, /"label": "Line"/);
  assert.match(runtimeSource, /vendor\/streamline-svg\/micro-line\/align-top\.svg/);

  assert.match(typesSource, /export type StreamlineSharedViewIconId =/);
  assert.match(typesSource, /"streamlineMicroLineAlignTop"/);
  assert.match(typesSource, /readonly StreamlineSharedViewIconMeta\[\]/);
});

test("generateSharedViewStreamlineIcons disambiguates variant collisions with source ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-registry-"));
  const manifestPath = join(root, "micro-line.manifest.json");
  const runtimeOutputPath = join(root, "streamline-shared-view-icons.mjs");
  const typesOutputPath = join(root, "streamline-shared-view-icons.d.ts");

  await createManifest({
    manifestPath,
    family: "micro-line",
    items: [
      { slug: "leaf", name: "Leaf", iconUrl: "https://example.test/icons/download/leaf--26423" },
      { slug: "leaf", name: "Leaf", iconUrl: "https://example.test/icons/download/leaf--26448" },
    ],
    outputDir: "vendor/streamline-svg/micro-line",
  });
  await markManifestItemSuccess({ manifestPath, itemId: "leaf--26423", extractedAt: "2026-06-23T10:00:00.000Z" });
  await markManifestItemSuccess({ manifestPath, itemId: "leaf--26448", extractedAt: "2026-06-23T10:01:00.000Z" });

  await generateSharedViewStreamlineIcons({
    manifestPaths: [manifestPath],
    runtimeOutputPath,
    typesOutputPath,
  });

  const runtimeSource = await readFile(runtimeOutputPath, "utf8");
  assert.match(runtimeSource, /streamlineMicroLineLeaf26423/);
  assert.match(runtimeSource, /streamlineMicroLineLeaf26448/);
  assert.match(runtimeSource, /"name": "Leaf \(26423\)"/);
  assert.match(runtimeSource, /vendor\/streamline-svg\/micro-line\/leaf-26423\.svg/);
});

test("generateSharedViewStreamlineIcons includes tags in runtime metadata and searchText", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-registry-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const runtimeOutputPath = join(root, "streamline-shared-view-icons.mjs");
  const typesOutputPath = join(root, "streamline-shared-view-icons.d.ts");

  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://example.test/icons/download/attachment-1--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });
  await markManifestItemSuccess({ manifestPath, slug: "attachment-1", extractedAt: "2026-06-24T10:00:00.000Z" });
  await updateManifestItemMetadata({
    manifestPath,
    itemId: "attachment-1",
    tags: ["paperclip", "affix"],
    metadataStatus: "success",
    metadataUpdatedAt: "2026-06-24T10:01:00.000Z",
  });

  await generateSharedViewStreamlineIcons({
    manifestPaths: [manifestPath],
    runtimeOutputPath,
    typesOutputPath,
  });

  const runtimeSource = await readFile(runtimeOutputPath, "utf8");
  const typesSource = await readFile(typesOutputPath, "utf8");

  assert.match(runtimeSource, /"tags": \[/);
  assert.match(runtimeSource, /paperclip/);
  assert.match(runtimeSource, /affix/);
  assert.match(runtimeSource, /paperclip affix/);
  assert.match(typesSource, /tags: string\[\]/);
});

test("generateSharedViewStreamlineIcons consumes sanitized tags from manifest load", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-registry-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const runtimeOutputPath = join(root, "streamline-shared-view-icons.mjs");
  const typesOutputPath = join(root, "streamline-shared-view-icons.d.ts");

  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "chat-bubble-disable-oval", name: "Chat Bubble Disable Oval", iconUrl: "https://example.test/icons/download/chat-bubble-disable-oval--26641" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });
  await markManifestItemSuccess({ manifestPath, slug: "chat-bubble-disable-oval", extractedAt: "2026-06-24T10:00:00.000Z" });
  await updateManifestItemMetadata({
    manifestPath,
    itemId: "chat-bubble-disable-oval",
    tags: ["```plaintext\nchat", "disable", "nosound\n```"],
    metadataStatus: "success",
    metadataUpdatedAt: "2026-06-24T10:01:00.000Z",
  });

  await generateSharedViewStreamlineIcons({
    manifestPaths: [manifestPath],
    runtimeOutputPath,
    typesOutputPath,
  });

  const runtimeSource = await readFile(runtimeOutputPath, "utf8");
  assert.match(runtimeSource, /chat disable nosound/);
  assert.doesNotMatch(runtimeSource, /```plaintext/);
});

test("generateSharedViewStreamlineIcons uses configured family label when available", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-registry-"));
  const manifestPath = join(root, "core-solid.manifest.json");
  const runtimeOutputPath = join(root, "streamline-shared-view-icons.mjs");
  const typesOutputPath = join(root, "streamline-shared-view-icons.d.ts");

  await createManifest({
    manifestPath,
    family: "core-solid",
    items: [
      { slug: "apply-to-all", name: "Apply To All", iconUrl: "https://example.test/icons/download/apply-to-all--23746" },
    ],
    outputDir: "vendor/streamline-svg/core-solid",
  });
  await markManifestItemSuccess({ manifestPath, slug: "apply-to-all", extractedAt: "2026-06-24T10:00:00.000Z" });

  await generateSharedViewStreamlineIcons({
    manifestPaths: [manifestPath],
    runtimeOutputPath,
    typesOutputPath,
  });

  const runtimeSource = await readFile(runtimeOutputPath, "utf8");
  assert.match(runtimeSource, /"label": "Core S"/);
  assert.match(runtimeSource, /streamlineCoreSolidApplyToAll/);
});
