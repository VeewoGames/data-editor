import { getMainColumns, getRows } from "../document-model.mjs";

export function buildCollectionKey(path, collectionPath) {
  return `${String(path)}:${String(collectionPath)}`;
}

export function isRecordMapCollection(model, collectionPath) {
  return model?.rootCollectionKind === "record-map" && collectionPath === "$";
}

export function analyzePrimaryKeyCandidates({
  model,
  collectionPath,
  configuredPrimaryKey,
}) {
  if (configuredPrimaryKey) {
    return { status: "configured", candidates: [], filtered: [] };
  }
  if (!model || isRecordMapCollection(model, collectionPath)) {
    return { status: "unconfigured", candidates: [], filtered: [] };
  }

  const rows = getRows(model, collectionPath);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: "unconfigured", candidates: [], filtered: [] };
  }

  const analyzed = getMainColumns(model, collectionPath)
    .map((fieldName) => analyzeFieldCandidate(rows, fieldName))
    .filter(Boolean);
  const candidates = analyzed
    .filter((candidate) => candidate.kind === "candidate")
    .map((candidate) => candidate.value)
    .sort(compareCandidates);
  const filtered = analyzed
    .filter((candidate) => candidate.kind === "filtered")
    .map((candidate) => candidate.value)
    .sort(compareFilteredCandidates);

  return {
    status: candidates.length ? "candidate-detected" : "unconfigured",
    candidates,
    filtered,
  };
}

function analyzeFieldCandidate(rows, fieldName) {
  const rule = candidateRule(fieldName);
  if (!rule) return null;

  let presentCount = 0;
  let missingCount = 0;
  const values = new Set();

  for (const row of rows) {
    const value = row?.[fieldName];
    if (!hasCandidateValue(value)) {
      missingCount += 1;
      continue;
    }
    if (Array.isArray(value) || isPlainObject(value)) return null;
    presentCount += 1;
    values.add(normalizeCandidateValue(value));
  }

  if (presentCount === 0) return null;
  if (values.size !== presentCount) {
    return {
      kind: "filtered",
      value: {
        fieldName,
        presentCount,
        missingCount,
        uniqueCount: values.size,
        rule,
        reasons: ["duplicate-values"],
      },
    };
  }

  const confidence = presentCount === rows.length
    ? "high"
    : presentCount / rows.length >= 0.8
      ? "secondary"
      : null;
  if (!confidence) {
    return {
      kind: "filtered",
      value: {
        fieldName,
        presentCount,
        missingCount,
        uniqueCount: values.size,
        rule,
        reasons: ["too-many-missing"],
      },
    };
  }

  return {
    kind: "candidate",
    value: {
      fieldName,
      confidence,
      presentCount,
      missingCount,
      uniqueCount: values.size,
      rule,
    },
  };
}

function candidateRule(fieldName) {
  if (fieldName === "id") return "bare-id";
  if (String(fieldName).endsWith("_id")) return "suffix-id";
  return null;
}

function compareCandidates(left, right) {
  const ruleRank = rulePriority(left.rule) - rulePriority(right.rule);
  if (ruleRank !== 0) return ruleRank;
  const confidenceRank = confidencePriority(left.confidence) - confidencePriority(right.confidence);
  if (confidenceRank !== 0) return confidenceRank;
  return String(left.fieldName).localeCompare(String(right.fieldName), undefined, { numeric: true });
}

function compareFilteredCandidates(left, right) {
  const ruleRank = rulePriority(left.rule) - rulePriority(right.rule);
  if (ruleRank !== 0) return ruleRank;
  return String(left.fieldName).localeCompare(String(right.fieldName), undefined, { numeric: true });
}

function rulePriority(rule) {
  return rule === "suffix-id" ? 0 : 1;
}

function confidencePriority(confidence) {
  return confidence === "high" ? 0 : 1;
}

function hasCandidateValue(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function normalizeCandidateValue(value) {
  return typeof value === "string" ? value.trim() : String(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
