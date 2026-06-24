import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GENERIC_ITEM_TOKENS = new Set([
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "circle",
  "square",
  "horizontal",
  "vertical",
  "left",
  "right",
  "top",
  "bottom",
  "up",
  "down",
  "off",
  "low",
  "medium",
  "high",
  "none",
  "full",
  "option",
]);

const BLOCKED_DRIFT_TAGS = new Set([
  "airport",
  "airplane",
  "atm",
  "cash",
  "catholicism",
  "charity",
  "christianity",
  "emergency",
  "entertainment",
  "favorite",
  "finance",
  "flight",
  "gaming",
  "healthcare",
  "hospital",
  "payment",
  "travel",
]);

function resolveProjectRoot() {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

function toTokenParts(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .flatMap((value) => String(value ?? "").toLowerCase().split(/[^a-z0-9]+/i))
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function toSemanticTokens(itemId) {
  return Array.from(
    new Set(
      String(itemId ?? "")
        .toLowerCase()
        .split("-")
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => !GENERIC_ITEM_TOKENS.has(part)),
    ),
  );
}

export function promoteReviewRequiredSuggestion(suggestion, {
  minConfidence = 0.77,
  blockedDriftTags = BLOCKED_DRIFT_TAGS,
} = {}) {
  if (suggestion?.decision !== "review_required") {
    return { promote: false, reason: "not_review_required", coveredTokens: [] };
  }
  if (!Array.isArray(suggestion?.suggestedTags) || suggestion.suggestedTags.length === 0) {
    return { promote: false, reason: "no_suggested_tags", coveredTokens: [] };
  }
  if (!(Number(suggestion?.confidence) >= minConfidence)) {
    return { promote: false, reason: "low_confidence", coveredTokens: [] };
  }

  const nameNeighborCount = Array.isArray(suggestion?.evidence?.nameNeighbors) ? suggestion.evidence.nameNeighbors.length : 0;
  const imageNeighborCount = Array.isArray(suggestion?.evidence?.imageNeighbors) ? suggestion.evidence.imageNeighbors.length : 0;
  if (nameNeighborCount < 2 || imageNeighborCount < 2) {
    return { promote: false, reason: "insufficient_neighbor_support", coveredTokens: [] };
  }

  const semanticTokens = toSemanticTokens(suggestion?.itemId);
  const tagParts = toTokenParts(suggestion?.suggestedTags?.slice(0, 8));
  const coveredTokens = semanticTokens.filter((token) => tagParts.has(token));
  if (coveredTokens.length < 2) {
    return { promote: false, reason: "insufficient_semantic_coverage", coveredTokens };
  }

  const primaryToken = semanticTokens[0] ?? "";
  if (!primaryToken || !coveredTokens.includes(primaryToken)) {
    return { promote: false, reason: "missing_primary_token", coveredTokens };
  }

  const blockedTopTag = suggestion.suggestedTags
    .slice(0, 5)
    .map((tag) => String(tag).toLowerCase())
    .find((tag) => blockedDriftTags.has(tag) && !semanticTokens.includes(tag));
  if (blockedTopTag) {
    return { promote: false, reason: "blocked_tag_drift", coveredTokens, blockedTopTag };
  }

  return {
    promote: true,
    reason: "promoted",
    coveredTokens,
    semanticTokens,
    nameNeighborCount,
    imageNeighborCount,
  };
}

function sanitizePromotedTags(tags, blockedDriftTags) {
  return (Array.isArray(tags) ? tags : [])
    .filter((tag) => !blockedDriftTags.has(String(tag).toLowerCase()))
    .slice(0, 8);
}

export function promoteStreamlineReviewRequiredSuggestions(payload, options = {}) {
  const sourceSuggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const reviewRequiredSuggestions = sourceSuggestions.filter((item) => item?.decision === "review_required");
  const audit = reviewRequiredSuggestions.map((suggestion) => {
    const decision = promoteReviewRequiredSuggestion(suggestion, options);
    return {
      itemId: suggestion.itemId,
      slug: suggestion.slug,
      confidence: suggestion.confidence,
      reason: decision.reason,
      blockedTopTag: decision.blockedTopTag ?? null,
      coveredTokens: decision.coveredTokens,
      promote: decision.promote,
      suggestedTags: suggestion.suggestedTags,
    };
  });

  const promotedSuggestions = reviewRequiredSuggestions
    .filter((suggestion, index) => audit[index]?.promote)
    .map((suggestion) => ({
      ...suggestion,
      suggestedTags: sanitizePromotedTags(suggestion.suggestedTags, options.blockedDriftTags ?? BLOCKED_DRIFT_TAGS),
      decision: "auto_accept",
      sourceDecision: "review_required",
      promotedBy: "second_stage_gate",
    }));

  const reasons = {};
  for (const row of audit) {
    reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  }

  return {
    kind: "streamline-review-required-promotion",
    version: 1,
    family: payload?.family ?? null,
    summary: {
      reviewRequiredCount: reviewRequiredSuggestions.length,
      promotedCount: promotedSuggestions.length,
      rejectedCount: reviewRequiredSuggestions.length - promotedSuggestions.length,
      reasons,
    },
    promotedSuggestions,
    audit,
  };
}

async function writePromotionArtifacts({
  suggestionsPath,
  outputPath,
  promotedSuggestionsPath,
} = {}) {
  const payload = JSON.parse(await readFile(suggestionsPath, "utf8"));
  const report = promoteStreamlineReviewRequiredSuggestions(payload);

  const resolvedOutputPath = outputPath || join(dirname(suggestionsPath), "micro-solid-review-required-promotion-report.json");
  const resolvedPromotedSuggestionsPath = promotedSuggestionsPath || join(dirname(suggestionsPath), "micro-solid-review-required-promoted-suggestions.json");

  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await mkdir(dirname(resolvedPromotedSuggestionsPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(resolvedPromotedSuggestionsPath, `${JSON.stringify({
    kind: "streamline-tag-suggestions",
    version: 1,
    family: report.family,
    source: "second_stage_gate",
    suggestions: report.promotedSuggestions,
  }, null, 2)}\n`, "utf8");

  return {
    outputPath: resolvedOutputPath,
    promotedSuggestionsPath: resolvedPromotedSuggestionsPath,
    summary: report.summary,
  };
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
  const projectRoot = resolveProjectRoot();
  const parsed = parseCliArgs(argv);
  const suggestionsPath = parsed.suggestionsPath ? resolve(projectRoot, parsed.suggestionsPath) : "";
  if (!suggestionsPath) {
    throw new Error("Usage: node scripts/streamline-export/promote-streamline-review-required.mjs <suggestionsPath> [--output <path>] [--promoted-output <path>]");
  }

  const result = await writePromotionArtifacts({
    suggestionsPath,
    outputPath: parsed.outputPath ? resolve(projectRoot, parsed.outputPath) : "",
    promotedSuggestionsPath: parsed.promotedSuggestionsPath ? resolve(projectRoot, parsed.promotedSuggestionsPath) : "",
  });
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("promote-streamline-review-required.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
