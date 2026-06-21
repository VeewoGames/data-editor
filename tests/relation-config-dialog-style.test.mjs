import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("relation config dialog target file select content is scrollable", async () => {
  const dialogSource = await readFile(new URL("../src/components/RelationConfigDialog.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(dialogSource, /className="menu-content select-content relation-config-select-content"/);
  assert.match(
    stylesSource,
    /\.relation-config-select-content\s*\{[\s\S]*max-height:\s*min\(420px,\s*calc\(100vh - 96px\)\);[\s\S]*overflow-y:\s*auto;/,
  );
});
