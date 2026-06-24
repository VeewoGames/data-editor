import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./lib/manifest-store.mjs";
import { getStreamlineFamilyEntryConfig } from "./lib/streamline-family-entry-config.mjs";

const generatedModulePath = "src/generated/streamline-shared-view-icons.mjs";
const generatedTypesPath = "src/generated/streamline-shared-view-icons.d.ts";

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

function buildIconId(family, slug) {
  return `streamline${toPascalCase(family)}${toPascalCase(slug)}`;
}

function buildFamilyGroupId(family) {
  return `streamline-${family}`;
}

function resolveFamilyLabel(family) {
  try {
    return getStreamlineFamilyEntryConfig(family).label ?? family;
  } catch {
    return family;
  }
}

export async function generateSharedViewStreamlineIcons({
  manifestPaths,
  runtimeOutputPath = generatedModulePath,
  typesOutputPath = generatedTypesPath,
} = {}) {
  if (!Array.isArray(manifestPaths) || manifestPaths.length === 0) {
    throw new Error("generateSharedViewStreamlineIcons requires at least one manifest path");
  }

  const manifests = await Promise.all(manifestPaths.map((manifestPath) => loadManifest(manifestPath)));
  const iconMap = new Map();
  for (const manifest of manifests) {
    const family = String(manifest.family ?? "").trim();
    const uniqueUrlsBySlug = new Map();
    for (const item of Array.isArray(manifest.items) ? manifest.items : []) {
      const slug = String(item?.slug ?? "").trim();
      if (!slug) continue;
      const values = uniqueUrlsBySlug.get(slug) ?? new Set();
      const url = String(item?.iconUrl ?? "").trim();
      if (url) values.add(url);
      uniqueUrlsBySlug.set(slug, values);
    }
    for (const item of Array.isArray(manifest.items) ? manifest.items : []) {
      if (item?.status !== "success" || !item?.outputPath) continue;
      const hasVariantCollision = (uniqueUrlsBySlug.get(String(item.slug ?? "").trim())?.size ?? 0) > 1;
      const sourceId = item?.sourceId ?? null;
      const normalizedTags = Array.isArray(item?.tags) ? item.tags : [];
      const displayName = hasVariantCollision && sourceId
        ? `${item.name ?? item.slug} (${sourceId})`
        : (item.name ?? item.slug);
      const icon = {
        id: buildIconId(family, item.itemId ?? item.slug),
        family,
        itemId: item.itemId ?? item.slug,
        slug: item.slug,
        sourceId,
        name: displayName,
        outputPath: String(item.outputPath).replace(/\\/g, "/"),
        tags: normalizedTags,
        searchText: [
          family,
          item.slug,
          displayName,
          item.itemId ?? item.slug,
          sourceId ?? "",
          normalizedTags.join(" "),
        ].join(" ").toLowerCase(),
      };
      iconMap.set(icon.id, icon);
    }
  }
  const icons = Array.from(iconMap.values());

  icons.sort((left, right) => left.id.localeCompare(right.id));

  const groups = manifests
    .map((manifest) => {
      const family = String(manifest.family ?? "").trim();
      const iconIds = icons.filter((icon) => icon.family === family).map((icon) => icon.id);
      if (!iconIds.length) return null;
      return {
        id: buildFamilyGroupId(family),
        label: resolveFamilyLabel(family),
        family,
        iconIds,
      };
    })
    .filter(Boolean);

  const runtimeSource = [
    `export const streamlineSharedViewIcons = ${JSON.stringify(icons, null, 2)};`,
    "",
    "export const streamlineSharedViewIconIds = streamlineSharedViewIcons.map((icon) => icon.id);",
    "export const streamlineSharedViewIconSearchTextById = Object.fromEntries(streamlineSharedViewIcons.map((icon) => [icon.id, icon.searchText]));",
    `export const streamlineSharedViewIconGroups = ${JSON.stringify(groups, null, 2)};`,
    "",
  ].join("\n");

  const typeLiterals = icons.map((icon) => `  | ${escapeText(icon.id)}`).join("\n");
  const dtsSource = [
    "export type StreamlineSharedViewIconId =",
    typeLiterals || "  | never",
    ";",
    "",
    "export type StreamlineSharedViewIconMeta = {",
    "  id: StreamlineSharedViewIconId;",
    "  family: string;",
    "  itemId: string;",
    "  slug: string;",
    "  sourceId: string | null;",
    "  name: string;",
    "  outputPath: string;",
    "  tags: string[];",
    "  searchText: string;",
    "};",
    "",
    "export declare const streamlineSharedViewIcons: readonly StreamlineSharedViewIconMeta[];",
    "export declare const streamlineSharedViewIconIds: readonly StreamlineSharedViewIconId[];",
    "export declare const streamlineSharedViewIconSearchTextById: Readonly<Record<StreamlineSharedViewIconId, string>>;",
    "export declare const streamlineSharedViewIconGroups: readonly Array<{",
    "  id: string;",
    "  label: string;",
    "  family: string;",
    "  iconIds: readonly StreamlineSharedViewIconId[];",
    "}>;",
    "",
  ].join("\n");

  await mkdir(dirname(runtimeOutputPath), { recursive: true });
  await mkdir(dirname(typesOutputPath), { recursive: true });
  await writeFile(runtimeOutputPath, runtimeSource, "utf8");
  await writeFile(typesOutputPath, dtsSource, "utf8");

  return {
    icons: icons.length,
    groups: groups.length,
    runtimeOutputPath,
    typesOutputPath,
    manifestPaths,
  };
}

async function main(argv) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const args = argv.slice(2);
  const manifests = [];
  let runtimeOutputPath = resolve(projectRoot, generatedModulePath);
  let typesOutputPath = resolve(projectRoot, generatedTypesPath);

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--runtime-output") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error("Usage: node scripts/streamline-export/generate-shared-view-streamline-icons.mjs [--runtime-output <path>] [--types-output <path>] <manifestPath...>");
      }
      runtimeOutputPath = resolve(projectRoot, nextValue);
      index += 1;
      continue;
    }
    if (value === "--types-output") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error("Usage: node scripts/streamline-export/generate-shared-view-streamline-icons.mjs [--runtime-output <path>] [--types-output <path>] <manifestPath...>");
      }
      typesOutputPath = resolve(projectRoot, nextValue);
      index += 1;
      continue;
    }
    manifests.push(value);
  }

  if (!manifests.length) {
    throw new Error("Usage: node scripts/streamline-export/generate-shared-view-streamline-icons.mjs [--runtime-output <path>] [--types-output <path>] <manifestPath...>");
  }
  const normalizedManifestPaths = manifests.map((manifestPath) => resolve(projectRoot, manifestPath));
  const result = await generateSharedViewStreamlineIcons({
    manifestPaths: normalizedManifestPaths,
    runtimeOutputPath,
    typesOutputPath,
  });
  console.log(JSON.stringify({
    ...result,
    runtimeOutputPath: relative(projectRoot, result.runtimeOutputPath).replace(/\\/g, "/"),
    typesOutputPath: relative(projectRoot, result.typesOutputPath).replace(/\\/g, "/"),
    manifestPaths: normalizedManifestPaths.map((value) => relative(projectRoot, value).replace(/\\/g, "/")),
  }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("generate-shared-view-streamline-icons.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
