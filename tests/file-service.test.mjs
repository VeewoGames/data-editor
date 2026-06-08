import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { listDataFiles, readTextFile, resolveInsideRoot, writeTextFile } from "../src/file-service.mjs";

test("resolveInsideRoot blocks traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-"));
  try {
    assert.throws(() => resolveInsideRoot(root, "../outside.json"), /outside project root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listDataFiles returns json and csv under data", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-"));
  try {
    await mkdir(path.join(root, "data"));
    await writeFile(path.join(root, "data", "a.json"), "[]");
    await writeFile(path.join(root, "data", "b.csv"), "id\n1\n");
    await writeFile(path.join(root, "data", "c.txt"), "skip");
    const files = await listDataFiles(root);
    assert.deepEqual(files.map((f) => f.path).sort(), ["data/a.json", "data/b.csv"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listDataFiles returns virtual paths from multiple data sources", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-"));
  const external = await mkdtemp(path.join(tmpdir(), "data-editor-external-"));
  try {
    await mkdir(path.join(root, "data"));
    await mkdir(path.join(external, "nested"));
    await writeFile(path.join(root, "data", "a.json"), "[]");
    await writeFile(path.join(external, "nested", "b.csv"), "id\n1\n");
    const files = await listDataFiles({
      projectRoot: root,
      dataSources: [
        { id: "data", label: "Data", path: "data", kind: "relative" },
        { id: "balance", label: "Balance", path: external, kind: "absolute" },
      ],
    });

    assert.deepEqual(files.map((f) => f.path).sort(), ["balance/nested/b.csv", "data/a.json"]);
    assert.equal(files.find((f) => f.path === "balance/nested/b.csv").dataSourceLabel, "Balance");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("readTextFile rejects large preview files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-"));
  try {
    await mkdir(path.join(root, "data"));
    await writeFile(path.join(root, "data", "big.json"), `[${'"x",'.repeat(6_000_000)}"x"]`);
    await assert.rejects(() => readTextFile(root, "data/big.json"), /File is too large/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeTextFile overwrites allowed project files directly", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-"));
  try {
    await mkdir(path.join(root, "data"));
    await writeFile(path.join(root, "data", "a.json"), "[1]");
    const result = await writeTextFile(root, "data/a.json", "[2]");
    assert.deepEqual(result, { ok: true });
    assert.equal(await readFile(path.join(root, "data", "a.json"), "utf8"), "[2]");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeTextFile overwrites allowed absolute data source files directly", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-"));
  const external = await mkdtemp(path.join(tmpdir(), "data-editor-external-"));
  try {
    await writeFile(path.join(external, "a.json"), "[1]");
    const context = {
      projectRoot: root,
      dataSources: [
        { id: "balance", label: "Balance", path: external, kind: "absolute" },
      ],
    };
    const result = await writeTextFile(context, "balance/a.json", "[2]");

    assert.deepEqual(result, { ok: true });
    assert.equal(await readFile(path.join(external, "a.json"), "utf8"), "[2]");
    await assert.rejects(() => readTextFile(context, "balance/../outside.json"), /outside data source root|allowlist/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
