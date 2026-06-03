import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { listDataFiles, readTextFile, resolveInsideRoot, writeTextFileWithBackup } from "../src/file-service.mjs";

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

test("writeTextFileWithBackup writes backups under project context backupsDir", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-"));
  try {
    await mkdir(path.join(root, "data"));
    await writeFile(path.join(root, "data", "a.json"), "[1]");
    const result = await writeTextFileWithBackup(root, "data/a.json", "[2]");
    assert.match(result.backupPath, /^\.data-editor\/backups\/data__a\.json\./);
    assert.equal(await readFile(path.join(root, "data", "a.json"), "utf8"), "[2]");
    assert.equal(await readFile(path.join(root, result.backupPath), "utf8"), "[1]");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
