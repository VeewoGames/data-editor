# relation 目标文件快速筛选共用方案边界

status: accepted

## context

这条 truth 沉淀的是“关联字段目标文件快速筛选共用方案”已经落地后的稳定事实，只记录可复用的代码锚点、行为边界和测试约束。

它用于后续继续排查 relation 目标文件选择器、automation 目标文件 picker、共享搜索工具和测试 helper 时快速回到真实锚点；不记录实现过程，不扩展到 target collection / target key，也不替代后续具体代码改动。

## 结论

### 1. 目标文件搜索匹配统一收口到 `src/searchable-picker-utils.mjs`

`src/searchable-picker-utils.mjs` 现在沉淀两项公共工具：

- `describeFileBasename(filePath)`
- `matchesFileSearchQuery(filePath, query)`

文件搜索匹配现在统一支持 full path 和 basename 两种命中方式，空 query 继续视为全量可见。

### 2. `SearchablePicker` 已成为公共受控组件

`src/components/SearchablePicker.tsx` 现在是正式公共组件，明确采用受控 `open` / `query` 模型。

组件关闭时会通过业务侧 `onQueryChange` 清空 query，不内建长期状态真值，也不替业务接管 open/query 的生命周期。

### 3. 自动化目标文件已切到公共 `SearchablePicker`，但状态模型保持不变

`src/App.tsx` 中自动化目标文件已经从内联 `Popover` 结构切到公共 `SearchablePicker`。

现有 `targetPickerOpenId` + `targetPickerQuery` 这套状态模型仍然保留，并继续由业务侧持有。

自动化目标集合仍保留原有独立 `Popover`，没有并入公共 `SearchablePicker`。

### 4. `RelationConfigDialog` 的目标文件已切到公共 `SearchablePicker`

`src/components/RelationConfigDialog.tsx` 的 `目标文件` 已从 `Select` 切到公共 `SearchablePicker`。

目标集合、目标主键、关系模式仍保持 `Select`，这轮没有扩 scope 到这些字段。

### 5. 关系弹窗内的 searchable popover 已通过样式层避开正文遮挡

`src/styles.css` 里的 `.searchable-picker-content` 已配置高于 `.dialog-content` 的 `z-index`。

这保证 relation dialog 内的 searchable popover 能正确浮在正文之上，不被对话框内容遮挡。

### 6. 相关测试已经覆盖共享 utils、relation picker 和 automation picker 回归

`tests/searchable-picker-utils.test.mjs` 已覆盖 basename / full path 的查询匹配。

`tests/data-editor.spec.ts` 已新增：

- `relation config target file supports searchable picker`
- `automation target file picker still filters visible files after shared picker extraction`

### 7. relation 配置 helper 已改为走 searchable picker 路径

`tests/data-editor.spec.ts::configureRelation(...)` 现在通过新的 `chooseRelationTargetFile(...)` 选择 relation 目标文件，不再走旧的 `chooseDialogSelect("目标文件", ...)`。

这条 helper 路径与公共 `SearchablePicker` 一致，避免 relation 测试继续依赖旧的 select 交互模型。

### 8. 这轮验证仍然维持 `node --test` + Playwright

这轮没有引入新的 React 组件测试框架，验证面仍沿用仓库当前的 `node --test` 和 Playwright 体系。

## 主代码锚点

- `src/searchable-picker-utils.mjs`
- `src/components/SearchablePicker.tsx`
- `src/components/RelationConfigDialog.tsx`
- `src/App.tsx`
- `src/styles.css`
- `tests/data-editor.spec.ts`
- `tests/searchable-picker-utils.test.mjs`

## 关键检索词

- `RelationConfigDialog`
- `targetPickerOpenId`
- `targetPickerQuery`
- `automation-target-picker`
- `automation-skill-picker`
- `searchable-picker-content`
- `select-trigger`
- `role="listbox"`
- `chooseDialogSelect`
- `chooseRelationTargetFile`
- `SearchablePicker`

## 适用边界

- 适用于 relation 目标文件选择器共用方案的快速判定。
- 适用于后续抽公共 `SearchablePicker` 时确认状态归属、UI 形态和测试 helper 影响面。
- 不适用于目标集合、目标主键或其他 relation 字段的进一步扩展。
- 不适用于 skills 这类富 option 布局的泛化设计；第一版只固定 relation 目标文件这个场景。
