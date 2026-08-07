import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateLegacyEntryActionPolicy } from "../src/entry-action-policy-migration.mjs";

async function project({ rowMatch = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-policy-migration-"));
  await mkdir(path.join(root, ".data-editor"));
  await writeFile(path.join(root, ".data-editor", "automation-profile.json"), JSON.stringify({ rules: [
    { id: "trait", label: "Trait", icon: "edit", enabled: true, targets: [{ file: "data/traits.json", collection: "traits" }], payload: { includeRow: true, includeNeighbors: false } },
    { id: "design", label: "Design", icon: "edit", enabled: true, targets: [{ file: "data/skills.json", collection: "skills", textArtifactId: "skill-doc" }], payload: { includeRow: true, includeNeighbors: false } },
  ] }, null, 2));
  await writeFile(path.join(root, ".data-editor", "entry-action-policy.json"), JSON.stringify({ version: 4, targets: [
    { actionId: "design", file: "data/skills.json", collection: "skills", ...(rowMatch ? { rowMatch: { owner: ["player"] } } : {}) },
  ], textArtifacts: [{ actionId: "design", id: "skill-doc", pathTemplate: "docs/skills/{value}.md", sourceField: "skill_id", allowCreate: true, allowUpdate: true, maxBytes: 4096 }] }, null, 2));
  return root;
}

test("migration keeps profile-only targets and deletes the legacy policy after exact artifact migration", async () => {
  const root = await project();
  try {
    assert.deepEqual(await migrateLegacyEntryActionPolicy(root), { status: "migrated" });
    const profile = JSON.parse(await readFile(path.join(root, ".data-editor", "automation-profile.json"), "utf8"));
    assert.equal(profile.rules[0].targets[0].file, "data/traits.json");
    assert.deepEqual(profile.rules[1].targets[0].textArtifact, {});
    await assert.rejects(() => readFile(path.join(root, ".data-editor", "entry-action-policy.json"), "utf8"), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("migration removes legacy rowMatch because row predicates belong to the selected skill", async () => {
  const root = await project({ rowMatch: true });
  try {
    const result = await migrateLegacyEntryActionPolicy(root);
    assert.deepEqual(result, { status: "migrated", droppedRowMatchActions: ["design"] });
    const profile = JSON.parse(await readFile(path.join(root, ".data-editor", "automation-profile.json",), "utf8"));
    assert.deepEqual(profile.rules[1].targets[0].textArtifact, {});
    await assert.rejects(() => readFile(path.join(root, ".data-editor", "entry-action-policy.json"), "utf8"), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("migration retires a leftover legacy policy when the profile is already modern", async () => {
  const root = await project({ rowMatch: true });
  try {
    const profilePath = path.join(root, ".data-editor", "automation-profile.json");
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    for (const rule of profile.rules) {
      rule.execution = { kind: "proposal" };
      for (const target of rule.targets) delete target.textArtifactId;
    }
    await writeFile(profilePath, JSON.stringify(profile, null, 2));

    assert.deepEqual(await migrateLegacyEntryActionPolicy(root), {
      status: "already_migrated",
      droppedRowMatchActions: ["design"],
    });
    assert.deepEqual(JSON.parse(await readFile(profilePath, "utf8")), profile);
    await assert.rejects(() => readFile(path.join(root, ".data-editor", "entry-action-policy.json"), "utf8"), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
