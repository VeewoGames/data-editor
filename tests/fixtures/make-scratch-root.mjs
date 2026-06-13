import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(fixtureDir, "../..");
const fixtureProjectRoot = path.resolve(process.env.DATA_EDITOR_FIXTURE_PROJECT_ROOT ?? path.join(toolRoot, "..", "Nocturnel"));
const scratchRoot = path.join(toolRoot, "tests", ".scratch");
const scratchData = path.join(scratchRoot, "data");
const scratchToolConfigDir = path.join(scratchRoot, "tools", "data-editor");

await rm(scratchRoot, { recursive: true, force: true });
await mkdir(scratchData, { recursive: true });
await mkdir(scratchToolConfigDir, { recursive: true });
await writeFile(path.join(scratchToolConfigDir, "view-config.json"), JSON.stringify({ fields: {} }, null, 2));

for (const fileName of ["runes.json", "keywords.json", "skills.json", "enemies.json", "traits.json", "affixes.json", "status_effects.json"]) {
  await cp(path.join(fixtureProjectRoot, "data", fileName), path.join(scratchData, fileName));
}

await writeFile(path.join(scratchData, "e2e_mixed.json"), JSON.stringify([
  {
    id: "mixed_1",
    name: "Mixed fallback",
    mixed: [1, { nested: true }]
  }
], null, 2));

await writeFile(path.join(scratchData, "e2e_wrap_rows.json"), JSON.stringify([
  {
    id: "wrap_1",
    name: "Short row",
    description: "短文本"
  },
  {
    id: "wrap_2",
    name: "Long row",
    description: "这是一条用于端到端测试的长文本内容，用来验证开启自动换行后只有真正发生换行的记录才会增高，而不是让整张表的所有行统一变高。"
  },
  {
    id: "wrap_3",
    name: "Medium row",
    description: "中等长度文本，用于形成稳定的高度对比。"
  }
], null, 2));

await writeFile(path.join(scratchData, "e2e_nested_panel.json"), JSON.stringify([
  {
    id: "nested_1",
    name: "Nested Panel",
    effects: [
      {
        category: "trigger_re",
        effect_type: "trigger_on_event",
        params: {
          energy_percent: 100,
          target: "self"
        },
        timing: "prepare"
      },
      {
        category: "counter_c",
        effect_type: "counter_count",
        params: {
          counter_id: "frost_spike",
          amount: 2
        },
        timing: "execute"
      }
    ]
  }
], null, 2));

await writeFile(path.join(scratchData, "e2e_multiselect.json"), JSON.stringify([
  {
    id: "multi_1",
    name: "Multi Select",
    features: ["minion"]
  },
  {
    id: "multi_2",
    name: "Option Source",
    features: ["attack", "spell", "empower", "avatar", "special"]
  }
], null, 2));

await writeFile(path.join(scratchData, "e2e_relation.json"), JSON.stringify([
  {
    id: "relation_1",
    name: "Relation Row",
    skill_id: "skill_slash",
    keywords: ["immobilised"]
  },
  {
    id: "relation_2",
    name: "Missing Relation",
    skill_id: "missing_skill",
    keywords: ["immobilised", "missing_keyword"]
  }
], null, 2));

await writeFile(path.join(scratchData, "e2e_primary_key_sync_target.json"), JSON.stringify([
  {
    target_id: "focus",
    name: "Focus Target"
  }
], null, 2));

await writeFile(path.join(scratchData, "e2e_primary_key_sync_source.json"), JSON.stringify([
  {
    id: "sync_1",
    name: "Sync Source",
    target_id: "focus"
  }
], null, 2));

await writeFile(path.join(scratchData, "e2e_select.json"), JSON.stringify([
  {
    id: "select_1",
    name: "Select One",
    category: "attack"
  },
  {
    id: "select_2",
    name: "Select Two",
    category: "spell"
  },
  {
    id: "select_3",
    name: "Select Three",
    category: ""
  }
], null, 2));

await writeFile(path.join(scratchData, "e2e_select_long.json"), JSON.stringify([
  {
    id: "select_long_1",
    name: "Long Select",
    category: "one_handed_weapon_with_extended_socket_requirement"
  }
], null, 2));

await writeFile(path.join(scratchData, "e2e_checkbox.json"), JSON.stringify([
  {
    id: "checkbox_1",
    name: "Checkbox One",
    enabled: true
  },
  {
    id: "checkbox_2",
    name: "Checkbox Two",
    enabled: false
  }
], null, 2));

await writeFile(path.join(scratchData, "e2e_primary_key_candidates.json"), JSON.stringify({
  alpha: [
    { alpha_id: "alpha_focus", id: "1", name: "Alpha Focus" },
    { alpha_id: "alpha_poisoned", id: "2", name: "Alpha Poisoned" }
  ],
  beta: [
    { name: "Beta One", description: "No id candidate here" },
    { name: "Beta Two", description: "Still no id candidate" }
  ]
}, null, 2));

console.log(`Scratch root ready: ${scratchRoot}`);
