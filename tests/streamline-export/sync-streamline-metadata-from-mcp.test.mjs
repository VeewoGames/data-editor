import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, loadManifest } from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { syncManifestMetadataFromMcp } from "../../scripts/streamline-export/sync-streamline-metadata-from-mcp.mjs";

test("syncManifestMetadataFromMcp writes tags from official MCP responses", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-mcp-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", hash: "ico_attachment", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
      { slug: "binocular", hash: "ico_binocular", name: "Binocular", iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const result = await syncManifestMetadataFromMcp({
    manifestPath,
    apiKey: "test-key",
    concurrency: 2,
    callTool: async ({ arguments: toolArguments }) => ({
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            hash: toolArguments.iconHash,
            tags: toolArguments.iconHash === "ico_attachment"
              ? ["attachment", "paperclip", "affix"]
              : ["optics", "view", "glass"],
          }),
        }],
      },
    }),
  });

  assert.equal(result.success, 2);
  assert.equal(result.failed, 0);
  const manifest = await loadManifest(manifestPath);
  assert.deepEqual(manifest.items.map((item) => item.tags), [
    ["attachment", "paperclip", "affix"],
    ["optics", "view", "glass"],
  ]);
});

test("syncManifestMetadataFromMcp marks items failed when MCP returns no tags", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-mcp-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", hash: "ico_attachment", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const result = await syncManifestMetadataFromMcp({
    manifestPath,
    apiKey: "test-key",
    callTool: async () => ({
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            hash: "ico_attachment",
            webUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
          }),
        }],
      },
    }),
  });

  assert.equal(result.success, 0);
  assert.equal(result.failed, 1);
  const manifest = await loadManifest(manifestPath);
  assert.equal(manifest.items[0].metadataStatus, "failed");
  assert.match(manifest.items[0].metadataError ?? "", /no tags/i);
});

test("syncManifestMetadataFromMcp can target explicit itemIds", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-mcp-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", hash: "ico_attachment", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
      { slug: "binocular", hash: "ico_binocular", name: "Binocular", iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const hashes = [];
  const result = await syncManifestMetadataFromMcp({
    manifestPath,
    apiKey: "test-key",
    itemIds: ["binocular"],
    callTool: async ({ arguments: toolArguments }) => {
      hashes.push(toolArguments.iconHash);
      return {
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              hash: toolArguments.iconHash,
              tags: ["optics", "view", "glass"],
            }),
          }],
        },
      };
    },
  });

  assert.equal(result.success, 1);
  assert.deepEqual(hashes, ["ico_binocular"]);
  const manifest = await loadManifest(manifestPath);
  assert.deepEqual(manifest.items[0].tags, []);
  assert.deepEqual(manifest.items[1].tags, ["optics", "view", "glass"]);
});
