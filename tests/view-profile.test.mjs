import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyViewProfile, listViewProfiles, loadViewProfile, normalizeProfileName, saveViewProfile } from "../src/view-profile.mjs";

test("listViewProfiles returns sorted profile names", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    const profileDir = path.join(root, ".data-editor", "view-configs");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, "zeta.json"), "{}");
    await writeFile(path.join(profileDir, "alpha.json"), "{}");
    await writeFile(path.join(profileDir, "skip.txt"), "");
    assert.deepEqual(await listViewProfiles(root), ["alpha", "zeta"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewProfile returns empty profile when file is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    assert.deepEqual(await loadViewProfile(root, "lans"), emptyViewProfile());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saveViewProfile writes normalized profile file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    const result = await saveViewProfile(root, "lans", {
      sidebarWidth: 311.8,
      collections: {
        "data/runes.json::$": {
          hidden: ["description"],
          wrapped: ["name"],
          order: ["name", "rune_id"],
          detailOrder: ["rune_name", "description", "description_zh"],
          widths: { description: 181.2 },
        },
      },
    });
    assert.equal(result.path, ".data-editor/view-configs/lans.json");
    const stored = JSON.parse(await readFile(path.join(root, result.path), "utf8"));
    assert.deepEqual(stored, {
      sidebarWidth: 312,
      collections: {
        "data/runes.json::$": {
          hidden: ["description"],
          wrapped: ["name"],
          order: ["name", "rune_id"],
          detailOrder: ["rune_name", "description", "description_zh"],
          widths: { description: 181 },
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normalizeProfileName rejects unsupported characters", () => {
  assert.equal(normalizeProfileName("lans"), "lans");
  assert.throws(() => normalizeProfileName("bad/name"), /unsupported characters/);
});

test("loadViewProfile de-duplicates repeated order fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    const profileDir = path.join(root, "tools", "data-editor", "view-configs");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, "lans.json"), JSON.stringify({
      sidebarWidth: null,
      collections: {
        "data/status_effects.json:$": {
          hidden: [],
          wrapped: [],
          order: ["effects", "effects", "dot", "dot", "buildup"],
          detailOrder: ["effect_name", "effect_name", "description"],
          widths: {},
        },
      },
    }, null, 2));
    const profile = await loadViewProfile(root, "lans");
    assert.deepEqual(profile.collections["data/status_effects.json:$"].order, ["effects", "dot", "buildup"]);
    assert.deepEqual(profile.collections["data/status_effects.json:$"].detailOrder, ["effect_name", "description"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listViewProfiles includes legacy profile names", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    const legacyProfileDir = path.join(root, "tools", "data-editor", "view-configs");
    await mkdir(legacyProfileDir, { recursive: true });
    await writeFile(path.join(legacyProfileDir, "legacy.json"), "{}");
    assert.deepEqual(await listViewProfiles(root), ["legacy"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
