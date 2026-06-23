import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, summarizeManifest } from "./lib/manifest-store.mjs";

const defaultOutputPath = "artifacts/streamline-export/shared-view-collision-report.json";

function buildSlugKey(family, slug) {
  return `${family}::${slug}`;
}

function buildOutputPathKey(family, outputPath) {
  return `${family}::${outputPath}`;
}

function sortGroups(groups) {
  return groups.sort((left, right) => {
    const familyCompare = left.family.localeCompare(right.family);
    if (familyCompare !== 0) return familyCompare;
    const keyCompare = left.key.localeCompare(right.key);
    if (keyCompare !== 0) return keyCompare;
    return left.itemCount - right.itemCount;
  });
}

function summarizeCollisionRisk(groups) {
  let exactDuplicateGroups = 0;
  let exactDuplicateItems = 0;
  let variantCollisionGroups = 0;
  let variantCollisionItems = 0;
  for (const group of groups) {
    const uniqueIconUrls = Array.from(new Set(group.items.map((item) => item.iconUrl).filter(Boolean)));
    if (uniqueIconUrls.length <= 1) {
      exactDuplicateGroups += 1;
      exactDuplicateItems += group.itemCount;
    } else {
      variantCollisionGroups += 1;
      variantCollisionItems += group.itemCount;
    }
  }
  return {
    exactDuplicateGroups,
    exactDuplicateItems,
    variantCollisionGroups,
    variantCollisionItems,
  };
}

export async function auditStreamlineCollisions({
  manifestPaths,
  reportOutputPath = defaultOutputPath,
} = {}) {
  if (!Array.isArray(manifestPaths) || manifestPaths.length === 0) {
    throw new Error("auditStreamlineCollisions requires at least one manifest path");
  }

  const manifests = await Promise.all(manifestPaths.map((manifestPath) => loadManifest(manifestPath)));
  const duplicateSlugMap = new Map();
  const outputPathCollisionMap = new Map();

  const manifestSummaries = manifests.map((manifest, index) => {
    const family = String(manifest.family ?? "").trim();
    const summary = summarizeManifest(manifest);
    for (const item of Array.isArray(manifest.items) ? manifest.items : []) {
      const record = {
        slug: String(item?.slug ?? ""),
        name: String(item?.name ?? item?.slug ?? ""),
        outputPath: String(item?.outputPath ?? "").replace(/\\/g, "/"),
        iconUrl: item?.iconUrl ?? null,
        status: item?.status ?? "pending",
      };

      const slugKey = buildSlugKey(family, record.slug);
      const duplicateSlugEntry = duplicateSlugMap.get(slugKey) ?? {
        key: record.slug,
        family,
        slug: record.slug,
        items: [],
      };
      duplicateSlugEntry.items.push(record);
      duplicateSlugMap.set(slugKey, duplicateSlugEntry);

      if (record.outputPath) {
        const outputPathKey = buildOutputPathKey(family, record.outputPath);
        const outputPathEntry = outputPathCollisionMap.get(outputPathKey) ?? {
          key: record.outputPath,
          family,
          outputPath: record.outputPath,
          items: [],
        };
        outputPathEntry.items.push(record);
        outputPathCollisionMap.set(outputPathKey, outputPathEntry);
      }
    }

    return {
      manifestPath: manifestPaths[index],
      family,
      counts: summary,
    };
  });

  const duplicateSlugs = sortGroups(
    Array.from(duplicateSlugMap.values())
      .filter((entry) => entry.items.length > 1)
      .map((entry) => ({
        ...entry,
        itemCount: entry.items.length,
        uniqueIconUrls: Array.from(new Set(entry.items.map((item) => item.iconUrl).filter(Boolean))).sort(),
        outputPaths: Array.from(new Set(entry.items.map((item) => item.outputPath))).sort(),
      })),
  );

  const outputPathCollisions = sortGroups(
    Array.from(outputPathCollisionMap.values())
      .filter((entry) => entry.items.length > 1)
      .map((entry) => ({
        ...entry,
        itemCount: entry.items.length,
        uniqueIconUrls: Array.from(new Set(entry.items.map((item) => item.iconUrl).filter(Boolean))).sort(),
        slugs: Array.from(new Set(entry.items.map((item) => item.slug))).sort(),
      })),
  );

  const duplicateRisk = summarizeCollisionRisk(duplicateSlugs);
  const outputPathRisk = summarizeCollisionRisk(outputPathCollisions);

  const report = {
    generatedAt: new Date().toISOString(),
    manifests: manifestSummaries,
    summary: {
      duplicateSlugGroups: duplicateSlugs.length,
      duplicateSlugItems: duplicateSlugs.reduce((sum, entry) => sum + entry.itemCount, 0),
      outputPathCollisionGroups: outputPathCollisions.length,
      outputPathCollisionItems: outputPathCollisions.reduce((sum, entry) => sum + entry.itemCount, 0),
      duplicateSlugExactDuplicateGroups: duplicateRisk.exactDuplicateGroups,
      duplicateSlugExactDuplicateItems: duplicateRisk.exactDuplicateItems,
      duplicateSlugVariantCollisionGroups: duplicateRisk.variantCollisionGroups,
      duplicateSlugVariantCollisionItems: duplicateRisk.variantCollisionItems,
      outputPathExactDuplicateGroups: outputPathRisk.exactDuplicateGroups,
      outputPathExactDuplicateItems: outputPathRisk.exactDuplicateItems,
      outputPathVariantCollisionGroups: outputPathRisk.variantCollisionGroups,
      outputPathVariantCollisionItems: outputPathRisk.variantCollisionItems,
    },
    duplicateSlugs,
    outputPathCollisions,
  };

  await mkdir(dirname(reportOutputPath), { recursive: true });
  await writeFile(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    report,
    reportOutputPath,
  };
}

async function main(argv) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const args = argv.slice(2);
  const manifests = [];
  let outputPath = resolve(projectRoot, defaultOutputPath);

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--output") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error("Usage: node scripts/streamline-export/audit-streamline-collisions.mjs [--output <path>] <manifestPath...>");
      }
      outputPath = resolve(projectRoot, nextValue);
      index += 1;
      continue;
    }
    manifests.push(resolve(projectRoot, value));
  }

  if (!manifests.length) {
    throw new Error("Usage: node scripts/streamline-export/audit-streamline-collisions.mjs [--output <path>] <manifestPath...>");
  }

  const { report, reportOutputPath } = await auditStreamlineCollisions({
    manifestPaths: manifests,
    reportOutputPath: outputPath,
  });

  console.log(JSON.stringify({
    reportOutputPath: relative(projectRoot, reportOutputPath).replace(/\\/g, "/"),
    manifests: manifests.map((value) => relative(projectRoot, value).replace(/\\/g, "/")),
    summary: report.summary,
  }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("audit-streamline-collisions.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
