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

test("extractCurrentIconSvgFromTab falls back to clipboard copy when preview contains only an image", async () => {
  const waitCalls = [];
  let clickCalls = 0;
  let formatButtonClicks = 0;
  let svgOptionClicks = 0;
  let clipboardValue = "";
  let currentFormat = "PNG";
  const tab = {
    clipboard: {
      async readText() {
        return clipboardValue;
      },
      async writeText(value) {
        clipboardValue = value;
      },
    },
    playwright: {
      async evaluate(fn) {
        const source = String(fn);
        if (source.includes('EditionPanelExportSectionFormatChooseNew')) {
          return currentFormat;
        }
        return {
          ariaLabel: null,
          hasPreviewRoot: true,
          hasImagePreview: true,
          svgOuterHTML: null,
        };
      },
      locator(selector) {
        assert.equal(selector, '[data-sentry-component="EditionPanelExportSectionFormatChooseNew"] button[aria-haspopup="listbox"]');
        return {
          async count() {
            return 1;
          },
          async click() {
            formatButtonClicks += 1;
          },
        };
      },
      getByRole(role, options) {
        assert.equal(role, "option");
        assert.deepEqual(options, { name: "SVG" });
        return {
          async count() {
            return 1;
          },
          async click() {
            svgOptionClicks += 1;
            currentFormat = "SVG";
          },
        };
      },
      getByText(text, options) {
        assert.equal(text, "Copy");
        assert.deepEqual(options, { exact: true });
        return {
          async count() {
            return 1;
          },
          async click() {
            clickCalls += 1;
            clipboardValue = '<svg id="copied"></svg>';
          },
        };
      },
      async waitForTimeout(ms) {
        waitCalls.push(ms);
      },
    },
  };

  const result = await extractCurrentIconSvgFromTab(tab, { attempts: 2, waitMs: 25 });
  assert.equal(result.ariaLabel, null);
  assert.match(result.svgOuterHTML, /id="copied"/);
  assert.equal(formatButtonClicks, 1);
  assert.equal(svgOptionClicks, 1);
  assert.ok(clickCalls >= 1);
  assert.ok(!waitCalls.includes(25));
  assert.ok(waitCalls.includes(400));
});

test("extractCurrentIconSvgFromTab keeps waiting when preview root exists but image preview has not rendered yet", async () => {
  const waitCalls = [];
  let evaluateCalls = 0;
  const tab = {
    playwright: {
      async evaluate() {
        evaluateCalls += 1;
        if (evaluateCalls < 3) {
          return {
            ariaLabel: null,
            hasPreviewRoot: true,
            hasImagePreview: false,
            svgOuterHTML: null,
          };
        }
        return {
          ariaLabel: "Attachment 1 Icon from Micro Solid Set",
          hasPreviewRoot: true,
          hasImagePreview: false,
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

test("runManifestExtraction honors maxItems when selecting pending work", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-extract-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    outputDir: join(root, "vendor", "streamline-svg", "micro-solid"),
    items: [
      { slug: "one", name: "One", iconUrl: "https://example.test/one" },
      { slug: "two", name: "Two", iconUrl: "https://example.test/two" },
      { slug: "three", name: "Three", iconUrl: "https://example.test/three" },
    ],
  });

  const visitedUrls = [];
  let currentUrl = null;
  const tab = {
    async goto(url) {
      currentUrl = url;
      visitedUrls.push(url);
    },
    playwright: {
      async waitForLoadState() {},
      async evaluate() {
        return {
          ariaLabel: `${currentUrl} icon`,
          svgOuterHTML: "<svg></svg>",
        };
      },
      async waitForTimeout() {},
    },
  };

  const result = await runManifestExtraction({
    manifestPath,
    tab,
    attempts: 1,
    waitMs: 1,
    maxItems: 2,
  });

  assert.equal(result.total, 2);
  assert.deepEqual(visitedUrls, [
    "https://example.test/one",
    "https://example.test/two",
  ]);

  const manifest = await loadManifest(manifestPath);
  assert.equal(manifest.items[0].status, "success");
  assert.equal(manifest.items[1].status, "success");
  assert.equal(manifest.items[2].status, "pending");
});

test("runManifestExtraction runs cleanupAfterItem after each item", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-extract-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    outputDir: join(root, "vendor", "streamline-svg", "micro-solid"),
    items: [
      { slug: "alpha", name: "Alpha", iconUrl: "https://example.test/alpha" },
      { slug: "beta", name: "Beta", iconUrl: "https://example.test/beta" },
    ],
  });

  let currentUrl = null;
  const cleaned = [];
  const tab = {
    async goto(url) {
      currentUrl = url;
    },
    playwright: {
      async waitForLoadState() {},
      async evaluate() {
        if (currentUrl === "https://example.test/alpha") {
          return {
            ariaLabel: "alpha icon",
            svgOuterHTML: "<svg id=\"alpha\"></svg>",
          };
        }
        return null;
      },
      async waitForTimeout() {},
    },
    clipboard: {
      async readText() {
        return "";
      },
      async writeText() {},
    },
  };

  const result = await runManifestExtraction({
    manifestPath,
    tab,
    attempts: 1,
    waitMs: 1,
    itemRetries: 1,
    cleanupAfterItem: async (item) => {
      cleaned.push(item.slug);
    },
  });

  assert.equal(result.success, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(cleaned, ["alpha", "beta"]);
});

test("runManifestExtraction fails fast when Streamline redirects to pricing", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-extract-"));
  const manifestPath = join(root, "core-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "core-solid",
    outputDir: join(root, "vendor", "streamline-svg", "core-solid"),
    items: [
      { slug: "blocked", name: "Blocked", iconUrl: "https://www.streamlinehq.com/icons/download/blocked--23746" },
    ],
  });

  let currentUrl = null;
  let gotoCalls = 0;
  const tab = {
    async goto(url) {
      gotoCalls += 1;
      currentUrl = url;
    },
    async url() {
      return gotoCalls === 1
        ? "https://home.streamlinehq.com/pricing"
        : currentUrl;
    },
    playwright: {
      async waitForLoadState() {},
      async evaluate() {
        return null;
      },
      async waitForTimeout() {},
    },
  };

  const result = await runManifestExtraction({
    manifestPath,
    tab,
    attempts: 1,
    waitMs: 1,
    itemRetries: 3,
  });

  assert.equal(result.success, 0);
  assert.equal(result.failed, 1);
  assert.equal(gotoCalls, 1);
  assert.match(result.results[0].error, /streamline-redirected-to-pricing/);

  const manifest = await loadManifest(manifestPath);
  assert.equal(manifest.items[0].status, "failed");
  assert.match(manifest.items[0].error, /streamline-redirected-to-pricing/);
});

test("runManifestExtraction fails fast when Streamline redirects to profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-extract-"));
  const manifestPath = join(root, "core-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "core-solid",
    outputDir: join(root, "vendor", "streamline-svg", "core-solid"),
    items: [
      { slug: "profile-blocked", name: "Profile Blocked", iconUrl: "https://www.streamlinehq.com/icons/download/profile-blocked--23746" },
    ],
  });

  let currentUrl = null;
  let gotoCalls = 0;
  const tab = {
    async goto(url) {
      gotoCalls += 1;
      currentUrl = url;
    },
    async url() {
      return gotoCalls === 1
        ? "https://www.streamlinehq.com/profile"
        : currentUrl;
    },
    playwright: {
      async waitForLoadState() {},
      async evaluate() {
        return null;
      },
      async waitForTimeout() {},
    },
  };

  const result = await runManifestExtraction({
    manifestPath,
    tab,
    attempts: 1,
    waitMs: 1,
    itemRetries: 3,
  });

  assert.equal(result.success, 0);
  assert.equal(result.failed, 1);
  assert.equal(gotoCalls, 1);
  assert.match(result.results[0].error, /streamline-redirected-to-profile/);

  const manifest = await loadManifest(manifestPath);
  assert.equal(manifest.items[0].status, "failed");
  assert.match(manifest.items[0].error, /streamline-redirected-to-profile/);
});
