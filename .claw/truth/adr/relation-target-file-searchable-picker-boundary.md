# relation 目标文件快速筛选共用方案边界

status: accepted

## context

“关联字段目标文件快速筛选共用方案”已经完成，形成了可长期复用的组件边界与搜索匹配规则。本 ADR 只沉淀稳定决策，不记录实现过程，也不扩展到目标集合、目标主键或 relation / automation 的保存模型。

## decision

### 1. relation 与 automation 的目标文件选择统一使用同一个受控 `SearchablePicker`

`RelationConfigDialog` 的目标文件选择与自动化设置中的目标文件选择，统一抽到同一个公共 `SearchablePicker` 组件。

业务侧继续持有 `open` / `query` 真值，公共组件只负责搜索与候选展示，不接管长期状态归属。

### 2. 文件搜索规则统一沉淀到 `src/searchable-picker-utils.mjs`

目标文件候选的匹配规则统一由 `src/searchable-picker-utils.mjs` 提供，采用 full path + basename 双匹配。

空 query 继续视为全量可见，避免 relation 与 automation 两处出现不同的过滤语义。

### 3. 本轮只改目标文件，不扩展到目标集合、目标主键或 relation 模式

`RelationConfigDialog` 这轮只把“目标文件”切到 searchable picker。

目标集合、目标主键、关系模式继续保留现有 `Select` 交互，不进入本轮范围。

### 4. relation 与 automation 的保存结构保持不变

这次 picker 抽离只改变交互与复用方式，不改变数据模型。

relation 配置 JSON 结构保持不变，automation 的 target 数据结构也保持不变。

### 5. relation dialog 内的 searchable popover 需要高于 dialog 内容层级

`RelationConfigDialog` 内部的 searchable popover 需要显式高于 `dialog-content` 层级，否则候选列表会被正文遮挡。

这是 relation 场景下公共 picker 的固定 UI 边界，后续复用时仍需遵守。

## consequences

- 后续只要还是“文件候选搜索”这一类需求，优先复用同一个 `SearchablePicker` 与共享搜索 helper。
- relation 与 automation 的搜索语义不会再因为各自实现而分叉。
- 若未来要调整文件搜索行为，只需要改共享 helper，避免两处 picker 各自维护过滤逻辑。
- relation 目标文件以外的字段仍保持原有 `Select` 交互，后续扩 scope 需要单独决策。

## related code

- `src/components/SearchablePicker.tsx`
- `src/components/RelationConfigDialog.tsx`
- `src/App.tsx`
- `src/searchable-picker-utils.mjs`
- `src/styles.css`
- `tests/searchable-picker-utils.test.mjs`
- `tests/data-editor.spec.ts`

## search terms

`RelationConfigDialog`、`SearchablePicker`、`targetPickerOpenId`、`targetPickerQuery`、`searchable-picker-utils.mjs`、`matchesFileSearchQuery`、`dialog-content`、`automation target file`
