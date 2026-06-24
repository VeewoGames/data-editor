import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const generatedModulePath = "src/generated/tabler-shared-view-icons.mjs";
const generatedTypesPath = "src/generated/tabler-shared-view-icons.d.ts";
const defaultVendorRoot = "vendor/tabler-svg";
const defaultCollisionReportPath = "artifacts/tabler-import/collision-report.json";

function toPascalCase(value) {
  return String(value)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function escapeText(value) {
  return JSON.stringify(String(value));
}

function toSearchWords(filename) {
  return filename
    .replace(/\.svg$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function buildTablerId(family, fileName) {
  const stem = basename(fileName, extname(fileName));
  return family === "filled"
    ? `tablerFilled${toPascalCase(stem)}`
    : `tablerLine${toPascalCase(stem)}`;
}

async function listSvgFiles(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".svg"))
    .map((entry) => entry.name)
    .sort();
}

async function loadStreamlineIds(projectRoot) {
  const moduleUrl = pathToFileURL(resolve(projectRoot, "src/generated/streamline-shared-view-icons.mjs")).href;
  const module = await import(moduleUrl);
  return new Set((module.streamlineSharedViewIcons ?? []).map((icon) => String(icon.id)));
}

async function loadLegacyIconIds(projectRoot) {
  const source = await readFile(resolve(projectRoot, "src/components/icons.ts"), "utf8");
  const match = source.match(/const sharedViewLegacyIconRegistry = \{([\s\S]*?)\n\} as const;/);
  if (!match) {
    throw new Error("Unable to locate sharedViewLegacyIconRegistry in src/components/icons.ts");
  }
  const keys = [];
  for (const keyMatch of match[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)) {
    keys.push(keyMatch[1]);
  }
  return new Set(keys);
}

function createCollisionReport() {
  return {
    duplicateBasenames: [],
    duplicateGeneratedIds: [],
    collidingExistingIds: [],
  };
}

function assertNoCollisions(report) {
  const hasCollisions = report.duplicateBasenames.length || report.duplicateGeneratedIds.length || report.collidingExistingIds.length;
  if (!hasCollisions) return;
  throw new Error("Tabler icon generation detected collisions; see artifacts/tabler-import/collision-report.json");
}

function parseArgs(argv) {
  const options = {
    vendorRoot: defaultVendorRoot,
    runtimeOutputPath: generatedModulePath,
    typesOutputPath: generatedTypesPath,
    collisionReportPath: defaultCollisionReportPath,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--vendor-root") {
      options.vendorRoot = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--runtime-output") {
      options.runtimeOutputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--types-output") {
      options.typesOutputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--collision-report") {
      options.collisionReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

export async function generateSharedViewTablerIcons({
  vendorRoot = defaultVendorRoot,
  runtimeOutputPath = generatedModulePath,
  typesOutputPath = generatedTypesPath,
  collisionReportPath = defaultCollisionReportPath,
} = {}) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const resolvedVendorRoot = resolve(projectRoot, vendorRoot);
  const resolvedRuntimeOutputPath = resolve(projectRoot, runtimeOutputPath);
  const resolvedTypesOutputPath = resolve(projectRoot, typesOutputPath);
  const resolvedCollisionReportPath = resolve(projectRoot, collisionReportPath);

  const [streamlineIds, legacyIds] = await Promise.all([
    loadStreamlineIds(projectRoot),
    loadLegacyIconIds(projectRoot),
  ]);
  const existingIds = new Set([...streamlineIds, ...legacyIds]);
  const report = createCollisionReport();
  const icons = [];
  const generatedIds = new Set();

  for (const family of ["filled", "outline"]) {
    const familyDir = resolve(resolvedVendorRoot, family);
    const fileNames = await listSvgFiles(familyDir);
    const basenameSet = new Set();
    for (const fileName of fileNames) {
      const stem = basename(fileName, ".svg");
      if (basenameSet.has(stem)) {
        report.duplicateBasenames.push({ family, stem });
        continue;
      }
      basenameSet.add(stem);
      const id = buildTablerId(family, fileName);
      if (generatedIds.has(id)) {
        report.duplicateGeneratedIds.push({ family, fileName, id });
        continue;
      }
      if (existingIds.has(id)) {
        report.collidingExistingIds.push({ family, fileName, id });
        continue;
      }
      generatedIds.add(id);
      const searchWords = toSearchWords(fileName);
      icons.push({
        id,
        family,
        fileName,
        outputPath: `${vendorRoot.replace(/\\/g, "/")}/${family}/${fileName}`,
        searchText: [
          "tabler",
          family,
          family === "filled" ? "tabler s solid filled" : "tabler l line outline",
          stem,
          searchWords,
        ].join(" ").toLowerCase(),
      });
    }
  }

  await mkdir(dirname(resolvedCollisionReportPath), { recursive: true });
  await writeFile(resolvedCollisionReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  assertNoCollisions(report);

  icons.sort((left, right) => left.id.localeCompare(right.id));

  const groups = [
    {
      id: "tabler-filled",
      label: "Tabler S",
      family: "filled",
      iconIds: icons.filter((icon) => icon.family === "filled").map((icon) => icon.id),
    },
    {
      id: "tabler-outline",
      label: "Tabler L",
      family: "outline",
      iconIds: icons.filter((icon) => icon.family === "outline").map((icon) => icon.id),
    },
  ];

  const runtimeSource = [
    `export const tablerSharedViewIcons = ${JSON.stringify(icons, null, 2)};`,
    "",
    "export const tablerSharedViewIconIds = tablerSharedViewIcons.map((icon) => icon.id);",
    "export const tablerSharedViewIconSearchTextById = Object.fromEntries(tablerSharedViewIcons.map((icon) => [icon.id, icon.searchText]));",
    `export const tablerSharedViewIconGroups = ${JSON.stringify(groups, null, 2)};`,
    "",
  ].join("\n");

  const typeLiterals = icons.map((icon) => `  | ${escapeText(icon.id)}`).join("\n");
  const dtsSource = [
    "export type TablerSharedViewIconId =",
    typeLiterals || "  | never",
    ";",
    "",
    "export type TablerSharedViewIconMeta = {",
    "  id: TablerSharedViewIconId;",
    "  family: \"filled\" | \"outline\";",
    "  fileName: string;",
    "  outputPath: string;",
    "  searchText: string;",
    "};",
    "",
    "export declare const tablerSharedViewIcons: readonly TablerSharedViewIconMeta[];",
    "export declare const tablerSharedViewIconIds: readonly TablerSharedViewIconId[];",
    "export declare const tablerSharedViewIconSearchTextById: Readonly<Record<TablerSharedViewIconId, string>>;",
    "export declare const tablerSharedViewIconGroups: readonly Array<{",
    "  id: \"tabler-filled\" | \"tabler-outline\";",
    "  label: string;",
    "  family: \"filled\" | \"outline\";",
    "  iconIds: readonly TablerSharedViewIconId[];",
    "}>;",
    "",
  ].join("\n");

  await mkdir(dirname(resolvedRuntimeOutputPath), { recursive: true });
  await mkdir(dirname(resolvedTypesOutputPath), { recursive: true });
  await writeFile(resolvedRuntimeOutputPath, runtimeSource, "utf8");
  await writeFile(resolvedTypesOutputPath, dtsSource, "utf8");

  return {
    icons: icons.length,
    groups: groups.length,
    runtimeOutputPath: relative(projectRoot, resolvedRuntimeOutputPath).replace(/\\/g, "/"),
    typesOutputPath: relative(projectRoot, resolvedTypesOutputPath).replace(/\\/g, "/"),
    collisionReportPath: relative(projectRoot, resolvedCollisionReportPath).replace(/\\/g, "/"),
  };
}

async function main(argv) {
  const options = parseArgs(argv);
  const result = await generateSharedViewTablerIcons(options);
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("generate-shared-view-tabler-icons.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
