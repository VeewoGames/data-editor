# relation 字段资格、多值语义与主键改名同步实现收尾

status: accepted

## context

“完善 multi relation 语义与主键改名同步”这一轮已经完成实现收口，需要把长期有效的正式决策沉淀为 canonical ADR。

此前已有 planning truth 固定两条前提：

- `Multi-select` 只是运行时显示类型，不是 `view-config` 中可持久化的正式字段类型
- nested path relation rewrite 不在本轮范围内

本轮需要固定的是实现完成后的正式支持面：`Text`、`Select` 与运行时 `Multi-select` 的 relation 配置资格，多值外键字段的运行时真值、顶层 multi relation 的主键改名同步链，以及 relation 激活后的历史配置边界。

## decision

### 1. 多值外键字段的正式语义固定为 `relation mode = multi`

顶层数组字段如果承担外键引用语义，应通过 relation 配置进入 `mode = multi`，不再继续依赖普通 `Multi-select` option 模型解释业务值。

relation 激活后，主表、详情、筛选和校验链路统一按 `Relation` 角色处理；业务 JSON 继续只保存目标主键值数组。

### 2. relation 配置资格统一为 `Text`、`Select` 与运行时 `Multi-select`

顶层普通字段的 relation 配置资格统一接受：

- `Text`
- `Select`
- 当前值形状被推断为 `Multi-select` 的顶层数组字段

`Select` 只扩展既有 relation 配置入口，不新增 relation 类型。配置完成后仍通过既有 `relationConfigured -> effectiveDisplayType: Relation` 链路切换为 `Relation` 角色，并继续使用现有 `RelationConfig`、目标解析、lookup、渲染与保存语义。

菜单能力层 `src/table/field-capabilities.mjs` 与 App 命令层 `src/App.tsx::canConfigureRelationForField(...)` 必须保持同一资格集合；前者负责入口可见性，后者负责打开和确认配置时的真实放行，后续不得只修改其中一层。

标题、主键、nested、backlink 与已启用 `documentField` 的字段仍不可配置 relation。标题字段和主键字段继续保持 `Text` 语义，不能因 relation 资格扩展而放宽。

### 3. 顶层 multi relation 正式进入主键改名同步链

既有同步链：

- `buildPrimaryKeySyncPlan(...)`
- `buildMaintenanceLookupState(...)`
- `buildPrimaryKeySyncSaveSnapshot(...)`
- `confirmPrimaryKeySyncSave`

现在正式覆盖顶层 `mode = multi` relation。命中的顶层数组字段会生成真实 rewrite，并在维护态 UI 中暴露为可执行同步项。

### 4. 保存写回对 multi relation 采用数组逐项 rewrite

顶层 multi relation 的保存写回语义固定为：只替换数组内匹配旧主键的元素，保留未命中的值与原顺序，不把数组降级成单值，也不做额外清洗。

### 5. relation 激活期间保留历史 `multiSelectOptions`，但运行时不读取

字段原有的 `multiSelectOptions` 可以保留为历史显示配置，用于未来清除 relation 后自然回退到普通多选表现。

但在 relation 激活期间，运行时真值只能来自 relation 配置与 relation 解析链，不能再把 `multiSelectOptions` 当成当前业务值解释来源。

### 6. 表格 Delete 清空语义按 relation mode 执行

表格矩形清空进入 `Relation` 分支后：

- `mode = single` 清空为 `null`
- `mode = multi` 清空为 `[]`

不再回退到普通 `Multi-select` 清空逻辑。

### 7. nested path relation rewrite 继续明确未支持

本轮正式支持面只扩到顶层字段。

nested path relation rewrite 继续保持未支持，并应继续以 `unsupported-nested-path` 的显式结果暴露，而不是静默跳过后假装同步成功。

## alternatives considered

- 为 `Select` 新增独立 relation 类型：不采用。`Select` 与现有字段在配置后共享同一 `Relation` 角色和运行时语义，新增类型只会制造重复的数据模型与分支。
- 只放宽菜单入口或只放宽 App 命令校验：不采用。两层资格不一致会造成“入口可见但无法执行”或“命令可执行但入口缺失”的双标行为。

## consequences

- 多值外键字段和普通多选 option 字段的语义边界被正式拆开，relation 成为唯一业务真值源。
- `Select` 可以直接配置 relation，但配置后不再以普通单选 option 角色运行，而是统一进入既有 `Relation` 角色。
- relation 字段资格新增或收缩时，菜单能力层与 App 命令层必须同步变更并共同回归。
- 顶层 multi relation 的主键改名同步从“命中但跳过”升级为“命中、可见、可保存”。
- 历史 `multiSelectOptions` 仍可作为撤销 relation 后的显示配置，但不会污染 relation 运行时语义。
- nested path rewrite 仍然是明确缺口，后续若要支持，必须作为单独决策处理。
- Delete 清空、维护态摘要和保存写回现在共享同一 relation 语义，不再出现不同表面各走一套规则。

## related code

- `src/table/field-capabilities.mjs`
- `src/App.tsx`
- `src/model/relation-maintenance.mjs`
- `src/model/relationMaintenance.ts`
- `src/model/maintenance-lookup.mjs`
- `src/model/primary-key-sync-save.mjs`
- `src/table/table-selection.mjs`
- `tests/field-capabilities.test.mjs`
- `tests/maintenance-lookup.test.mjs`
- `tests/relation-maintenance.test.mjs`
- `tests/primary-key-sync-save.test.mjs`
- `tests/data-editor.spec.ts`

## search terms

- `relation mode = multi`
- `Multi-select`
- `Select`
- `multiSelectOptions`
- `canConfigureRelation`
- `canConfigureRelationForField`
- `relationConfigured`
- `effectiveDisplayType`
- `buildPrimaryKeySyncPlan`
- `buildMaintenanceLookupState`
- `buildPrimaryKeySyncSaveSnapshot`
- `unsupported-nested-path`
- `delete clears rectangle values for multi relation`
