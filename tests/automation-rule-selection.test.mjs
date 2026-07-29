import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  automationRuleSelectionAfterRemoval,
  normalizeAutomationRuleSelection,
  normalizeVisibleAutomationRuleSelection,
} from "../src/automation-rule-selection.mjs";

test("规则选择使用数组索引，不依赖空或重复的 Rule Id", () => {
  assert.equal(normalizeAutomationRuleSelection(null, 3), 0);
  assert.equal(normalizeAutomationRuleSelection(2, 3), 2);
  assert.equal(normalizeAutomationRuleSelection(3, 3), 0);
  assert.equal(normalizeAutomationRuleSelection(0, 0), null);
});

test("搜索结果保留可见选中项，否则选择首个原始索引", () => {
  assert.equal(normalizeVisibleAutomationRuleSelection(3, [1, 3, 5], true), 3);
  assert.equal(normalizeVisibleAutomationRuleSelection(2, [1, 3, 5], true), 1);
  assert.equal(normalizeVisibleAutomationRuleSelection(2, [], true), null);
});

test("删除规则后按原始索引稳定迁移选中项", () => {
  assert.equal(automationRuleSelectionAfterRemoval(2, 1, 4), 1);
  assert.equal(automationRuleSelectionAfterRemoval(1, 1, 4), 1);
  assert.equal(automationRuleSelectionAfterRemoval(3, 3, 4), 2);
  assert.equal(automationRuleSelectionAfterRemoval(0, 0, 1), null);
});

test("Automation Settings 不再用可编辑 Rule Id 作为草稿选择身份", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /selectedRuleId|setSelectedRuleId/);
  assert.match(source, /setSelectedRuleIndex\(ruleIndex\)/);
  assert.match(source, /const selectedIndex = selectedRuleIndex \?\? -1/);
});
