import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, markManifestItemSuccess } from "../../scripts/streamline-export/lib/manifest-store.mjs";
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
