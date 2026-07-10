# relation 多值语义与主键改名同步实现收尾

status: accepted

## context

这条 truth 只沉淀“完善 multi relation 语义与主键改名同步”本轮已经实现并验证的稳定事实，覆盖 relation 配置资格、primary key rename rewrite、保存写回和表格 Delete 清空行为。

它是前一篇 [relation 多值语义与主键改名同步边界](./relation-multi-semantics-and-primary-key-rename-sync-boundary.md) 的实现 closeout：前文固定的是规划期边界和缺口，这篇固定的是实现完成后的正式支持面与验证锚点。

## 结论

### 1. relation 列头配置资格已放宽到 `Text` 与运行时 `Multi-select`

`src/table/field-capabilities.mjs` 现在把 relation 资格基底扩展为 `Text` 或 `Multi-select`；`src/App.tsx::canConfigureRelationForField(...)` 也同步放宽到这两类基础显示类型。

但标题字段和主键字段的资格没有改变：`canBeTitle`、`canBePrimaryKey` 仍只对 `Text` 开放，`App.tsx` 里也继续禁止 `title` / `primary key` 字段进入 relation 配置。

因此当前正式语义是：

- relation 可以配置在普通 `Text` 字段上
- relation 也可以配置在运行时推断为 `Multi-select` 的顶层数组字段上
- 标题字段和主键字段仍然必须保持 `Text` 语义，不能借放宽关系资格一起扩散

### 2. 顶层 multi relation 已进入正式 primary key rename rewrite 链

`src/model/relation-maintenance.mjs::buildPrimaryKeySyncPlan(...)` 现在不再按 `mode !== "single"` 拦截 multi relation。

当前判断逻辑只保留一条正式跳过边界：`parsed.fieldPath.length !== 1` 时记为 `unsupported-nested-path`；只要命中的是顶层字段，不论 relation mode 是 `single` 还是 `multi`，都会进入 `rewrites`。

这意味着顶层 multi relation 已从“命中但跳过”变成“命中并正式纳入同步计划”。

### 3. `buildMaintenanceLookupState(...)` 会把顶层 multi rewrite 暴露到 UI 维护态

`src/model/maintenance-lookup.mjs` 继续统一通过 `buildPrimaryKeySyncPlan(...)` 生成 `primaryKeySyncPlan`，并把结果挂到返回值里。

由于顶层 multi relation 现在会进入 `rewrites`，维护态 UI 看到的 `primaryKeySyncPlan` 也会直接暴露这些 multi rewrite，而不是只显示 single rewrite 或 skipped 提示。

因此当前 relation 维护面板和保存前同步对话框里的 multi rewrite 是正式可见、可执行的维护项，不再是隐藏缺口。

### 4. 顶层 multi relation 保存时会逐项替换旧主键，不再整列误覆盖

`src/model/primary-key-sync-save.mjs::buildPrimaryKeySyncSaveSnapshot(...)` 现在通过 `applyRewriteValue(...)` 执行 rewrite。

当当前字段值是数组时，`applyRewriteValue(...)` 会逐项把匹配 `oldValue` 的元素替换为 `newValue`；只有标量值才直接覆盖成新值。

所以顶层 multi relation 在保存同步时的正式行为已经收敛为“数组内逐项替换旧主键”，不会再把整个数组错误覆盖成单个字符串。

### 5. 表格矩形 Delete 已支持 relation 清空分支

`src/table/table-selection.mjs::resolveClearValueByDisplayType(...)` 现在包含 relation 清空规则：

- `Relation` + `mode === "single"` 清空为 `null`
- `Relation` + `mode === "multi"` 清空为 `[]`

因此矩形选区按 `Delete` 时，relation 单值列和多值列都能进入正式清空路径，不再因为 `Relation` 缺少 clear 分支而保持原值不动。

### 6. 本轮稳定支持面已经有单测与 Playwright 双重锚点

单测锚点覆盖：

- `tests/field-capabilities.test.mjs`：`multi-select fields can configure relation but cannot become title or primary key`
- `tests/relation-maintenance.test.mjs`：`buildPrimaryKeySyncPlan rewrites top-level single and multi relations while skipping nested paths`
- `tests/maintenance-lookup.test.mjs`：顶层 multi relation rewrite 会进入 `primaryKeySyncPlan.rewrites`
- `tests/primary-key-sync-save.test.mjs`：same-file / external 两种 top-level multi relation array rewrite

Playwright 锚点覆盖：

- `tests/data-editor.spec.ts`：`column header menu shows relation action but not title or primary key for eligible multi-select fields`
- `tests/data-editor.spec.ts`：`primary key sync rewrites top-level multi relation arrays`
- `tests/data-editor.spec.ts`：`delete clears rectangle values for multi relation`

因此这轮实现后的正式支持面，已经同时被代码级单测和真实 UI 流程用例固定。

## 主代码锚点

- `src/table/field-capabilities.mjs`
- `src/App.tsx`
- `src/model/relation-maintenance.mjs`
- `src/model/maintenance-lookup.mjs`
- `src/model/primary-key-sync-save.mjs`
- `src/table/table-selection.mjs`

## 验证锚点

- `node --test tests/field-capabilities.test.mjs tests/maintenance-lookup.test.mjs tests/relation-maintenance.test.mjs tests/primary-key-sync-save.test.mjs`
- `tests/data-editor.spec.ts` 中的定向用例：
- `column header menu shows relation action but not title or primary key for eligible multi-select fields`
- `primary key sync rewrites top-level multi relation arrays`
- `delete clears rectangle values for multi relation`

## 关键检索词

- `canConfigureRelation`
- `canConfigureRelationForField`
- `Multi-select`
- `buildPrimaryKeySyncPlan`
- `primaryKeySyncPlan`
- `unsupported-nested-path`
- `buildPrimaryKeySyncSaveSnapshot`
- `applyRewriteValue`
- `resolveClearValueByDisplayType`
- `delete clears rectangle values for multi relation`

## 适用边界

- 适用于当前仓库里“顶层 multi relation 已经正式支持到什么程度”的快速判定。
- 适用于后续排查 relation 列头入口、主键改名同步、保存写回和矩形 Delete 清空行为。
- 不适用于 nested path relation rewrite；这部分仍然保持 `unsupported-nested-path`。
- 不适用于更泛化的 relation schema 设计讨论；这里只固定当前已经实现并验证的支持面。
