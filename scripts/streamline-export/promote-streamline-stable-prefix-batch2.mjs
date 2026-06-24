import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const BATCH2_PREFIXES = new Set(["navigation", "search", "menu"]);
const PREFIX_MIN_CONFIDENCE = {
  menu: 0.99,
  search: 0.99,
};

function normalizeParts(itemId) {
  return String(itemId ?? "")
    .toLowerCase()
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
}

function dedupeTags(tags) {
  const seen = new Set();
  const result = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const normalized = String(tag ?? "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function appendIf(parts, token, ...tags) {
  return parts.includes(token) ? tags : [];
}

function buildNavigationTags(itemId) {
  const parts = normalizeParts(itemId);
  const tags = ["arrow", "direction", "navigation"];

  tags.push(...appendIf(parts, "fork", "fork"));
  tags.push(...appendIf(parts, "east", "east"));
  tags.push(...appendIf(parts, "west", "west"));
  tags.push(...appendIf(parts, "south", "south"));
  tags.push(...appendIf(parts, "off", "off", "disable"));
  tags.push(...appendIf(parts, "left", "left"));
  tags.push(...appendIf(parts, "right", "right"));

  return dedupeTags(tags).slice(0, 8);
}

function buildSearchTags(itemId) {
  const parts = normalizeParts(itemId);
  const tags = ["search", "find", "lookup"];

  tags.push(...appendIf(parts, "check", "check", "confirm"));
  tags.push(...appendIf(parts, "circle", "circle"));
  tags.push(...appendIf(parts, "square", "square"));
  tags.push(...appendIf(parts, "off", "off", "disable"));
  tags.push(...appendIf(parts, "text", "text"));
  if (parts.includes("dollar")) tags.push("dollar", "finance", "money");

  return dedupeTags(tags).slice(0, 8);
}

function buildMenuTags(itemId) {
  const parts = normalizeParts(itemId);
  const tags = ["menu", "navigation", "options", "interface"];

  tags.push(...appendIf(parts, "alternate", "alternate"));
  tags.push(...appendIf(parts, "horizontal", "horizontal"));
  tags.push(...appendIf(parts, "vertical", "vertical"));
  tags.push(...appendIf(parts, "line", "line"));

  return dedupeTags(tags).slice(0, 8);
}

export function promoteStablePrefixBatch2Suggestion(suggestion) {
  if (suggestion?.decision !== "review_required") {
    return { promote: false, reason: "not_review_required", suggestedTags: [] };
  }

  const itemId = String(suggestion?.itemId ?? "");
  const prefix = itemId.split("-")[0];
  if (!BATCH2_PREFIXES.has(prefix)) {
    return { promote: false, reason: "unsupported_prefix", suggestedTags: [] };
  }
  const minConfidence = PREFIX_MIN_CONFIDENCE[prefix] ?? null;
  if (minConfidence !== null && !(Number(suggestion?.confidence) >= minConfidence)) {
    return { promote: false, reason: "low_confidence", suggestedTags: [] };
  }

  let suggestedTags = [];
  if (prefix === "navigation") suggestedTags = buildNavigationTags(itemId);
  if (prefix === "search") suggestedTags = buildSearchTags(itemId);
  if (prefix === "menu") suggestedTags = buildMenuTags(itemId);

  if (suggestedTags.length === 0) {
    return { promote: false, reason: "empty_profile_result", suggestedTags: [] };
  }

  return {
    promote: true,
    reason: "stable_prefix_batch2",
    suggestedTags,
  };
}

export function promoteStreamlineStablePrefixBatch2Suggestions(payload) {
  const sourceSuggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const audit = sourceSuggestions.map((suggestion) => {
    const decision = promoteStablePrefixBatch2Suggestion(suggestion);
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
      promotedBy: "stable_prefix_batch2",
    }));

  const reasons = {};
  for (const row of audit) {
    reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  }

  return {
    kind: "streamline-stable-prefix-batch2-promotion",
    version: 1,
    family: payload?.family ?? null,
    summary: {
      totalSuggestions: sourceSuggestions.length,
      promotedCount: promotedSuggestions.length,
      reasons,
    },
    promotedSuggestions,
    audit,
  };
}

async function writeArtifacts({
  suggestionsPath,
  outputPath,
  promotedSuggestionsPath,
} = {}) {
  const payload = JSON.parse(await readFile(suggestionsPath, "utf8"));
  const report = promoteStreamlineStablePrefixBatch2Suggestions(payload);

  const resolvedOutputPath = outputPath || join(dirname(suggestionsPath), "micro-solid-stable-prefix-batch2-report.json");
  const resolvedPromotedSuggestionsPath = promotedSuggestionsPath || join(dirname(suggestionsPath), "micro-solid-stable-prefix-batch2-suggestions.json");

  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await mkdir(dirname(resolvedPromotedSuggestionsPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(resolvedPromotedSuggestionsPath, `${JSON.stringify({
    kind: "streamline-tag-suggestions",
    version: 1,
    family: report.family,
    source: "stable_prefix_batch2",
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
  const parsed = parseCliArgs(argv);
  const suggestionsPath = parsed.suggestionsPath ? resolve(PROJECT_ROOT, parsed.suggestionsPath) : "";
  if (!suggestionsPath) {
    throw new Error("Usage: node scripts/streamline-export/promote-streamline-stable-prefix-batch2.mjs <suggestionsPath> [--output <path>] [--promoted-output <path>]");
  }

  const result = await writeArtifacts({
    suggestionsPath,
    outputPath: parsed.outputPath ? resolve(PROJECT_ROOT, parsed.outputPath) : "",
    promotedSuggestionsPath: parsed.promotedSuggestionsPath ? resolve(PROJECT_ROOT, parsed.promotedSuggestionsPath) : "",
  });
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("promote-streamline-stable-prefix-batch2.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
