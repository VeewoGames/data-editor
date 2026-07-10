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

test("buildDocumentIndex refresh picks up markdown files added after the cache was created", async () => {
  clearDocumentServiceCache();
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-document-service-"));
  try {
    await mkdir(path.join(root, "docs", "keywords"), { recursive: true });

    const first = await buildDocumentIndex(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json");
    assert.deepEqual(first.entries, {});

    await writeFile(path.join(root, "docs", "keywords", "burn.md"), "# Burn\n\nDeal damage.", "utf8");

    const stale = await buildDocumentIndex(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json");
    assert.deepEqual(stale.entries, {});

    const refreshed = await buildDocumentIndex(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json", { forceRefresh: true });
    assert.deepEqual(refreshed.entries.burn, {
      status: "resolved",
      id: "burn",
      relativePath: "burn.md",
      title: "Burn",
    });
  } finally {
    clearDocumentServiceCache();
    await rm(root, { recursive: true, force: true });
  }
});

test("readResolvedDocument auto-refreshes once after a cached missing result", async () => {
  clearDocumentServiceCache();
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-document-service-"));
  try {
    await mkdir(path.join(root, "docs", "keywords"), { recursive: true });

    const cachedMissing = await readResolvedDocument(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json", "burn", { forceRefresh: true });
    assert.deepEqual(cachedMissing, {
      status: "missing",
      id: "burn",
    });

    await writeFile(path.join(root, "docs", "keywords", "burn.md"), "# Burn\n\nDeal damage.", "utf8");

    const recovered = await readResolvedDocument(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json", "burn");
    assert.deepEqual(recovered, {
      status: "resolved",
      id: "burn",
      relativePath: "burn.md",
      title: "Burn",
      content: "# Burn\n\nDeal damage.",
    });
  } finally {
    clearDocumentServiceCache();
    await rm(root, { recursive: true, force: true });
  }
});

test("readResolvedDocument force refresh picks up changed markdown content", async () => {
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
    assert.equal(first.status, "resolved");
    assert.equal(first.content, "# Burn\n\nDeal damage.");

    await writeFile(documentPath, "# Burn\n\nUpdated damage text.", "utf8");

    const refreshed = await readResolvedDocument(root, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json", "burn", { forceRefresh: true });
    assert.deepEqual(refreshed, {
      status: "resolved",
      id: "burn",
      relativePath: "burn.md",
      title: "Burn",
      content: "# Burn\n\nUpdated damage text.",
    });
  } finally {
    clearDocumentServiceCache();
    await rm(root, { recursive: true, force: true });
  }
});

test("document cache stays isolated per projectRoot even when docRoot strings match", async () => {
  clearDocumentServiceCache();
  const rootA = await mkdtemp(path.join(tmpdir(), "data-editor-document-service-a-"));
  const rootB = await mkdtemp(path.join(tmpdir(), "data-editor-document-service-b-"));
  try {
    await mkdir(path.join(rootA, "docs", "keywords"), { recursive: true });
    await mkdir(path.join(rootB, "docs", "keywords"), { recursive: true });
    await writeFile(path.join(rootA, "docs", "keywords", "burn.md"), "# Burn", "utf8");
    await writeFile(path.join(rootB, "docs", "keywords", "freeze.md"), "# Freeze", "utf8");

    const indexA = await buildDocumentIndex(rootA, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json");
    const indexB = await buildDocumentIndex(rootB, {
      "data/keywords.json": {
        docRoot: "docs/keywords",
      },
    }, "data/keywords.json");

    assert.deepEqual(Object.keys(indexA.entries), ["burn"]);
    assert.deepEqual(Object.keys(indexB.entries), ["freeze"]);
  } finally {
    clearDocumentServiceCache();
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  }
});
