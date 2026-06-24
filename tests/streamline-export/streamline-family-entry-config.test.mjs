import test from "node:test";
import assert from "node:assert/strict";
import {
  getStreamlineFamilyEntryConfig,
  streamlineFamilyEntryConfig,
} from "../../scripts/streamline-export/lib/streamline-family-entry-config.mjs";

test("streamlineFamilyEntryConfig exposes supported families", () => {
  assert.deepEqual(Object.keys(streamlineFamilyEntryConfig).sort(), ["core-solid", "micro-line", "micro-solid"]);
});

test("getStreamlineFamilyEntryConfig returns explicit entry urls", () => {
  assert.deepEqual(getStreamlineFamilyEntryConfig("core-solid"), {
    family: "core-solid",
    entryUrl: "https://www.streamlinehq.com/icons/core-solid",
    label: "Core S",
    manifestPath: "artifacts/streamline-export/core-solid-full.manifest.json",
    itemsPath: "artifacts/streamline-export/core-solid-full-items.json",
    outputDir: "vendor/streamline-svg/core-solid",
  });
  assert.deepEqual(getStreamlineFamilyEntryConfig("micro-line"), {
    family: "micro-line",
    entryUrl: "https://www.streamlinehq.com/icons/micro-line",
    label: "Line",
    manifestPath: "artifacts/streamline-export/micro-line-full.manifest.json",
    outputDir: "vendor/streamline-svg/micro-line",
  });
  assert.deepEqual(getStreamlineFamilyEntryConfig("micro-solid"), {
    family: "micro-solid",
    entryUrl: "https://www.streamlinehq.com/icons/micro-solid",
    label: "Solid",
    manifestPath: "artifacts/streamline-export/micro-solid-full.manifest.json",
    outputDir: "vendor/streamline-svg/micro-solid",
  });
});

test("getStreamlineFamilyEntryConfig throws for unsupported families", () => {
  assert.throws(() => getStreamlineFamilyEntryConfig("unknown-family"), /Unsupported Streamline family/);
});
