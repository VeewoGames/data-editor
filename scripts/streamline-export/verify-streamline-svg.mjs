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

export async function verifyStreamlineSvgManifest({ manifestPath } = {}) {
  if (!manifestPath) {
    throw new Error("verifyStreamlineSvgManifest requires manifestPath");
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

  return {
    family: manifest.family,
    total: results.length,
    success: results.filter((item) => item.status === "success").length,
    pending: results.filter((item) => item.status === "pending").length,
    failed: results.filter((item) => item.status === "failed").length,
    presentFiles: results.filter((item) => item.present).length,
    missingFiles: results.filter((item) => !item.present).map((item) => item.slug),
    invalidSvg: results.filter((item) => item.present && !item.hasSvg).map((item) => item.slug),
    emptyFiles: results.filter((item) => item.present && item.empty).map((item) => item.slug),
    successMissingFiles: results
      .filter((item) => item.status === "success" && !item.present)
      .map((item) => item.slug),
    successInvalidSvg: results
      .filter((item) => item.status === "success" && item.present && !item.hasSvg)
      .map((item) => item.slug),
    successEmptyFiles: results
      .filter((item) => item.status === "success" && item.present && item.empty)
      .map((item) => item.slug),
    pendingExistingFiles: results
      .filter((item) => item.status === "pending" && item.present)
      .map((item) => item.slug),
    failedExistingFiles: results
      .filter((item) => item.status === "failed" && item.present)
      .map((item) => item.slug),
  };
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error("Usage: node verify-streamline-svg.mjs <manifestPath>");
  }

  console.log(JSON.stringify(await verifyStreamlineSvgManifest({ manifestPath }), null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("verify-streamline-svg.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
