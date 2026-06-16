import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultRelationConfigs, emptyViewConfig, loadViewConfig, saveViewConfig } from "../src/view-config.mjs";
import { currentRelationsVersion, defaultBacklinkConfigs, defaultPrimaryKeys } from "../src/relation-defaults.mjs";

test("emptyViewConfig includes project relations", () => {
  assert.deepEqual(emptyViewConfig(), {
    fields: {},
    titleFields: {},
    primaryKeys: defaultPrimaryKeys(),
    backlinks: defaultBacklinkConfigs(),
    relations: defaultRelationConfigs(),
    relationsVersion: currentRelationsVersion,
  });
});

test("loadViewConfig returns empty config when file is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-config-"));
  try {
    assert.deepEqual(await loadViewConfig(root), emptyViewConfig());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saveViewConfig preserves field type and select options", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-config-"));
  try {
    const result = await saveViewConfig(root, {
      fields: {
        "data/e2e_select.json:$:category": {
          type: "Select",
          selectOptions: {
            attack: { label: "attack", color: null },
            spell: { label: "spell", color: null },
          },
          multiSelectOptions: {},
        },
      },
    });
    assert.equal(result.path, ".data-editor/view-config.json");
    const stored = JSON.parse(await readFile(path.join(root, result.path), "utf8"));
    assert.deepEqual(stored, {
      fields: {
        "data/e2e_select.json:$:category": {
          type: "Select",
          selectOptions: {
            attack: { label: "attack", color: null },
            spell: { label: "spell", color: null },
          },
          multiSelectOptions: {},
        },
      },
      titleFields: {},
      primaryKeys: defaultPrimaryKeys(),
      backlinks: defaultBacklinkConfigs(),
      relations: defaultRelationConfigs(),
      relationsVersion: currentRelationsVersion,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewConfig falls back to legacy project config path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-config-"));
  try {
    const legacyPath = path.join(root, "tools", "data-editor", "view-config.json");
    await mkdir(path.dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({
      fields: {},
      primaryKeys: {
        "data/equipment_bases.json:equipment_bases": "equipment_base_id",
      },
      backlinks: {},
      relations: {},
      relationsVersion: currentRelationsVersion,
    }), "utf8");
    const loaded = await loadViewConfig(root);
    assert.equal(loaded.primaryKeys["data/equipment_bases.json:equipment_bases"], "equipment_base_id");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewConfig drops unsupported field type and normalizes malformed select options", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-config-"));
  try {
    await saveViewConfig(root, {
      fields: {
        "data/e2e_select.json:$:category": {
          type: "Relation",
          selectOptions: {
            attack: { label: "", color: null },
            spell: null,
          },
          multiSelectOptions: {},
        },
      },
    });
    const loaded = await loadViewConfig(root);
    assert.deepEqual(loaded, {
      fields: {
        "data/e2e_select.json:$:category": {
          type: undefined,
          selectOptions: {
            attack: { label: "attack", color: null },
          },
          multiSelectOptions: {},
        },
      },
      titleFields: {},
      primaryKeys: defaultPrimaryKeys(),
      backlinks: defaultBacklinkConfigs(),
      relations: defaultRelationConfigs(),
      relationsVersion: currentRelationsVersion,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewConfig preserves missing field type instead of forcing Text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-config-"));
  try {
    const target = path.join(root, ".data-editor", "view-config.json");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({
      fields: {
        "data/prototypes.json:$:match_build_tags": {
          selectOptions: {},
          multiSelectOptions: {
            attack: { label: "attack", color: "red" },
            ailment: { label: "ailment", color: "brown" },
          },
        },
      },
      primaryKeys: defaultPrimaryKeys(),
      backlinks: defaultBacklinkConfigs(),
      relations: defaultRelationConfigs(),
      relationsVersion: currentRelationsVersion,
    }), "utf8");

    const loaded = await loadViewConfig(root);
    assert.equal(loaded.fields["data/prototypes.json:$:match_build_tags"].type, undefined);
    assert.deepEqual(loaded.fields["data/prototypes.json:$:match_build_tags"].multiSelectOptions, {
      attack: { label: "attack", color: "red" },
      ailment: { label: "ailment", color: "brown" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewConfig filters invalid relation configs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-config-"));
  try {
    await saveViewConfig(root, {
      fields: {},
      primaryKeys: defaultPrimaryKeys(),
      backlinks: defaultBacklinkConfigs(),
      relationsVersion: currentRelationsVersion,
      relations: {
        "data/enemies.json:enemies:skills": {
          targetFile: "data/skills.json",
          targetCollection: "skills",
          targetKey: "skill_id",
          mode: "multi",
          titleFields: ["skill_name", "name", "*_name"],
          allowMissing: false,
        },
        bad: {
          targetFile: "",
          targetCollection: "skills",
          targetKey: "skill_id",
          mode: "wrong",
        },
        "data/enemies.json:enemies:bad_mode": {
          targetFile: "data/skills.json",
          targetCollection: "skills",
          targetKey: "skill_id",
          mode: "wrong",
        },
      },
    });

    const loaded = await loadViewConfig(root);
    assert.deepEqual(loaded, {
      fields: {},
      titleFields: {},
      primaryKeys: defaultPrimaryKeys(),
      backlinks: {
        "data/skills.json:skills:back_skills": {
          sourceRelation: "data/enemies.json:enemies:skills",
          displayMode: "list",
        },
      },
      relationsVersion: currentRelationsVersion,
      relations: {
        "data/enemies.json:enemies:skills": {
          targetFile: "data/skills.json",
          targetCollection: "skills",
          targetKey: "skill_id",
          mode: "multi",
          titleFields: ["skill_name", "name", "*_name"],
          allowMissing: false,
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("default relation migration runs once", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-config-"));
  try {
    const migrated = await saveViewConfig(root, { fields: {}, relations: {} });
    const stored = JSON.parse(await readFile(path.join(root, migrated.path), "utf8"));
    assert.deepEqual(stored.relations, defaultRelationConfigs());
    assert.equal(stored.relationsVersion, currentRelationsVersion);

    await saveViewConfig(root, { fields: {}, relations: {}, relationsVersion: currentRelationsVersion - 1 });
    const loaded = await loadViewConfig(root);
    assert.deepEqual(loaded, {
      fields: {},
      titleFields: {},
      primaryKeys: defaultPrimaryKeys(),
      backlinks: defaultBacklinkConfigs(),
      relations: defaultRelationConfigs(),
      relationsVersion: currentRelationsVersion,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewConfig filters primary key self relations while keeping valid relations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-config-"));
  try {
    await saveViewConfig(root, {
      fields: {},
      titleFields: {
        "data/keywords.json:$": "name",
      },
      primaryKeys: {
        "data/keywords.json:$": "keyword_id",
        "data/skills.json:skills": "skill_id",
      },
      backlinks: {},
      relationsVersion: currentRelationsVersion,
      relations: {
        "data/keywords.json:$:keyword_id": {
          targetFile: "data/keywords.json",
          targetCollection: "$",
          targetKey: "keyword_id",
          mode: "single",
          titleFields: ["name", "keyword_id"],
          allowMissing: false,
        },
        "data/skills.json:skills:skill_id": {
          targetFile: "data/skills.json",
          targetCollection: "skills",
          targetKey: "skill_id",
          mode: "single",
          titleFields: ["skill_name"],
          allowMissing: false,
        },
        "data/status_effects.json:$:keyword_id": {
          targetFile: "data/keywords.json",
          targetCollection: "$",
          targetKey: "keyword_id",
          mode: "single",
          titleFields: ["name", "keyword_id"],
          allowMissing: false,
        },
      },
    });

    const loaded = await loadViewConfig(root);
    assert.deepEqual(loaded.titleFields, {
      "data/keywords.json:$": "name",
    });
    assert.deepEqual(loaded.relations, {
      "data/status_effects.json:$:keyword_id": {
        targetFile: "data/keywords.json",
        targetCollection: "$",
        targetKey: "keyword_id",
        mode: "single",
        titleFields: ["name", "keyword_id"],
        allowMissing: false,
      },
    });
    assert.deepEqual(loaded.backlinks, {
      "data/keywords.json:$:back_keyword_id": {
        sourceRelation: "data/status_effects.json:$:keyword_id",
        displayMode: "list",
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewConfig prunes stale backlinks and persists active relation backlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-config-"));
  try {
    await saveViewConfig(root, {
      fields: {},
      primaryKeys: {
        "data/keywords.json:$": "keyword_id",
      },
      backlinks: {
        "data/keywords.json:$:back_keyword_id": {
          sourceRelation: "data/status_effects.json:$:keyword_id",
          displayMode: "list",
        },
        "data/keywords.json:$:back_stale": {
          sourceRelation: "data/missing.json:$:keyword_id",
          displayMode: "list",
        },
      },
      relationsVersion: currentRelationsVersion,
      relations: {
        "data/status_effects.json:$:keyword_id": {
          targetFile: "data/keywords.json",
          targetCollection: "$",
          targetKey: "keyword_id",
          mode: "single",
          titleFields: ["name", "keyword_id"],
          allowMissing: false,
        },
      },
    });

    const loaded = await loadViewConfig(root);
    assert.deepEqual(loaded.backlinks, {
      "data/keywords.json:$:back_keyword_id": {
        sourceRelation: "data/status_effects.json:$:keyword_id",
        displayMode: "list",
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewConfig preserves configured collection title fields and drops invalid values", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-config-"));
  try {
    const target = path.join(root, ".data-editor", "view-config.json");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({
      fields: {},
      titleFields: {
        "data/e2e_select.json:$": "category",
        "data/empty.json:$": "",
        "": "name",
      },
      primaryKeys: defaultPrimaryKeys(),
      backlinks: defaultBacklinkConfigs(),
      relations: defaultRelationConfigs(),
      relationsVersion: currentRelationsVersion,
    }), "utf8");

    const loaded = await loadViewConfig(root);
    assert.deepEqual(loaded.titleFields, {
      "data/e2e_select.json:$": "category",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
