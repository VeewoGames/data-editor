import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, loadManifest } from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { importStreamlineDetailSourceMetadata } from "../../scripts/streamline-export/import-streamline-detail-source-metadata.mjs";

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

test("importStreamlineDetailSourceMetadata parses captured detail html and writes tags", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-detail-source-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const sourcePath = join(root, "captured-sources.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
      { slug: "binocular", name: "Binocular", iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  await writeFile(sourcePath, JSON.stringify({
    items: [
      {
        slug: "attachment-1",
        iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
        source: buildDetailHtml({
          slug: "attachment-1",
          sourceId: "26582",
          name: "Attachment 1",
          tags: ["attachment", "paperclip", "affix"],
        }),
      },
      {
        slug: "binocular",
        iconUrl: "https://www.streamlinehq.com/icons/download/binocular--26582",
        source: buildDetailHtml({
          slug: "binocular",
          sourceId: "26582",
          name: "Binocular",
          tags: ["optics", "view", "glass"],
        }),
      },
    ],
  }, null, 2));

  const result = await importStreamlineDetailSourceMetadata({
    manifestPath,
    sourcePath,
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

test("importStreamlineDetailSourceMetadata reports missing manifest items without crashing batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-detail-source-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const sourcePath = join(root, "captured-sources.json");
  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  await writeFile(sourcePath, JSON.stringify([
    {
      slug: "missing",
      iconUrl: "https://www.streamlinehq.com/icons/download/missing--26582",
      source: buildDetailHtml({
        slug: "missing",
        sourceId: "26582",
        name: "Missing",
        tags: ["missing"],
      }),
    },
  ], null, 2));

  const result = await importStreamlineDetailSourceMetadata({
    manifestPath,
    sourcePath,
  });

  assert.equal(result.success, 0);
  assert.equal(result.failed, 1);
  assert.match(result.results[0]?.error ?? "", /Manifest item not found/i);
});
