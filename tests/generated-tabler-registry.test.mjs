import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("generated tabler registry includes filled and outline groups", async () => {
  const runtimeSource = await readFile(new URL("../src/generated/tabler-shared-view-icons.mjs", import.meta.url), "utf8");
  const typesSource = await readFile(new URL("../src/generated/tabler-shared-view-icons.d.ts", import.meta.url), "utf8");

  assert.doesNotMatch(runtimeSource, /export const tablerSharedViewIcons = \[\];/);
  assert.match(runtimeSource, /"id": "tabler-filled"/);
  assert.match(runtimeSource, /"label": "Tabler S"/);
  assert.match(runtimeSource, /"id": "tabler-outline"/);
  assert.match(runtimeSource, /"label": "Tabler L"/);
  assert.match(runtimeSource, /tablerFilledHome/);
  assert.match(runtimeSource, /tablerLineHome/);
  assert.match(typesSource, /"tablerFilledHome"/);
  assert.match(typesSource, /"tablerLineHome"/);
});
