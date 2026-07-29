import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  pruneOrphanAutomationRuleBindings,
  remapAutomationRuleBindingKey,
  removeAutomationRuleBinding,
} from "../src/automation-rule-draft.mjs";

const originalBindings = {
  defaults: {},
  bindings: {
    "action-1": { provider: "codex", skill: "review-player-skill", enabled: true },
  },
  bindingStatuses: {
    "action-1": { status: "ready" },
  },
};

test("Rule Id 清空再重新输入时 binding 不丢失且不残留旧键", () => {
  const emptyIdDraft = remapAutomationRuleBindingKey(originalBindings, "action-1", "");
  assert.deepEqual(Object.keys(emptyIdDraft.bindings), [""]);

  const renamedDraft = remapAutomationRuleBindingKey(emptyIdDraft, "", "review-skill");
  assert.deepEqual(Object.keys(renamedDraft.bindings), ["review-skill"]);
  assert.equal(renamedDraft.bindings["review-skill"].skill, "review-player-skill");
  assert.deepEqual(Object.keys(renamedDraft.bindingStatuses), ["review-skill"]);
});

test("删除空 Rule Id 草稿时同步清理 binding 和状态", () => {
  const emptyIdDraft = remapAutomationRuleBindingKey(originalBindings, "action-1", "");
  assert.deepEqual(removeAutomationRuleBinding(emptyIdDraft, ""), {
    defaults: {},
    bindings: {},
    bindingStatuses: {},
  });
});

test("打开或保存设置时清理没有对应规则的孤立 binding", () => {
  const bindingsWithOrphan = {
    ...originalBindings,
    bindings: {
      ...originalBindings.bindings,
      "review-player-skill": { provider: "codex", skill: "review-player-skill", enabled: true },
    },
    bindingStatuses: {
      ...originalBindings.bindingStatuses,
      "review-player-skill": { status: "ready" },
    },
  };
  assert.deepEqual(pruneOrphanAutomationRuleBindings(bindingsWithOrphan, ["action-1"]), originalBindings);
});

test("Automation Settings 的 profile 与 bindings 提交基于同步 ref 快照", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /const current = profileRef\.current;/);
  assert.match(source, /const current = bindingsRef\.current;/);
  assert.match(source, /remapAutomationRuleBindingKey\(bindingsRef\.current, previousId, nextId\)/);
  assert.match(source, /pruneOrphanAutomationRuleBindings\(\s*props\.bindings,\s*props\.profile\.rules\.map/);
  assert.match(source, /pruneOrphanAutomationRuleBindings\(\s*nextBindings,\s*nextProfile\.rules\.map/);
});
