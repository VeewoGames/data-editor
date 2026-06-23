import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractCurrentIconSvgFromTab,
  runManifestExtraction,
} from "../../scripts/streamline-export/extract-streamline-svg-dom.mjs";
import { createManifest, loadManifest } from "../../scripts/streamline-export/lib/manifest-store.mjs";

test("extractCurrentIconSvgFromTab waits until preview svg appears", async () => {
  const waitCalls = [];
  let evaluateCalls = 0;
  const tab = {
    playwright: {
      async evaluate() {
        evaluateCalls += 1;
        if (evaluateCalls < 3) return null;
        return {
          ariaLabel: "Attachment 1 Icon from Micro Solid Set",
          svgOuterHTML: '<svg viewBox="0 0 12 12"></svg>',
        };
      },
      async waitForTimeout(ms) {
        waitCalls.push(ms);
      },
    },
  };

  const result = await extractCurrentIconSvgFromTab(tab, { attempts: 5, waitMs: 25 });
  assert.equal(result.ariaLabel, "Attachment 1 Icon from Micro Solid Set");
  assert.match(result.svgOuterHTML, /<svg/);
  assert.equal(evaluateCalls, 3);
  assert.deepEqual(waitCalls, [25, 25]);
});

test("extractCurrentIconSvgFromTab throws after retries are exhausted", async () => {
  const tab = {
    playwright: {
      async evaluate() {
        return null;
      },
      async waitForTimeout() {},
    },
  };

  await assert.rejects(
    () => extractCurrentIconSvgFromTab(tab, { attempts: 3, waitMs: 1 }),
    /preview-svg-not-found-after-wait/,
  );
});

test("runManifestExtraction writes svg files and updates manifest statuses", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-extract-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    outputDir: join(root, "vendor", "streamline-svg", "micro-solid"),
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://example.test/attachment-1" },
      { slug: "attachment-2", name: "Attachment 2", iconUrl: "https://example.test/attachment-2" },
    ],
  });

  const visitedUrls = [];
  const waitCalls = [];
  const payloads = new Map([
    ["https://example.test/attachment-1", { ariaLabel: "Attachment 1 Icon", svgOuterHTML: '<svg id="one"></svg>' }],
    ["https://example.test/attachment-2", null],
  ]);
  let currentUrl = null;
  const tab = {
    async goto(url) {
      currentUrl = url;
      visitedUrls.push(url);
    },
    playwright: {
      async waitForLoadState() {},
      async evaluate() {
        return payloads.get(currentUrl) ?? null;
      },
      async waitForTimeout(ms) {
        waitCalls.push(ms);
      },
    },
  };

  const result = await runManifestExtraction({
    manifestPath,
    tab,
    attempts: 2,
    waitMs: 10,
  });

  assert.equal(result.family, "micro-solid");
  assert.equal(result.total, 2);
  assert.equal(result.success, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(visitedUrls, [
    "https://example.test/attachment-1",
    "https://example.test/attachment-2",
    "https://example.test/attachment-2",
  ]);
  assert.ok(waitCalls.length >= 1);

  const manifest = await loadManifest(manifestPath);
  assert.equal(manifest.items[0].status, "success");
  assert.equal(manifest.items[1].status, "failed");

  const svgText = await readFile(manifest.items[0].outputPath, "utf8");
  assert.match(svgText, /id="one"/);
});

test("runManifestExtraction retries the same item once before marking it failed", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-extract-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    outputDir: join(root, "vendor", "streamline-svg", "micro-solid"),
    items: [
      { slug: "attachment-2", name: "Attachment 2", iconUrl: "https://example.test/attachment-2" },
    ],
  });

  let currentUrl = null;
  let itemAttempt = 0;
  const visitedUrls = [];
  const tab = {
    async goto(url) {
      currentUrl = url;
      visitedUrls.push(url);
      itemAttempt += 1;
    },
    playwright: {
      async waitForLoadState() {},
      async evaluate() {
        if (currentUrl !== "https://example.test/attachment-2") return null;
        return itemAttempt >= 2
          ? { ariaLabel: "Attachment 2 Icon", svgOuterHTML: '<svg id="two"></svg>' }
          : null;
      },
      async waitForTimeout() {},
    },
  };

  const result = await runManifestExtraction({
    manifestPath,
    tab,
    attempts: 1,
    waitMs: 1,
    itemRetries: 2,
  });

  assert.equal(result.success, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(visitedUrls, [
    "https://example.test/attachment-2",
    "https://example.test/attachment-2",
  ]);

  const manifest = await loadManifest(manifestPath);
  assert.equal(manifest.items[0].status, "success");
  const svgText = await readFile(manifest.items[0].outputPath, "utf8");
  assert.match(svgText, /id="two"/);
});
