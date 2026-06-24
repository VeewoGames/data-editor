import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepository = "https://github.com/tabler/tabler-icons";
const defaultTag = "v3.44.0";
const defaultFilledSourcePath = "icons/filled";
const defaultOutlineSourcePath = "icons/outline";
const defaultVendorRoot = "vendor/tabler-svg";
const defaultSourceMetadataPath = "artifacts/tabler-import/source.json";

async function listSvgFiles(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".svg"))
    .map((entry) => entry.name)
    .sort();
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

async function replaceDirectoryContents(sourceDir, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await ensureDirectory(dirname(targetDir));
  await cp(sourceDir, targetDir, { recursive: true });
}

function parseArgs(argv) {
  const options = {
    sourceRoot: "",
    tag: defaultTag,
    repository: defaultRepository,
    filledSourcePath: defaultFilledSourcePath,
    outlineSourcePath: defaultOutlineSourcePath,
    vendorRoot: defaultVendorRoot,
    sourceMetadataPath: defaultSourceMetadataPath,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--source-root") {
      options.sourceRoot = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--tag") {
      options.tag = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--repository") {
      options.repository = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--filled-source-path") {
      options.filledSourcePath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--outline-source-path") {
      options.outlineSourcePath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--vendor-root") {
      options.vendorRoot = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--source-metadata-path") {
      options.sourceMetadataPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

export async function importTablerTaggedSnapshot({
  sourceRoot,
  repository = defaultRepository,
  tag = defaultTag,
  filledSourcePath = defaultFilledSourcePath,
  outlineSourcePath = defaultOutlineSourcePath,
  vendorRoot = defaultVendorRoot,
  sourceMetadataPath = defaultSourceMetadataPath,
} = {}) {
  if (!sourceRoot) {
    throw new Error("importTablerTaggedSnapshot requires --source-root");
  }

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const resolvedSourceRoot = resolve(projectRoot, sourceRoot);
  const resolvedFilledSourceDir = resolve(resolvedSourceRoot, filledSourcePath);
  const resolvedOutlineSourceDir = resolve(resolvedSourceRoot, outlineSourcePath);
  const resolvedVendorRoot = resolve(projectRoot, vendorRoot);
  const resolvedFilledTargetDir = resolve(resolvedVendorRoot, "filled");
  const resolvedOutlineTargetDir = resolve(resolvedVendorRoot, "outline");
  const resolvedSourceMetadataPath = resolve(projectRoot, sourceMetadataPath);

  const [filledFiles, outlineFiles] = await Promise.all([
    listSvgFiles(resolvedFilledSourceDir),
    listSvgFiles(resolvedOutlineSourceDir),
  ]);

  if (!filledFiles.length) {
    throw new Error(`No SVG files found in filled source path: ${resolvedFilledSourceDir}`);
  }
  if (!outlineFiles.length) {
    throw new Error(`No SVG files found in outline source path: ${resolvedOutlineSourceDir}`);
  }

  await replaceDirectoryContents(resolvedFilledSourceDir, resolvedFilledTargetDir);
  await replaceDirectoryContents(resolvedOutlineSourceDir, resolvedOutlineTargetDir);

  await ensureDirectory(dirname(resolvedSourceMetadataPath));
  const sourceMetadata = {
    repository,
    tag,
    upstreamFilledPath: filledSourcePath.replace(/\\/g, "/"),
    upstreamOutlinePath: outlineSourcePath.replace(/\\/g, "/"),
    importedAt: new Date().toISOString(),
    filledCount: filledFiles.length,
    outlineCount: outlineFiles.length,
  };
  await writeFile(resolvedSourceMetadataPath, `${JSON.stringify(sourceMetadata, null, 2)}\n`, "utf8");

  return {
    tag,
    repository,
    sourceRoot: resolvedSourceRoot,
    filledCount: filledFiles.length,
    outlineCount: outlineFiles.length,
    vendorRoot: resolvedVendorRoot,
    sourceMetadataPath: resolvedSourceMetadataPath,
  };
}

async function main(argv) {
  const options = parseArgs(argv);
  const result = await importTablerTaggedSnapshot(options);
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("import-tabler-tagged-snapshot.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
