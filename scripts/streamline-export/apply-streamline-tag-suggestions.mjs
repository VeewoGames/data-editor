import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { updateManifestItemsMetadataBatch } from "./lib/manifest-store.mjs";

function resolveProjectRoot() {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

function buildDefaultReportPath(suggestionsPath) {
  const baseDir = dirname(suggestionsPath);
  return join(baseDir, "micro-solid-auto-accept-apply-report.json");
}

function normalizeSuggestionUpdates(payload, metadataUpdatedAt) {
  const sourceSuggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const applied = [];
  const skipped = [];

  for (const suggestion of sourceSuggestions) {
    if (suggestion?.decision !== "auto_accept" || !Array.isArray(suggestion?.suggestedTags) || suggestion.suggestedTags.length === 0) {
      skipped.push({
        itemId: suggestion?.itemId ?? null,
        slug: suggestion?.slug ?? null,
        decision: suggestion?.decision ?? null,
      });
      continue;
    }
    applied.push({
      itemId: suggestion.itemId,
      slug: suggestion.slug,
      tags: suggestion.suggestedTags,
      metadataStatus: "success",
      metadataError: null,
      metadataUpdatedAt,
      confidence: suggestion.confidence ?? null,
    });
  }

  return { applied, skipped };
}

export async function applyStreamlineTagSuggestions({
  manifestPath,
  suggestionsPath,
  outputPath,
  dryRun = false,
  metadataUpdatedAt = new Date().toISOString(),
} = {}) {
  if (!manifestPath || !suggestionsPath) {
    throw new Error("applyStreamlineTagSuggestions requires manifestPath and suggestionsPath");
  }

  const payload = JSON.parse(await readFile(suggestionsPath, "utf8"));
  const { applied, skipped } = normalizeSuggestionUpdates(payload, metadataUpdatedAt);

  if (!dryRun && applied.length > 0) {
    await updateManifestItemsMetadataBatch({
      manifestPath,
      updates: applied,
    });
  }

  const report = {
    family: payload?.family ?? null,
    manifestPath,
    suggestionsPath,
    dryRun,
    metadataUpdatedAt,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    applied,
    skipped,
  };

  const resolvedOutputPath = outputPath || buildDefaultReportPath(suggestionsPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    outputPath: resolvedOutputPath,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    dryRun,
  };
}

function parseCliArgs(argv) {
  const options = {
    manifestPath: "",
    suggestionsPath: "",
    outputPath: "",
    dryRun: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      options.outputPath = argv[++index] ?? "";
      continue;
    }
    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!options.manifestPath) {
      options.manifestPath = value;
      continue;
    }
    if (!options.suggestionsPath) {
      options.suggestionsPath = value;
    }
  }

  return options;
}

async function main(argv) {
  const projectRoot = resolveProjectRoot();
  const parsed = parseCliArgs(argv);
  const manifestPath = parsed.manifestPath ? resolve(projectRoot, parsed.manifestPath) : "";
  const suggestionsPath = parsed.suggestionsPath ? resolve(projectRoot, parsed.suggestionsPath) : "";
  if (!manifestPath || !suggestionsPath) {
    throw new Error("Usage: node scripts/streamline-export/apply-streamline-tag-suggestions.mjs <manifestPath> <suggestionsPath> [--output <path>] [--dry-run]");
  }

  const result = await applyStreamlineTagSuggestions({
    manifestPath,
    suggestionsPath,
    outputPath: parsed.outputPath ? resolve(projectRoot, parsed.outputPath) : "",
    dryRun: parsed.dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("apply-streamline-tag-suggestions.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
