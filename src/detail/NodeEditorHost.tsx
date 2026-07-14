import { useMemo, useState } from "react";
import { icons } from "../components/icons";
import { SearchablePicker } from "../components/SearchablePicker";
import { FieldTypeIcon } from "../components/FieldTypeIcon";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { RelationOption } from "../model/relations";
import { buildRelationKey } from "../model/relationPath";
import type { MultiSelectOptionView, RelationConfig } from "../model/viewConfig";
import { parseNumberDraft, sanitizeNumberDraft } from "../editing/number-draft";
import { AutoSizeTextarea } from "./AutoSizeTextarea";
import { MultiSelectCellEditor } from "../table/MultiSelectCellEditor";
import { forwardOptionFieldSurfaceClick } from "../table/OptionFieldEditor";
import { RelationCellEditor } from "../table/RelationCellEditor";
import { SelectCellEditor } from "../table/SelectCellEditor";
import { matchesContractSkillSource, resolveNestedNodeSchema } from "./node-schema-registry.mjs";
import type { SkillNodeContractFormModel } from "./skill-node-contract-form-model";
import type { NodeFieldSchema, ObjectNodeSchema } from "./node-schema";

type NodePathSegment = string | number;

type NodeEditorHostProps = {
  title: string;
  value: Record<string, unknown>;
  rootField: string;
  basePath: NodePathSegment[];
  relationOptions: Record<string, RelationOption[]>;
  relationConfigs?: Record<string, RelationConfig>;
  sourcePath?: string | null;
  collectionPath?: string;
  schemaContextValue?: Record<string, unknown> | null;
  contractFormModel?: SkillNodeContractFormModel | null;
  rootValue?: Record<string, unknown>;
  embedded?: boolean;
  onBack: () => void;
  onCloseAll: () => void;
  onEditValue: (path: NodePathSegment[], nextValue: unknown) => void;
  onOpenNested: (pathSuffix: NodePathSegment[], nestedValue: unknown, schemaContextValue?: Record<string, unknown> | null) => void;
};

export function NodeEditorHost(props: NodeEditorHostProps) {
  const contractScope = matchesContractSkillSource({
    sourcePath: props.sourcePath,
    collectionPath: props.collectionPath,
    rootField: props.rootField,
  });
  const resolved = useMemo(() => {
    const context = {
      sourcePath: props.sourcePath,
      collectionPath: props.collectionPath,
      rootField: props.rootField,
      nestedPath: props.basePath,
      value: props.value,
      contextValue: props.schemaContextValue ?? null,
    };
    if (!contractScope) return resolveNestedNodeSchema(context);
    return props.contractFormModel?.resolveNestedNodeSchema(context) ?? {
      kind: "unsupported" as const,
      lookupKey: "skill-node-contract:missing-form-model",
      reason: "技能节点合同表单未加载，当前节点只读且禁止保存。",
    };
  }, [contractScope, props.basePath, props.collectionPath, props.contractFormModel, props.rootField, props.schemaContextValue, props.sourcePath, props.value]);
  const canEdit = !contractScope || props.contractFormModel?.canEdit === true;

  const resetDefaultValue = resolved.kind === "supported"
    ? ensureDiscriminatorValue(
      cloneValue(resolved.schema.defaultValue),
      resolved.discriminatorField,
      resolved.currentDiscriminator ?? resolved.defaultDiscriminator ?? null,
    )
    : null;

  const handleSwitchDiscriminator = (nextDiscriminator: string) => {
    if (resolved.kind !== "supported" || !resolved.discriminatorField || !resolved.variantDefaults) return;
    const nextDefault = resolved.variantDefaults[nextDiscriminator];
    if (!nextDefault) return;
    props.onEditValue([], ensureDiscriminatorValue(cloneValue(nextDefault), resolved.discriminatorField, nextDiscriminator));
  };

  return (
    <>
      {!props.embedded ? (
        <div className="detail-header">
          <div className="detail-title-block">
            <div className="panel-kicker">Nested detail</div>
            <div className="panel-title">{props.title}</div>
            <div className="panel-subtitle">
              {resolved.kind === "supported"
                ? `${resolved.schema.fields.length} fields`
                : "Schema fallback"}
            </div>
          </div>
          <div className="detail-nav">
            {canEdit && resolved.kind === "supported" && resetDefaultValue ? (
              <button
                className="icon-button"
                onClick={() => props.onEditValue([], cloneValue(resetDefaultValue))}
                title="恢复默认值"
              >
                <icons.reset size={16} />
              </button>
            ) : null}
            <button className="icon-button" onClick={props.onBack} title="Back">
              <icons.previous size={16} />
            </button>
            <button className="icon-button" onClick={props.onCloseAll} title="Close nested detail">
              <icons.close size={16} />
            </button>
          </div>
        </div>
      ) : null}
      {resolved.kind === "supported" ? (
        <ObjectNodeEditor
          schema={resolved.schema}
          value={props.value}
          rootField={props.rootField}
          basePath={props.basePath}
          relationOptions={props.relationOptions}
          relationConfigs={props.relationConfigs}
          sourcePath={props.sourcePath}
          collectionPath={props.collectionPath}
          discriminatorField={resolved.discriminatorField}
          discriminatorOptions={resolved.discriminatorOptions ?? []}
          currentDiscriminator={resolved.currentDiscriminator ?? null}
          canSwitchDiscriminator={Boolean(resolved.canSwitchDiscriminator && resolved.discriminatorField && resolved.discriminatorOptions?.length)}
          canEdit={canEdit}
          contractFormModel={contractScope ? props.contractFormModel : null}
          rootValue={props.rootValue}
          onSwitchDiscriminator={handleSwitchDiscriminator}
          onEditValue={props.onEditValue}
          onOpenNested={props.onOpenNested}
        />
      ) : (
        <UnsupportedNodeFallback
          title={props.title}
          reason={("reason" in resolved && typeof resolved.reason === "string") ? resolved.reason : "Unsupported nested structure."}
          value={props.value}
        />
      )}
    </>
  );
}

function ObjectNodeEditor(props: {
  schema: ObjectNodeSchema;
  value: Record<string, unknown>;
  rootField: string;
  basePath: NodePathSegment[];
  relationOptions: Record<string, RelationOption[]>;
  relationConfigs?: Record<string, RelationConfig>;
  sourcePath?: string | null;
  collectionPath?: string;
  discriminatorField?: string;
  discriminatorOptions: string[];
  currentDiscriminator: string | null;
  canSwitchDiscriminator: boolean;
  canEdit: boolean;
  contractFormModel?: SkillNodeContractFormModel | null;
  rootValue?: Record<string, unknown>;
  onSwitchDiscriminator: (nextDiscriminator: string) => void;
  onEditValue: (path: NodePathSegment[], nextValue: unknown) => void;
  onOpenNested: (pathSuffix: NodePathSegment[], nestedValue: unknown, schemaContextValue?: Record<string, unknown> | null) => void;
}) {
  const unknownFieldNames = Object.keys(props.value).filter((fieldName) => !props.schema.fields.some((field) => field.fieldName === fieldName));
  const [discriminatorPickerOpen, setDiscriminatorPickerOpen] = useState(false);
  const [discriminatorQuery, setDiscriminatorQuery] = useState("");
  const visibleDiscriminatorOptions = props.discriminatorOptions.filter((option) => option.toLowerCase().includes(discriminatorQuery.trim().toLowerCase()));
  const fieldStates = props.contractFormModel
    ? props.contractFormModel.projectFieldStates(props.schema, props.value, { rootValue: props.rootValue })
    : props.schema.fields.map((field) => ({ field, visible: true, disabled: false, readonly: false }));
  const visibleFields = fieldStates.filter((state) => state.visible).map((state) => ({
    ...state.field,
    disabled: !props.canEdit || state.disabled,
  }));
  const canSwitchDiscriminator = props.canSwitchDiscriminator
    && (props.contractFormModel?.canSwitchDiscriminator(props.schema, { rootValue: props.rootValue }) ?? true);
  const derivedRuleSummary = props.contractFormModel?.getDerivedRuleSummary(props.schema, { rootValue: props.rootValue }) ?? [];
  const sections = buildNodeSections(visibleFields, props.schema.presentation?.sections ?? []);
  const showUnknownAdvanced = !props.schema.allowUnknownFields && unknownFieldNames.length > 0;
  const unknownAdvancedLabel = `Unknown fields (${unknownFieldNames.length})`;

  return (
    <div className="property-list nested-property-list">
      {canSwitchDiscriminator && props.discriminatorField ? (
        <section className="property-block property-block--node-summary">
          <div className="property-heading">
            <span className="property-heading-label">
              <span className="property-heading-icon" data-field-type-icon="Select">
                <FieldTypeIcon fieldType="Select" size={14} strokeWidth={2.2} />
              </span>
              <span>{props.discriminatorField}</span>
            </span>
          </div>
          <SearchablePicker
            open={discriminatorPickerOpen}
            onOpenChange={setDiscriminatorPickerOpen}
            query={discriminatorQuery}
            onQueryChange={setDiscriminatorQuery}
            searchAriaLabel={`筛选 ${props.discriminatorField}`}
            searchPlaceholder="筛选类型..."
            listAriaLabel={`${props.discriminatorField} 候选列表`}
            contentClassName="node-discriminator-picker-content"
            emptyContent={<div className="searchable-picker-empty">没有匹配的类型。</div>}
            trigger={(
              <button
                type="button"
                role="combobox"
                aria-label={props.discriminatorField}
                aria-expanded={discriminatorPickerOpen}
                className="select-trigger node-discriminator-trigger"
                disabled={!props.canEdit}
                title={props.currentDiscriminator ?? ""}
              >
                <span className="node-discriminator-trigger__value">{props.currentDiscriminator ?? "选择类型"}</span>
                <icons.chevronDown size={16} />
              </button>
            )}
          >
            {visibleDiscriminatorOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`searchable-picker-option node-discriminator-option ${option === props.currentDiscriminator ? "is-selected" : ""}`}
                onClick={() => {
                  props.onSwitchDiscriminator(option);
                  setDiscriminatorPickerOpen(false);
                  setDiscriminatorQuery("");
                }}
              >
                <span className="searchable-picker-option__title">{option}</span>
              </button>
            ))}
          </SearchablePicker>
        </section>
      ) : null}
      {derivedRuleSummary.length ? (
        <section className="node-section" data-node-section="derived-rule-summary">
          <div className="node-section-header">
            <strong>合同派生规则</strong>
            <small>只读，不写回技能 JSON</small>
          </div>
          <div className="node-section-fields">
            {derivedRuleSummary.map((row) => (
              <section className="property-block" key={row.label}>
                <PropertyHeading fieldName={row.label} fieldType="Text" />
                <input className="detail-input detail-input--readonly" readOnly value={row.value} />
              </section>
            ))}
          </div>
        </section>
      ) : null}
      {sections.map((section) => {
        const sectionFilledCount = section.fields.reduce((count, field) => count + (isMeaningfullyFilled(props.value[field.fieldName]) ? 1 : 0), 0);
        return (
          <section className="node-section" data-node-section={section.id} key={section.id}>
            <div className="node-section-header">
              <strong>{section.title}</strong>
              <small>{sectionFilledCount}/{section.fields.length}</small>
            </div>
            <div className="node-section-fields">
              {section.fields.map((field) => {
                const value = props.value[field.fieldName];
                return (
                  <section className="property-block" key={field.fieldName} onClick={forwardOptionFieldSurfaceClick}>
                    <PropertyHeading fieldName={field.fieldName} fieldType={field.displayType ?? "Text"} />
                    <NodeFieldEditor
                      fieldName={field.fieldName}
                      fieldSchema={field}
                      value={value}
                      pathParts={[props.rootField, ...props.basePath, field.fieldName]}
                      relationOptions={props.relationOptions}
                      relationConfigs={props.relationConfigs}
                      sourcePath={props.sourcePath}
                      collectionPath={props.collectionPath}
                      onEditValue={(nextValue) => props.onEditValue([field.fieldName], nextValue)}
                      onOpenNested={(nestedValue) => props.onOpenNested([field.fieldName], nestedValue, props.value)}
                    />
                  </section>
                );
              })}
            </div>
          </section>
        );
      })}
      {showUnknownAdvanced ? (
        <details className="property-block property-block--advanced" data-advanced-block="unknown-fields">
          <summary className="advanced-block-summary">
            <span className="advanced-block-summary__title">高级信息</span>
            <small>{unknownAdvancedLabel}</small>
          </summary>
          <div className="advanced-block-body">
            <div className="advanced-block-label">{unknownAdvancedLabel}</div>
            <pre className="json-editor">{JSON.stringify(Object.fromEntries(unknownFieldNames.map((fieldName) => [fieldName, props.value[fieldName]])), null, 2)}</pre>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function NodeFieldEditor(props: {
  fieldName: string;
  fieldSchema: NodeFieldSchema & { disabled?: boolean };
  value: unknown;
  pathParts: NodePathSegment[];
  relationOptions: Record<string, RelationOption[]>;
  relationConfigs?: Record<string, RelationConfig>;
  sourcePath?: string | null;
  collectionPath?: string;
  onEditValue: (nextValue: unknown) => void;
  onOpenNested: (nestedValue: unknown) => void;
}) {
  if (props.fieldSchema.nestedNodeKind === "array" || Array.isArray(props.value)) {
    return (
      <button className="nested-entry-button" onClick={() => props.onOpenNested(Array.isArray(props.value) ? props.value : [])}>
        <icons.nested size={15} />
        <span>{Array.isArray(props.value) ? `${props.value.length} 条` : "0 条"}</span>
      </button>
    );
  }

  if (props.fieldSchema.nestedNodeKind === "object" || isPlainObjectValue(props.value)) {
    const objectValue = isPlainObjectValue(props.value) ? props.value : {};
    return (
      <button className="nested-entry-button" onClick={() => props.onOpenNested(objectValue)}>
        <icons.nested size={15} />
        <span>{Object.keys(objectValue).length} 字段</span>
      </button>
    );
  }

  if (props.fieldSchema.disabled) {
    return <input className="detail-input detail-input--readonly" readOnly value={formatReadonlyValue(props.value)} />;
  }

  const relation = getRelationConfig(props.pathParts, props.relationOptions, props.relationConfigs, props.sourcePath, props.collectionPath);
  if (relation && isRelationValue(props.value)) {
    return (
      <RelationCellEditor
        cellId={`nested-node:${props.pathParts.join(".")}`}
        configured={relation.configured}
        mode={relation.mode}
        options={relation.options}
        surface="detail"
        value={props.value as string | number | null | Array<string | number>}
        onEdit={(next) => props.onEditValue(next)}
      />
    );
  }

  if (props.fieldSchema.displayType === "Checkbox") {
    return (
      <label className="checkbox-cell" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={Boolean(props.value)}
          onChange={(event) => props.onEditValue(event.target.checked)}
        />
      </label>
    );
  }

  if (props.fieldSchema.displayType === "Select" && (props.value == null || typeof props.value === "string" || typeof props.value === "number")) {
    return (
      <div className="option-field-click-surface" onClick={forwardOptionFieldSurfaceClick}>
        <SelectCellEditor
          cellId={`nested-node:${props.pathParts.join(".")}`}
          onCommitDraft={(patch) => props.onEditValue(patch.nextSelectedValues[0] ?? null)}
          options={normalizeNodeOptions(props.fieldSchema.options)}
          surface="detail"
          value={props.value as string | number | null}
        />
      </div>
    );
  }

  if (props.fieldSchema.displayType === "Multi-select" && Array.isArray(props.value)) {
    return (
      <div className="option-field-click-surface" onClick={forwardOptionFieldSurfaceClick}>
        <MultiSelectCellEditor
          cellId={`nested-node:${props.pathParts.join(".")}`}
          onCommitDraft={(patch) => props.onEditValue(patch.nextSelectedValues)}
          options={normalizeNodeOptions(props.fieldSchema.options)}
          surface="detail"
          value={props.value as Array<string | number>}
        />
      </div>
    );
  }

  if (props.fieldSchema.displayType === "Number") {
    return (
      <input
        className="detail-input"
        inputMode="decimal"
        placeholder={props.fieldSchema.placeholder}
        value={props.value == null ? "" : String(props.value)}
        onChange={(event) => props.onEditValue(parseNumberDraft(sanitizeNumberDraft(event.target.value)))}
      />
    );
  }

  if (props.fieldSchema.multiline) {
    return (
      <AutoSizeTextarea
        className="detail-input detail-textarea"
        placeholder={props.fieldSchema.placeholder}
        value={props.value == null ? "" : String(props.value)}
        onChange={(event) => props.onEditValue(event.target.value)}
      />
    );
  }

  return (
    <input
      className="detail-input"
      placeholder={props.fieldSchema.placeholder}
      value={props.value == null ? "" : String(props.value)}
      onChange={(event) => props.onEditValue(event.target.value)}
    />
  );
}

function formatReadonlyValue(value: unknown) {
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function UnsupportedNodeFallback({ title, reason, value }: { title: string; reason: string; value: unknown }) {
  const [copied, setCopied] = useState(false);

  const copyJson = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="property-list nested-property-list">
      <section className="property-block property-block--fallback">
        <div className="fallback-state-kicker">Read-only fallback</div>
        <div className="fallback-state-title">当前结构暂未进入节点编辑器</div>
        <div className="fallback-state-description">{reason}</div>
        <div className="fallback-state-subtitle">{title}</div>
        <div className="json-actions">
          <button className="ghost-button nested-toolbar-button" onClick={copyJson} type="button">
            {copied ? <icons.check size={15} /> : <icons.copy size={15} />}
            <span>{copied ? "已复制 JSON" : "复制 JSON"}</span>
          </button>
        </div>
        <pre className="json-editor">{JSON.stringify(value, null, 2)}</pre>
      </section>
    </div>
  );
}

function PropertyHeading({ fieldName, fieldType }: { fieldName: string; fieldType: FieldDisplayType }) {
  return (
    <div className="property-heading">
      <span className="property-heading-label">
        <span className="property-heading-icon" data-field-type-icon={fieldType}>
          <FieldTypeIcon fieldType={fieldType} size={14} strokeWidth={2.2} />
        </span>
        <span>{fieldName}</span>
      </span>
    </div>
  );
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
  }
  return value;
}

function ensureDiscriminatorValue<T extends Record<string, unknown>>(value: T, discriminatorField?: string, discriminatorValue?: string | null) {
  if (!discriminatorField || discriminatorValue == null) return value;
  return {
    ...value,
    [discriminatorField]: discriminatorValue,
  };
}

function buildNodeSections(
  fields: Array<NodeFieldSchema & { disabled?: boolean }>,
  configuredSections: Array<{ id: string; title: string; fieldNames: string[] }>,
) {
  const fieldMap = new Map(fields.map((field) => [field.fieldName, field]));
  const usedFieldNames = new Set<string>();
  const sections = configuredSections
    .map((section) => {
      const sectionFields = section.fieldNames
        .map((fieldName) => fieldMap.get(fieldName))
        .filter((field): field is NonNullable<typeof field> => Boolean(field));
      sectionFields.forEach((field) => usedFieldNames.add(field.fieldName));
      return sectionFields.length ? {
        id: section.id,
        title: section.title,
        fields: sectionFields,
      } : null;
    })
    .filter((section): section is NonNullable<typeof section> => Boolean(section));

  const remainingFields = fields.filter((field) => !usedFieldNames.has(field.fieldName));
  if (remainingFields.length) {
    sections.push({
      id: "main",
      title: "字段",
      fields: remainingFields,
    });
  }

  if (!sections.length) {
    sections.push({
      id: "main",
      title: "字段",
      fields,
    });
  }

  return sections;
}

function normalizeNodeOptions(options: NodeFieldSchema["options"]): MultiSelectOptionView[] {
  return (options ?? []).map((option) => ({ value: String(option.value), label: option.label, color: null }));
}

function getRelationConfig(
  pathParts: NodePathSegment[],
  relationOptions: Record<string, RelationOption[]>,
  relationConfigs: Record<string, RelationConfig> = {},
  sourcePath?: string | null,
  collectionPath?: string,
) {
  if (sourcePath && collectionPath) {
    const relationKey = buildRelationKey({ sourceFile: sourcePath, sourceCollection: collectionPath, fieldPath: pathParts });
    const config = relationConfigs[relationKey];
    if (config) {
      return {
        configured: true,
        config,
        mode: config.mode,
        options: relationOptions[relationKey] ?? [],
      };
    }
  }
  return null;
}

function isRelationValue(value: unknown) {
  if (value == null) return true;
  if (typeof value === "string" || typeof value === "number") return true;
  return Array.isArray(value) && value.every((item) => item == null || typeof item === "string" || typeof item === "number");
}

function isPlainObjectValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMeaningfullyFilled(value: unknown) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}
