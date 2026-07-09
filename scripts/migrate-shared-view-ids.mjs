import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  buildSharedViewIdMaps,
  rewriteProfileWithNeutralViewIds,
  rewriteSharedViewsWithNeutralIds,
  summarizeSharedViewIdMaps,
} from "../src/shared-view-id-migration.mjs";

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    write: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--project") {
      args.projectRoot = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--write") {
      args.write = true;
      continue;
    }
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dataEditorDir = path.join(options.projectRoot, ".data-editor");
  const sharedViewsPath = path.join(dataEditorDir, "shared-views.json");
  const viewConfigsDir = path.join(dataEditorDir, "view-configs");

  const sharedViews = await readJson(sharedViewsPath);
  const collectionIdMaps = buildSharedViewIdMaps(sharedViews);
  const summary = summarizeSharedViewIdMaps(collectionIdMaps);
  const sharedViewsNext = rewriteSharedViewsWithNeutralIds(sharedViews, collectionIdMaps);

  const viewConfigNames = await readdir(viewConfigsDir);
  const profileResults = [];
  for (const fileName of viewConfigNames) {
    if (!fileName.endsWith(".json")) continue;
    const profilePath = path.join(viewConfigsDir, fileName);
    const profile = await readJson(profilePath);
    const nextProfile = rewriteProfileWithNeutralViewIds(profile, collectionIdMaps);
    profileResults.push({ fileName, profilePath, nextProfile });
  }

  if (options.write) {
    await writeJson(sharedViewsPath, sharedViewsNext);
    for (const profileResult of profileResults) {
      await writeJson(profileResult.profilePath, profileResult.nextProfile);
    }
  }

  console.log(JSON.stringify({
    projectRoot: options.projectRoot,
    write: options.write,
    sharedViewsPath,
    viewConfigsDir,
    collectionIdMaps: summary,
    updatedProfiles: profileResults.map((result) => result.fileName),
  }, null, 2));
}

await main();
