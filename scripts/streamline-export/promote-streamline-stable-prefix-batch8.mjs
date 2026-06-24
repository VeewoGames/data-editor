import {
  promoteStableClusterSuggestion,
  promoteStableClusterSuggestions,
  writeStableClusterArtifacts,
} from "./promote-streamline-stable-clusters.mjs";
import { stableClusterProfiles } from "./stable-cluster-profiles.mjs";

const profile = stableClusterProfiles.user;

export function promoteStablePrefixBatch8Suggestion(suggestion) {
  return promoteStableClusterSuggestion(suggestion, profile);
}

export function promoteStreamlineStablePrefixBatch8Suggestions(payload) {
  return promoteStableClusterSuggestions(payload, profile);
}

async function writeArtifacts({
  suggestionsPath,
  outputPath,
  promotedSuggestionsPath,
} = {}) {
  return writeStableClusterArtifacts({
    profile,
    suggestionsPath,
    outputPath,
    promotedSuggestionsPath,
  });
}

function parseCliArgs(argv) {
  const options = {
    suggestionsPath: "",
    outputPath: "",
    promotedSuggestionsPath: "",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      options.outputPath = argv[++index] ?? "";
      continue;
    }
    if (value === "--promoted-output") {
      options.promotedSuggestionsPath = argv[++index] ?? "";
      continue;
    }
    if (!options.suggestionsPath) {
      options.suggestionsPath = value;
    }
  }

  return options;
}

async function main(argv) {
  const parsed = parseCliArgs(argv);
  if (!parsed.suggestionsPath) {
    throw new Error("Usage: node scripts/streamline-export/promote-streamline-stable-prefix-batch8.mjs <suggestionsPath> [--output <path>] [--promoted-output <path>]");
  }

  const result = await writeArtifacts({
    suggestionsPath: parsed.suggestionsPath,
    outputPath: parsed.outputPath,
    promotedSuggestionsPath: parsed.promotedSuggestionsPath,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("promote-streamline-stable-prefix-batch8.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
