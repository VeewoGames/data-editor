import {
  buildNodeLookupKey,
  cloneObjectNodeSchema,
  cloneSchemaValue,
  createDiscriminatedObjectNodeSchema,
  createObjectNodeSchema,
} from "./node-schema.mjs";
import { SUPPORTED_CONTRACT_VERSION } from "../skill-node-contract-version.mjs";
import { assertSkillNodeContractSemantics } from "../skill-node-contract-semantics.mjs";

function normalizeNestedPath(path) {
  return path.map((segment) => (typeof segment === "number" ? "[]" : String(segment)));
}

function resolveDiscriminatorValue(entry, value, contextValue) {
  if (!entry.schema || !entry.schema.discriminatorField) return { value: null, source: "none" };
  if (value && typeof value === "object" && !Array.isArray(value) && entry.schema.discriminatorField in value) {
    return { value: value[entry.schema.discriminatorField] ?? null, source: "value" };
  }
  if (contextValue && typeof contextValue === "object" && !Array.isArray(contextValue) && entry.schema.discriminatorField in contextValue) {
    return { value: contextValue[entry.schema.discriminatorField] ?? null, source: "context" };
  }
  return { value: null, source: "none" };
}

function cloneObjectSchema(schema) {
  return cloneObjectNodeSchema(schema);
}

export function createSkillNodeContractRegistryAdapter(contract) {
  assertSupportedSkillNodeContract(contract);
  const schema = buildContractNodeSchema(contract);
  const pathRules = buildContractPathRules(contract);

  return Object.freeze({
    contractVersion: contract.contract_version,
    deriveNodeConsumes(nodes, targeting = null) {
      return deriveContractNodeConsumes(contract, nodes, targeting);
    },
    resolveNestedNodeSchema(context) {
      if (!matchesContractSkillSource(context)) {
        return unsupportedContractResult(context, "The shared contract adapter only supports its declared node collection.");
      }
      const normalizedPath = normalizeNestedPath(context.nestedPath);
      const nestedFieldName = contractNestedFieldName(normalizedPath, pathRules);
      if (nestedFieldName) {

        const parentNode = isPlainObject(context.contextValue) ? context.contextValue : null;
        const nodeType = parentNode && typeof parentNode.type === "string" ? parentNode.type : null;
        const variant = nodeType ? schema.variants[nodeType] : null;
        const nestedField = variant?.fields.find((field) => field.fieldName === nestedFieldName);
        if (!nestedField?.nestedSchema) {
          return unsupportedContractResult(context, `No shared contract schema for nested field ${nestedFieldName}.`);
        }
        return resolveContractSchema(context, nestedField.nestedSchema);
      }
      if (!isContractNodeItemPath(normalizedPath, pathRules)) {
        return unsupportedContractResult(context, "No shared contract schema for the current nested path.");
      }
      return resolveContractSchema(context, schema);
    },
  });
}

function assertSupportedSkillNodeContract(contract) {
  if (!isPlainObject(contract)) throw new TypeError("Skill node contract must be an object.");
  if (contract.contract_version !== SUPPORTED_CONTRACT_VERSION) {
    throw new Error(`Unsupported skill node contract version: ${String(contract.contract_version)}.`);
  }
  if (!isPlainObject(contract.nodes) || !isPlainObject(contract.runtime_rules)
    || !isPlainObject(contract.labels) || !isPlainObject(contract.ui_presentation)) {
    throw new TypeError("Skill node contract is missing required registry sections.");
  }
  if (!isPlainObject(contract.runtime_rules.validation?.field_constraints)
    || !isPlainObject(contract.runtime_rules.validation?.blocking_codes)) {
    throw new TypeError("Skill node contract is missing validation declarations.");
  }
  assertSkillNodeContractSemantics(contract);
}

export function matchesContractSkillSource({ collectionPath, rootField }) {
  return String(collectionPath ?? "") === "skills" && String(rootField ?? "") === "nodes";
}

function buildContractPathRules(contract) {
  const recursiveNodeFields = new Set();
  for (const node of Object.values(contract.nodes)) collectRecursiveNodeFields(node.fields, recursiveNodeFields);

  const rootFields = contract.runtime_rules.targeting?.root_fields;
  if (!Array.isArray(rootFields)) throw new TypeError("Skill node contract targeting rules are missing root_fields.");
  return {
    recursiveNodeFields,
    targetingRootFields: new Set(rootFields),
  };
}

function collectRecursiveNodeFields(fields, output) {
  if (!Array.isArray(fields)) return;
  for (const field of fields) {
    if (field?.type === "array" && field.items?.type === "node") output.add(field.name);
    if (field?.type === "array" && field.items?.type === "dict") collectRecursiveNodeFields(field.items.fields, output);
  }
}

function isContractNodeItemPath(path, pathRules) {
  if (path[0] !== "[]") return false;
  for (let index = 1; index < path.length; index += 2) {
    if (!pathRules.recursiveNodeFields.has(path[index]) || path[index + 1] !== "[]") return false;
  }
  return true;
}

function contractNestedFieldName(path, pathRules) {
  if (path.length < 2) return null;
  const fieldName = path.at(-1);
  return isContractNodeItemPath(path.slice(0, -1), pathRules) && pathRules.targetingRootFields.has(fieldName)
    ? fieldName
    : null;
}

function buildContractNodeSchema(contract) {
  const variants = Object.fromEntries(
    Object.entries(contract.nodes).map(([nodeType, node]) => [
      nodeType,
      buildContractNodeVariant(contract, nodeType, node),
    ]),
  );
  return createDiscriminatedObjectNodeSchema({
    discriminatorField: "type",
    variants,
    defaultVariant: Object.hasOwn(variants, "targeting") ? "targeting" : Object.keys(variants)[0] ?? null,
  });
}

function buildContractNodeVariant(contract, nodeType, node) {
  const fields = node.fields.map((field) => contractFieldSchema(contract, nodeType, field));
  if (nodeType === "targeting") replaceTargetingFields(contract, fields);
  const constraints = nodeType === "targeting"

    ? buildTargetingConstraints(contract)
    : nodeType === "movement" ? buildMovementConstraints(contract) : [];
  return createObjectNodeSchema({
    title: contract.labels.nodes[nodeType] ?? nodeType,
    fields,
    defaultValue: { type: nodeType },
    allowUnknownFields: false,
    constraints,
    omitDefaults: Boolean(contract.runtime_rules.normalization?.omit_explicit_defaults),
    presentation: {
      sections: [{ id: nodeType, title: contract.labels.nodes[nodeType] ?? nodeType, fieldNames: fields.map((field) => field.fieldName) }],
      advancedFields: contract.ui_presentation.advanced_fields
        .filter((fieldPath) => fieldPath.startsWith(`${nodeType}.`))
        .map((fieldPath) => fieldPath.slice(nodeType.length + 1)),
    },
  });
}

function contractFieldSchema(contract, nodeType, field) {
  const fieldPath = `${nodeType}.${field.name}`;
  const hasDefault = Object.hasOwn(field, "default");
  const schema = {
    fieldName: field.name,
    valueType: field.type,
    displayType: contractDisplayType(field),
    required: field.required === true,
    readonly: contract.ui_presentation.readonly_derived.includes(fieldPath),
    defaultValue: hasDefault ? cloneSchemaValue(field.default) : undefined,
    omitWhenDefault: hasDefault && Boolean(contract.runtime_rules.normalization?.omit_explicit_defaults),
    options: Array.isArray(field.options) ? optionSchemas(field.options) : undefined,
    visibleWhen: mapVisibleWhen(field.visible_when),
  };
  if (Object.hasOwn(field, "min")) schema.min = field.min;
  if (Object.hasOwn(field, "max")) schema.max = field.max;
  applyDeclaredFieldBounds(contract, fieldPath, schema);
  if (field.type === "dict") schema.nestedNodeKind = "object";
  if (field.type === "array") {
    if (!isPlainObject(field.items)) {
      throw new TypeError(`Skill node contract array field ${nodeType}.${field.name} is missing items.`);
    }
    schema.nestedNodeKind = "array";
    schema.arrayItem = contractArrayItemSchema(contract, nodeType, field.items);
  }
  if (nodeType === "movement") applyMovementFieldConditions(contract, schema);
  return schema;
}

function replaceTargetingFields(contract, fields) {
  const replacements = {
    selection: buildSelectionSchema(contract),

    area: buildAreaSchema(contract),
    affects: buildAffectsSchema(contract),
  };
  for (const field of fields) {
    if (replacements[field.fieldName]) field.nestedSchema = replacements[field.fieldName];
  }
}

function buildSelectionSchema(contract) {
  const rules = contract.runtime_rules.targeting.selection;
  const variants = Object.fromEntries(rules.types.map((selectionType) => {
    const fieldNames = rules.fields_by_type[selectionType] ?? [rules.discriminator];
    const fields = fieldNames
      .filter((fieldName) => fieldName !== rules.discriminator)
      .map((fieldName) => selectionFieldSchema(contract, rules, selectionType, fieldName));
    const constraints = selectionType === "entity" ? [{
      code: contractBlockingCode(contract, "selection_target_count_order"),
      kind: "compare",
      fieldNames: ["min_targets", "max_targets"],
      operator: "less_than_or_equal",
    }] : [];
    constraints.push(...buildNonEmptyArrayConstraints(
      contractBlockingCode(contract, "selection_non_empty_array"),
      rules.non_empty_array_fields,
      fieldNames,
    ));
    constraints.push(...buildDeclaredNumericConstraints(contract, "selection", fieldNames));
    return [selectionType, createObjectNodeSchema({
      title: `selection.${selectionType}`,
      fields,
      defaultValue: { [rules.discriminator]: selectionType },
      constraints,
      omitDefaults: Boolean(contract.runtime_rules.normalization.omit_explicit_defaults),
    })];
  }));
  return createDiscriminatedObjectNodeSchema({
    discriminatorField: rules.discriminator,
    variants,
    defaultVariant: rules.types[0] ?? null,
  });
}

function selectionFieldSchema(contract, rules, selectionType, fieldName) {
  const enumValues = {
    pattern: rules.patterns,
    visibility: rules.visibility,
    occupancy: rules.occupancy,
    relations: rules.relations,
    entity_types: rules.entity_types,
    directions: rules.directions,

  }[fieldName];
  const multiSelect = ["relations", "entity_types", "directions"].includes(fieldName);
  const hasDefault = Object.hasOwn(rules.defaults, fieldName);
  const schema = {
    fieldName,
    displayType: multiSelect ? "Multi-select" : enumValues ? "Select" : "Number",
    required: (rules.required_by_type[selectionType] ?? []).includes(fieldName),
    defaultValue: hasDefault ? cloneSchemaValue(rules.defaults[fieldName]) : undefined,
    omitWhenDefault: hasDefault && Boolean(contract.runtime_rules.normalization.omit_explicit_defaults),
    options: enumValues ? optionSchemas(enumValues) : undefined,
    arrayItem: multiSelect ? { valueType: "string", options: optionSchemas(enumValues ?? []) } : undefined,
    visibleWhen: { fieldName: rules.discriminator, operator: "equals", value: selectionType },
  };
  applyDeclaredFieldBounds(contract, `selection.${fieldName}`, schema);
  return schema;
}

function buildAreaSchema(contract) {
  const rules = contract.runtime_rules.targeting.area;
  const variants = Object.fromEntries(rules.shapes.map((shape) => {
    const forbidden = new Set(rules.forbidden_fields_by_shape[shape] ?? []);
    const required = new Set(rules.required_fields_by_shape[shape] ?? []);
    const fields = [];
    if (!forbidden.has("anchor")) fields.push({
      fieldName: "anchor",
      displayType: "Select",
      options: optionSchemas(rules.anchors),
      readonly: contract.ui_presentation.readonly_derived.includes("area.anchor"),
      visibleWhen: { fieldName: "shape", operator: "equals", value: shape },
    });
    if (!forbidden.has("size") && (rules.size_shapes.includes(shape) || required.has("size"))) {
      const sizeField = {
        fieldName: "size",
        displayType: "Number",
        required: required.has("size"),
        visibleWhen: { fieldName: "shape", operator: "equals", value: shape },
      };
      applyDeclaredFieldBounds(contract, "area.size", sizeField);
      fields.push(sizeField);
    }
    if (!forbidden.has("include_anchor") && rules.include_anchor_shapes.includes(shape)) fields.push({
      fieldName: "include_anchor",
      displayType: "Checkbox",
      defaultValue: rules.defaults.include_anchor,
      omitWhenDefault: Boolean(contract.runtime_rules.normalization.omit_explicit_defaults),
      visibleWhen: { fieldName: "shape", operator: "equals", value: shape },
    });
    if (!forbidden.has("params") && (rules.params_by_shape[shape]?.length ?? 0) > 0) fields.push({
      fieldName: "params",
      nestedNodeKind: "object",

      nestedSchema: buildAreaParamsSchema(contract, shape, rules.param_constraints[shape] ?? {}),
      required: required.has("params"),
      visibleWhen: { fieldName: "shape", operator: "equals", value: shape },
    });
    return [shape, createObjectNodeSchema({
      title: `area.${shape}`,
      fields,
      defaultValue: { shape },
      constraints: buildDeclaredNumericConstraints(contract, "area", fields.map((field) => field.fieldName)),
      omitDefaults: Boolean(contract.runtime_rules.normalization.omit_explicit_defaults),
    })];
  }));
  return createDiscriminatedObjectNodeSchema({ discriminatorField: "shape", variants, defaultVariant: rules.shapes[0] ?? null });
}

function buildAreaParamsSchema(contract, shape, constraint) {
  const required = new Set(constraint.required ?? []);
  const fields = [...required].map((fieldName) => {
    if (fieldName === "offsets") {
      return {
        fieldName,
        nestedNodeKind: "array",
        required: true,
        defaultValue: [],
        arrayItem: { valueType: "array", items: { valueType: "number" } },
      };
    }
    return { fieldName, displayType: "Number", required: true };
  });
  const constraints = (constraint.odd ?? []).map((fieldName) => ({
    code: contractBlockingCode(contract, "area_param_odd"),
    kind: "custom",
    fieldNames: [fieldName],
    operator: "odd_integer",
  }));
  for (const [fieldName, minimum] of Object.entries(constraint.integer_min ?? {})) {
    constraints.push({
      code: contractBlockingCode(contract, "area_param_integer_min"),
      kind: "custom",
      fieldNames: [fieldName],
      operator: "integer_min",
      value: minimum,
    });
  }
  constraints.push(...buildNonEmptyArrayConstraints(
    contractBlockingCode(contract, "area_param_non_empty_array"),
    constraint.non_empty_arrays,
    [...required],
  ));
  if (constraint.offset_pair_integers === true) {

    constraints.push({
      code: contractBlockingCode(contract, "area_param_offset_pair_integers"),
      kind: "custom",
      fieldNames: ["offsets"],
      operator: "offset_pair_integers",
    });
  }
  return createObjectNodeSchema({
    title: `area.params.${shape}`,
    fields,
    defaultValue: {},
    constraints,
  });
}

function buildAffectsSchema(contract) {
  const rules = contract.runtime_rules.targeting.affects;
  const selectionRules = contract.runtime_rules.targeting.selection;
  const enumMap = { relations: selectionRules.relations, entity_types: selectionRules.entity_types };
  const fields = rules.fields.map((fieldName) => ({
    fieldName,
    displayType: "Multi-select",
    required: rules.required.includes(fieldName),
    options: optionSchemas(enumMap[fieldName] ?? []),
    arrayItem: { valueType: "string", options: optionSchemas(enumMap[fieldName] ?? []) },
  }));
  return createObjectNodeSchema({
    title: "affects",
    fields,
    defaultValue: {},
    constraints: buildNonEmptyArrayConstraints(
      contractBlockingCode(contract, "affects_non_empty_array"),
      rules.non_empty_array_fields,
      rules.fields,
    ),
    omitDefaults: true,
  });
}

function buildTargetingConstraints(contract) {
  const areaRules = contract.runtime_rules.targeting.area;
  const affectsRules = contract.runtime_rules.targeting.affects;
  const constraints = Object.entries(areaRules.allowed_selection_types_by_shape).map(([shape, selectionTypes]) => ({
    code: contractBlockingCode(contract, "targeting_selection_area_compatibility"),
    kind: "custom",
    fieldNames: ["selection.type", "area.shape"],
    when: { fieldName: "area.shape", operator: "equals", value: shape },
    operator: "allowed_values",
    value: cloneSchemaValue(selectionTypes),
  }));

  constraints.push(...affectsRules.constraints.map((constraint) => ({
    code: contractBlockingCode(contract, constraint.code_key),
    kind: "consumer",
    fieldNames: ["affects"],
    operator: constraint.operator,
  })));
  return constraints;
}

function deriveContractNodeConsumes(contract, nodes, targeting) {
  const selection = isPlainObject(targeting?.selection) ? targeting.selection : {};
  const entries = [];
  const consumes = new Set();

  const visit = (candidateNodes, parentPath) => {
    if (!Array.isArray(candidateNodes)) return;
    candidateNodes.forEach((node, index) => {
      if (!isPlainObject(node) || typeof node.type !== "string") return;
      const nodeContract = contract.nodes[node.type];
      if (!isPlainObject(nodeContract)) return;
      const nodePath = `${parentPath}/${index}`;
      const effectiveConsumes = node.type === "movement"
        ? deriveMovementConsumes(contract, node, selection)
        : normalizedConsumes(nodeContract.consumes);
      entries.push({ nodePath, nodeType: node.type, consumes: effectiveConsumes });
      effectiveConsumes.forEach((consumer) => consumes.add(consumer));
      for (const field of nodeContract.fields ?? []) {
        if (field?.type === "array" && field.items?.type === "node") {
          visit(node[field.name], `${nodePath}/${field.name}`);
        }
      }
    });
  };

  visit(nodes, "nodes");
  return {
    consumes: [...consumes].sort(),
    entries,
  };
}

function deriveMovementConsumes(contract, node, selection) {
  const rules = contract.runtime_rules.movement;
  const mode = String(node.mode ?? "");
  const candidates = Object.entries(rules.derived_rules ?? {})
    .filter(([key]) => key === mode || key.startsWith(`${mode}_`));
  const exact = candidates.find(([, rule]) => rule?.selection_type === selection.type);
  const selectionType = (exact ?? candidates[0])?.[1]?.selection_type;
  const consumer = contract.runtime_rules.targeting.selection.consumer_by_type?.[selectionType];
  return normalizedConsumes(consumer == null ? [] : [consumer]);

}

function normalizedConsumes(consumes) {
  return Array.isArray(consumes)
    ? consumes.filter((consumer) => typeof consumer === "string" && consumer !== "" && consumer !== "none")
    : [];
}

function applyMovementFieldConditions(contract, schema) {
  const validFields = contract.runtime_rules.movement.valid_fields;
  const variants = Object.entries(validFields)
    .filter(([, fieldNames]) => fieldNames.includes(schema.fieldName))
    .map(([modeKey]) => movementVariantCondition(contract, modeKey));
  if (schema.fieldName !== "mode" && variants.length) {
    const simpleModes = variants.every((condition) => condition.fieldName === "mode")
      ? [...new Set(variants.map((condition) => condition.value))]
      : null;
    if (simpleModes) {
      schema.visibleWhen = { fieldName: "mode", operator: "in", values: simpleModes };
      schema.disabledWhen = { fieldName: "mode", operator: "not_in", values: simpleModes };
    } else {
      schema.visibleWhen = { operator: "any", conditions: variants };
      schema.disabledWhen = { operator: "none", conditions: variants };
    }
  }
}

function buildMovementConstraints(contract) {
  const rules = contract.runtime_rules.movement;
  const constraints = Object.entries(rules.required_fields).flatMap(([modeKey, fieldNames]) => {
    return fieldNames.filter((fieldName) => fieldName !== "mode").map((fieldName) => ({
      code: contractBlockingCode(contract, "movement_required_field"),
      kind: "required",
      fieldNames: [fieldName],
      when: movementVariantCondition(contract, modeKey),
      sourceVariant: modeKey,
    }));
  });
  const movementFields = contract.nodes.movement.fields.map((field) => field.name);
  constraints.push(...buildDeclaredNumericConstraints(contract, "movement", movementFields));
  return constraints;
}

function movementVariantCondition(contract, modeKey) {
  const mode = modeKey.replace(/^dash_(cell|direction)$/, "dash");
  if (!modeKey.startsWith("dash_")) return { fieldName: "mode", operator: "equals", value: mode };
  const selectionType = contract.runtime_rules.movement.derived_rules[modeKey]?.selection_type;
  return {
    operator: "all",
    conditions: [

      { fieldName: "mode", operator: "equals", value: mode },
      { fieldName: "selection.type", operator: "equals", value: selectionType },
    ],
  };
}

function buildNonEmptyArrayConstraints(code, configuredFields = [], availableFields = []) {
  const available = new Set(availableFields);
  return configuredFields.filter((fieldName) => available.has(fieldName)).map((fieldName) => ({
    code,
    kind: "custom",
    fieldNames: [fieldName],
    operator: "non_empty_array",
  }));
}

function contractBlockingCode(contract, key) {
  const code = contract.runtime_rules.validation.blocking_codes[key];
  if (typeof code !== "string" || code.length === 0) {
    throw new TypeError(`Skill node contract is missing blocking code ${key}.`);
  }
  return code;
}

function declaredFieldConstraint(contract, fieldPath) {
  const constraint = contract.runtime_rules.validation.field_constraints[fieldPath];
  return isPlainObject(constraint) ? constraint : null;
}

function applyDeclaredFieldBounds(contract, fieldPath, schema) {
  const constraint = declaredFieldConstraint(contract, fieldPath);
  if (!constraint) return;
  schema.valueType = constraint.type === "integer" ? "int" : "float";
  if (Object.hasOwn(constraint, "min")) schema.min = constraint.min;
  if (Object.hasOwn(constraint, "max")) schema.max = constraint.max;
}

function buildDeclaredNumericConstraints(contract, objectPath, availableFields) {
  const available = new Set(availableFields);
  const prefix = `${objectPath}.`;
  return Object.entries(contract.runtime_rules.validation.field_constraints).flatMap(([fieldPath, constraint]) => {
    if (!fieldPath.startsWith(prefix) || !isPlainObject(constraint)) return [];
    const fieldName = fieldPath.slice(prefix.length);
    if (fieldName.includes(".") || !available.has(fieldName)) return [];
    const constraints = [];
    const operatorPrefix = constraint.type === "integer" ? "integer" : "number";
    if (Object.hasOwn(constraint, "min")) constraints.push({
      code: constraint.code,
      kind: "custom",
      fieldNames: [fieldName],

      operator: `${operatorPrefix}_min`,
      value: constraint.min,
    });
    if (Object.hasOwn(constraint, "max")) constraints.push({
      code: constraint.code,
      kind: "custom",
      fieldNames: [fieldName],
      operator: `${operatorPrefix}_max`,
      value: constraint.max,
    });
    return constraints;
  });
}

function contractArrayItemSchema(contract, nodeType, item) {
  if (!isPlainObject(item) || typeof item.type !== "string") {
    throw new TypeError(`Skill node contract array item for ${nodeType} is invalid.`);
  }
  if (item.type === "node") return { valueType: "object", schemaRef: "skill-node" };
  if (item.type === "dict") {
    if (!Array.isArray(item.fields)) throw new TypeError(`Skill node contract dict array item for ${nodeType} is missing fields.`);
    return {
      valueType: "object",
      fields: item.fields.map((field) => contractFieldSchema(contract, nodeType, field)),
    };
  }
  if (item.type === "array") {
    return { valueType: "array", items: contractArrayItemSchema(contract, nodeType, item.items) };
  }
  const valueTypes = { int: "number", float: "number", string: "string", bool: "boolean" };
  const valueType = valueTypes[item.type];
  if (!valueType) throw new TypeError(`Unsupported skill node contract array item type: ${String(item.type)}.`);
  return {
    valueType,
    ...(item.type === "int" || item.type === "float" ? { numericType: item.type } : {}),
    ...(Object.hasOwn(item, "min") ? { min: item.min } : {}),
    ...(Object.hasOwn(item, "max") ? { max: item.max } : {}),
    ...(Array.isArray(item.options) ? { options: optionSchemas(item.options) } : {}),
  };
}

function contractDisplayType(field) {
  if (field.type === "int" || field.type === "float") return "Number";
  if (field.type === "bool") return "Checkbox";
  if (field.type === "string" && Array.isArray(field.options)) return "Select";
  if (field.type === "array" && Array.isArray(field.options)) return "Multi-select";
  return field.type === "string" ? "Text" : "Nested";
}

function mapVisibleWhen(visibleWhen) {

  if (!isPlainObject(visibleWhen)) return undefined;
  const conditions = Object.entries(visibleWhen).map(([fieldName, value]) => Array.isArray(value)
    ? { fieldName, operator: "in", values: cloneSchemaValue(value) }
    : { fieldName, operator: "equals", value: cloneSchemaValue(value) });
  return conditions.length === 1 ? conditions[0] : conditions;
}

function optionSchemas(values) {
  return values.map((value) => ({ value, label: String(value) }));
}

function resolveContractSchema(context, schema) {
  if (schema.nodeKind === "object") {
    return {
      kind: "supported",
      lookupKey: buildNodeLookupKey(context),
      schema: cloneObjectNodeSchema(schema),
    };
  }
  const discriminatorState = resolveDiscriminatorValue({ schema }, context.value, context.contextValue);
  const defaultDiscriminator = schema.defaultVariant ?? Object.keys(schema.variants)[0] ?? null;
  const effectiveDiscriminator = discriminatorState.value == null ? defaultDiscriminator : String(discriminatorState.value);
  const variant = effectiveDiscriminator == null ? null : schema.variants[effectiveDiscriminator] ?? null;
  if (!variant) return unsupportedContractResult(context, `No shared contract variant for discriminator ${String(discriminatorState.value ?? "<null>")}.`);
  return {
    kind: "supported",
    lookupKey: buildNodeLookupKey({ ...context, discriminator: effectiveDiscriminator }),
    schema: cloneObjectNodeSchema(variant),
    discriminatorField: schema.discriminatorField,
    discriminatorOptions: Object.keys(schema.variants),
    currentDiscriminator: effectiveDiscriminator,
    defaultDiscriminator,
    canSwitchDiscriminator: discriminatorState.source !== "context",
    variantDefaults: Object.fromEntries(
      Object.entries(schema.variants).map(([key, item]) => [key, cloneSchemaValue(item.defaultValue)]),
    ),
  };
}

function unsupportedContractResult(context, reason) {
  return { kind: "unsupported", lookupKey: buildNodeLookupKey(context), reason };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
