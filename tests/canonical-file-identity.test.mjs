import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalFileIdentity } from "../src/canonical-file-identity.mjs";

async function withFixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-identity-"));
  try {
    await mkdir(path.join(root, "data", "nested"), { recursive: true });
    await writeFile(path.join(root, "data", "nested", "a.json"), "[]");
    await writeFile(path.join(root, "data", "nested", "b.json"), "[]");
    await writeFile(path.join(root, "data", "nested", "blocked.txt"), "blocked");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("returns a stable 64-character SHA-256 key", async () => {
  await withFixture(async (root) => {
    const first = await canonicalFileIdentity(root, "data/nested/a.json");
    const second = await canonicalFileIdentity(root, "data/nested/a.json");

    assert.match(first.canonicalFileKey, /^[0-9a-f]{64}$/);
    assert.equal(first.canonicalFileKey, second.canonicalFileKey);
    assert.equal(first.version, 1);
    assert.equal(first.sourcePath, "data/nested/a.json");
    assert.equal(first.resolvedPath, path.join(root, "data", "nested", "a.json"));
    const expectedPath = path.resolve(root, "data", "nested", "a.json").replaceAll("\\", "/");
    assert.equal(first.canonicalPath, process.platform === "win32" ? expectedPath.toLowerCase() : expectedPath);
  });
});

test("overlapping relative and absolute sources produce the same physical key", async () => {
  await withFixture(async (root) => {
    const context = {
      projectRoot: root,
      dataSources: [
        { id: "parent", path: "data", kind: "relative" },
        { id: "child", path: path.join(root, "data", "nested"), kind: "absolute" },
      ],
    };

    const parent = await canonicalFileIdentity(context, "parent/nested/a.json");
    const child = await canonicalFileIdentity(context, "child/a.json");

    assert.equal(parent.canonicalFileKey, child.canonicalFileKey);
    assert.equal(parent.canonicalPath, child.canonicalPath);
    assert.notEqual(parent.sourcePath, child.sourcePath);
  });
});

test("normalizes slash, dot, and safe parent-directory segments", async () => {
  await withFixture(async (root) => {
    const expected = await canonicalFileIdentity(root, "data/nested/a.json");
    const dotted = await canonicalFileIdentity(root, "data\\nested\\.\\a.json");
    const parent = await canonicalFileIdentity(root, "data/nested/other/../a.json");

    assert.equal(dotted.sourcePath, "data/nested/a.json");
    assert.equal(parent.sourcePath, "data/nested/a.json");
    assert.equal(dotted.canonicalFileKey, expected.canonicalFileKey);
    assert.equal(parent.canonicalFileKey, expected.canonicalFileKey);
  });
});

test("Windows platform injection folds only the canonical path and key", async () => {
  await withFixture(async (root) => {
    const resolved = path.join(root, "data", "nested", "a.json");
    const upper = await canonicalFileIdentity(root, "data/nested/a.json", {
      platform: "win32",
      realpathImpl: async () => resolved.toUpperCase(),
    });
    const lower = await canonicalFileIdentity(root, "data/nested/a.json", {
      platform: "win32",
      realpathImpl: async () => resolved.toLowerCase(),
    });

    assert.equal(upper.sourcePath, "data/nested/a.json");
    assert.equal(upper.resolvedPath, resolved);
    assert.equal(upper.canonicalPath, lower.canonicalPath);
    assert.equal(upper.canonicalFileKey, lower.canonicalFileKey);
  });
});

test("Windows filesystem matching preserves source id case while folding the inner path", {
  skip: process.platform !== "win32",
}, async () => {
  await withFixture(async (root) => {
    const lower = await canonicalFileIdentity(root, "data/nested/a.json");
    const upper = await canonicalFileIdentity(root, "data/NESTED/A.JSON");

    assert.equal(upper.sourcePath, "data/nested/a.json");
    assert.equal(upper.resolvedPath, lower.resolvedPath);
    assert.equal(upper.canonicalFileKey, lower.canonicalFileKey);
    await assert.rejects(
      () => canonicalFileIdentity(root, "DATA/NESTED/A.JSON"),
      /Unknown data source/,
    );
  });
});

test("a source rooted at a directory link resolves to the target file identity", async (t) => {
  await withFixture(async (root) => {
    const linkedRoot = path.join(root, "linked-data");
    try {
      await symlink(path.join(root, "data"), linkedRoot, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (process.platform !== "win32" && ["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        t.skip(`directory link unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    const context = {
      projectRoot: root,
      dataSources: [
        { id: "direct", path: "data", kind: "relative" },
        { id: "linked", path: linkedRoot, kind: "absolute" },
      ],
    };
    const direct = await canonicalFileIdentity(context, "direct/nested/a.json");
    const linked = await canonicalFileIdentity(context, "linked/nested/a.json");

    assert.equal(linked.canonicalFileKey, direct.canonicalFileKey);
    assert.equal(linked.canonicalPath, direct.canonicalPath);
  });
});

test("fails closed for disallowed, unknown, escaping, and missing paths", async () => {
  await withFixture(async (root) => {
    await assert.rejects(
      () => canonicalFileIdentity(root, "data/nested/blocked.txt"),
      /allowlist/,
    );
    await assert.rejects(
      () => canonicalFileIdentity(root, "unknown/nested/a.json"),
      /Unknown data source/,
    );
    await assert.rejects(
      () => canonicalFileIdentity(root, "data/../../outside.json"),
      /outside project root/,
    );
    await assert.rejects(
      () => canonicalFileIdentity(root, "data/nested/missing.json"),
      /allowlist/,
    );
  });
});

test("fails closed when realpath fails", async () => {
  await withFixture(async (root) => {
    const failure = Object.assign(new Error("injected realpath failure"), { code: "EIO" });
    await assert.rejects(
      () => canonicalFileIdentity(root, "data/nested/a.json", {
        realpathImpl: async () => { throw failure; },
      }),
      (error) => error === failure,
    );
  });
});

test("different physical files produce different keys", async () => {
  await withFixture(async (root) => {
    const first = await canonicalFileIdentity(root, "data/nested/a.json");
    const second = await canonicalFileIdentity(root, "data/nested/b.json");
    assert.notEqual(first.canonicalFileKey, second.canonicalFileKey);
  });
});
