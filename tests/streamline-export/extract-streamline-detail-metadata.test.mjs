import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  loadManifest,
  updateManifestItemMetadata,
} from "../../scripts/streamline-export/lib/manifest-store.mjs";
import {
  runManifestMetadataExtraction,
  runManifestMetadataExtractionParallel,
} from "../../scripts/streamline-export/extract-streamline-detail-metadata.mjs";

function buildDetailHtml({ slug, sourceId, name, tags }) {
  return [
    "<html><body>",
    '<script type="application/json">',
    JSON.stringify({
      props: {
        pageProps: {
          initialState: {
            streamlineApi: {
              queries: {
                [`getIconDetailsBySlugAndSubcategoryId({"iconSlug":"${slug}","subcategoryId":${Number(sourceId)}})`]: {
                  endpointName: "getIconDetailsBySlugAndSubcategoryId",
                  originalArgs: {
                    iconSlug: slug,
                    subcategoryId: Number(sourceId),
                  },
                  data: {
                    slug,
                    name,
                    tags,
                  },
                },
              },
            },
          },
        },
      },
    }),
    "</script>",
    "</body></html>",
  ].join("");
}

test("runManifestMetadataExtraction updates tags from detail page state", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
      { slug: "binocular", name: "Binocular", iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const htmlByUrl = new Map([
    ["https://www.streamlinehq.com/icons/download/attachment-1--26582", buildDetailHtml({
      slug: "attachment-1",
      sourceId: "26582",
      name: "Attachment 1",
      tags: ["attachment", "paperclip", "affix"],
    })],
    ["https://www.streamlinehq.com/icons/download/binocular--26582", buildDetailHtml({
      slug: "binocular",
      sourceId: "26582",
      name: "Binocular",
      tags: ["optics", "view", "glass"],
    })],
  ]);

  let currentUrl = "";
  const tab = {
    async goto(url) {
      currentUrl = url;
    },
    playwright: {
      async waitForLoadState() {},
      async waitForTimeout() {},
      async evaluate(handler) {
        if (typeof handler !== "function") {
          throw new Error("evaluate requires a function handler");
        }
        return htmlByUrl.get(currentUrl) ?? "<html><body></body></html>";
      },
    },
  };

  const result = await runManifestMetadataExtraction({
    manifestPath,
    tab,
  });

  assert.equal(result.success, 2);
  assert.equal(result.failed, 0);
  const manifest = await loadManifest(manifestPath);
  assert.deepEqual(manifest.items.map((item) => item.tags), [
    ["attachment", "paperclip", "affix"],
    ["optics", "view", "glass"],
  ]);
  assert.deepEqual(manifest.items.map((item) => item.metadataStatus), ["success", "success"]);
});

test("runManifestMetadataExtraction skips metadata-success items unless forced", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
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

  const visited = [];
  let currentUrl = "";
  const tab = {
    async goto(url) {
      visited.push(url);
      currentUrl = url;
    },
    playwright: {
      async waitForLoadState() {},
      async waitForTimeout() {},
      async evaluate() {
        return buildDetailHtml({
          slug: "binocular",
          sourceId: "26582",
          name: "Binocular",
          tags: ["optics", "view", "glass"],
        });
      },
    },
  };

  const result = await runManifestMetadataExtraction({
    manifestPath,
    tab,
  });

  assert.equal(result.success, 1);
  assert.equal(visited.length, 1);
  assert.equal(visited[0], "https://www.streamlinehq.com/icons/download/binocular--26582");
  const manifest = await loadManifest(manifestPath);
  assert.deepEqual(manifest.items[0].tags, ["existing"]);
  assert.deepEqual(manifest.items[1].tags, ["optics", "view", "glass"]);
  assert.equal(currentUrl, "https://www.streamlinehq.com/icons/download/binocular--26582");
});

test("runManifestMetadataExtraction skips metadata-failed items unless retryFailed is enabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
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
    tags: [],
    metadataStatus: "failed",
    metadataError: "Error: payload not found",
    metadataUpdatedAt: "2026-06-24T10:00:00.000Z",
  });

  const visited = [];
  const tab = {
    async goto(url) {
      visited.push(url);
    },
    playwright: {
      async waitForLoadState() {},
      async waitForTimeout() {},
      async evaluate() {
        return buildDetailHtml({
          slug: "binocular",
          sourceId: "26582",
          name: "Binocular",
          tags: ["optics", "view", "glass"],
        });
      },
    },
  };

  const result = await runManifestMetadataExtraction({
    manifestPath,
    tab,
  });

  assert.equal(result.success, 1);
  assert.deepEqual(visited, ["https://www.streamlinehq.com/icons/download/binocular--26582"]);
});

test("runManifestMetadataExtraction can target explicit itemIds", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
      { slug: "binocular", name: "Binocular", iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const visited = [];
  const tab = {
    async goto(url) {
      visited.push(url);
    },
    playwright: {
      async waitForLoadState() {},
      async waitForTimeout() {},
      async evaluate() {
        return buildDetailHtml({
          slug: "binocular",
          sourceId: "26582",
          name: "Binocular",
          tags: ["optics", "view", "glass"],
        });
      },
    },
  };

  const result = await runManifestMetadataExtraction({
    manifestPath,
    tab,
    itemIds: ["binocular"],
  });

  assert.equal(result.success, 1);
  assert.deepEqual(visited, ["https://www.streamlinehq.com/icons/download/binocular--26582"]);
  const manifest = await loadManifest(manifestPath);
  assert.deepEqual(manifest.items[0].tags, []);
  assert.deepEqual(manifest.items[1].tags, ["optics", "view", "glass"]);
});

test("runManifestMetadataExtraction marks metadata failures when detail payload is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const tab = {
    async goto() {},
    playwright: {
      async waitForLoadState() {},
      async waitForTimeout() {},
      async evaluate() {
        return "<html><body></body></html>";
      },
    },
  };

  const result = await runManifestMetadataExtraction({
    manifestPath,
    tab,
  });

  assert.equal(result.success, 0);
  assert.equal(result.failed, 1);
  const manifest = await loadManifest(manifestPath);
  assert.equal(manifest.items[0].metadataStatus, "failed");
  assert.match(manifest.items[0].metadataError ?? "", /payload not found/i);
});

test("runManifestMetadataExtraction applies paced delays with jitter in serial mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const waits = [];
  const tab = {
    async goto() {},
    playwright: {
      async waitForLoadState() {},
      async waitForTimeout(delayMs) {
        waits.push(delayMs);
      },
      async evaluate() {
        return buildDetailHtml({
          slug: "attachment-1",
          sourceId: "26582",
          name: "Attachment 1",
          tags: ["attachment", "paperclip", "affix"],
        });
      },
    },
  };

  const result = await runManifestMetadataExtraction({
    manifestPath,
    tab,
    waitMs: 1_000,
    postLoadJitterMs: 300,
    preNavigationDelayMs: 500,
    preNavigationJitterMs: 200,
    postItemDelayMs: 700,
    postItemJitterMs: 100,
    random: () => 0.5,
  });

  assert.equal(result.success, 1);
  assert.deepEqual(waits, [600, 1150, 750]);
});

test("runManifestMetadataExtractionParallel processes a chunk concurrently and persists batched results", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-metadata-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
      { slug: "binocular", name: "Binocular", iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582" },
      { slug: "bomb", name: "Bomb", iconUrl: "https://www.streamlinehq.com/icons/download/bomb--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const htmlByUrl = new Map([
    ["https://www.streamlinehq.com/icons/download/attachment-1--26582", buildDetailHtml({
      slug: "attachment-1",
      sourceId: "26582",
      name: "Attachment 1",
      tags: ["attachment", "paperclip", "affix"],
    })],
    ["https://www.streamlinehq.com/icons/download/binocular--26582", buildDetailHtml({
      slug: "binocular",
      sourceId: "26582",
      name: "Binocular",
      tags: ["optics", "view", "glass"],
    })],
    ["https://www.streamlinehq.com/icons/download/bomb--26582", buildDetailHtml({
      slug: "bomb",
      sourceId: "26582",
      name: "Bomb",
      tags: ["explosive", "danger", "blast"],
    })],
  ]);

  const createTab = (tabId) => {
    let currentUrl = "";
    return {
      id: tabId,
      async goto(url) {
        currentUrl = url;
      },
      playwright: {
        async waitForLoadState() {},
        async waitForTimeout() {},
        async evaluate(handler) {
          if (typeof handler !== "function") {
            throw new Error("evaluate requires a function handler");
          }
          return htmlByUrl.get(currentUrl) ?? "<html><body></body></html>";
        },
      },
    };
  };

  const cleanups = [];
  const result = await runManifestMetadataExtractionParallel({
    manifestPath,
    tabs: [createTab("tab-1"), createTab("tab-2")],
    cleanupAfterItem: async (item) => {
      cleanups.push(item.slug);
    },
  });

  assert.equal(result.success, 3);
  assert.equal(result.failed, 0);
  assert.deepEqual(cleanups.sort(), ["attachment-1", "binocular", "bomb"]);
  const manifest = await loadManifest(manifestPath);
  assert.deepEqual(manifest.items.map((item) => item.tags), [
    ["attachment", "paperclip", "affix"],
    ["optics", "view", "glass"],
    ["explosive", "danger", "blast"],
  ]);
  assert.deepEqual(manifest.items.map((item) => item.metadataStatus), ["success", "success", "success"]);
});
