import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, loadManifest } from "../../scripts/streamline-export/lib/manifest-store.mjs";
import {
  fetchAllFamilyIcons,
  hydrateManifestHashesFromFamily,
} from "../../scripts/streamline-export/hydrate-streamline-manifest-hashes.mjs";

test("fetchAllFamilyIcons paginates until hasMore is false", async () => {
  const seenOffsets = [];
  const fetchImpl = async (url) => {
    seenOffsets.push(Number(url.searchParams.get("offset")));
    const offset = Number(url.searchParams.get("offset"));
    if (offset === 0) {
      return new Response(JSON.stringify({
        icons: [{ hash: "ico_1", webUrl: "https://example.test/1" }],
        pagination: { hasMore: true, nextOffset: 1 },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      icons: [{ hash: "ico_2", webUrl: "https://example.test/2" }],
      pagination: { hasMore: false, nextOffset: 2 },
    }), { status: 200 });
  };

  const icons = await fetchAllFamilyIcons({
    familyHash: "fam_micro_solid",
    apiKey: "test-key",
    fetchImpl,
  });

  assert.deepEqual(seenOffsets, [0, 1]);
  assert.deepEqual(icons.map((icon) => icon.hash), ["ico_1", "ico_2"]);
});

test("hydrateManifestHashesFromFamily matches manifest items by iconUrl/webUrl and writes hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-hash-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
      { slug: "add-1", name: "Add 1", iconUrl: "https://www.streamlinehq.com/icons/download/add-1--26556" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const familyIcons = [
    { hash: "ico_attachment", webUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
    { hash: "ico_add_1", webUrl: "https://www.streamlinehq.com/icons/download/add-1--26556" },
  ];

  const result = await hydrateManifestHashesFromFamily({
    manifestPath,
    familyHash: "fam_micro_solid",
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      icons: familyIcons,
      pagination: { hasMore: false, nextOffset: 2 },
    }), { status: 200 }),
  });

  assert.equal(result.fetched, 2);
  assert.equal(result.matched, 2);
  assert.equal(result.updated, 2);
  const manifest = await loadManifest(manifestPath);
  assert.deepEqual(manifest.items.map((item) => item.hash), ["ico_attachment", "ico_add_1"]);
});
