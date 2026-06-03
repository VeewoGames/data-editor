import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentModel } from "../src/document-model.mjs";
import {
  analyzePrimaryKeyCandidates,
  buildCollectionKey,
  isRecordMapCollection,
} from "../src/model/primary-key-candidate.mjs";

test("buildCollectionKey joins path and collectionPath", () => {
  assert.equal(buildCollectionKey("data/keywords.json", "$"), "data/keywords.json:$");
});

test("detects a high-confidence _id candidate from main columns", () => {
  const model = buildDocumentModel([
    { keyword_id: "focus", name: "专注" },
    { keyword_id: "poisoned", name: "中毒" },
  ], "json");

  const result = analyzePrimaryKeyCandidates({
    model,
    collectionPath: "$",
    configuredPrimaryKey: null,
  });

  assert.equal(result.status, "candidate-detected");
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0], {
    fieldName: "keyword_id",
    confidence: "high",
    presentCount: 2,
    missingCount: 0,
    uniqueCount: 2,
    rule: "suffix-id",
  });
});

test("keeps sparse unique _id fields as secondary candidates", () => {
  const model = buildDocumentModel([
    { legacy_id: "a", name: "Alpha" },
    { legacy_id: "b", name: "Beta" },
    { name: "Gamma" },
    { legacy_id: "d", name: "Delta" },
    { legacy_id: "e", name: "Epsilon" },
  ], "json");

  const result = analyzePrimaryKeyCandidates({
    model,
    collectionPath: "$",
    configuredPrimaryKey: null,
  });

  assert.equal(result.status, "candidate-detected");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].fieldName, "legacy_id");
  assert.equal(result.candidates[0].confidence, "secondary");
  assert.equal(result.candidates[0].missingCount, 1);
});

test("ignores non-id fields even when unique", () => {
  const model = buildDocumentModel([
    { name: "Alpha", title: "A" },
    { name: "Beta", title: "B" },
  ], "json");

  const result = analyzePrimaryKeyCandidates({
    model,
    collectionPath: "$",
    configuredPrimaryKey: null,
  });

  assert.equal(result.status, "unconfigured");
  assert.deepEqual(result.candidates, []);
});

test("ignores duplicate id-like fields", () => {
  const model = buildDocumentModel([
    { effect_id: "burn" },
    { effect_id: "burn" },
  ], "json");

  const result = analyzePrimaryKeyCandidates({
    model,
    collectionPath: "$",
    configuredPrimaryKey: null,
  });

  assert.equal(result.status, "unconfigured");
  assert.deepEqual(result.candidates, []);
  assert.equal(result.filtered.length, 1);
  assert.equal(result.filtered[0].fieldName, "effect_id");
  assert.deepEqual(result.filtered[0].reasons, ["duplicate-values"]);
});

test("returns configured when the collection already has a primary key", () => {
  const model = buildDocumentModel([
    { keyword_id: "focus" },
    { keyword_id: "poisoned" },
  ], "json");

  const result = analyzePrimaryKeyCandidates({
    model,
    collectionPath: "$",
    configuredPrimaryKey: "keyword_id",
  });

  assert.equal(result.status, "configured");
  assert.deepEqual(result.candidates, []);
});

test("record-map collections are excluded from ordinary id scanning", () => {
  const model = buildDocumentModel({
    focus: { name: "专注", category: "buff" },
    poisoned: { name: "中毒", category: "debuff" },
  }, "json");

  assert.equal(isRecordMapCollection(model, "$"), true);

  const result = analyzePrimaryKeyCandidates({
    model,
    collectionPath: "$",
    configuredPrimaryKey: null,
  });

  assert.equal(result.status, "unconfigured");
  assert.deepEqual(result.candidates, []);
});

test("prefers xxx_id before bare id when both are high-confidence candidates", () => {
  const model = buildDocumentModel([
    { id: "1", keyword_id: "focus" },
    { id: "2", keyword_id: "poisoned" },
  ], "json");

  const result = analyzePrimaryKeyCandidates({
    model,
    collectionPath: "$",
    configuredPrimaryKey: null,
  });

  assert.equal(result.status, "candidate-detected");
  assert.deepEqual(result.candidates.map((candidate) => candidate.fieldName), ["keyword_id", "id"]);
});

test("reports filtered id-like fields with reasons and stats", () => {
  const model = buildDocumentModel([
    { id: 1, base_id: "broadsword", skill_id: "skill_slash" },
    { id: 2, base_id: "broadsword" },
    { id: 3, base_id: "warhammer" },
    { id: 4, base_id: "longbow" },
    { id: 5, base_id: "staff" },
  ], "json");

  const result = analyzePrimaryKeyCandidates({
    model,
    collectionPath: "$",
    configuredPrimaryKey: null,
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].fieldName, "id");
  assert.equal(result.filtered.length, 2);
  assert.deepEqual(result.filtered[0], {
    fieldName: "base_id",
    presentCount: 5,
    missingCount: 0,
    uniqueCount: 4,
    rule: "suffix-id",
    reasons: ["duplicate-values"],
  });
  assert.deepEqual(result.filtered[1], {
    fieldName: "skill_id",
    presentCount: 1,
    missingCount: 4,
    uniqueCount: 1,
    rule: "suffix-id",
    reasons: ["too-many-missing"],
  });
});
