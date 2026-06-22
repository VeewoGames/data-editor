import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDefaultCandidate,
  resolveEnterAction,
  confirmNextSelectedValues,
  resetSearchStateAfterCommit,
} from "../src/table/discrete-value-picker.mjs";

test("multi mode prefers first unselected match as default candidate", () => {
  const options = [{ value: "dot" }, { value: "damage" }, { value: "debuff" }];
  const result = resolveDefaultCandidate({
    filteredOptions: options,
    selectedValues: ["dot"],
    mode: "multi",
  });
  assert.equal(result?.value, "damage");
});

test("enter creates new value when no candidate and create is allowed", () => {
  const action = resolveEnterAction({
    search: "ignite",
    defaultCandidate: null,
    allowCreate: true,
  });
  assert.deepEqual(action, { type: "create", value: "ignite" });
});

test("resetSearchStateAfterCommit clears search and candidate", () => {
  assert.deepEqual(resetSearchStateAfterCommit(), {
    search: "",
    highlightedValue: null,
  });
});

test("confirmNextSelectedValues does not toggle away selected value in single mode", () => {
  assert.deepEqual(
    confirmNextSelectedValues({ mode: "single", selectedValues: ["dot"], value: "dot" }),
    ["dot"],
  );
});
