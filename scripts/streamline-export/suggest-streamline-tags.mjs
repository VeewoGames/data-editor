import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./lib/manifest-store.mjs";
import { buildStreamlineTagKnowledge, suggestTagsForManifestItem } from "./lib/streamline-tag-suggestion-knowledge.mjs";

function resolveProjectRoot() {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

function buildDefaultOutputPath(manifestPath, family) {
  return join(dirname(manifestPath), `${family}-tag-suggestions.json`);
}

function buildSvgReader(projectRoot) {
  return async function readSvg(outputPath) {
    return readFile(resolve(projectRoot, outputPath), "utf8");
  };
}

function buildSearchTextPreview(family, item, suggestedTags) {
  return [
    family,
    item?.slug ?? "",
    item?.name ?? "",
    item?.itemId ?? item?.slug ?? "",
    item?.sourceId ?? "",
    suggestedTags.join(" "),
  ].join(" ").toLowerCase();
}

export async function suggestStreamlineTagsForManifest({
  manifestPath,
  outputPath,
  projectRoot = resolveProjectRoot(),
  maxTags = 12,
  mode = "precise",
  includeLabeled = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!manifestPath) {
    throw new Error("suggestStreamlineTagsForManifest requires manifestPath");
  }

  const manifest = await loadManifest(manifestPath);
  const readSvg = buildSvgReader(projectRoot);
  const knowledge = await buildStreamlineTagKnowledge({
    items: manifest.items,
    readSvg,
  });

  const unlabeledItems = manifest.items.filter((item) => !Array.isArray(item?.tags) || item.tags.length === 0);
  const targetItems = includeLabeled ? manifest.items : unlabeledItems;
  const suggestions = [];
  for (const item of targetItems) {
    const suggestion = await suggestTagsForManifestItem(knowledge, item, { readSvg, maxTags, mode });
    suggestions.push({
      itemId: item.itemId,
      slug: item.slug,
      name: item.name,
      outputPath: item.outputPath,
      confidence: suggestion.confidence,
      decision: suggestion.decision,
      suggestedTags: suggestion.suggestedTags,
      searchTextPreview: buildSearchTextPreview(manifest.family, item, suggestion.suggestedTags),
      evidence: suggestion.evidence,
    });
  }

  const resolvedOutputPath = outputPath || buildDefaultOutputPath(manifestPath, manifest.family);
  const report = {
    kind: "streamline-tag-suggestions",
    version: 1,
    family: manifest.family,
    manifestPath,
    generatedAt,
    mode,
    summary: {
      totalItems: manifest.items.length,
      labeledItems: knowledge.labeledItems.length,
      unlabeledItems: unlabeledItems.length,
      suggestedItems: suggestions.filter((item) => item.suggestedTags.length > 0).length,
      autoAcceptItems: suggestions.filter((item) => item.decision === "auto_accept").length,
      reviewRequiredItems: suggestions.filter((item) => item.decision === "review_required").length,
      rejectedItems: suggestions.filter((item) => item.decision === "reject").length,
      maxTags,
    },
    suggestions,
  };

  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return {
    outputPath: resolvedOutputPath,
    summary: report.summary,
  };
}

function parseCliArgs(argv) {
  const options = {
    manifestPath: "",
    outputPath: "",
    maxTags: 12,
    mode: "precise",
    includeLabeled: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      options.outputPath = argv[++index] ?? "";
      continue;
    }
    if (value === "--max-tags") {
      options.maxTags = Number.parseInt(argv[++index] ?? "12", 10);
      continue;
    }
    if (value === "--mode") {
      options.mode = argv[++index] ?? "precise";
      continue;
    }
    if (value === "--include-labeled") {
      options.includeLabeled = true;
      continue;
    }
    if (!options.manifestPath) {
      options.manifestPath = value;
    }
  }

  return options;
}

async function main(argv) {
  const projectRoot = resolveProjectRoot();
  const parsed = parseCliArgs(argv);
  const manifestPath = parsed.manifestPath ? resolve(projectRoot, parsed.manifestPath) : "";
  if (!manifestPath) {
    throw new Error("Usage: node scripts/streamline-export/suggest-streamline-tags.mjs <manifestPath> [--output <path>] [--max-tags <n>] [--mode precise|baseline] [--include-labeled]");
  }

  const result = await suggestStreamlineTagsForManifest({
    manifestPath,
    outputPath: parsed.outputPath ? resolve(projectRoot, parsed.outputPath) : "",
    projectRoot,
    maxTags: parsed.maxTags,
    mode: parsed.mode,
    includeLabeled: parsed.includeLabeled,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("suggest-streamline-tags.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
