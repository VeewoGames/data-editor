import test from "node:test";
import assert from "node:assert/strict";
import {
  indexOfficialMetadataRecords,
  normalizeOfficialMetadataRecord,
  resolveOfficialMetadataForManifestItem,
} from "../../scripts/streamline-export/lib/streamline-official-metadata-source.mjs";

test("normalizeOfficialMetadataRecord trims hash slug and tags", () => {
  const record = normalizeOfficialMetadataRecord({
    hash: " ico_123 ",
    slug: " attachment-1 ",
    tags: [" paperclip ", "", null, "```plaintext\naffix\n```"],
  });

  assert.deepEqual(record, {
    hash: "ico_123",
    slug: "attachment-1",
    tags: ["paperclip", "affix"],
  });
});

test("resolveOfficialMetadataForManifestItem prefers hash over slug", () => {
  const index = indexOfficialMetadataRecords([
    { hash: "ico_123", slug: "attachment-1", tags: ["paperclip"] },
    { hash: "ico_999", slug: "attachment-1", tags: ["wrong"] },
  ]);

  const matched = resolveOfficialMetadataForManifestItem(index, {
    hash: "ico_123",
    slug: "attachment-1",
  });

  assert.deepEqual(matched, {
    hash: "ico_123",
    slug: "attachment-1",
    tags: ["paperclip"],
    matchedBy: "hash",
  });
});

test("resolveOfficialMetadataForManifestItem falls back to slug when hash is absent", () => {
  const index = indexOfficialMetadataRecords([
    { slug: "attachment-1", tags: ["paperclip", "affix"] },
  ]);

  const matched = resolveOfficialMetadataForManifestItem(index, {
    slug: "attachment-1",
  });

  assert.deepEqual(matched, {
    hash: null,
    slug: "attachment-1",
    tags: ["paperclip", "affix"],
    matchedBy: "slug",
  });
});
