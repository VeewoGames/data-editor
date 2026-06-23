import { readFile } from "node:fs/promises";
import { createManifest } from "./lib/manifest-store.mjs";

async function main() {
  const manifestPath = process.argv[2];
  const family = process.argv[3];
  const itemsPath = process.argv[4];
  if (!manifestPath || !family) {
    throw new Error("Usage: node collect-streamline-icons.mjs <manifestPath> <family> [itemsJsonPath]");
  }

  const items = itemsPath
    ? JSON.parse(await readFile(itemsPath, "utf8"))
    : [];

  await createManifest({
    manifestPath,
    family,
    outputDir: `vendor/streamline-svg/${family}`,
    items,
  });

  console.log(JSON.stringify({
    manifestPath,
    family,
    itemCount: items.length,
    message: itemsPath ? "Manifest created from item list." : "Empty manifest scaffold created.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
