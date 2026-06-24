import { normalizeStreamlineTags } from "./streamline-tag-normalization.mjs";
import { extractSvgFeatureTokens } from "./streamline-svg-feature-tokens.mjs";

const GENERIC_NAME_TOKENS = new Set([
  "1",
  "2",
  "3",
  "4",
  "5",
  "circle",
  "square",
  "triangle",
  "left",
  "right",
  "up",
  "down",
  "top",
  "bottom",
  "open",
  "close",
  "horizontal",
  "vertical",
  "small",
  "large",
  "round",
  "rounded",
  "solid",
  "line",
  "filled",
  "outline",
]);

const BASELINE_EXCLUDED_TOKENS = new Set([
  "1",
  "2",
  "3",
  "4",
  "5",
  "icon",
  "solid",
  "line",
  "filled",
]);

const BASELINE_SYNONYM_TAGS = {
  add: ["plus"],
  scroll: ["navigation"],
  search: ["find"],
  shield: ["protection", "security"],
  shopping: ["commerce"],
  sign: ["symbol"],
  subtract: ["minus"],
};

function tokenizeText(value) {
  return Array.from(
    new Set(
      String(value ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2)
        .filter((part) => !GENERIC_NAME_TOKENS.has(part))
        .filter(Boolean),
    ),
  );
}

function buildPrefixTokens(itemId) {
  const parts = String(itemId ?? "").toLowerCase().split("-").filter(Boolean);
  const prefixes = [];
  if (parts[0]) {
    prefixes.push(parts[0]);
  }
  if (parts.length >= 2) {
    prefixes.push(parts.slice(0, 2).join("-"));
  }
  return prefixes;
}

function tokenizeBaselineText(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .filter((part) => !BASELINE_EXCLUDED_TOKENS.has(part))
    .filter(Boolean);
}

export function buildBaselineTagsForItem(item, { maxTags = 8 } = {}) {
  const orderedTokens = [
    ...tokenizeBaselineText(item?.itemId ?? ""),
    ...tokenizeBaselineText(item?.name ?? ""),
  ];
  const tags = [];
  for (const token of orderedTokens) {
    tags.push(token);
    tags.push(...(BASELINE_SYNONYM_TAGS[token] ?? []));
  }
  return normalizeStreamlineTags(tags, { lowercase: true }).slice(0, maxTags);
}

function countOverlap(left, right) {
  const rightSet = new Set(Array.isArray(right) ? right : []);
  let count = 0;
  for (const value of Array.isArray(left) ? left : []) {
    if (rightSet.has(value)) {
      count += 1;
    }
  }
  return count;
}

function collectOverlap(left, right) {
  const rightSet = new Set(Array.isArray(right) ? right : []);
  const matches = [];
  for (const value of Array.isArray(left) ? left : []) {
    if (rightSet.has(value)) {
      matches.push(value);
    }
  }
  return matches;
}

async function buildKnowledgeEntry(item, { readSvg }) {
  const svgText = typeof readSvg === "function" && item?.outputPath
    ? await readSvg(item.outputPath)
    : "";
  const nameTokens = tokenizeText(`${item?.itemId ?? ""} ${item?.name ?? ""}`);
  const prefixTokens = buildPrefixTokens(item?.itemId);
  const svgTokens = extractSvgFeatureTokens(svgText);
  return {
    itemId: item.itemId,
    name: item.name,
    outputPath: item.outputPath,
    tags: normalizeStreamlineTags(item.tags),
    nameTokens,
    prefixTokens,
    svgTokens,
  };
}

export async function buildStreamlineTagKnowledge({ items, readSvg } = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  const labeledSourceItems = sourceItems.filter((item) => Array.isArray(item?.tags) && item.tags.length > 0);
  const labeledItems = [];
  const tagStats = {};

  for (const item of labeledSourceItems) {
    const entry = await buildKnowledgeEntry(item, { readSvg });
    labeledItems.push(entry);
    for (const tag of entry.tags) {
      tagStats[tag] ??= { count: 0 };
      tagStats[tag].count += 1;
    }
  }

  return {
    labeledItems,
    tagStats,
    tagVocabulary: Object.keys(tagStats).sort(),
  };
}

function scoreNeighbor(target, candidate) {
  const nameMatches = collectOverlap(target.nameTokens, candidate.nameTokens);
  const prefixMatches = collectOverlap(target.prefixTokens, candidate.prefixTokens);
  const svgMatches = collectOverlap(target.svgTokens, candidate.svgTokens);
  const lexicalScore = (nameMatches.length * 5) + (prefixMatches.length * 4);
  const svgScore = lexicalScore > 0 ? Math.min(3, svgMatches.length) : 0;
  return {
    score: lexicalScore + svgScore,
    lexicalScore,
    svgScore,
    nameMatches,
    prefixMatches,
    svgMatches,
  };
}

export async function suggestTagsForManifestItem(knowledge, item, {
  readSvg,
  maxTags = 12,
  mode = "precise",
} = {}) {
  if (mode === "baseline") {
    const suggestedTags = buildBaselineTagsForItem(item, { maxTags });
    return {
      itemId: item?.itemId ?? null,
      suggestedTags,
      confidence: suggestedTags.length > 0 ? 0.91 : 0,
      decision: suggestedTags.length > 0 ? "auto_accept" : "reject",
      evidence: {
        strategy: "baseline_name_tokens",
        nameNeighbors: [],
        imageNeighbors: [],
      },
    };
  }

  const target = await buildKnowledgeEntry({ ...item, tags: [] }, { readSvg });
  const neighbors = (knowledge?.labeledItems ?? [])
    .map((candidate) => ({ candidate, ...scoreNeighbor(target, candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.lexicalScore - left.lexicalScore);

  const tagScores = new Map();
  for (const { candidate, score } of neighbors.slice(0, 8)) {
    for (const tag of candidate.tags) {
      tagScores.set(tag, (tagScores.get(tag) ?? 0) + score);
    }
  }

  const rankedTags = [...tagScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxTags);

  const suggestedTags = rankedTags.map(([tag]) => tag);
  const maxNeighborScore = neighbors[0]?.score ?? 0;
  const maxLexicalScore = neighbors[0]?.lexicalScore ?? 0;
  const lexicalNeighborCount = neighbors.filter((entry) => entry.lexicalScore > 0).length;
  const strongLexicalNeighborCount = neighbors.filter((entry) => entry.lexicalScore >= 10).length;
  const confidence = Number(
    Math.min(
      0.99,
      (Math.min(maxNeighborScore, 12) / 12) * 0.7
      + (Math.min(lexicalNeighborCount, 3) / 3) * 0.2
      + (Math.min(suggestedTags.length, maxTags) / maxTags) * 0.1,
    )
      .toFixed(2),
  );
  const hasLexicalEvidence = maxLexicalScore > 0;
  const canAutoAccept = confidence >= 0.85 && maxLexicalScore >= 10 && strongLexicalNeighborCount >= 2;
  const decision = !hasLexicalEvidence || suggestedTags.length === 0
    ? "reject"
    : (canAutoAccept ? "auto_accept" : "review_required");

  return {
    itemId: item?.itemId ?? null,
    suggestedTags,
    confidence,
    decision,
    evidence: {
      nameNeighbors: neighbors
        .filter(({ lexicalScore }) => lexicalScore > 0)
        .slice(0, 2)
        .map(({ candidate, score, lexicalScore, nameMatches, prefixMatches }) => ({
          itemId: candidate.itemId,
          score,
          lexicalScore,
          nameMatches,
          prefixMatches,
        })),
      imageNeighbors: neighbors
        .filter(({ svgScore }) => svgScore > 0)
        .slice(0, 2)
        .map(({ candidate, score, svgScore, svgMatches }) => ({
          itemId: candidate.itemId,
          score,
          svgScore,
          svgMatches,
        })),
    },
  };
}
