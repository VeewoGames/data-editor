import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./lib/manifest-store.mjs";
import { buildStreamlineTagKnowledge } from "./lib/streamline-tag-suggestion-knowledge.mjs";

function resolveProjectRoot() {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

function buildDefaultOutputPath(manifestPath, family) {
  return join(dirname(manifestPath), `${family}-tag-knowledge.json`);
}

function buildSvgReader(projectRoot) {
  return async function readSvg(outputPath) {
    return readFile(resolve(projectRoot, outputPath), "utf8");
  };
}

export async function buildStreamlineTagKnowledgeFile({
  manifestPath,
  outputPath,
  projectRoot = resolveProjectRoot(),
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!manifestPath) {
    throw new Error("buildStreamlineTagKnowledgeFile requires manifestPath");
  }

  const manifest = await loadManifest(manifestPath);
  const knowledge = await buildStreamlineTagKnowledge({
    items: manifest.items,
    readSvg: buildSvgReader(projectRoot),
  });

  const resolvedOutputPath = outputPath || buildDefaultOutputPath(manifestPath, manifest.family);
  const snapshot = {
    kind: "streamline-tag-knowledge",
    version: 1,
    family: manifest.family,
    manifestPath,
    generatedAt,
    summary: {
      totalItems: manifest.items.length,
      labeledItems: knowledge.labeledItems.length,
      unlabeledItems: manifest.items.length - knowledge.labeledItems.length,
      vocabularySize: knowledge.tagVocabulary.length,
    },
    tagVocabulary: knowledge.tagVocabulary,
    labeledItems: knowledge.labeledItems,
  };

  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return {
    outputPath: resolvedOutputPath,
    summary: snapshot.summary,
  };
}

function parseCliArgs(argv) {
  const options = {
    manifestPath: "",
    outputPath: "",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      options.outputPath = argv[++index] ?? "";
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
    throw new Error("Usage: node scripts/streamline-export/build-streamline-tag-knowledge.mjs <manifestPath> [--output <path>]");
  }

  const result = await buildStreamlineTagKnowledgeFile({
    manifestPath,
    outputPath: parsed.outputPath ? resolve(projectRoot, parsed.outputPath) : "",
    projectRoot,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("build-streamline-tag-knowledge.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
