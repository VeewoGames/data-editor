import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, updateManifestItemMetadata } from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { captureStreamlineDetailSources } from "../../scripts/streamline-export/capture-streamline-detail-sources.mjs";

test("captureStreamlineDetailSources fetches selected detail pages into importable payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-capture-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const outputPath = join(root, "captured-sources.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", hash: "ico_attachment", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
      { slug: "binocular", hash: "ico_binocular", name: "Binocular", iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const result = await captureStreamlineDetailSources({
    manifestPath,
    outputPath,
    concurrency: 2,
    fetchImpl: async (url) => new Response(`<html><body>${url}</body></html>`, { status: 200 }),
  });

  assert.equal(result.captured, 2);
  assert.equal(result.failed, 0);
  const payload = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].source.includes("<html>"), true);
  assert.equal(payload.items[0].hash?.startsWith("ico_"), true);
});

test("captureStreamlineDetailSources skips metadata-success items by default and records fetch failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-capture-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const outputPath = join(root, "captured-sources.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
      { slug: "binocular", name: "Binocular", iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });
  await updateManifestItemMetadata({
    manifestPath,
    slug: "attachment-1",
    tags: ["existing"],
    metadataStatus: "success",
    metadataUpdatedAt: "2026-06-24T10:00:00.000Z",
  });

  const requested = [];
  const result = await captureStreamlineDetailSources({
    manifestPath,
    outputPath,
    fetchImpl: async (url) => {
      requested.push(String(url));
      return new Response("blocked", { status: 403, statusText: "Forbidden" });
    },
  });

  assert.deepEqual(requested, ["https://www.streamlinehq.com/icons/download/binocular--26582"]);
  assert.equal(result.captured, 0);
  assert.equal(result.failed, 1);
  const payload = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(payload.failed.length, 1);
  assert.match(payload.failed[0]?.error ?? "", /403/i);
});

test("captureStreamlineDetailSources retries 429 responses before succeeding", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-capture-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const outputPath = join(root, "captured-sources.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  let attempts = 0;
  const result = await captureStreamlineDetailSources({
    manifestPath,
    outputPath,
    retryCount: 1,
    retryBaseDelayMs: 1,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("slow down", {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "retry-after": "0" },
        });
      }
      return new Response("<html>ok</html>", { status: 200 });
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.captured, 1);
  assert.equal(result.failed, 0);
});
