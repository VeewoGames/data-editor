import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importManifestSvgFromMcp } from "../../scripts/streamline-export/import-streamline-svg-from-mcp.mjs";

test("importManifestSvgFromMcp writes svg and marks success", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "streamline-mcp-svg-"));
  try {
    const manifestPath = join(tempDir, "manifest.json");
    const outputPath = join(tempDir, "attachment-1.svg");
    await writeFile(manifestPath, `${JSON.stringify({
      family: "core-solid",
      generatedAt: "2026-06-24T00:00:00.000Z",
      items: [
        {
          itemId: "attachment-1",
          slug: "attachment-1",
          hash: "ico_attachment",
          iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
          outputPath,
          status: "pending",
          attempts: 0,
          error: null,
          extractedAt: null,
          metadataStatus: "pending",
          metadataError: null,
          metadataUpdatedAt: null,
          tags: [],
        },
      ],
    }, null, 2)}\n`, "utf8");

    const result = await importManifestSvgFromMcp({
      manifestPath,
      apiKey: "test-key",
      callTool: async () => ({
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                hash: "ico_attachment",
                svg: "<svg viewBox=\"0 0 16 16\"></svg>",
              }),
            },
          ],
        },
      }),
    });

    assert.equal(result.success, 1);
    assert.equal(result.failed, 0);

    const svgText = await readFile(outputPath, "utf8");
    assert.match(svgText, /<svg/);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.items[0].status, "success");
    assert.equal(manifest.items[0].error, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importManifestSvgFromMcp records failure when MCP returns no svg", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "streamline-mcp-svg-fail-"));
  try {
    const manifestPath = join(tempDir, "manifest.json");
    const outputPath = join(tempDir, "attachment-1.svg");
    await writeFile(manifestPath, `${JSON.stringify({
      family: "core-solid",
      generatedAt: "2026-06-24T00:00:00.000Z",
      items: [
        {
          itemId: "attachment-1",
          slug: "attachment-1",
          hash: "ico_attachment",
          iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
          outputPath,
          status: "pending",
          attempts: 0,
          error: null,
          extractedAt: null,
          metadataStatus: "pending",
          metadataError: null,
          metadataUpdatedAt: null,
          tags: [],
        },
      ],
    }, null, 2)}\n`, "utf8");

    const result = await importManifestSvgFromMcp({
      manifestPath,
      apiKey: "test-key",
      callTool: async () => ({
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                hash: "ico_attachment",
                webUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
              }),
            },
          ],
        },
      }),
    });

    assert.equal(result.success, 0);
    assert.equal(result.failed, 1);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.items[0].status, "failed");
    assert.match(manifest.items[0].error, /no svg/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
