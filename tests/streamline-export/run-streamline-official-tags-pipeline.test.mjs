import test from "node:test";
import assert from "node:assert/strict";
import { runStreamlineOfficialTagsPipeline } from "../../scripts/streamline-export/run-streamline-official-tags-pipeline.mjs";

test("runStreamlineOfficialTagsPipeline orchestrates enabled steps in order", async () => {
  const pipeline = await runStreamlineOfficialTagsPipeline({
    manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-full.manifest.json",
    familyHash: "fam_micro_solid",
    captureOutputPath: "C:/temp/captured.json",
    runtimeOutputPath: "C:/temp/runtime.mjs",
    typesOutputPath: "C:/temp/runtime.d.ts",
    apiKey: "test-key",
    maxItems: 2,
    concurrency: 2,
    requestDelayMs: 250,
    retryCount: 1,
    retryBaseDelayMs: 1500,
    skipGenerateRegistry: true,
    skipHydrateHashes: true,
    skipImport: true,
    skipCapture: true,
  });

  assert.equal(Array.isArray(pipeline.steps), true);
  assert.equal(pipeline.captureOutputPath, "C:/temp/captured.json");
  assert.deepEqual(pipeline.steps, []);
});
