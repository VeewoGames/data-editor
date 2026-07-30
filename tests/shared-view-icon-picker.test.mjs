import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("shared view icon picker retains wheel events inside its scrollable grid", async () => {
  const source = await readFile(new URL("../src/components/SharedViewIconPicker.tsx", import.meta.url), "utf8");
  assert.match(source, /className="view-tab-icon-picker-grid"[\s\S]*onWheelCapture=\{\(event\) => event\.stopPropagation\(\)\}/);
});
