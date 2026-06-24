import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, loadManifest } from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { repairStreamlineManifestCollisions } from "../../scripts/streamline-export/repair-streamline-manifest-collisions.mjs";

test("repairStreamlineManifestCollisions dry-run reports changes without mutating manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-repair-"));
  const manifestPath = join(root, "core-solid.manifest.json");

  await createManifest({
    manifestPath,
    family: "core-solid",
    items: [
      { slug: "leaf", name: "Leaf", iconUrl: "https://example.test/icons/download/leaf--26423" },
      { slug: "leaf", name: "Leaf", iconUrl: "https://example.test/icons/download/leaf--26448" },
    ],
    outputDir: join(root, "vendor", "streamline-svg", "core-solid"),
  });

  const beforeSource = await readFile(manifestPath, "utf8");
  const result = await repairStreamlineManifestCollisions({
    manifestPath,
    dryRun: true,
  });
  const afterSource = await readFile(manifestPath, "utf8");
  const manifest = await loadManifest(manifestPath);

  assert.equal(result.dryRun, true);
  assert.equal(result.changedItems, 0);
  assert.equal(result.resetToPending, 2);
  assert.equal(beforeSource, afterSource);
  assert.deepEqual(
    manifest.items.map((item) => item.status),
    ["pending", "pending"],
  );
});

test("repairStreamlineManifestCollisions removes exact duplicate items from manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-repair-"));
  const manifestPath = join(root, "core-solid.manifest.json");

  await createManifest({
    manifestPath,
    family: "core-solid",
    items: [
      { slug: "square-clock", name: "Square Clock", iconUrl: "https://example.test/icons/download/square-clock--23706" },
      { slug: "square-clock", name: "Square Clock", iconUrl: "https://example.test/icons/download/square-clock--23706" },
    ],
    outputDir: join(root, "vendor", "streamline-svg", "core-solid"),
  });

  const before = await loadManifest(manifestPath);
  assert.equal(before.items.length, 2);

  const result = await repairStreamlineManifestCollisions({
    manifestPath,
    dryRun: false,
  });
  const after = await loadManifest(manifestPath);

  assert.equal(result.dryRun, false);
  assert.equal(result.removedExactDuplicates, 1);
  assert.equal(result.total, 1);
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].slug, "square-clock");
  assert.equal(after.items[0].itemId, "square-clock");
});
