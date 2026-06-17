import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDocumentIndex, clearDocumentServiceCache, readResolvedDocument } from "../src/document-service.mjs";

test("buildDocumentIndex scans docRoot and resolves markdown titles", async () => {
  clearDocumentServiceCache();
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-document-service-"));
  try {
    await mkdir(path.join(root, "docs", "keywords", "status"), { recursive: true });
    await writeFile(path.join(root, "docs", "keywords", "burn.md"), "# Burn\n\nDeal damage.", "utf8");
    await writeFile(path.join(root, "docs", "keywords", "status", "freeze.md"), "No H1 here", "utf8");

    const index = await buildDocumentIndex(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json");

    assert.deepEqual(index.docRoot, "docs/keywords");
    assert.deepEqual(index.entries.burn, {
      status: "resolved",
      id: "burn",
      relativePath: "burn.md",
      title: "Burn",
    });
    assert.deepEqual(index.entries.freeze, {
      status: "resolved",
      id: "freeze",
      relativePath: "status/freeze.md",
      title: "freeze.md",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildDocumentIndex marks duplicate ids as conflict", async () => {
  clearDocumentServiceCache();
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-document-service-"));
  try {
    await mkdir(path.join(root, "docs", "keywords", "status"), { recursive: true });
    await writeFile(path.join(root, "docs", "keywords", "burn.md"), "# Burn", "utf8");
    await writeFile(path.join(root, "docs", "keywords", "status", "burn.md"), "# Burn Status", "utf8");

    const index = await buildDocumentIndex(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json");

    assert.deepEqual(index.entries.burn, {
      status: "conflict",
      id: "burn",
      matches: ["burn.md", "status/burn.md"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readResolvedDocument returns markdown content for a resolved id", async () => {
  clearDocumentServiceCache();
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-document-service-"));
  try {
    await mkdir(path.join(root, "docs", "keywords"), { recursive: true });
    await writeFile(path.join(root, "docs", "keywords", "burn.md"), "# Burn\n\nDeal damage.", "utf8");

    const document = await readResolvedDocument(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json", "burn");

    assert.deepEqual(document, {
      status: "resolved",
      id: "burn",
      relativePath: "burn.md",
      title: "Burn",
      content: "# Burn\n\nDeal damage.",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readResolvedDocument returns missing when no matching document exists", async () => {
  clearDocumentServiceCache();
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-document-service-"));
  try {
    await mkdir(path.join(root, "docs", "keywords"), { recursive: true });

    const document = await readResolvedDocument(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json", "burn");

    assert.deepEqual(document, {
      status: "missing",
      id: "burn",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readResolvedDocument reuses cached index and content for repeated reads", async () => {
  clearDocumentServiceCache();
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-document-service-"));
  try {
    await mkdir(path.join(root, "docs", "keywords"), { recursive: true });
    const documentPath = path.join(root, "docs", "keywords", "burn.md");
    await writeFile(documentPath, "# Burn\n\nDeal damage.", "utf8");

    const first = await readResolvedDocument(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json", "burn");
    await rm(documentPath, { force: true });
    const second = await readResolvedDocument(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json", "burn");

    assert.deepEqual(second, first);
  } finally {
    clearDocumentServiceCache();
    await rm(root, { recursive: true, force: true });
  }
});
