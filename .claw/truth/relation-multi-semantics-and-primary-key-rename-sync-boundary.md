# relation 多值语义与主键改名同步边界

status: accepted

## context

这条 truth 沉淀的是“完善 multi relation 语义与主键改名同步”这轮规划收敛后的稳定事实，只覆盖当前 `data-editor` 已确认的运行时语义、配置边界和同步缺口。

它用于后续继续实现顶层 multi relation 或排查 relation / primary key rename 相关行为时，快速回到真实锚点；不记录一次性讨论过程，也不替代后续实现方案。

## 结论

### 1. `Multi-select` 不是可持久化的正式字段类型

`src/model/viewConfig.ts` 中 `RealFieldType` 只有 `Text`、`Select`、`Document`；`FieldViewConfig` 虽然保留 `multiSelectOptions`，但并不存在可写回配置的 `Multi-select` type。

`src/model/fieldTypes.ts` / `src\field-types.mjs` 里的 `Multi-select` 属于运行时显示类型：当字段值是数组且兼容离散值时，显示层会把它推断成 `Multi-select`。

这意味着当前多选语义是“值形态驱动的显示结果”，不是 `view-config` 中的正式 schema type。

### 2. relation 配置资格当前由两层共同约束

菜单能力层在 `src/table/field-capabilities.mjs`：`canConfigureRelation` 只对非 nested、非 backlink、非标题、非主键、且 base type 为 `Text` 的字段开放。

命令处理层在 `src/App.tsx`：`canConfigureRelationForField(...)` 额外要求当前字段不是 `title`、不是 `primary key`，且没有启用 `documentField`。

因此后续如果要放宽 relation 配置资格，必须同时修改菜单能力层和 `App.tsx` 命令处理层；只改一边会出现 UI 可见性和真实执行资格不一致的双标。

### 3. 字段一旦配置 relation，显示链会整体切到 `Relation`

`src/table/table-column-models.mjs` 会在 `relationConfigured` 为真时，把列模型的 `effectiveDisplayType` 从基础类型提升为 `Relation`。

后续表格渲染 `src/table/CellRenderer.tsx`、详情渲染 `src/detail/DetailPanel.tsx`、筛选字段类型 `src/App.tsx` 都会按 `Relation` 分支处理，而不是继续走普通 `Multi-select` / `Select` / `Text` 路径。

所以 relation 一旦激活，不只是表头语义变化，表格、详情、筛选、校验和删除等依赖显示类型的行为都会转向 relation 路径。

### 4. 当前主键改名同步对 multi relation 仍有两处正式缺口

第一处在 `src/model/relation-maintenance.mjs`：`buildPrimaryKeySyncPlan(...)` 命中 `config.mode !== "single"` 时，会把记录放进 `skipped`，原因记为 `unsupported-multi`。

第二处在 `src/model/primary-key-sync-save.mjs`：`buildPrimaryKeySyncSaveSnapshot(...)` 只在 `rewrite.fieldPath.length === 1` 时，执行顶层 `row[rewrite.fieldPath[0]] = rewrite.newValue` 覆盖。

这说明当前 rename sync 真实支持面仍是“顶层单值 relation 重写”；multi relation 和更深路径都还没有进入正式写回链路。

### 5. 本轮明确范围只做到顶层 multi relation

`src/model/relation-maintenance.mjs` 已经把 `parsed.fieldPath.length !== 1` 的命中显式记为 `unsupported-nested-path`。

因此这轮规划收敛后的稳定边界是：只扩展顶层 multi relation；nested path relation rewrite 继续保持未支持，并且应该继续显式暴露为 unsupported，而不是静默跳过后假装同步成功。

### 6. relation 激活时可以保留历史 `multiSelectOptions`，但运行时不再消费它们

`src/App.tsx::confirmRelationConfig(...)` 和 `handleClearRelation(...)` 只增删 `draft.relations[...]`，不会清理字段原有的 `multiSelectOptions`。

但 relation 激活后，显示和编辑链路会改走 relation：例如 `src/table/CellRenderer.tsx` / `src/detail/DetailPanel.tsx` 直接渲染 `RelationCellEditor`，`src/App.tsx` 的筛选选项也优先使用 `relationOptions`，不会再读取 `multiSelectOptions` 作为当前 relation 值的运行时来源。

因此保留历史 `multiSelectOptions` 是安全的：relation 打开期间它们只是惰性历史配置；清除 relation 后，字段可以自然回到普通多选显示配置，而不需要重新补回 option 元数据。

## 主代码锚点

- `src/model/viewConfig.ts`
- `src/model/fieldTypes.ts`
- `src/field-types.mjs`
- `src/table/field-capabilities.mjs`
- `src/App.tsx`
- `src/table/table-column-models.mjs`
- `src/table/CellRenderer.tsx`
- `src/detail/DetailPanel.tsx`
- `src/model/relation-maintenance.mjs`
- `src/model/primary-key-sync-save.mjs`

## 关键检索词

- `RealFieldType`
- `Multi-select`
- `multiSelectOptions`
- `canConfigureRelation`
- `canConfigureRelationForField`
- `relationConfigured`
- `effectiveDisplayType`
- `unsupported-multi`
- `unsupported-nested-path`
- `buildPrimaryKeySyncPlan`
- `buildPrimaryKeySyncSaveSnapshot`

## 适用边界

- 适用于顶层字段的 relation / multi relation 语义、列显示类型切换、主键改名同步规划和实现前排查。
- 适用于解释为什么 relation 不是单纯的 field type 切换，而是会切换整条显示和编辑链。
- 不适用于 nested collection 内部更深路径的 relation rewrite；这部分当前仍明确未支持。
- 不适用于 relation 的未来实现方案取舍；这里只固定当前已确认的真实边界和缺口。
