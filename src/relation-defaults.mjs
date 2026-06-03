import { syncBacklinksWithRelations } from "./model/field-role.mjs";

export const currentRelationsVersion = 3;
export const defaultTitleFields = ["name", "*_name", "title", "display_name"];

export function defaultPrimaryKeys() {
  return {
    "data/keywords.json:$": "keyword_id",
    "data/status_effects.json:$": "effect_id",
    "data/skills.json:skills": "skill_id",
    "data/enemies.json:enemies": "enemy_id",
    "data/runes.json:$": "rune_id",
  };
}

export function defaultBacklinkConfigs() {
  return syncBacklinksWithRelations(defaultRelationConfigs(), {});
}

export function defaultRelationConfigs() {
  return {
    "data/enemies.json:enemies:skills": {
      targetFile: "data/skills.json",
      targetCollection: "skills",
      targetKey: "skill_id",
      mode: "multi",
      titleFields: ["skill_name", "name", "*_name"],
      allowMissing: false,
    },
    "data/enemies.json:enemies:phase_skills": {
      targetFile: "data/skills.json",
      targetCollection: "skills",
      targetKey: "skill_id",
      mode: "multi",
      titleFields: ["skill_name", "name", "*_name"],
      allowMissing: false,
    },
    "data/status_effects.json:$:keyword_id": {
      targetFile: "data/keywords.json",
      targetCollection: "$",
      targetKey: "keyword_id",
      mode: "single",
      titleFields: ["name", "*_name", "keyword_id"],
      allowMissing: false,
    },
  };
}
