import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, loadManifest } from "../../scripts/streamline-export/lib/manifest-store.mjs";
import { applyStreamlineTagSuggestions } from "../../scripts/streamline-export/apply-streamline-tag-suggestions.mjs";

test("applyStreamlineTagSuggestions dry-run reports auto_accept updates without mutating manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-apply-suggestions-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const suggestionsPath = join(root, "micro-solid-tag-suggestions.json");

  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "alpha", name: "Alpha", iconUrl: "https://example.test/icons/download/alpha--1" },
      { slug: "beta", name: "Beta", iconUrl: "https://example.test/icons/download/beta--2" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const before = await readFile(manifestPath, "utf8");
  await writeFile(suggestionsPath, `${JSON.stringify({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "alpha",
        slug: "alpha",
        decision: "auto_accept",
        confidence: 0.95,
        suggestedTags: ["tag-a", "tag-b"],
      },
      {
        itemId: "beta",
        slug: "beta",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["tag-c"],
      },
    ],
  }, null, 2)}\n`, "utf8");

  const result = await applyStreamlineTagSuggestions({
    manifestPath,
    suggestionsPath,
    dryRun: true,
  });

  const after = await readFile(manifestPath, "utf8");
  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(before, after);
});

test("applyStreamlineTagSuggestions writes auto_accept tags back to manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-apply-suggestions-"));
  const manifestPath = join(root, "micro-solid.manifest.json");
  const suggestionsPath = join(root, "micro-solid-tag-suggestions.json");

  await createManifest({
    manifestPath,
    family: "micro-solid",
    items: [
      { slug: "alpha", name: "Alpha", iconUrl: "https://example.test/icons/download/alpha--1" },
      { slug: "beta", name: "Beta", iconUrl: "https://example.test/icons/download/beta--2" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  await writeFile(suggestionsPath, `${JSON.stringify({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "alpha",
        slug: "alpha",
        decision: "auto_accept",
        confidence: 0.95,
        suggestedTags: ["tag-a", "tag-b"],
      },
      {
        itemId: "beta",
        slug: "beta",
        decision: "reject",
        confidence: 0,
        suggestedTags: [],
      },
    ],
  }, null, 2)}\n`, "utf8");

  const result = await applyStreamlineTagSuggestions({
    manifestPath,
    suggestionsPath,
  });

  const manifest = await loadManifest(manifestPath);
  const alpha = manifest.items.find((item) => item.itemId === "alpha");
  const beta = manifest.items.find((item) => item.itemId === "beta");

  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(alpha?.tags, ["tag-a", "tag-b"]);
  assert.equal(alpha?.metadataStatus, "success");
  assert.equal(alpha?.metadataError, null);
  assert.match(String(alpha?.metadataUpdatedAt), /^20/);
  assert.deepEqual(beta?.tags, []);
});
