import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "../..");
const iconsSource = await readFile(path.join(projectRoot, "src/components/icons.ts"), "utf8");
const outputPath = path.join(projectRoot, "artifacts/shared-view-icons/legacy-inventory.json");

const legacyIconIds = extractQuotedKeys(iconsSource, "sharedViewLegacyIconRegistry");
const baseIconIds = extractStringArray(iconsSource, "sharedViewBaseIconIds");
const baseSet = new Set(baseIconIds);

const result = {
  capturedAt: new Date().toISOString(),
  summary: {
    totalLegacyRegistryIcons: legacyIconIds.length,
    baseIcons: baseIconIds.length,
    legacyOnlyIcons: legacyIconIds.filter((iconId) => !baseSet.has(iconId)).length,
  },
  baseIcons: baseIconIds,
  legacyOnlyIcons: legacyIconIds.filter((iconId) => !baseSet.has(iconId)),
  categories: {
    keepAsBase: baseIconIds,
    candidateFormalSourceMigration: legacyIconIds.filter((iconId) => !baseSet.has(iconId) && looksLikeFormalSourceCandidate(iconId)),
    candidateLegacyTightening: legacyIconIds.filter((iconId) => !baseSet.has(iconId) && !looksLikeFormalSourceCandidate(iconId)),
  },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function extractQuotedKeys(source, constName) {
  const match = source.match(new RegExp(`const ${constName} = \\{([\\s\\S]*?)\\n\\} as const;`));
  if (!match) throw new Error(`Unable to locate ${constName}`);
  return [...match[1].matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((item) => item[1]);
}

function extractStringArray(source, constName) {
  const match = source.match(new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const;`));
  if (!match) throw new Error(`Unable to locate ${constName}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function looksLikeFormalSourceCandidate(iconId) {
  return !["json", "tagsField", "refresh"].includes(iconId);
}
