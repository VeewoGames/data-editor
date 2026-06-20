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
      detailPanelWidth: 455.6,
      detailDocumentPanelOpen: true,
      detailDocumentPanelWidth: 366.4,
      fileOrder: ["data/skills.json", "data/runes.json", "data/skills.json", " "],
      sidebarTree: {
        childOrderByParent: {
          "source:data": ["folder:data/items", "folder:data/actors", "folder:data/items"],
          " ": ["file:ignored"],
        },
        expandedNodeIds: ["source:data", "folder:data/items", "source:data"],
      },
      lastActiveViews: {
        "data/runes.json::$": " view-1 ",
        "data/empty.json::$": "",
        "data/bad.json::$": 1,
      },
      viewDrafts: {
        " data/runes.json::$ ": {
          " view-1 ": {
            id: "ignored-id",
            name: "Ignored",
            type: "table",
            query: " fire ",
            filters: {
              op: "or",
              rules: [
                { id: " rule-1 ", field: " element ", operator: "contains", value: "fire" },
                { id: "bad", field: "element", operator: "bad_operator" },
              ],
            },
            hidden: [" description ", "description"],
            order: ["rune_name", " description "],
          },
          empty: {
            id: "ignored-empty",
            name: "Ignored Empty",
            type: "table",
          },
        },
        "data/empty.json::$": {
          empty: {
            id: "ignored-empty",
          },
        },
      },
      viewOrderDrafts: {
        " data/runes.json::$ ": [" view-2 ", "view-1", "view-2", " "],
        "data/empty.json::$": [" "],
      },
      appearance: {
        activeThemeId: "dark",
        baseFontSize: 16,
        themeOverrides: {
          light: {
            accent: " #7c3aed ",
            empty: " ",
          },
          dark: ["bad"],
        },
      },
      viewLayouts: {
        "data/runes.json::$": {
          "view-1": {
            hidden: ["description"],
            wrapped: ["name"],
            order: ["name", "rune_id"],
            detailOrder: ["rune_name", "description", "description_zh"],
            widths: { description: 181.2 },
          },
        },
      },
    });
    assert.equal(result.path, ".data-editor/view-configs/lans.json");
    const stored = JSON.parse(await readFile(path.join(root, result.path), "utf8"));
    assert.deepEqual(stored, {
      sidebarWidth: 312,
      detailPanelWidth: 456,
      detailDocumentPanelOpen: true,
      detailDocumentPanelWidth: 366,
      fileOrder: ["data/skills.json", "data/runes.json"],
      sidebarTree: {
        childOrderByParent: {
          "source:data": ["folder:data/items", "folder:data/actors"],
        },
        expandedNodeIds: ["source:data", "folder:data/items"],
      },
      lastActiveViews: {
        "data/runes.json::$": "view-1",
      },
      viewDrafts: {
        "data/runes.json::$": {
          "view-1": {
            query: "fire",
            filters: {
              topLevelRules: [
                { kind: "rule", id: "rule-1", field: "element", operator: "contains", value: "fire" },
              ],
              advancedRoot: null,
            },
            hidden: ["description"],
            order: ["rune_name", "description"],
          },
        },
      },
      viewOrderDrafts: {
        "data/runes.json::$": ["view-2", "view-1"],
      },
      structureDrafts: {},
      appearance: {
        activeThemeId: "dark",
        baseFontSize: 16,
        themeOverrides: {
          light: {
            accent: "#7c3aed",
          },
        },
      },
      viewLayouts: {
        "data/runes.json::$": {
          "view-1": {
            hidden: ["description"],
            wrapped: ["name"],
            order: ["name", "rune_id"],
            detailOrder: ["rune_name", "description", "description_zh"],
            widths: { description: 181 },
          },
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewProfile normalizes appearance and drops invalid values", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    const profileDir = path.join(root, ".data-editor", "view-configs");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, "lans.json"), JSON.stringify({
      appearance: {
        activeThemeId: "neon",
        baseFontSize: 18,
        themeOverrides: {
          light: {
            accent: " #7c3aed ",
            invalid: "",
          },
          dark: {
            surface: " #111827 ",
          },
        },
      },
    }, null, 2));
    const profile = await loadViewProfile(root, "lans");
    assert.deepEqual(profile, {
      ...emptyViewProfile(),
      appearance: {
        activeThemeId: "light",
        baseFontSize: 14,
        themeOverrides: {
          light: {
            accent: "#7c3aed",
          },
          dark: {
            surface: "#111827",
          },
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewProfile preserves supported fractional base font size", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    const profileDir = path.join(root, ".data-editor", "view-configs");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, "lans.json"), JSON.stringify({
      appearance: {
        activeThemeId: "dark",
        baseFontSize: 14.5,
      },
    }, null, 2));
    const profile = await loadViewProfile(root, "lans");
    assert.deepEqual(profile, {
      ...emptyViewProfile(),
      appearance: {
        activeThemeId: "dark",
        baseFontSize: 14.5,
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewProfile omits appearance when no valid appearance values remain", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    const profileDir = path.join(root, ".data-editor", "view-configs");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, "lans.json"), JSON.stringify({
      appearance: {
        activeThemeId: "solarized",
        baseFontSize: 13,
        themeOverrides: {
          light: {
            accent: "",
          },
        },
      },
    }, null, 2));
    const profile = await loadViewProfile(root, "lans");
    assert.deepEqual(profile, emptyViewProfile());
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
      detailPanelWidth: 470,
      detailDocumentPanelOpen: false,
      detailDocumentPanelWidth: 380,
      fileOrder: ["data/status_effects.json", "data/runes.json", "data/status_effects.json"],
      lastActiveViews: {
        "data/status_effects.json:$": "all",
      },
      viewLayouts: {
        "data/status_effects.json:$": {
          all: {
            hidden: [],
            wrapped: [],
            order: ["effects", "effects", "dot", "dot", "buildup"],
            detailOrder: ["effect_name", "effect_name", "description"],
            widths: {},
          },
        },
      },
    }, null, 2));
    const profile = await loadViewProfile(root, "lans");
    assert.equal(profile.detailPanelWidth, 470);
    assert.equal(profile.detailDocumentPanelOpen, false);
    assert.equal(profile.detailDocumentPanelWidth, 380);
    assert.deepEqual(profile.fileOrder, ["data/status_effects.json", "data/runes.json"]);
    assert.deepEqual(profile.viewLayouts["data/status_effects.json:$"].all.order, ["effects", "dot", "buildup"]);
    assert.deepEqual(profile.viewLayouts["data/status_effects.json:$"].all.detailOrder, ["effect_name", "description"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewProfile normalizes document panel preferences", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    const profileDir = path.join(root, ".data-editor", "view-configs");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, "lans.json"), JSON.stringify({
      detailDocumentPanelOpen: true,
      detailDocumentPanelWidth: 402.8,
    }, null, 2));

    const profile = await loadViewProfile(root, "lans");
    assert.equal(profile.detailDocumentPanelOpen, true);
    assert.equal(profile.detailDocumentPanelWidth, 403);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewProfile keeps sidebarTree as a top-level personal preference", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    const profileDir = path.join(root, ".data-editor", "view-configs");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, "lans.json"), JSON.stringify({
      fileOrder: ["data/legacy.json"],
      sidebarTree: {
        childOrderByParent: { "source:data": ["folder:data/items", "folder:data/actors"] },
        expandedNodeIds: ["source:data", "folder:data/items"],
      },
    }, null, 2));

    const profile = await loadViewProfile(root, "lans");

    assert.deepEqual(profile.fileOrder, ["data/legacy.json"]);
    assert.deepEqual(profile.sidebarTree, {
      childOrderByParent: { "source:data": ["folder:data/items", "folder:data/actors"] },
      expandedNodeIds: ["source:data", "folder:data/items"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadViewProfile migrates legacy collections into the last active view layout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-view-profile-"));
  try {
    const profileDir = path.join(root, ".data-editor", "view-configs");
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, "lans.json"), JSON.stringify({
      lastActiveViews: {
        "data/runes.json:$": "damage",
      },
      collections: {
        "data/runes.json:$": {
          hidden: ["debug"],
          wrapped: ["description"],
          order: ["rune_name", "description"],
          detailOrder: ["description"],
          widths: { description: 220 },
        },
      },
    }, null, 2));
    const profile = await loadViewProfile(root, "lans");
    assert.deepEqual(profile.viewLayouts["data/runes.json:$"].damage, {
      hidden: ["debug"],
      wrapped: ["description"],
      order: ["rune_name", "description"],
      detailOrder: ["description"],
      widths: { description: 220 },
    });
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
