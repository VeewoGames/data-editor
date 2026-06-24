import { streamlineSharedViewIcons } from "./generated/streamline-shared-view-icons.mjs";
import { tablerSharedViewIcons } from "./generated/tabler-shared-view-icons.mjs";

function resolveGeneratedPackId(outputPath) {
  if (outputPath.includes("/tabler-svg/filled/")) return "tabler-filled";
  if (outputPath.includes("/tabler-svg/outline/")) return "tabler-outline";
  if (outputPath.includes("/core-solid/")) return "core-solid";
  if (outputPath.includes("/micro-line/")) return "micro-line";
  return "micro-solid";
}

const generatedManifestEntries = [
  ...streamlineSharedViewIcons.map((icon) => ({
    id: icon.id,
    outputPath: icon.outputPath,
    packId: resolveGeneratedPackId(icon.outputPath),
    searchText: icon.searchText,
  })),
  ...tablerSharedViewIcons.map((icon) => ({
    id: icon.id,
    outputPath: icon.outputPath,
    packId: resolveGeneratedPackId(icon.outputPath),
    searchText: icon.searchText,
  })),
];

const generatedManifestEntriesByPackId = {
  "micro-solid": generatedManifestEntries.filter((entry) => entry.packId === "micro-solid"),
  "core-solid": generatedManifestEntries.filter((entry) => entry.packId === "core-solid"),
  "tabler-filled": generatedManifestEntries.filter((entry) => entry.packId === "tabler-filled"),
  "micro-line": generatedManifestEntries.filter((entry) => entry.packId === "micro-line"),
  "tabler-outline": generatedManifestEntries.filter((entry) => entry.packId === "tabler-outline"),
};

export function listSharedViewIconManifestEntries(packId) {
  return generatedManifestEntriesByPackId[packId] ?? [];
}
