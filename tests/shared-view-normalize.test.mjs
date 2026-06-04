import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeCollectionViewDraft,
  normalizeSharedViewDraftState,
} from "../src/view/shared-view-normalize.mjs";

test("shared view normalize module is browser-safe and keeps draft semantics", async () => {
  const source = await readFile(new URL("../src/view/shared-view-normalize.mjs", import.meta.url), "utf8");

  assert.equal(source.includes("node:fs"), false);
  assert.equal(source.includes("node:path"), false);
  assert.equal(source.includes("project-context"), false);
  assert.deepEqual(normalizeCollectionViewDraft({
    filters: { op: "or", rules: [{ id: "bad", field: "element", operator: "starts_with" }] },
    sorts: [{ id: "bad", field: "power", direction: "down" }],
    hidden: "icon",
    widths: { tiny: 0.4, bad: "88" },
  }), {});
  assert.deepEqual(normalizeSharedViewDraftState({
    viewDrafts: {
      " data/runes.json:$ ": {
        " view-1 ": {
          query: " fire ",
        },
      },
    },
  }).viewDrafts, {
    "data/runes.json:$": {
      "view-1": {
        query: "fire",
      },
    },
  });
});
