export const streamlineFamilyEntryConfig = {
  "core-solid": {
    family: "core-solid",
    entryUrl: "https://www.streamlinehq.com/icons/core-solid",
    label: "Core S",
    manifestPath: "artifacts/streamline-export/core-solid-full.manifest.json",
    itemsPath: "artifacts/streamline-export/core-solid-full-items.json",
    outputDir: "vendor/streamline-svg/core-solid",
  },
  "micro-line": {
    family: "micro-line",
    entryUrl: "https://www.streamlinehq.com/icons/micro-line",
    label: "Line",
    manifestPath: "artifacts/streamline-export/micro-line-full.manifest.json",
    outputDir: "vendor/streamline-svg/micro-line",
  },
  "micro-solid": {
    family: "micro-solid",
    entryUrl: "https://www.streamlinehq.com/icons/micro-solid",
    label: "Solid",
    manifestPath: "artifacts/streamline-export/micro-solid-full.manifest.json",
    outputDir: "vendor/streamline-svg/micro-solid",
  },
};

export function getStreamlineFamilyEntryConfig(family) {
  const config = streamlineFamilyEntryConfig[String(family ?? "").trim()];
  if (!config) {
    throw new Error(`Unsupported Streamline family: ${family}`);
  }
  return config;
}
