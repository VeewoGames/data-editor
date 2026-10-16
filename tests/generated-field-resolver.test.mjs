import assert from "node:assert/strict";
import test from "node:test";
import { createGeneratedFieldResolver, invalidateGeneratedFieldResult } from "../src/view/generated-field-resolver.mjs";
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("load/focus/poll duplicates use one flight and draft/version switches reject late responses", async () => {
  let current = { key: "a", projectId: "p", sourcePath: "data/a.json", collectionPath: "items", documentEtag: "one", dirty: false };
  const reads = []; const results = []; const errors = [];
  const resolver = createGeneratedFieldResolver({ getCurrent: () => current, read: (scope) => new Promise((resolve, reject) => reads.push({ scope, resolve, reject })), onResult: (scope, value) => results.push({ scope, value }), onError: (scope) => errors.push(scope) });
  resolver.refresh(); resolver.refresh(); resolver.refresh(); assert.equal(reads.length, 1);
  current = { ...current, key: "b", sourcePath: "data/b.json" }; resolver.refresh();
  reads[0].resolve({ result: "late-a" }); await tick(); assert.equal(results.length, 0); assert.equal(reads.length, 2);
  reads[1].resolve({ result: "b" }); await tick(); assert.equal(results[0].scope.key, "b");
  resolver.refresh(); current = { ...current, key: "saved-b", documentEtag: "two" }; resolver.refresh(); reads[2].reject(new Error("late error")); await tick(); assert.equal(errors.length, 0); assert.equal(reads.length, 4);
  resolver.dispose(); reads[3].resolve({ result: "unmounted" }); await tick(); assert.equal(results.length, 1);
  resolver.activate(); resolver.refresh(); assert.equal(reads.length, 5); reads[4].resolve({ result: "restored" }); await tick(); assert.equal(results.length, 2);
});
import { runView } from "../src/view/view-engine.mjs";

test("cold saved Boolean rules stay unknown until the first declaration response; ordinary null values retain semantics", () => {
  const rows = [{ rowId: "a", sourceOrder: 0, row: { stable: "a", ordinary: null } }];
  const generated = { fields: [{ name: "computed", type: "Boolean" }], bindings: [{ identityField: "stable", fields: [{ name: "computed", type: "Boolean" }], state: "ready", rows: [{ id: "a", state: "ready", values: { computed: true } }] }] };
  for (const value of [true, false]) for (const operator of ["is", "is_not"]) {
    const savedFilters = JSON.parse(JSON.stringify({ topLevelRules: [{ kind: "rule", id: "saved", field: "computed", operator, value }] }));
    const pending = runView({ rows, filters: savedFilters, derivedFieldProjection: { generated: null, declarationPending: true } });
    assert.deepEqual(pending.visibleRowIds, [], `${operator} ${value} before declaration`);
    const resolved = runView({ rows, filters: savedFilters, derivedFieldProjection: { generated, declarationPending: false } });
    assert.deepEqual(resolved.visibleRowIds, (operator === "is" ? value === true : value !== true) ? ["a"] : []);
    const unknown = runView({ rows, filters: savedFilters, derivedFieldProjection: { generated: { ...generated, bindings: generated.bindings.map((binding) => ({ ...binding, state: "unavailable", rows: [] })) }, declarationPending: false } });
    assert.deepEqual(unknown.visibleRowIds, []);
  }
  for (const pending of [true, false]) {
    for (const [operator, value] of [["is", false], ["is_not", true]]) {
      const ordinary = runView({ rows, filters: { rules: [{ field: "ordinary", operator, value }] }, derivedFieldProjection: { generated: { fields: [], bindings: [] }, declarationPending: pending } });
      assert.deepEqual(ordinary.visibleRowIds, ["a"]);
    }
  }
  // A no-capability response resolves the absent field through the unchanged
  // ordinary comparator; subsequent polls never return to the pending gate.
  assert.deepEqual(runView({ rows, filters: { rules: [{ field: "legacyAbsent", operator: "is", value: false }] }, derivedFieldProjection: { generated: { fields: [], bindings: [] }, declarationPending: false } }).visibleRowIds, ["a"]);
});
test("switching registered projects discards late declaration responses and resolves only the current project", async () => {
  let current = { key: "project-a|data/items.json", projectId: "project-a", sourcePath: "data/items.json", collectionPath: "items", documentEtag: "one", dirty: false };
  const reads = []; const accepted = [];
  const resolver = createGeneratedFieldResolver({ getCurrent: () => current, read: (scope) => new Promise((resolve) => reads.push({ scope, resolve })), onResult: (scope, value) => accepted.push({ scope, value }), onError: () => assert.fail("unexpected") });
  resolver.refresh(); current = { ...current, key: "project-b|data/items.json", projectId: "project-b" }; resolver.refresh();
  reads[0].resolve({ projectId: "project-a", fields: [{name: "computed", type: "Boolean"}] }); await tick(); assert.deepEqual(accepted, []);
  assert.equal(reads[1].scope.projectId, "project-b"); reads[1].resolve({ projectId: "project-b", fields: [], bindings: [] }); await tick(); assert.equal(accepted[0].value.projectId, "project-b");
});

test("saved ETag then failed GET keeps scoped declarations readonly with unknown business values", async () => {
  const oldKey = "p|items|old";
  let current = { key: "p|items|saved", projectId: "p", sourcePath: "data/items.json", collectionPath: "items", documentEtag: "saved", dirty: false };
  const fields = [{ name: "computed", type: "Boolean" }];
  const original = { key: oldKey, value: { projectId: "p", sourcePath: "data/items.json", collectionPath: "items", generation: 1, documentEtag: "old", fields, bindings: [{ bindingId: "binding", identityField: "stable", fields, state: "ready", reason: null, rows: [{ id: "a", state: "ready", values: { computed: true } }] }] } };
  let loaded = original;
  const resolver = createGeneratedFieldResolver({ getCurrent: () => current, read: async () => { throw new Error("503"); }, onResult: () => assert.fail("failed fetch must not succeed"), onError: (request) => loaded = invalidateGeneratedFieldResult(loaded, request) });
  await resolver.refresh();
  assert.equal(loaded.key, current.key); assert.strictEqual(loaded.value.fields, fields);
  assert.equal(loaded.value.bindings[0].state, "unavailable"); assert.deepEqual(loaded.value.bindings[0].rows, []);
  assert.equal(original.value.bindings[0].rows[0].values.computed, true);
  const rows = [{ rowId: "a", sourceOrder: 0, row: { stable: "a", ordinary: null } }];
  for (const value of [true, false]) for (const operator of ["is", "is_not"]) assert.deepEqual(runView({ rows, filters: { rules: [{ field: "computed", operator, value }] }, derivedFieldProjection: { generated: loaded.value, declarationPending: false } }).visibleRowIds, []);
  assert.deepEqual(runView({ rows, filters: { rules: [{ field: "ordinary", operator: "is", value: false }] }, derivedFieldProjection: { generated: loaded.value } }).visibleRowIds, ["a"]);
});
test("failed refresh discards previous declarations across project, document and collection scopes", () => {
  const request = { key: "new", projectId: "p", sourcePath: "data/items.json", collectionPath: "items", documentEtag: "new", dirty: false };
  const previous = { key: "old", value: { projectId: "p", sourcePath: "data/items.json", collectionPath: "items", fields: [{ name: "computed", type: "Boolean" }], bindings: [] } };
  for (const changed of [{ projectId: "other" }, { sourcePath: "data/other.json" }, { collectionPath: "other" }]) assert.equal(invalidateGeneratedFieldResult(previous, { ...request, ...changed }), null);
  assert.equal(invalidateGeneratedFieldResult(null, request), null);
});
