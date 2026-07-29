import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { canonicalProjectArtifactIdentity } from "../src/canonical-project-artifact-identity.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "docs", "skills"), { recursive: true });
  return root;
}

test("artifact identity is stable for existing and policy-authorized missing Markdown files", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "docs", "skills", "existing.md"), "before");
  const existing = await canonicalProjectArtifactIdentity(root, "docs/skills/existing.md");
  const missing = await canonicalProjectArtifactIdentity(root, "docs/skills/missing.md");
  assert.match(existing.canonicalFileKey, /^[0-9a-f]{64}$/);
  assert.match(missing.canonicalFileKey, /^[0-9a-f]{64}$/);
  assert.notEqual(existing.canonicalFileKey, missing.canonicalFileKey);
  assert.equal(missing.relativePath, "docs/skills/missing.md");
});

test("artifact identity rejects escaping, non-Markdown and missing parent paths", async (t) => {
  const root = await fixture(t);
  await assert.rejects(() => canonicalProjectArtifactIdentity(root, "../outside.md"), { code: "ENTRY_ACTION_TEXT_ARTIFACT_PATH_INVALID" });
  await assert.rejects(() => canonicalProjectArtifactIdentity(root, "docs/skills/file.txt"), { code: "ENTRY_ACTION_TEXT_ARTIFACT_PATH_INVALID" });
  await assert.rejects(() => canonicalProjectArtifactIdentity(root, "docs/missing/file.md"), { code: "ENTRY_ACTION_TEXT_ARTIFACT_PARENT_MISSING" });
});

test("artifact identity rejects linked ancestors instead of following them", async (t) => {
  const root = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "artifact-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const linked = path.join(root, "docs", "linked");
  try {
    await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
      t.skip(`directory link unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(() => canonicalProjectArtifactIdentity(root, "docs/linked/file.md"), { code: "ENTRY_ACTION_TEXT_ARTIFACT_LINK_REJECTED" });
});
