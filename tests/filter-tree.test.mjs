import test from "node:test";
import assert from "node:assert/strict";
import {
  addGroupToGroup,
  addRuleToGroup,
  canCreateChildGroup,
  collectAllFilterNodeIds,
  convertRuleToGroup,
  duplicateNodeInAdvancedRoot,
  mergeTopLevelRuleIntoAdvancedRoot,
  removeNodeFromFilters,
  updateChildJoin,
  updateGroupOp,
} from "../src/view/filter-tree.mjs";

test("mergeTopLevelRuleIntoAdvancedRoot moves a rule into advancedRoot and removes it from topLevelRules", () => {
  const next = mergeTopLevelRuleIntoAdvancedRoot({
    topLevelRules: [{ kind: "rule", id: "rule:a", field: "owner", operator: "is", value: "player" }],
    advancedRoot: null,
  }, "rule:a");

  assert.deepEqual(next.topLevelRules, []);
  assert.equal(next.advancedRoot.children[0].id, "rule:a");
});

test("duplicateNodeInAdvancedRoot inserts duplicate immediately after source node", () => {
  const filters = {
    topLevelRules: [],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "and",
      children: [
        { kind: "rule", id: "rule:a", field: "owner", operator: "is", value: "player" },
        { kind: "rule", id: "rule:b", field: "dev_status", operator: "is_not", value: "草稿" },
      ],
    },
  };

  const next = duplicateNodeInAdvancedRoot(filters, "rule:a");
  assert.deepEqual(next.advancedRoot.children.map((node) => node.id), ["rule:a", "rule:a:copy", "rule:b"]);
});

test("canCreateChildGroup returns false for level-3 group", () => {
  const filters = {
    topLevelRules: [],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "and",
      children: [{
        kind: "group",
        id: "group:level2",
        op: "and",
        children: [{
          kind: "group",
          id: "group:level3",
          op: "and",
          children: [],
        }],
      }],
    },
  };

  assert.equal(canCreateChildGroup(filters, "group:level3"), false);
});

test("addRuleToGroup appends a rule to the target group", () => {
  const filters = {
    topLevelRules: [],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "and",
      children: [],
    },
  };

  const next = addRuleToGroup(filters, "advanced-root", {
    kind: "rule",
    id: "rule:new",
    field: "skill_category",
    operator: "is",
    value: "general",
  });

  assert.equal(next.advancedRoot.children.length, 1);
  assert.equal(next.advancedRoot.children[0].id, "rule:new");
});

test("addGroupToGroup appends a child group to the target group", () => {
  const filters = {
    topLevelRules: [],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "and",
      children: [],
    },
  };

  const next = addGroupToGroup(filters, "advanced-root", {
    kind: "group",
    id: "group:1",
    op: "or",
    children: [],
  });

  assert.equal(next.advancedRoot.children[0].kind, "group");
  assert.equal(next.advancedRoot.children[0].id, "group:1");
});

test("updateGroupOp changes only the target group's operator", () => {
  const filters = {
    topLevelRules: [],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "and",
      children: [{
        kind: "group",
        id: "group:1",
        op: "and",
        children: [],
      }],
    },
  };

  const next = updateGroupOp(filters, "group:1", "or");
  assert.equal(next.advancedRoot.op, "and");
  assert.equal(next.advancedRoot.children[0].op, "or");
});

test("updateChildJoin changes only the target child connector", () => {
  const filters = {
    topLevelRules: [],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "and",
      children: [
        { kind: "rule", id: "rule:a", field: "owner", operator: "is", value: "player" },
        { kind: "rule", id: "rule:b", field: "skill_category", operator: "is", value: "general", join: "and" },
        { kind: "rule", id: "rule:c", field: "dev_status", operator: "is_not", value: "草稿", join: "and" },
      ],
    },
  };

  const next = updateChildJoin(filters, "advanced-root", "rule:c", "or");
  assert.equal(next.advancedRoot.children[1].join, "and");
  assert.equal(next.advancedRoot.children[2].join, "or");
});

test("convertRuleToGroup replaces the rule with a new child group that inherits parent op", () => {
  const filters = {
    topLevelRules: [],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "or",
      children: [
        { kind: "rule", id: "rule:a", field: "owner", operator: "is", value: "player" },
      ],
    },
  };

  const next = convertRuleToGroup(filters, "rule:a");
  const child = next.advancedRoot.children[0];

  assert.equal(child.kind, "group");
  assert.equal(child.op, "or");
  assert.equal(child.children[0].id, "rule:a");
});

test("removeNodeFromFilters prunes empty advancedRoot when last child is removed", () => {
  const filters = {
    topLevelRules: [],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "and",
      children: [
        { kind: "rule", id: "rule:a", field: "owner", operator: "is", value: "player" },
      ],
    },
  };

  const next = removeNodeFromFilters(filters, "rule:a");
  assert.equal(next.advancedRoot, null);
});

test("collectAllFilterNodeIds includes top-level rules, groups, and nested rules", () => {
  const ids = collectAllFilterNodeIds({
    topLevelRules: [{ kind: "rule", id: "top:a", field: "owner", operator: "is", value: "player" }],
    advancedRoot: {
      kind: "group",
      id: "advanced-root",
      op: "and",
      children: [{
        kind: "group",
        id: "group:1",
        op: "or",
        children: [{ kind: "rule", id: "nested:a", field: "dev_status", operator: "is_not", value: "草稿" }],
      }],
    },
  });

  assert.deepEqual([...ids].sort(), ["advanced-root", "group:1", "nested:a", "top:a"]);
});
