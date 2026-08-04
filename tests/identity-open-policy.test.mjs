import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("opening a document keeps durable identity promotion out of the normal editor path", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const openDocumentAt = source.slice(source.indexOf("async function openDocumentAt("), source.indexOf("function finalizeDetailReorderAsyncSegment"));
  assert.doesNotMatch(openDocumentAt, /ensurePersistentEntryIds/);
  assert.doesNotMatch(openDocumentAt, /markDirty\("document"\)/);
  assert.match(openDocumentAt, /buildDocumentStoreTyped/);
});
