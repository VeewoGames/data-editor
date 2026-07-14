import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  migrateTargetingViewLocalStorage,
  migrateTargetingViewValue,
} from "../src/view/targeting-view-field-migration.mjs";
import {
  migrateAllTargetingViewStorage,
  migrateTargetingViewStorage,
} from "../src/view/targeting-view-file-migration.mjs";
import { loadSharedViews } from "../src/shared-views.mjs";
import { loadViewProfile } from "../src/view-profile.mjs";
import { readLocalSharedViewDrafts, readLocalViewLayoutState } from "../src/view-state-storage.mjs";

test("browser targeting migration module has no Node runtime dependencies", async () => {
  const source = await readFile(new URL("../src/view/targeting-view-field-migration.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:(?:fs|path)/);
  assert.doesNotMatch(source, /project-context/);
});

test("view migration rewrites known legacy fields and preserves unavailable conditions for manual review", () => {
  const source = {
    filters: {
      topLevelRules: [
        { kind: "rule", id: "range", field: "range_type_show", operator: "is", value: "distance" },
        { kind: "rule", id: "unknown", field: "missing_field", operator: "contains", value: "x" },
      ],
    },
    sorts: [{ id: "distance", field: "range_value_show", direction: "asc" }],
    hidden: ["range_type_show", "missing_field"],
    widths: { range_value_show: 120, missing_field: 80 },
  };
  const result = migrateTargetingViewValue(source, {
    store: "shared_view",
    location: ".data-editor/shared-views.json",
    availableFields: ["@selection_type", "@selection_distance"],
  });
  assert.equal(result.value.filters.topLevelRules[0].field, "@selection_type");
  assert.equal(result.value.filters.topLevelRules[1].field, "missing_field");
  assert.equal(result.value.sorts[0].field, "@selection_distance");
  assert.deepEqual(result.value.hidden, ["@selection_type", "missing_field"]);
  assert.equal(result.value.widths["@selection_distance"], 120);
  assert.ok(result.report.manual.some((entry) => entry.oldField === "missing_field" && entry.reason === "unavailable_field_preserved"));
  assert.deepEqual(source.hidden, ["range_type_show", "missing_field"]);
});

test("storage migration covers shared views, project profiles, and profile home without applying by default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-targeting-view-migration-"));
  const profileHome = await mkdtemp(path.join(tmpdir(), "data-editor-targeting-profile-home-"));
  try {
    const sharedPath = path.join(root, ".data-editor", "shared-views.json");
    const projectProfile = path.join(root, ".data-editor", "view-configs", "project.json");
    const homeProfileDir = path.join(profileHome, "project-id");
    const homeProfile = path.join(homeProfileDir, "home.json");
    await mkdir(path.dirname(projectProfile), { recursive: true });
    await mkdir(homeProfileDir, { recursive: true });
    await writeFile(sharedPath, JSON.stringify({ collections: { skills: { items: [{ kind: "view", view: { id: "v", name: "V", filters: { topLevelRules: [{ field: "range_type_show" }] } } }] } } }));
    await writeFile(projectProfile, JSON.stringify({ viewDrafts: { skills: { v: { sorts: [{ field: "range_value_show" }] } } } }));
    await writeFile(homeProfile, JSON.stringify({ viewLayouts: { skills: { v: { hidden: ["range_type_show"] } } } }));

    const context = { projectRoot: root, projectId: "project-id", profileBaseDir: profileHome };
    const dryRun = await migrateTargetingViewStorage(context);
    assert.equal(dryRun.applied, false);
    assert.deepEqual(new Set(dryRun.report.migrated.map((entry) => entry.store)), new Set(["shared_view", "profile", "profile_home"]));
    assert.match(await readFile(sharedPath, "utf8"), /range_type_show/);

    const applied = await migrateTargetingViewStorage(context, { apply: true });
    assert.equal(applied.applied, true);
    assert.doesNotMatch(await readFile(sharedPath, "utf8"), /range_type_show/);
    assert.doesNotMatch(await readFile(projectProfile, "utf8"), /range_value_show/);
    assert.doesNotMatch(await readFile(homeProfile, "utf8"), /range_type_show/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(profileHome, { recursive: true, force: true });
  }
});

test("local storage migration covers drafts and layout keys while reporting key conflicts", () => {
  const storage = createStorage({
    "data-editor:shared-view-drafts": JSON.stringify({ viewDrafts: { skills: { v: { filters: { topLevelRules: [{ field: "range_type_show" }] } } } } }),
    "data-editor:data/content/skills.json:skills:v:range_value_show:width": "160",
    "data-editor:data/content/skills.json:skills:v:__order": "skill_id,range_type_show",
  });
  const result = migrateTargetingViewLocalStorage(storage, { apply: true });
  assert.equal(result.changed, true);
  assert.match(storage.getItem("data-editor:shared-view-drafts"), /@selection_type/);
  assert.equal(storage.getItem("data-editor:data/content/skills.json:skills:v:@selection_distance:width"), "160");
  assert.equal(storage.getItem("data-editor:data/content/skills.json:skills:v:__order"), "skill_id,@selection_type");
});

test("field record conflicts are deterministic, lossless, and block apply", () => {
	for (const widths of [
		{ range_value_show: 120, "@selection_distance": 180 },
		{ "@selection_distance": 180, range_value_show: 120 },
	]) {
		const result = migrateTargetingViewValue({ widths }, { store: "shared_view", location: "fixture" });
		assert.deepEqual(result.value.widths, widths);
		assert.equal(result.report.manual.filter((entry) => entry.reason === "field_conflict").length, 1);
	}
});

test("field list conflicts are deterministic and preserve the whole container", () => {
  for (const key of ["hidden", "wrapped", "order", "detailOrder"]) {
    for (const fields of [
      ["range_type_show", "@selection_type", "skill_id"],
      ["@selection_type", "range_type_show", "skill_id"],
    ]) {
      const result = migrateTargetingViewValue({ [key]: fields }, { store: "shared_view", location: "fixture" });
      assert.deepEqual(result.value[key], fields);
      assert.equal(result.changed, false);
      assert.equal(result.report.manual.filter((entry) => entry.reason === "field_conflict").length, 1);
    }
  }
});

test("sort and filter rule conflicts preserve object arrays in both field orders", () => {
  for (const container of ["sorts", "filters"]) {
    for (const property of ["field", "fieldName"]) {
      for (const fields of [
        ["range_value_show", "@selection_distance"],
        ["@selection_distance", "range_value_show"],
      ]) {
        const rules = fields.map((field, index) => ({ id: `rule-${index}`, [property]: field, direction: "asc" }));
        const source = container === "sorts" ? { sorts: rules } : { filters: { topLevelRules: rules } };
        const result = migrateTargetingViewValue(source, { store: "shared_view", location: "fixture" });
        const actual = container === "sorts" ? result.value.sorts : result.value.filters.topLevelRules;
        assert.deepEqual(actual, rules);
        assert.equal(result.changed, false);
        assert.equal(result.report.manual.filter((entry) => entry.reason === "field_conflict").length, 1);
      }
    }
  }
});

test("local storage field lists preserve conflicts in both orders and reject apply", () => {
  for (const suffix of ["__order", "__detail-order"]) {
    for (const fields of [
      ["range_type_show", "@selection_type", "skill_id"],
      ["@selection_type", "range_type_show", "skill_id"],
    ]) {
      const key = `data-editor:data/content/skills.json:skills:v:${suffix}`;
      const original = fields.join(",");
      const storage = createStorage({ [key]: original });
      const result = migrateTargetingViewLocalStorage(storage, { apply: true });
      assert.equal(result.applied, false);
      assert.equal(result.changed, false);
      assert.equal(storage.getItem(key), original);
      assert.equal(result.report.manual.filter((entry) => entry.reason === "field_conflict").length, 1);
    }
  }
});

test("unified migration entry reports file and browser stores and blocks conflicted apply", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-targeting-unified-"));
  try {
    const sharedPath = path.join(root, ".data-editor", "shared-views.json");
    await mkdir(path.dirname(sharedPath), { recursive: true });
    await writeFile(sharedPath, JSON.stringify({ hidden: ["range_type_show"] }));
    const storage = createStorage({
      "data-editor:data/content/skills.json:skills:v:range_value_show:width": "160",
      "data-editor:data/content/skills.json:skills:v:@selection_distance:width": "180",
    });
    const result = await migrateAllTargetingViewStorage({ projectContext: root, localStorage: storage }, { apply: true });
    assert.equal(result.applied, false);
    assert.equal(result.applyAllowed, false);
    assert.deepEqual(new Set(result.report.migrated.map((entry) => entry.store)), new Set(["shared_view"]));
    assert.ok(result.report.manual.some((entry) => entry.store === "local_storage" && entry.reason === "key_conflict"));
    assert.match(await readFile(sharedPath, "utf8"), /range_type_show/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production file loaders migrate shared views and profile home idempotently", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-targeting-production-"));
  const profileHome = await mkdtemp(path.join(tmpdir(), "data-editor-targeting-production-home-"));
  try {
    const sharedPath = path.join(root, ".data-editor", "shared-views.json");
    const homeProfileDir = path.join(profileHome, "project-id");
    const homeProfile = path.join(homeProfileDir, "lans.json");
    await mkdir(path.dirname(sharedPath), { recursive: true });
    await mkdir(homeProfileDir, { recursive: true });
    await writeFile(sharedPath, JSON.stringify({
      collections: {
        "data/content/skills.json:skills": {
          defaultViewId: "all",
          items: [{ kind: "view", view: { id: "all", name: "All", hidden: ["range_type_show"] } }],
        },
      },
    }));
    await writeFile(homeProfile, JSON.stringify({
      viewLayouts: {
        "data/content/skills.json:skills": { all: { order: ["skill_id", "range_value_show"] } },
      },
    }));
    const context = { projectRoot: root, projectId: "project-id", profileBaseDir: profileHome };

    const shared = await loadSharedViews(context);
    const firstSharedWrite = await readFile(sharedPath, "utf8");
    const profile = await loadViewProfile(context, "lans");
    const firstProfileWrite = await readFile(homeProfile, "utf8");
    await loadSharedViews(context);
    await loadViewProfile(context, "lans");

    assert.deepEqual(shared.collections["data/content/skills.json:skills"].items[0].view.hidden, ["@selection_type"]);
    assert.deepEqual(profile.viewLayouts["data/content/skills.json:skills"].all.order, ["skill_id", "@selection_distance"]);
    assert.equal(await readFile(sharedPath, "utf8"), firstSharedWrite);
    assert.equal(await readFile(homeProfile, "utf8"), firstProfileWrite);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(profileHome, { recursive: true, force: true });
  }
});

test("production file loaders block every file write when any profile collides", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-targeting-production-conflict-"));
  try {
    const sharedPath = path.join(root, ".data-editor", "shared-views.json");
    const profilePath = path.join(root, ".data-editor", "view-configs", "lans.json");
    await mkdir(path.dirname(profilePath), { recursive: true });
    await writeFile(sharedPath, JSON.stringify({ hidden: ["range_type_show"] }));
    await writeFile(profilePath, JSON.stringify({ order: ["range_value_show", "@selection_distance"] }));
    const beforeShared = await readFile(sharedPath, "utf8");
    const beforeProfile = await readFile(profilePath, "utf8");

    await loadSharedViews(root);

    assert.equal(await readFile(sharedPath, "utf8"), beforeShared);
    assert.equal(await readFile(profilePath, "utf8"), beforeProfile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production localStorage readers migrate drafts and layouts idempotently", () => {
  const draftKey = "data-editor:shared-view-drafts";
  const widthKey = "data-editor:data/content/skills.json:skills:all:range_value_show:width";
  const storage = createStorage({
    [draftKey]: JSON.stringify({
      viewDrafts: {
        "data/content/skills.json:skills": { all: { hidden: ["range_type_show"] } },
      },
    }),
    [widthKey]: "160",
  });

  const drafts = readLocalSharedViewDrafts(storage);
  const layout = readLocalViewLayoutState({
    path: "data/content/skills.json",
    collectionPath: "skills",
    viewId: "all",
    localStorage: storage,
  });
  const firstSnapshot = snapshotStorage(storage);
  readLocalSharedViewDrafts(storage);
  readLocalViewLayoutState({
    path: "data/content/skills.json",
    collectionPath: "skills",
    viewId: "all",
    localStorage: storage,
  });

  assert.deepEqual(drafts.viewDrafts["data/content/skills.json:skills"].all.hidden, ["@selection_type"]);
  assert.equal(layout.widths["@selection_distance"], 160);
  assert.deepEqual(snapshotStorage(storage), firstSnapshot);
});

test("production localStorage readers preserve the whole store on collision", () => {
  const storage = createStorage({
    "data-editor:shared-view-drafts": JSON.stringify({
      viewDrafts: {
        "data/content/skills.json:skills": { all: { hidden: ["range_type_show"] } },
      },
    }),
    "data-editor:data/content/skills.json:skills:all:range_value_show:width": "160",
    "data-editor:data/content/skills.json:skills:all:@selection_distance:width": "180",
  });
  const before = snapshotStorage(storage);

  readLocalSharedViewDrafts(storage);

  assert.deepEqual(snapshotStorage(storage), before);
});

function createStorage(initial) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function snapshotStorage(storage) {
  return Object.fromEntries(
    Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter(Boolean)
      .sort()
      .map((key) => [key, storage.getItem(key)]),
  );
}
