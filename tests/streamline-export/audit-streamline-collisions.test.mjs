import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, markManifestItemSuccess } from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { auditStreamlineCollisions } from "../../scripts/streamline-export/audit-streamline-collisions.mjs";

test("auditStreamlineCollisions reports duplicate slugs and output path collisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-audit-"));
  const manifestPath = join(root, "micro-line.manifest.json");
  const reportOutputPath = join(root, "collision-report.json");

  await createManifest({
    manifestPath,
    family: "micro-line",
    items: [
      { slug: "leaf", name: "Leaf A", iconUrl: "https://example.test/leaf-a" },
      { slug: "leaf", name: "Leaf B", iconUrl: "https://example.test/leaf-b" },
      { slug: "repeat", name: "Repeat 1", iconUrl: "https://example.test/repeat" },
      { slug: "repeat", name: "Repeat 2", iconUrl: "https://example.test/repeat" },
    ],
    outputDir: "vendor/streamline-svg/micro-line",
  });

  await markManifestItemSuccess({ manifestPath, slug: "leaf", extractedAt: "2026-06-23T10:00:00.000Z" });
  await markManifestItemSuccess({ manifestPath, slug: "repeat", extractedAt: "2026-06-23T10:01:00.000Z" });

  const { report } = await auditStreamlineCollisions({
    manifestPaths: [manifestPath],
    reportOutputPath,
  });

  assert.equal(report.summary.duplicateSlugGroups, 2);
  assert.equal(report.summary.outputPathCollisionGroups, 2);
  assert.equal(report.duplicateSlugs[0].slug, "leaf");
  assert.equal(report.summary.duplicateSlugExactDuplicateGroups, 1);
  assert.equal(report.summary.duplicateSlugVariantCollisionGroups, 1);
  assert.deepEqual(report.outputPathCollisions.map((entry) => entry.outputPath), [
    "vendor/streamline-svg/micro-line/leaf.svg",
    "vendor/streamline-svg/micro-line/repeat.svg",
  ]);
  assert.deepEqual(
    report.outputPathCollisions.map((entry) => ({ outputPath: entry.outputPath, uniqueIconUrls: entry.uniqueIconUrls })),
    [
      {
        outputPath: "vendor/streamline-svg/micro-line/leaf.svg",
        uniqueIconUrls: ["https://example.test/leaf-a", "https://example.test/leaf-b"],
      },
      {
        outputPath: "vendor/streamline-svg/micro-line/repeat.svg",
        uniqueIconUrls: ["https://example.test/repeat"],
      },
    ],
  );

  const savedReport = JSON.parse(await readFile(reportOutputPath, "utf8"));
  assert.equal(savedReport.summary.outputPathCollisionGroups, 2);
  assert.equal(savedReport.summary.outputPathVariantCollisionGroups, 1);
});
