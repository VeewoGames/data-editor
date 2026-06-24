import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest } from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { buildStreamlineTagKnowledgeFile } from "../../scripts/streamline-export/build-streamline-tag-knowledge.mjs";
import { suggestStreamlineTagsForManifest } from "../../scripts/streamline-export/suggest-streamline-tags.mjs";

test("buildStreamlineTagKnowledgeFile writes a reusable knowledge snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-tag-knowledge-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const outputDir = join(root, "vendor", "streamline-svg", "micro-solid");
  await mkdir(outputDir, { recursive: true });

  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment", name: "Attachment", iconUrl: "https://example.test/icons/download/attachment--26409" },
      { slug: "attachment-off", name: "Attachment Off", iconUrl: "https://example.test/icons/download/attachment-off--26409" },
    ],
    outputDir,
  });

  await writeFile(join(outputDir, "attachment.svg"), '<svg viewBox="0 0 16 16"><path fill="#000"/></svg>\n', "utf8");
  await writeFile(join(outputDir, "attachment-off.svg"), '<svg viewBox="0 0 16 16"><path fill="#000"/></svg>\n', "utf8");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.items[0].status = "success";
  manifest.items[0].tags = ["attachment", "paperclip", "clip"];
  manifest.items[0].metadataStatus = "success";
  manifest.items[0].metadataUpdatedAt = "2026-06-24T12:00:00.000Z";
  manifest.items[1].status = "success";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const outputPath = join(root, "micro-solid-tag-knowledge.json");
  const result = await buildStreamlineTagKnowledgeFile({ manifestPath, outputPath });
  const snapshot = JSON.parse(await readFile(outputPath, "utf8"));

  assert.equal(result.summary.labeledItems, 1);
  assert.equal(snapshot.kind, "streamline-tag-knowledge");
  assert.equal(snapshot.summary.vocabularySize, 3);
  assert.deepEqual(snapshot.tagVocabulary, ["attachment", "clip", "paperclip"]);
  assert.deepEqual(snapshot.labeledItems[0].nameTokens, ["attachment"]);
});

test("suggestStreamlineTagsForManifest writes unlabeled suggestions with searchText preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-tag-suggestions-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const outputDir = join(root, "vendor", "streamline-svg", "micro-solid");
  await mkdir(outputDir, { recursive: true });

  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "attachment", name: "Attachment", iconUrl: "https://example.test/icons/download/attachment--26409" },
      { slug: "attachment-off", name: "Attachment Off", iconUrl: "https://example.test/icons/download/attachment-off--26409" },
      { slug: "search", name: "Search", iconUrl: "https://example.test/icons/download/search--26403" },
    ],
    outputDir,
  });

  await writeFile(join(outputDir, "attachment.svg"), '<svg viewBox="0 0 16 16"><path fill="#000"/></svg>\n', "utf8");
  await writeFile(join(outputDir, "attachment-off.svg"), '<svg viewBox="0 0 16 16"><path fill="#000"/></svg>\n', "utf8");
  await writeFile(join(outputDir, "search.svg"), '<svg viewBox="0 0 16 16"><circle fill="#000"/></svg>\n', "utf8");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.items[0].status = "success";
  manifest.items[0].tags = ["attachment", "paperclip", "clip"];
  manifest.items[0].metadataStatus = "success";
  manifest.items[1].status = "success";
  manifest.items[2].status = "success";
  manifest.items[2].tags = ["search", "find", "magnifier"];
  manifest.items[2].metadataStatus = "success";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const outputPath = join(root, "micro-solid-tag-suggestions.json");
  const result = await suggestStreamlineTagsForManifest({ manifestPath, outputPath, maxTags: 5 });
  const suggestions = JSON.parse(await readFile(outputPath, "utf8"));

  assert.equal(result.summary.suggestedItems, 1);
  assert.equal(suggestions.kind, "streamline-tag-suggestions");
  assert.equal(suggestions.suggestions[0].itemId, "attachment-off");
  assert.deepEqual(suggestions.suggestions[0].suggestedTags.slice(0, 3), ["attachment", "clip", "paperclip"]);
  assert.match(suggestions.suggestions[0].searchTextPreview, /paperclip/);
});

test("suggestStreamlineTagsForManifest baseline mode emits direct low-risk tags for unlabeled items", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-tag-suggestions-baseline-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const outputDir = join(root, "vendor", "streamline-svg", "micro-solid");
  await mkdir(outputDir, { recursive: true });

  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "shopping-store-signage-1", name: "Shopping Store Signage 1", iconUrl: "https://example.test/icons/download/shopping-store-signage-1--26493" },
      { slug: "shield-off", name: "Shield Off", iconUrl: "https://example.test/icons/download/shield-off--26411" },
    ],
    outputDir,
  });

  await writeFile(join(outputDir, "shopping-store-signage-1.svg"), '<svg viewBox="0 0 16 16"><path fill="#000"/></svg>\n', "utf8");
  await writeFile(join(outputDir, "shield-off.svg"), '<svg viewBox="0 0 16 16"><path fill="#000"/></svg>\n', "utf8");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.items[0].status = "success";
  manifest.items[1].status = "success";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const outputPath = join(root, "micro-solid-tag-suggestions.json");
  const result = await suggestStreamlineTagsForManifest({ manifestPath, outputPath, mode: "baseline", maxTags: 6 });
  const suggestions = JSON.parse(await readFile(outputPath, "utf8"));

  assert.equal(result.summary.autoAcceptItems, 2);
  assert.equal(suggestions.mode, "baseline");
  assert.deepEqual(suggestions.suggestions[0].suggestedTags, ["shopping", "commerce", "store", "signage"]);
  assert.deepEqual(suggestions.suggestions[1].suggestedTags, ["shield", "protection", "security", "off"]);
});

test("suggestStreamlineTagsForManifest can include labeled items for baseline rewrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-tag-suggestions-rewrite-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const outputDir = join(root, "vendor", "streamline-svg", "micro-solid");
  await mkdir(outputDir, { recursive: true });

  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "medical-cross-sign-healthcare", name: "Medical Cross Sign Healthcare", iconUrl: "https://example.test/icons/download/medical-cross-sign-healthcare--26676" },
    ],
    outputDir,
  });

  await writeFile(join(outputDir, "medical-cross-sign-healthcare.svg"), '<svg viewBox="0 0 16 16"><path fill="#000"/></svg>\n', "utf8");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.items[0].status = "success";
  manifest.items[0].tags = ["medical", "cross", "remove", "sign", "symbol", "healthcare"];
  manifest.items[0].metadataStatus = "success";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const outputPath = join(root, "micro-solid-tag-suggestions.json");
  const result = await suggestStreamlineTagsForManifest({ manifestPath, outputPath, mode: "baseline", includeLabeled: true, maxTags: 6 });
  const suggestions = JSON.parse(await readFile(outputPath, "utf8"));

  assert.equal(result.summary.suggestedItems, 1);
  assert.deepEqual(suggestions.suggestions[0].suggestedTags, ["medical", "cross", "sign", "symbol", "healthcare"]);
});
