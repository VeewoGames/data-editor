import { createElement } from "react";
import {
  IconAlertTriangleFilled,
  IconAdjustmentsHorizontal,
  IconBackpack,
  IconBellFilled,
  IconBookmarkFilled,
  IconBorderAll,
  IconBraces,
  IconCalendarFilled,
  IconCircleCaretDownFilled,
  IconCheckbox,
  IconCircleDotFilled,
  IconCopy,
  IconDatabaseFilled,
  IconDeviceFloppyFilled,
  IconDots,
  IconEdit,
  IconEyeOff,
  IconFileFilled,
  IconFileCodeFilled,
  IconFilterFilled,
  IconFolderFilled,
  IconFolderOpenFilled,
  IconFilter2,
  IconGripVertical,
  IconHierarchy,
  IconHourglassEmpty,
  IconInfoCircleFilled,
  IconLayoutSidebarRightFilled,
  IconLink,
  IconLinkOff,
  IconListFilled,
  IconPlus,
  IconPower,
  IconRotateClockwise2,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconShieldFilled,
  IconX,
  IconNumber,
  IconRefresh,
  IconSettings,
  IconRowInsertBottom,
  IconSearch,
  IconSortAscending,
  IconSortDescending,
  IconStar,
  IconStarFilled,
  IconSword,
  IconTableFilled,
  IconTagsFilled,
  IconTextSize,
  IconTextWrap,
  IconTrashFilled,
  IconWand,
} from "@tabler/icons-react";
import { sharedViewIconIds as normalizedSharedViewIconIds } from "../view/shared-view-normalize.mjs";
export const icons = {
  search: IconSearch,
  save: IconDeviceFloppyFilled,
  dirty: IconCircleDotFilled,
  circleDot: IconCircleDotFilled,
  borderAll: IconBorderAll,
  incompatible: IconAlertTriangleFilled,
  jsonFile: IconFileCodeFilled,
  csvFile: IconTableFilled,
  table: IconTableFilled,
  textField: IconTextSize,
  wrapText: IconTextWrap,
  numberField: IconNumber,
  checkboxField: IconCheckbox,
  selectField: IconCircleCaretDownFilled,
  multiSelectField: IconTagsFilled,
  dateField: IconCalendarFilled,
  tagsField: IconTagsFilled,
  sortAscending: IconSortAscending,
  sortDescending: IconSortDescending,
  filter: IconFilter2,
  addRow: IconRowInsertBottom,
  addField: IconPlus,
  delete: IconTrashFilled,
  detailPanel: IconLayoutSidebarRightFilled,
  previous: IconChevronLeft,
  next: IconChevronRight,
  chevronDown: IconChevronDown,
  openDetail: IconLayoutSidebarRightFilled,
  close: IconX,
  power: IconPower,
  copy: IconCopy,
  refresh: IconRefresh,
  edit: IconEdit,
  adjust: IconAdjustmentsHorizontal,
  settings: IconSettings,
  hidden: IconEyeOff,
  reset: IconRotateClockwise2,
  dragHandle: IconGripVertical,
  more: IconDots,
  info: IconInfoCircleFilled,
  hourglassEmpty: IconHourglassEmpty,
  check: IconCheck,
  nested: IconHierarchy,
  folder: IconFolderFilled,
  json: IconBraces,
  relation: IconLink,
  relationOff: IconLinkOff,
} as const;

type InlineIconProps = {
  size?: number;
  className?: string;
};

export type SharedViewIconPackId = "base" | "micro-solid" | "core-solid" | "micro-line" | "tabler-filled" | "tabler-outline" | "legacy";

function normalizeStreamlineSvg(svgText: string) {
  return svgText
    .replace(/var\(--sl-c-000000,#000000\)/g, "currentColor")
    .replace(/(["'])#000000\1/gi, "$1currentColor$1")
    .replace(/(["'])#000\1/gi, "$1currentColor$1")
    .replace(/<svg\b/, '<svg width="100%" height="100%" aria-hidden="true" focusable="false"');
}

function createStreamlineIcon(svgText: string) {
  const normalizedSvg = normalizeStreamlineSvg(svgText);
  return function StreamlineIcon({ size = 18, className }: InlineIconProps) {
    return createElement("span", {
      className,
      style: {
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "currentColor",
        lineHeight: 0,
        flex: "0 0 auto",
      },
      dangerouslySetInnerHTML: { __html: normalizedSvg },
    });
  };
}

const sharedViewBaseIconRegistry = {
  borderAll: icons.borderAll,
  folder: IconFolderFilled,
  folderOpen: IconFolderOpenFilled,
  bookmark: IconBookmarkFilled,
  search: IconSearch,
  settings: IconSettings,
  list: IconListFilled,
  bell: IconBellFilled,
  table: IconTableFilled,
  database: IconDatabaseFilled,
  file: IconFileFilled,
  filter: IconFilterFilled,
  shield: IconShieldFilled,
  sword: IconSword,
  wand: IconWand,
  backpack: IconBackpack,
} as const;

export const sharedViewFavoriteOutlineIcon = IconStar;
export const sharedViewFavoriteFilledIcon = IconStarFilled;

export const sharedViewDefaultIconId = "borderAll" as const;
export const sharedViewRecentIconStorageKey = "data-editor:shared-view-recent-icons";

export const sharedViewBaseIconIds = [
  "borderAll",
  "folder",
  "search",
  "settings",
  "list",
  "filter",
  "table",
  "database",
  "file",
  "folderOpen",
  "bookmark",
  "bell",
  "shield",
  "sword",
  "wand",
  "backpack",
] as const;

const sharedViewBaseIconIdSet = new Set<string>(sharedViewBaseIconIds);
const sharedViewLegacyIconIds = [...normalizedSharedViewIconIds].filter((iconId) => !sharedViewBaseIconIdSet.has(iconId));
const sharedViewLegacyIconIdSet = new Set<string>(sharedViewLegacyIconIds);
let sharedViewLegacyIconRegistryPromise: Promise<Record<string, any>> | null = null;

type SharedViewGeneratedManifestEntry = {
  id: string;
  outputPath: string;
  searchText: string;
};

function resolveGeneratedPackId(outputPath: string): Exclude<SharedViewIconPackId, "base" | "legacy"> {
  if (outputPath.includes("/tabler-svg/filled/")) return "tabler-filled";
  if (outputPath.includes("/tabler-svg/outline/")) return "tabler-outline";
  if (outputPath.includes("/core-solid/")) return "core-solid";
  if (outputPath.includes("/micro-line/")) return "micro-line";
  return "micro-solid";
}

export const sharedViewIconPackLabels = {
  base: "Base",
  "micro-solid": "Micro S",
  "core-solid": "Core S",
  "tabler-filled": "Tabler S",
  "micro-line": "Micro L",
  "tabler-outline": "Tabler L",
  legacy: "Legacy",
} as const;

const sharedViewIconIdsByPackId: Record<SharedViewIconPackId, string[]> = {
  base: [...sharedViewBaseIconIds],
  "micro-solid": [],
  "core-solid": [],
  "tabler-filled": [],
  "micro-line": [],
  "tabler-outline": [],
  legacy: [...sharedViewLegacyIconIds],
};

export const sharedViewIconRegistry: Record<string, any> = Object.fromEntries(
  sharedViewBaseIconIds.map((iconId) => [iconId, sharedViewBaseIconRegistry[iconId as keyof typeof sharedViewBaseIconRegistry]]),
);

export const sharedViewLoadedIconPacksStorageKey = "data-editor:shared-view-loaded-icon-packs";
const loadedSharedViewIconPackIds = new Set<SharedViewIconPackId>(["base"]);
const sharedViewIconPackSvgTextCache = new Map<Exclude<SharedViewIconPackId, "base" | "legacy">, Promise<Record<string, string>>>();
const sharedViewIconManifestCache = new Map<Exclude<SharedViewIconPackId, "base" | "legacy">, Promise<SharedViewGeneratedManifestEntry[]>>();
export const sharedViewGeneratedIconSearchText = {} as Record<string, string>;

function resolveGeneratedPackIdFromIconId(iconId: string): Exclude<SharedViewIconPackId, "base" | "legacy"> | null {
  if (iconId.startsWith("streamlineCoreSolid")) return "core-solid";
  if (iconId.startsWith("streamlineMicroSolid")) return "micro-solid";
  if (iconId.startsWith("streamlineMicroLine")) return "micro-line";
  if (iconId.startsWith("tablerFilled")) return "tabler-filled";
  if (iconId.startsWith("tablerLine")) return "tabler-outline";
  return null;
}

function isKnownSharedViewIconId(iconId: string) {
  return sharedViewLegacyIconIdSet.has(iconId) || !!resolveGeneratedPackIdFromIconId(iconId);
}

async function loadSharedViewIconManifest(
  packId: Exclude<SharedViewIconPackId, "base" | "legacy">,
) {
  const cached = sharedViewIconManifestCache.get(packId);
  if (cached) return cached;
  const loader = fetch(`/api/shared-view-icon-pack-manifest?packId=${encodeURIComponent(packId)}`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load shared view icon manifest: ${packId}`);
      }
      const payload = await response.json() as SharedViewGeneratedManifestEntry[];
      sharedViewIconIdsByPackId[packId].splice(0, sharedViewIconIdsByPackId[packId].length, ...payload.map((entry) => entry.id));
      for (const entry of payload) sharedViewGeneratedIconSearchText[entry.id] = entry.searchText;
      return payload;
    });
  sharedViewIconManifestCache.set(packId, loader);
  return loader;
}

function readPersistedLoadedSharedViewIconPackIds(storage: Storage | null | undefined) {
  if (!storage) return [] as SharedViewIconPackId[];
  try {
    const raw = storage.getItem(sharedViewLoadedIconPacksStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((packId): packId is SharedViewIconPackId => typeof packId === "string" && packId in sharedViewIconIdsByPackId && packId !== "base");
  } catch {
    return [];
  }
}

function persistLoadedSharedViewIconPackIds(storage: Storage | null | undefined) {
  if (!storage) return;
  const persistedPackIds = [...loadedSharedViewIconPackIds].filter((packId) => packId !== "base");
  storage.setItem(sharedViewLoadedIconPacksStorageKey, JSON.stringify(persistedPackIds));
}

function registerBasePack() {
  for (const iconId of sharedViewIconIdsByPackId.base) {
    sharedViewIconRegistry[iconId] = sharedViewBaseIconRegistry[iconId as keyof typeof sharedViewBaseIconRegistry];
  }
}

async function loadSharedViewLegacyIconRegistry() {
  sharedViewLegacyIconRegistryPromise ??= import("./shared-view-legacy-icons").then((module) => module.sharedViewLegacyIconRegistry);
  return sharedViewLegacyIconRegistryPromise;
}

async function registerLegacyPack() {
  const sharedViewLegacyIconRegistry = await loadSharedViewLegacyIconRegistry();
  for (const iconId of sharedViewIconIdsByPackId.legacy) {
    sharedViewIconRegistry[iconId] = sharedViewLegacyIconRegistry[iconId as keyof typeof sharedViewLegacyIconRegistry];
  }
}

async function registerStreamlinePack(packId: "micro-solid" | "core-solid" | "micro-line") {
  const entries = await registerSvgPackEntries(packId);
  for (const entry of entries) {
    if (!entry) continue;
    sharedViewIconRegistry[entry[0]] = entry[1];
  }
}

async function registerTablerPack(packId: "tabler-filled" | "tabler-outline") {
  const entries = await registerSvgPackEntries(packId);
  for (const entry of entries) {
    if (!entry) continue;
    sharedViewIconRegistry[entry[0]] = entry[1];
  }
}

async function registerSvgPackEntries(
  packId: Exclude<SharedViewIconPackId, "base" | "legacy">,
) {
  const manifestEntries = await loadSharedViewIconManifest(packId);
  const manifestEntryByIconId = new Map(manifestEntries.map((entry) => [entry.id, entry]));
  const svgTextByOutputPath = await loadSharedViewIconPackSvgTextMap(packId);
  const entries = await Promise.all(
    sharedViewIconIdsByPackId[packId].map(async (iconId) => {
      const outputPath = manifestEntryByIconId.get(iconId)?.outputPath;
      if (!outputPath) return null;
      const svgText = svgTextByOutputPath[outputPath];
      if (!svgText) return null;
      return [iconId, createStreamlineIcon(svgText)] as const;
    }),
  );
  return entries;
}

function loadSharedViewIconPackSvgTextMap(packId: Exclude<SharedViewIconPackId, "base" | "legacy">) {
  const cached = sharedViewIconPackSvgTextCache.get(packId);
  if (cached) return cached;
  const loader = fetch(`/api/shared-view-icon-pack?packId=${encodeURIComponent(packId)}`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load shared view icon pack: ${packId}`);
      }
      return response.json() as Promise<Record<string, string>>;
    });
  sharedViewIconPackSvgTextCache.set(packId, loader);
  return loader;
}

export async function loadSharedViewIconPack(packId: SharedViewIconPackId) {
  if (loadedSharedViewIconPackIds.has(packId)) return;
  if (packId === "base") {
    registerBasePack();
  } else if (packId === "legacy") {
    await registerLegacyPack();
  } else if (packId === "tabler-filled" || packId === "tabler-outline") {
    await registerTablerPack(packId);
  } else {
    await registerStreamlinePack(packId);
  }
  loadedSharedViewIconPackIds.add(packId);
  if (typeof window !== "undefined") persistLoadedSharedViewIconPackIds(window.localStorage);
}

export function unloadSharedViewIconPack(packId: SharedViewIconPackId) {
  if (packId === "base") return false;
  if (!loadedSharedViewIconPackIds.has(packId)) return true;
  for (const iconId of sharedViewIconIdsByPackId[packId]) {
    delete sharedViewIconRegistry[iconId];
  }
  loadedSharedViewIconPackIds.delete(packId);
  if (typeof window !== "undefined") persistLoadedSharedViewIconPackIds(window.localStorage);
  return true;
}

export function readLoadedSharedViewIconPackIds() {
  return [...loadedSharedViewIconPackIds];
}

export async function hydratePersistedSharedViewIconPacks(storage: Storage | null | undefined = typeof window === "undefined" ? null : window.localStorage) {
  const persistedPackIds = readPersistedLoadedSharedViewIconPackIds(storage);
  await Promise.all(persistedPackIds.map((packId) => loadSharedViewIconPack(packId)));
}

export function resolveSharedViewIconPackId(iconId: string) {
  if (sharedViewBaseIconIdSet.has(iconId)) return "base";
  if (sharedViewLegacyIconIdSet.has(iconId)) return "legacy";
  return resolveGeneratedPackIdFromIconId(iconId) ?? "legacy";
}

export function isSharedViewIconLoaded(iconId: string) {
  return !!sharedViewIconRegistry[iconId];
}

export function readSharedViewIconComponent(iconId: string) {
  return sharedViewIconRegistry[iconId] ?? null;
}

export const sharedViewFallbackIcon = icons.borderAll;

export const sharedViewIconGroups = [
  { id: "recent", label: "最近" },
  {
    id: "favorites",
    label: "收藏",
  },
  {
    id: "micro-solid",
    label: "Micro S",
  },
  {
    id: "core-solid",
    label: "Core S",
  },
  {
    id: "tabler-filled",
    label: "Tabler S",
  },
  {
    id: "micro-line",
    label: "Micro L",
  },
  {
    id: "tabler-outline",
    label: "Tabler L",
  },
  {
    id: "legacy",
    label: "Legacy",
  },
] as const;

export const sharedViewIconSearchAliases = {
  favorites: ["收藏", "星标", "喜欢", "常用"],
  "micro-solid": ["streamline", "micro", "solid", "micro s", "实心", "填充", "filled"],
  "core-solid": ["streamline", "core", "solid", "core s", "实心", "填充", "filled"],
  "tabler-filled": ["tabler", "filled", "solid", "tabler s", "实心", "填充"],
  "micro-line": ["streamline", "micro", "line", "micro l", "线条", "描边", "outline"],
  "tabler-outline": ["tabler", "outline", "line", "tabler l", "线条", "描边"],
  legacy: ["legacy", "旧版", "历史", "builtin", "tabler"],
} as const;

export function readSharedViewIconIdsForPack(packId: SharedViewIconPackId) {
  return [...sharedViewIconIdsByPackId[packId]];
}

export function isSharedViewIconPackLoaded(packId: SharedViewIconPackId) {
  return loadedSharedViewIconPackIds.has(packId);
}

export function readRecentSharedViewIconIds(storage: Storage | null) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(sharedViewRecentIconStorageKey) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && isKnownSharedViewIconId(value)).slice(0, 12)
      : [];
  } catch {
    return [];
  }
}
