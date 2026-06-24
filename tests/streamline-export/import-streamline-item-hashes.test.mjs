import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAbsoluteIconUrl,
  buildHashIndex,
  importManifestHashesFromItems,
} from "../../scripts/streamline-export/import-streamline-item-hashes.mjs";

test("buildAbsoluteIconUrl normalizes relative streamline urls", () => {
  assert.equal(
    buildAbsoluteIconUrl("/icons/download/attachment-1--26582"),
    "https://www.streamlinehq.com/icons/download/attachment-1--26582",
  );
  assert.equal(
    buildAbsoluteIconUrl("https://www.streamlinehq.com/icons/download/attachment-1--26582"),
    "https://www.streamlinehq.com/icons/download/attachment-1--26582",
  );
});

test("buildHashIndex indexes by absolute icon url and slug", () => {
  const index = buildHashIndex([
    {
      hash: "ico_attachment",
      slug: "attachment-1",
      url: "/icons/download/attachment-1--26582",
    },
  ]);

  assert.equal(
    index.byIconUrl.get("https://www.streamlinehq.com/icons/download/attachment-1--26582"),
    "ico_attachment",
  );
  assert.equal(index.bySlug.get("attachment-1"), "ico_attachment");
});

test("importManifestHashesFromItems backfills missing manifest hashes", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "streamline-hash-import-"));
  try {
    const manifestPath = join(tempDir, "manifest.json");
    const itemsPath = join(tempDir, "items.json");

    await writeFile(manifestPath, `${JSON.stringify({
      family: "core-solid",
      generatedAt: "2026-06-24T00:00:00.000Z",
      items: [
        {
          itemId: "attachment-1",
          slug: "attachment-1",
          hash: null,
          iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
          outputPath: "vendor/streamline-svg/core-solid/attachment-1.svg",
          status: "pending",
          attempts: 0,
          error: null,
          extractedAt: null,
          metadataStatus: "pending",
          metadataError: null,
          metadataUpdatedAt: null,
          tags: [],
        },
      ],
    }, null, 2)}\n`, "utf8");

    await writeFile(itemsPath, `${JSON.stringify([
      {
        hash: "ico_attachment",
        slug: "attachment-1",
        url: "/icons/download/attachment-1--26582",
      },
    ], null, 2)}\n`, "utf8");

    const result = await importManifestHashesFromItems({
      manifestPath,
      itemsPath,
    });

    assert.equal(result.updated, 1);
    assert.equal(result.matchedByUrl, 1);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.items[0].hash, "ico_attachment");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
