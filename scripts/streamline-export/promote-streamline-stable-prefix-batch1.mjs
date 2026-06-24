import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const BATCH1_PREFIXES = new Set(["layout", "mail", "phone"]);

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

function buildLayoutTags(itemId) {
  const parts = normalizeParts(itemId);
  const tags = [
    "layout",
    "dashboard",
    "widgets",
    "arrangement",
    "frame",
    "grid",
    "interface",
  ];

  if (parts.includes("border")) tags.push("border");
  if (parts.includes("position")) tags.push("position");
  if (parts.includes("columns")) tags.push("columns");
  if (parts.includes("rows")) tags.push("rows");
  if (parts.includes("center")) tags.push("center", "align");
  if (parts.includes("corner")) tags.push("corner", "diagonal");
  if (parts.includes("full")) tags.push("full");
  if (parts.includes("horizontal")) tags.push("horizontal");
  if (parts.includes("vertical")) tags.push("vertical");
  if (parts.includes("left")) tags.push("left");
  if (parts.includes("right")) tags.push("right");
  if (parts.includes("top")) tags.push("top");
  if (parts.includes("bottom")) tags.push("bottom");
  if (parts.includes("none")) tags.push("none");
  if (parts.includes("two")) tags.push("two");
  if (parts.includes("three")) tags.push("three");

  return dedupeTags(tags).slice(0, 8);
}

function buildMailTags(itemId) {
  const parts = normalizeParts(itemId);
  const tags = [
    "message",
    "communication",
    "email",
    "envelope",
    "mail",
    "inbox",
  ];

  tags.push(...appendIf(parts, "add", "add"));
  tags.push(...appendIf(parts, "block", "block", "disable"));
  tags.push(...appendIf(parts, "check", "check", "confirm"));
  tags.push(...appendIf(parts, "incoming", "incoming"));
  tags.push(...appendIf(parts, "loading", "loading"));
  tags.push(...appendIf(parts, "lock", "lock", "privacy", "secure"));
  if (parts.includes("read")) tags.push("read");
  tags.push(...appendIf(parts, "notification", "notification", "alert"));
  tags.push(...appendIf(parts, "outgoing", "outgoing"));
  tags.push(...appendIf(parts, "remove", "remove"));
  tags.push(...appendIf(parts, "schedule", "schedule", "time"));
  tags.push(...appendIf(parts, "search", "search", "find"));
  tags.push(...appendIf(parts, "setting", "settings", "configuration"));
  tags.push(...appendIf(parts, "subtract", "subtract", "remove"));

  return dedupeTags(tags).slice(0, 8);
}

function buildPhoneTags(itemId) {
  const parts = normalizeParts(itemId);
  const tags = [
    "phone",
    "call",
    "contact",
    "telephone",
    "communication",
  ];

  tags.push(...appendIf(parts, "book", "book", "directory"));
  tags.push(...appendIf(parts, "landscape", "mobile", "landscape"));
  tags.push(...appendIf(parts, "numpad", "numpad", "keypad"));
  tags.push(...appendIf(parts, "off", "off", "disable"));
  if (parts.includes("mobile")) tags.push("mobile");
  tags.push(...appendIf(parts, "ringing", "ringing"));
  tags.push(...appendIf(parts, "rotate", "rotate"));
  tags.push(...appendIf(parts, "send", "send", "transfer"));
  tags.push(...appendIf(parts, "signal", "signal"));
  tags.push(...appendIf(parts, "full", "full"));
  tags.push(...appendIf(parts, "low", "low"));
  tags.push(...appendIf(parts, "medium", "medium"));
  tags.push(...appendIf(parts, "vibrate", "vibrate", "vibration"));

  return dedupeTags(tags).slice(0, 8);
}

export function promoteStablePrefixBatch1Suggestion(suggestion) {
  if (suggestion?.decision !== "review_required") {
    return { promote: false, reason: "not_review_required", suggestedTags: [] };
  }

  const itemId = String(suggestion?.itemId ?? "");
  const prefix = itemId.split("-")[0];
  if (!BATCH1_PREFIXES.has(prefix)) {
    return { promote: false, reason: "unsupported_prefix", suggestedTags: [] };
  }
  if (!(Number(suggestion?.confidence) >= 0.99)) {
    return { promote: false, reason: "low_confidence", suggestedTags: [] };
  }

  let suggestedTags = [];
  if (prefix === "layout") suggestedTags = buildLayoutTags(itemId);
  if (prefix === "mail") suggestedTags = buildMailTags(itemId);
  if (prefix === "phone") suggestedTags = buildPhoneTags(itemId);

  if (suggestedTags.length === 0) {
    return { promote: false, reason: "empty_profile_result", suggestedTags: [] };
  }

  return {
    promote: true,
    reason: "stable_prefix_batch1",
    suggestedTags,
  };
}

export function promoteStreamlineStablePrefixBatch1Suggestions(payload) {
  const sourceSuggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const audit = sourceSuggestions.map((suggestion) => {
    const decision = promoteStablePrefixBatch1Suggestion(suggestion);
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
      promotedBy: "stable_prefix_batch1",
    }));

  const reasons = {};
  for (const row of audit) {
    reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  }

  return {
    kind: "streamline-stable-prefix-batch1-promotion",
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
  const report = promoteStreamlineStablePrefixBatch1Suggestions(payload);

  const resolvedOutputPath = outputPath || join(dirname(suggestionsPath), "micro-solid-stable-prefix-batch1-report.json");
  const resolvedPromotedSuggestionsPath = promotedSuggestionsPath || join(dirname(suggestionsPath), "micro-solid-stable-prefix-batch1-suggestions.json");

  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await mkdir(dirname(resolvedPromotedSuggestionsPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(resolvedPromotedSuggestionsPath, `${JSON.stringify({
    kind: "streamline-tag-suggestions",
    version: 1,
    family: report.family,
    source: "stable_prefix_batch1",
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
    throw new Error("Usage: node scripts/streamline-export/promote-streamline-stable-prefix-batch1.mjs <suggestionsPath> [--output <path>] [--promoted-output <path>]");
  }

  const result = await writeArtifacts({
    suggestionsPath,
    outputPath: parsed.outputPath ? resolve(PROJECT_ROOT, parsed.outputPath) : "",
    promotedSuggestionsPath: parsed.promotedSuggestionsPath ? resolve(PROJECT_ROOT, parsed.promotedSuggestionsPath) : "",
  });
  console.log(JSON.stringify(result, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("promote-streamline-stable-prefix-batch1.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
