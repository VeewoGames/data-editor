import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { loadManifest } from "./lib/manifest-store.mjs";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error("Usage: node verify-streamline-svg.mjs <manifestPath>");
  }

  const manifest = await loadManifest(manifestPath);
  const results = [];
  for (const item of manifest.items) {
    const present = await exists(item.outputPath);
    const content = present ? await readFile(item.outputPath, "utf8") : "";
    results.push({
      slug: item.slug,
      status: item.status,
      present,
      hasSvg: content.includes("<svg"),
      empty: content.trim().length === 0,
    });
  }

  console.log(JSON.stringify({
    family: manifest.family,
    total: results.length,
    success: results.filter((item) => item.status === "success").length,
    missingFiles: results.filter((item) => !item.present).map((item) => item.slug),
    invalidSvg: results.filter((item) => item.present && !item.hasSvg).map((item) => item.slug),
    emptyFiles: results.filter((item) => item.present && item.empty).map((item) => item.slug),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
