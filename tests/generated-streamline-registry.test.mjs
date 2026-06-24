import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("generated streamline registry includes micro and core family groups", async () => {
  const runtimeSource = await readFile(new URL("../src/generated/streamline-shared-view-icons.mjs", import.meta.url), "utf8");
  const typesSource = await readFile(new URL("../src/generated/streamline-shared-view-icons.d.ts", import.meta.url), "utf8");

  assert.doesNotMatch(runtimeSource, /export const streamlineSharedViewIcons = \[\];/);
  assert.match(runtimeSource, /"id": "streamline-micro-solid"/);
  assert.match(runtimeSource, /"label": "Solid"/);
  assert.match(runtimeSource, /"id": "streamline-micro-line"/);
  assert.match(runtimeSource, /"label": "Line"/);
  assert.match(runtimeSource, /"id": "streamline-core-solid"/);
  assert.match(runtimeSource, /"label": "Core S"/);
  assert.match(runtimeSource, /streamlineCoreSolidApplyToAll/);
  assert.match(typesSource, /"streamlineCoreSolidApplyToAll"/);
});
