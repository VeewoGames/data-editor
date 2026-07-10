import test from "node:test";
import assert from "node:assert/strict";
import { describeFileBasename, matchesFileSearchQuery } from "../src/searchable-picker-utils.mjs";

test("matches file query by full path and basename", () => {
  assert.equal(matchesFileSearchQuery("data/affixes.json", "affixes"), true);
  assert.equal(matchesFileSearchQuery("data/analysis/prototype_mechanic_gap.json", "analysis/prototype"), true);
  assert.equal(matchesFileSearchQuery("data/affixes.json", "runes"), false);
});

test("empty query keeps all file options visible", () => {
  assert.equal(matchesFileSearchQuery("data/affixes.json", ""), true);
  assert.equal(matchesFileSearchQuery("data/affixes.json", "   "), true);
});

test("describe basename strips directory segments", () => {
  assert.equal(describeFileBasename("data/analysis/prototype_mechanic_gap.json"), "prototype_mechanic_gap.json");
});
