import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeParts,
  stableClusterProfiles,
} from "./stable-cluster-profiles.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function buildReasons(audit) {
  const reasons = {};
  for (const row of audit) {
    reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  }
  return reasons;
}

export function promoteStableClusterSuggestion(suggestion, profile) {
  if (suggestion?.decision !== "review_required") {
    return { promote: false, reason: "not_review_required", suggestedTags: [] };
  }

  const itemId = String(suggestion?.itemId ?? "");
  if (!itemId.startsWith(profile.prefix)) {
    return { promote: false, reason: "unsupported_prefix", suggestedTags: [] };
  }

  const parts = normalizeParts(itemId);
  const suggestedTags = profile.buildTagsFromParts(parts, suggestion);
  if (!Array.isArray(suggestedTags) || suggestedTags.length === 0) {
    return { promote: false, reason: "empty_profile_result", suggestedTags: [] };
  }

  return {
    promote: true,
    reason: profile.promotedBy,
    suggestedTags,
  };
}

export function promoteStableClusterSuggestions(payload, profile) {
  const sourceSuggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const audit = sourceSuggestions.map((suggestion) => {
    const decision = promoteStableClusterSuggestion(suggestion, profile);
    return {
      itemId: suggestion?.itemId ?? null,
      slug: suggestion?.slug ?? null,
      reason: decision.reason,
      promote: decision.promote,
      suggestedTags: decision.suggestedTags,
    };
  });

  const promotedSuggestions = sourceSuggestions
    .map((suggestion, index) => ({ suggestion, decision: audit[index] }))
    .filter(({ decision }) => decision.promote)
    .map(({ suggestion, decision }) => ({
      ...suggestion,
      suggestedTags: decision.suggestedTags,
      decision: "auto_accept",
      sourceDecision: "review_required",
      promotedBy: profile.promotedBy,
    }));

  return {
    kind: profile.reportKind,
    version: 1,
    family: payload?.family ?? null,
    summary: {
      totalSuggestions: sourceSuggestions.length,
      promotedCount: promotedSuggestions.length,
      reasons: buildReasons(audit),
    },
    promotedSuggestions,
    audit,
  };
}

export async function writeStableClusterArtifacts({
  profile,
  suggestionsPath,
  outputPath,
  promotedSuggestionsPath,
} = {}) {
  const payload = JSON.parse(await readFile(suggestionsPath, "utf8"));
  const report = promoteStableClusterSuggestions(payload, profile);

  const resolvedOutputPath = outputPath || join(dirname(suggestionsPath), profile.defaultReportName);
  const resolvedPromotedSuggestionsPath =
    promotedSuggestionsPath || join(dirname(suggestionsPath), profile.defaultSuggestionsName);

  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await mkdir(dirname(resolvedPromotedSuggestionsPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(
    resolvedPromotedSuggestionsPath,
    `${JSON.stringify({
      kind: "streamline-tag-suggestions",
      version: 1,
      family: report.family,
      source: profile.promotedBy,
      suggestions: report.promotedSuggestions,
    }, null, 2)}\n`,
    "utf8",
  );

  return {
    outputPath: resolvedOutputPath,
    promotedSuggestionsPath: resolvedPromotedSuggestionsPath,
    summary: report.summary,
  };
}

function parseCliArgs(argv) {
  const options = {
    cluster: "",
    suggestionsPath: "",
    outputPath: "",
    promotedSuggestionsPath: "",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--cluster") {
      options.cluster = argv[++index] ?? "";
      continue;
    }
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
  const profile = stableClusterProfiles[parsed.cluster];
  if (!profile) {
    throw new Error(`Unknown stable cluster "${parsed.cluster}".`);
  }
  const suggestionsPath = parsed.suggestionsPath ? resolve(PROJECT_ROOT, parsed.suggestionsPath) : "";
  if (!suggestionsPath) {
    throw new Error("Usage: node scripts/streamline-export/promote-streamline-stable-clusters.mjs --cluster <cluster> <suggestionsPath> [--output <path>] [--promoted-output <path>]");
  }

  const result = await writeStableClusterArtifacts({
    profile,
    suggestionsPath,
    outputPath: parsed.outputPath ? resolve(PROJECT_ROOT, parsed.outputPath) : "",
    promotedSuggestionsPath: parsed.promotedSuggestionsPath ? resolve(PROJECT_ROOT, parsed.promotedSuggestionsPath) : "",
  });
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("promote-streamline-stable-clusters.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
