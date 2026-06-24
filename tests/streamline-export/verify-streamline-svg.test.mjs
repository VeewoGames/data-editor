import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, markManifestItemFailed, markManifestItemSuccess } from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { verifyStreamlineSvgManifest } from "../../scripts/streamline-export/verify-streamline-svg.mjs";

test("verifyStreamlineSvgManifest reports status/file drift and invalid svg states", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-verify-"));
  try {
    const outputDir = join(root, "vendor", "streamline-svg", "core-solid");
    const manifestPath = join(root, "core-solid.manifest.json");

    await mkdir(outputDir, { recursive: true });
    await createManifest({
      manifestPath,
      family: "core-solid",
      items: [
        { slug: "alpha", name: "Alpha", iconUrl: "https://example.test/alpha" },
        { slug: "beta", name: "Beta", iconUrl: "https://example.test/beta" },
        { slug: "gamma", name: "Gamma", iconUrl: "https://example.test/gamma" },
        { slug: "delta", name: "Delta", iconUrl: "https://example.test/delta" },
      ],
      outputDir,
    });

    await markManifestItemSuccess({ manifestPath, slug: "alpha", extractedAt: "2026-06-24T10:00:00.000Z" });
    await markManifestItemSuccess({ manifestPath, slug: "beta", extractedAt: "2026-06-24T10:01:00.000Z" });
    await markManifestItemFailed({ manifestPath, slug: "delta", error: "test failure" });

    await writeFile(join(outputDir, "alpha.svg"), "<svg viewBox=\"0 0 16 16\"></svg>\n", "utf8");
    await writeFile(join(outputDir, "gamma.svg"), "<svg viewBox=\"0 0 16 16\"></svg>\n", "utf8");
    await writeFile(join(outputDir, "delta.svg"), "not-svg\n", "utf8");

    const result = await verifyStreamlineSvgManifest({ manifestPath });

    assert.equal(result.family, "core-solid");
    assert.equal(result.total, 4);
    assert.equal(result.success, 2);
    assert.equal(result.pending, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.presentFiles, 3);
    assert.deepEqual(result.successMissingFiles, ["beta"]);
    assert.deepEqual(result.pendingExistingFiles, ["gamma"]);
    assert.deepEqual(result.failedExistingFiles, ["delta"]);
    assert.deepEqual(result.invalidSvg, ["delta"]);
    assert.deepEqual(result.successInvalidSvg, []);
    assert.deepEqual(result.successEmptyFiles, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
