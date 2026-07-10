import { buildNodeLookupKey, cloneSchemaValue, createDiscriminatedObjectNodeSchema, createObjectNodeSchema } from "./node-schema.mjs";

function textField(fieldName, overrides = {}) {
  return { fieldName, displayType: "Text", defaultValue: "", ...overrides };
}

function multilineField(fieldName, overrides = {}) {
  return textField(fieldName, { multiline: true, ...overrides });
}

function numberField(fieldName, overrides = {}) {
  return { fieldName, displayType: "Number", defaultValue: null, ...overrides };
}

function checkboxField(fieldName, overrides = {}) {
  return { fieldName, displayType: "Checkbox", defaultValue: false, ...overrides };
}

function objectField(fieldName, defaultValue = {}, overrides = {}) {
  return { fieldName, nestedNodeKind: "object", defaultValue: cloneSchemaValue(defaultValue), ...overrides };
}

function arrayField(fieldName, defaultValue = [], overrides = {}) {
  return { fieldName, nestedNodeKind: "array", defaultValue: cloneSchemaValue(defaultValue), ...overrides };
}

function createSchema(title, fields, extraDefaults = {}, options = {}) {
  const defaultValue = {
    ...Object.fromEntries(fields.map((field) => [field.fieldName, cloneSchemaValue(field.defaultValue)])),
    ...cloneSchemaValue(extraDefaults),
  };
  return createObjectNodeSchema({
    title,
    fields,
    defaultValue,
    allowUnknownFields: options.allowUnknownFields ?? false,
    presentation: options.presentation ?? null,
  });
}

const classesStartingEquipmentsSchema = createSchema("starting_equipments", [
  textField("main_hand", { placeholder: "未装备主手" }),
  textField("off_hand", { placeholder: "未装备副手" }),
  textField("helm", { placeholder: "未装备头盔" }),
  textField("chest", { placeholder: "未装备胸甲" }),
  textField("gloves", { placeholder: "未装备手套" }),
  textField("boots", { placeholder: "未装备靴子" }),
  textField("ring", { placeholder: "未装备戒指" }),
  textField("amulet", { placeholder: "未装备项链" }),
], {}, {
  presentation: {
    sections: [
      { id: "weapons", title: "武器位", fieldNames: ["main_hand", "off_hand"] },
      { id: "armor", title: "防具位", fieldNames: ["helm", "chest", "gloves", "boots"] },
      { id: "accessories", title: "饰品位", fieldNames: ["ring", "amulet"] },
    ],
  },
});

const classesStartingStatsSchema = createSchema("starting_stats", [
  numberField("max_hp", { placeholder: "未设置生命" }),
  numberField("max_mana", { placeholder: "未设置法力" }),
  numberField("ap", { placeholder: "未设置 AP" }),
  numberField("move_range", { placeholder: "未设置移动" }),
  numberField("evasion", { placeholder: "未设置闪避" }),
], {}, {
  presentation: {
    sections: [
      { id: "core", title: "核心属性", fieldNames: ["max_hp", "max_mana", "ap"] },
      { id: "mobility", title: "机动属性", fieldNames: ["move_range", "evasion"] },
    ],
  },
});

const classesStatGrowthSchema = createSchema("stat_growth", [
  numberField("hp_per_level", { placeholder: "未设置成长" }),
  numberField("mana_per_level", { placeholder: "未设置成长" }),
], {}, {
  presentation: {
    sections: [
      { id: "growth", title: "成长属性", fieldNames: ["hp_per_level", "mana_per_level"] },
    ],
  },
});

const sharedValueModelSchema = createSchema("value_model", [
  textField("stat", { placeholder: "未设置属性" }),
  numberField("min", { placeholder: "未设置最小值" }),
  numberField("max", { placeholder: "未设置最大值" }),
  checkboxField("is_percent"),
  numberField("roll_precision", { placeholder: "未设置精度" }),
  textField("sign_mode", { placeholder: "未设置符号模式" }),
  textField("keyword_id", { placeholder: "未设置 keyword" }),
], {}, {
  presentation: {
    sections: [
      { id: "range", title: "数值范围", fieldNames: ["stat", "min", "max", "is_percent"] },
      { id: "rules", title: "修正规则", fieldNames: ["roll_precision", "sign_mode", "keyword_id"] },
    ],
    summaryFields: ["stat", "min", "max", "keyword_id"],
    titleField: "stat",
  },
});

const effectSpecValueModelSchema = createSchema("value_model", [
  numberField("min", { placeholder: "未设置最小值" }),
  numberField("max", { placeholder: "未设置最大值" }),
  checkboxField("is_percent"),
  numberField("roll_precision", { placeholder: "未设置精度" }),
], {}, {
  presentation: {
    sections: [
      { id: "range", title: "数值范围", fieldNames: ["min", "max", "is_percent"] },
      { id: "precision", title: "修正规则", fieldNames: ["roll_precision"] },
    ],
    summaryFields: ["min", "max", "roll_precision"],
  },
});

const emptyConstraintsSchema = createSchema("constraints", []);

const affixesEffectSpecSchema = createSchema("effect_spec", [
  textField("mechanic_scope", { placeholder: "未设置 scope" }),
  textField("timing", { placeholder: "未设置时机" }),
  textField("target", { placeholder: "未设置目标" }),
  textField("trigger", { placeholder: "未设置触发条件" }),
  numberField("threshold", { placeholder: "未设置阈值" }),
  objectField("value_model", effectSpecValueModelSchema.defaultValue),
], {}, {
  presentation: {
    sections: [
      { id: "scope", title: "机制范围", fieldNames: ["mechanic_scope", "target"] },
      { id: "trigger", title: "触发规则", fieldNames: ["timing", "trigger", "threshold"] },
      { id: "value", title: "数值模型", fieldNames: ["value_model"] },
    ],
    summaryFields: ["mechanic_scope", "timing", "target", "threshold"],
    titleField: "mechanic_scope",
  },
});

const runeTriggerOnCastParamsSchema = createSchema("trigger_on_cast.params", [
  numberField("energy_per_event"),
  multilineField("note"),
  textField("skill_filter"),
  numberField("threshold"),
  objectField("trigger_effect"),
], {}, {
  presentation: {
    sections: [
      { id: "energy", title: "触发收益", fieldNames: ["energy_per_event", "threshold"] },
      { id: "filter", title: "限制条件", fieldNames: ["skill_filter", "note"] },
      { id: "effect", title: "触发效果", fieldNames: ["trigger_effect"] },
    ],
    summaryFields: ["energy_per_event", "skill_filter", "threshold"],
  },
});

const runeTriggerOnMinionHitParamsSchema = createSchema("trigger_on_minion_hit.params", [
  numberField("energy_per_event"),
  multilineField("note"),
  numberField("threshold"),
  objectField("trigger_effect"),
  numberField("accumulate_threshold"),
], {}, {
  presentation: {
    sections: [
      { id: "energy", title: "触发收益", fieldNames: ["energy_per_event", "threshold", "accumulate_threshold"] },
      { id: "effect", title: "触发效果", fieldNames: ["trigger_effect", "note"] },
    ],
    summaryFields: ["energy_per_event", "threshold", "accumulate_threshold"],
  },
});

const runeAddOnHitParamsSchema = createSchema("add_on_hit.params", [
  numberField("chance"),
  textField("trigger_product"),
  multilineField("note"),
  textField("condition"),
  textField("trigger_on"),
], {}, {
  presentation: {
    sections: [
      { id: "trigger", title: "触发规则", fieldNames: ["chance", "trigger_on", "condition"] },
      { id: "payload", title: "附加效果", fieldNames: ["trigger_product", "note"] },
    ],
    summaryFields: ["chance", "trigger_on", "trigger_product"],
    titleField: "trigger_product",
  },
});

const runeAddOnKillParamsSchema = createSchema("add_on_kill.params", [
  multilineField("note"),
  textField("trigger_product"),
  textField("condition"),
], {}, {
  presentation: {
    sections: [
      { id: "trigger", title: "触发规则", fieldNames: ["condition"] },
      { id: "payload", title: "附加效果", fieldNames: ["trigger_product", "note"] },
    ],
    summaryFields: ["trigger_product", "condition"],
    titleField: "trigger_product",
  },
});

const runeDamageMultiplyParamsSchema = createSchema("damage_multiply.params", [
  numberField("max_value"),
  multilineField("note"),
  numberField("per_adjacent_minion"),
  numberField("value"),
  textField("ailment_filter"),
  numberField("max_stacks"),
  numberField("per_enemy_with_ailment"),
  textField("damage_tag"),
  textField("affect_type"),
  numberField("max_count"),
  numberField("per_minion_count"),
  textField("scaling"),
  numberField("per_stack"),
  textField("per_buff_type"),
  textField("per_ailment_type_above"),
  checkboxField("per_turn_stacking"),
  checkboxField("reset_on_move"),
  textField("target_stat"),
  textField("scope"),
  textField("target_type"),
]);

const runeApplyAilmentParamsSchema = createSchema("apply_ailment.params", [
  textField("ailment_type"),
  numberField("chance"),
  numberField("stacks"),
  numberField("range"),
  multilineField("note"),
], {}, {
  presentation: {
    sections: [
      { id: "ailment", title: "异常效果", fieldNames: ["ailment_type", "stacks"] },
      { id: "delivery", title: "施加规则", fieldNames: ["chance", "range", "note"] },
    ],
    summaryFields: ["ailment_type", "chance", "stacks", "range"],
    titleField: "ailment_type",
  },
});

const runeModMinionStatParamsSchema = createSchema("mod_minion_stat.params", [
  checkboxField("disable_attack"),
  checkboxField("disable_move"),
  multilineField("note"),
  checkboxField("inherit_element_bonus"),
  textField("stat"),
  numberField("value"),
  textField("condition"),
]);

const runeCritChanceAddParamsSchema = createSchema("crit_chance_add.params", [
  multilineField("note"),
  numberField("value"),
]);

const runeManaCostModifyParamsSchema = createSchema("mana_cost_modify.params", [
  numberField("value"),
  textField("mode"),
  multilineField("note"),
]);

const runeApplyBuffParamsSchema = createSchema("apply_buff.params", [
  textField("buff_type"),
  multilineField("note"),
  checkboxField("prevent_ignite_decay"),
  numberField("duration"),
  numberField("stacks"),
  numberField("shared_damage_split"),
]);

const runeGenerateArmorParamsSchema = createSchema("generate_armor.params", [
  textField("armor_type"),
  numberField("value_percent_max_hp"),
  multilineField("note"),
  numberField("value"),
  numberField("per_buff_stack"),
  textField("resource_select"),
  numberField("value_percent_max_resource"),
  numberField("value_percent_mana_cost"),
  numberField("percent"),
  textField("source"),
  numberField("per_enemy"),
  numberField("range"),
  numberField("value_percent_lost_hp"),
]);

const runeParamsVariants = {
  trigger_on_cast: runeTriggerOnCastParamsSchema,
  trigger_on_minion_hit: runeTriggerOnMinionHitParamsSchema,
  add_on_hit: runeAddOnHitParamsSchema,
  add_on_kill: runeAddOnKillParamsSchema,
  damage_multiply: runeDamageMultiplyParamsSchema,
  apply_ailment: runeApplyAilmentParamsSchema,
  mod_minion_stat: runeModMinionStatParamsSchema,
  crit_chance_add: runeCritChanceAddParamsSchema,
  mana_cost_modify: runeManaCostModifyParamsSchema,
  apply_buff: runeApplyBuffParamsSchema,
  generate_armor: runeGenerateArmorParamsSchema,
};

const runeParamsSchema = createDiscriminatedObjectNodeSchema({
  discriminatorField: "effect_type",
  defaultVariant: "trigger_on_cast",
  variants: runeParamsVariants,
});

function createRuneEffectSchema(effectType, paramsSchema) {
  return createSchema(`runes.${effectType}`, [
    textField("category"),
    textField("timing"),
    objectField("params", paramsSchema.defaultValue),
  ], {
    effect_type: effectType,
  });
}

const runesEffectsSchema = createDiscriminatedObjectNodeSchema({
  discriminatorField: "effect_type",
  defaultVariant: "trigger_on_cast",
  variants: Object.fromEntries(
    Object.entries(runeParamsVariants).map(([effectType, paramsSchema]) => [effectType, createRuneEffectSchema(effectType, paramsSchema)]),
  ),
});

const skillsConditionNodeSchema = createSchema("skills.condition", [
  textField("condition_type"),
  numberField("threshold"),
  arrayField("then_nodes"),
  arrayField("else_nodes"),
], {
  type: "condition",
}, {
  presentation: {
    sections: [
      { id: "condition", title: "条件判断", fieldNames: ["condition_type", "threshold"] },
      { id: "branches", title: "分支节点", fieldNames: ["then_nodes", "else_nodes"] },
    ],
  },
});

const skillsTargetingNodeSchema = createSchema("skills.targeting", [
  textField("range_type"),
  numberField("range_value"),
  textField("target_type"),
  textField("area_shape"),
  numberField("area_size"),
  numberField("target_count"),
  textField("target_alignment"),
], {
  type: "targeting",
}, {
  presentation: {
    sections: [
      { id: "base", title: "基础目标", fieldNames: ["range_type", "range_value", "target_type"] },
      { id: "area", title: "区域形态", fieldNames: ["area_shape", "area_size"] },
      { id: "limits", title: "目标限制", fieldNames: ["target_count", "target_alignment"] },
    ],
    advancedFields: ["unsupported_fields"],
  },
});

const skillsDamageNodeSchema = createSchema("skills.damage", [
  numberField("base_damage"),
  textField("damage_type"),
  textField("element"),
  textField("scaling_type"),
  numberField("sp_ratio"),
  numberField("ad_ratio"),
  numberField("hit_count"),
  numberField("damage_range_max"),
  numberField("damage_range_min"),
  multilineField("runtime_todo"),
], {
  type: "damage",
}, {
  presentation: {
    sections: [
      { id: "damage-core", title: "伤害核心", fieldNames: ["base_damage", "damage_type", "element", "hit_count"] },
      { id: "scaling", title: "倍率与区间", fieldNames: ["scaling_type", "sp_ratio", "ad_ratio", "damage_range_min", "damage_range_max"] },
      { id: "runtime", title: "运行备注", fieldNames: ["runtime_todo"] },
    ],
    advancedFields: ["unsupported_fields"],
  },
});

const skillsStatusEffectNodeSchema = createSchema("skills.status_effect", [
  numberField("chance"),
  numberField("duration"),
  textField("status"),
  numberField("stacks"),
  textField("target"),
  multilineField("runtime_todo"),
], {
  type: "status_effect",
});

const skillsStatModNodeSchema = createSchema("skills.stat_mod", [
  numberField("duration"),
  numberField("percent_value"),
  numberField("flat_value"),
  textField("stat"),
  textField("target"),
], {
  type: "stat_mod",
});

const skillsSummonNodeSchema = createSchema("skills.summon", [
  textField("agent_type"),
  objectField("base_stats"),
  arrayField("behaviors"),
  textField("display_name"),
  numberField("duration"),
  textField("inheritance_profile"),
  numberField("max_count"),
  textField("persistence"),
  textField("source_skill_id"),
  numberField("summon_count"),
  textField("summon_id"),
  numberField("summon_range"),
  textField("death_penalty"),
  numberField("respawn_cooldown"),
  textField("damage_element"),
  textField("agent_rank"),
  numberField("damage_modifier"),
  textField("persistence_mode"),
  multilineField("runtime_todo"),
], {
  type: "summon",
});

const skillsMovementNodeSchema = createSchema("skills.movement", [
  numberField("distance"),
  textField("movement_type"),
  multilineField("runtime_todo"),
], {
  type: "movement",
});

const skillsHealNodeSchema = createSchema("skills.heal", [
  numberField("base_heal"),
  textField("target"),
  numberField("percent_heal"),
], {
  type: "heal",
});

const skillsTrapNodeSchema = createSchema("skills.trap", [
  numberField("trap_damage"),
  textField("trap_effect"),
  numberField("trap_duration"),
  textField("trap_trigger"),
  numberField("trap_trigger_range"),
], {
  type: "trap",
});

const skillsTerrainCreationNodeSchema = createSchema("skills.terrain_creation", [
  numberField("duration"),
  textField("terrain_type"),
], {
  type: "terrain_creation",
});

const skillsDispelNodeSchema = createSchema("skills.dispel", [
  textField("dispel_type"),
], {
  type: "dispel",
});

const skillsNodesSchema = createDiscriminatedObjectNodeSchema({
  discriminatorField: "type",
  defaultVariant: "targeting",
  variants: {
    targeting: skillsTargetingNodeSchema,
    damage: skillsDamageNodeSchema,
    status_effect: skillsStatusEffectNodeSchema,
    stat_mod: skillsStatModNodeSchema,
    summon: skillsSummonNodeSchema,
    movement: skillsMovementNodeSchema,
    heal: skillsHealNodeSchema,
    trap: skillsTrapNodeSchema,
    terrain_creation: skillsTerrainCreationNodeSchema,
    dispel: skillsDispelNodeSchema,
    condition: skillsConditionNodeSchema,
  },
});

const traitsMechanicSchema = createSchema("traits.mechanic", [
  textField("effect_id"),
  textField("role"),
  textField("mechanic"),
  numberField("value"),
  arrayField("input_tags"),
  arrayField("output_tags"),
  textField("future_handler"),
  multilineField("implementation_note"),
], {
  type: "mechanic",
});

const traitsRestrictionSchema = createSchema("traits.restriction", [
  textField("effect_id"),
  textField("role"),
  textField("restriction"),
  numberField("value"),
  textField("future_handler"),
  multilineField("implementation_note"),
  arrayField("input_tags"),
  arrayField("output_tags"),
], {
  type: "restriction",
});

const traitsTriggerSchema = createSchema("traits.trigger", [
  textField("effect_id"),
  textField("role"),
  textField("trigger"),
  textField("effect"),
  numberField("value"),
  multilineField("implementation_note"),
  textField("trigger_policy"),
], {
  type: "trigger",
});

const traitsEffectsSchema = createDiscriminatedObjectNodeSchema({
  discriminatorField: "type",
  defaultVariant: "mechanic",
  variants: {
    mechanic: traitsMechanicSchema,
    restriction: traitsRestrictionSchema,
    trigger: traitsTriggerSchema,
  },
});

const registryEntries = [
  {
    sourcePathSuffix: "data/classes.json",
    collectionPath: "$",
    rootField: "starting_equipments",
    nestedPath: [],
    schema: classesStartingEquipmentsSchema,
  },
  {
    sourcePathSuffix: "data/classes.json",
    collectionPath: "$",
    rootField: "starting_stats",
    nestedPath: [],
    schema: classesStartingStatsSchema,
  },
  {
    sourcePathSuffix: "data/classes.json",
    collectionPath: "$",
    rootField: "stat_growth",
    nestedPath: [],
    schema: classesStatGrowthSchema,
  },
  {
    sourcePathSuffix: "data/affixes.json",
    collectionPath: "affixes",
    rootField: "value_model",
    nestedPath: [],
    schema: sharedValueModelSchema,
  },
  {
    sourcePathSuffix: "data/affixes.json",
    collectionPath: "affixes",
    rootField: "constraints",
    nestedPath: [],
    schema: emptyConstraintsSchema,
  },
  {
    sourcePathSuffix: "data/affixes_mechanic.json",
    collectionPath: "$",
    rootField: "effect_spec",
    nestedPath: [],
    schema: affixesEffectSpecSchema,
  },
  {
    sourcePathSuffix: "data/affixes_mechanic.json",
    collectionPath: "$",
    rootField: "effect_spec",
    nestedPath: ["value_model"],
    schema: effectSpecValueModelSchema,
  },
  {
    sourcePathSuffix: "data/affixes_mechanic.json",
    collectionPath: "$",
    rootField: "constraints",
    nestedPath: [],
    schema: emptyConstraintsSchema,
  },
  {
    sourcePathSuffix: "data/affixes_mechanic.json",
    collectionPath: "affixes_mechanic",
    rootField: "effect_spec",
    nestedPath: [],
    schema: affixesEffectSpecSchema,
  },
  {
    sourcePathSuffix: "data/affixes_mechanic.json",
    collectionPath: "affixes_mechanic",
    rootField: "effect_spec",
    nestedPath: ["value_model"],
    schema: effectSpecValueModelSchema,
  },
  {
    sourcePathSuffix: "data/affixes_mechanic.json",
    collectionPath: "affixes_mechanic",
    rootField: "constraints",
    nestedPath: [],
    schema: emptyConstraintsSchema,
  },
  {
    sourcePathSuffix: "data/runes.json",
    collectionPath: "$",
    rootField: "effects",
    nestedPath: ["[]"],
    schema: runesEffectsSchema,
  },
  {
    sourcePathSuffix: "data/runes.json",
    collectionPath: "$",
    rootField: "effects",
    nestedPath: ["[]", "params"],
    schema: runeParamsSchema,
  },
  {
    sourcePathSuffix: "data/skills.json",
    collectionPath: "skills",
    rootField: "nodes",
    nestedPath: ["[]"],
    recursiveItemPaths: [["then_nodes", "[]"], ["else_nodes", "[]"]],
    schema: skillsNodesSchema,
  },
  {
    sourcePathSuffix: "data/traits.json",
    collectionPath: "traits",
    rootField: "effects",
    nestedPath: ["[]"],
    schema: traitsEffectsSchema,
  },
];

function normalizeNestedPath(path) {
  return path.map((segment) => (typeof segment === "number" ? "[]" : String(segment)));
}

function matchesNestedPath(entry, actualPath) {
  const expectedPath = entry.nestedPath;
  if (expectedPath.length > actualPath.length) return false;
  if (!expectedPath.every((segment, index) => segment === actualPath[index])) return false;
  if (expectedPath.length === actualPath.length) return true;
  if (!entry.recursiveItemPaths?.length) return false;

  let cursor = expectedPath.length;
  while (cursor < actualPath.length) {
    const matchedPattern = entry.recursiveItemPaths.find((pattern) =>
      pattern.length <= (actualPath.length - cursor)
      && pattern.every((segment, offset) => actualPath[cursor + offset] === segment),
    );
    if (!matchedPattern) return false;
    cursor += matchedPattern.length;
  }
  return true;
}

function resolveDiscriminatorValue(entry, value, contextValue) {
  if (!entry.schema || !entry.schema.discriminatorField) return { value: null, source: "none" };

  if (value && typeof value === "object" && !Array.isArray(value) && entry.schema.discriminatorField in value) {
    return {
      value: value[entry.schema.discriminatorField] ?? null,
      source: "value",
    };
  }

  if (contextValue && typeof contextValue === "object" && !Array.isArray(contextValue) && entry.schema.discriminatorField in contextValue) {
    return {
      value: contextValue[entry.schema.discriminatorField] ?? null,
      source: "context",
    };
  }

  return { value: null, source: "none" };
}

function cloneObjectSchema(schema) {
  return {
    ...schema,
    fields: schema.fields.map((field) => ({
      ...field,
      defaultValue: cloneSchemaValue(field.defaultValue),
      options: field.options ? field.options.map((option) => ({ ...option })) : undefined,
    })),
    defaultValue: cloneSchemaValue(schema.defaultValue),
    presentation: schema.presentation ? {
      ...schema.presentation,
      sections: Array.isArray(schema.presentation.sections)
        ? schema.presentation.sections.map((section) => ({
          ...section,
          fieldNames: Array.isArray(section.fieldNames) ? [...section.fieldNames] : [],
        }))
        : undefined,
      advancedFields: Array.isArray(schema.presentation.advancedFields)
        ? [...schema.presentation.advancedFields]
        : undefined,
    } : null,
  };
}

export function resolveNestedNodeSchema({ sourcePath, collectionPath, rootField, nestedPath, value, contextValue }) {
  const normalizedPath = normalizeNestedPath(nestedPath);
  const entry = registryEntries.find((candidate) =>
    (sourcePath ?? "").endsWith(candidate.sourcePathSuffix)
    && candidate.collectionPath === (collectionPath ?? "<unknown>")
    && candidate.rootField === rootField
    && matchesNestedPath(candidate, normalizedPath),
  );

  if (!entry) {
    return {
      kind: "unsupported",
      lookupKey: buildNodeLookupKey({ sourcePath, collectionPath, rootField, nestedPath }),
      reason: "No registered schema for the current nested path.",
    };
  }

  if (entry.schema.nodeKind === "object") {
    return {
      kind: "supported",
      lookupKey: buildNodeLookupKey({ sourcePath, collectionPath, rootField, nestedPath }),
      schema: cloneObjectSchema(entry.schema),
    };
  }

  const discriminatorState = resolveDiscriminatorValue(entry, value, contextValue);
  const defaultDiscriminator = entry.schema.defaultVariant ?? Object.keys(entry.schema.variants)[0] ?? null;
  const effectiveDiscriminator = discriminatorState.value == null ? defaultDiscriminator : String(discriminatorState.value);
  const variant = effectiveDiscriminator == null ? null : entry.schema.variants[effectiveDiscriminator] ?? null;

  if (!variant) {
    return {
      kind: "unsupported",
      lookupKey: buildNodeLookupKey({ sourcePath, collectionPath, rootField, nestedPath, discriminator: discriminatorState.value }),
      reason: `No registered schema variant for discriminator ${String(discriminatorState.value ?? "<null>")}.`,
    };
  }

  return {
    kind: "supported",
    lookupKey: buildNodeLookupKey({ sourcePath, collectionPath, rootField, nestedPath, discriminator: effectiveDiscriminator }),
    schema: cloneObjectSchema(variant),
    discriminatorField: entry.schema.discriminatorField,
    discriminatorOptions: Object.keys(entry.schema.variants),
    currentDiscriminator: effectiveDiscriminator,
    defaultDiscriminator,
    canSwitchDiscriminator: discriminatorState.source !== "context",
    variantDefaults: Object.fromEntries(
      Object.entries(entry.schema.variants).map(([variantKey, variantSchema]) => [variantKey, cloneSchemaValue(variantSchema.defaultValue)]),
    ),
  };
}
