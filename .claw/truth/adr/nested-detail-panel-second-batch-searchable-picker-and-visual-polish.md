# nested 编辑界面体验优化第二批：选择器与视觉精修收口

status: accepted

## context

这条 ADR 记录的是 `nested` 编辑界面体验优化第二批实现后的固定决策，不是阶段进度日志。

本轮已经归档完成的计划明确了第二批的范围：

- `SearchablePicker` 接入 `NodeEditorHost` 的 discriminator 切换
- collection rail 工具栏图标化与层级收口
- 节点卡片与 summary 的视觉精修

稳定基础仍然是：

- `src/detail/DetailPanel.tsx`
- `src/detail/NodeEditorHost.tsx`
- `src/components/SearchablePicker.tsx`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`

## decision

### 1. 第二批体验优化固定包含三项

第二批 nested 编辑界面体验优化的正式范围固定为三项：

- `SearchablePicker` 接 discriminator
- 工具栏图标化与层级收口
- 节点卡片 / summary 视觉精修

这批只收口已经确认的交互与视觉层，不向 `unknown` / `fallback` 高级区重做扩散。

### 2. discriminator 切换正式改为公共可筛选选择器

`NodeEditorHost` 中的 discriminator / type 切换不再接受原生 `select`。

正式 contract 固定为：

- 项目内公共可筛选选择器承担 discriminator 切换
- `SearchablePicker` 作为统一选择器底座
- 不再为 discriminator 单独再造一套专用下拉控件

这条决策的长期含义是：当 nested 节点需要切换类型时，应该复用项目内统一的可筛选选择器语义，而不是回到原生表单控件。

### 3. 工具栏图标与层级收口成为正式视觉 contract

collection rail 的工具栏在第二批中收口为：

- 带图标
- 层级更清晰
- 危险动作视觉显著区分

这意味着 `Add`、`Duplicate`、`Move`、`Delete` 不再只是功能可用，而是需要在视觉层体现动作层级和风险差异。

### 4. 节点卡片与 summary 的视觉精修纳入本批

节点卡片、选中态、hover、信息层级与 type 区块的视觉细节，已被固定为第二批范围内要完成的收口项。

其长期含义是：

- `collection rail` 不能只停留在功能正确
- 节点卡片必须继续向“默认表单感消失”的方向收口
- summary 区块需要和卡片层级协同，而不是作为孤立补丁出现

### 5. DetailPanel 的 outside-click 白名单必须覆盖 portal 弹层

`DetailPanel` 的 outside-click 逻辑必须把 portal 弹层纳入白名单，至少覆盖：

- `.searchable-picker-content`
- `.select-content`

如果不覆盖这些 portal 区域，nested 内公共选择器会在交互时误触发面板关闭。

这条规则是 nested 公共选择器可用性的正式边界，不是局部实现细节。

## alternatives considered

- 继续保留原生 `select`：会让 discriminator 体验仍停留在默认表单层级，因此不接受。
- 把工具栏图标化和节点视觉精修拆到后续批次：会削弱第二批收口目标，因此不接受。
- 不处理 portal 弹层的 outside-click 白名单：会导致公共选择器误关面板，因此不接受。

## consequences

- `SearchablePicker` 成为 discriminator 切换的统一 contract。
- collection rail 的动作区视觉层级会继续收口，不再以原生按钮堆形态出现。
- 节点卡片与 summary 的视觉精修会和第二批一起完成，而不是散落到后续批次。
- portal 弹层如果不在 outside-click 白名单内，会被视为 nested 公共选择器的功能缺陷。
- 本批仍不扩散到 `unknown` / `fallback` 高级区重做，后续批次继续单独处理该范围。

## related code

- `src/detail/DetailPanel.tsx`
- `src/detail/NodeEditorHost.tsx`
- `src/components/SearchablePicker.tsx`
- `src/styles.css`
- `docs/plans/2026-07-09-nested-编辑界面体验优化第二批实现.md`

## search terms

- `nested detail`
- `SearchablePicker`
- `discriminator`
- `type switch`
- `outside-click`
- `.searchable-picker-content`
- `.select-content`
- `portal`
- `collection rail`
- `toolbar icons`
- `node card`
- `summary polish`
- `unknown fallback`
## 补充：顶层详情离散选项 Portal 的关闭边界

顶层详情字段的 `OptionFieldEditor` 也会通过 Portal 渲染 `.option-field-popover-shell`。因此 `src/detail/DetailPanel.tsx` 的 window `pointerdown` outside-click 判断必须把该 shell 与 `.searchable-picker-content`、`.select-content` 同样识别为 detail 内部交互区域。

否则用户在 `rating` 等离散选项弹层中选择值时，事件会先被误判为面板外点击并关闭详情。允许选择器 Portal 保持详情打开不会改变显式关闭（关闭按钮或真正面板外点击）的语义。

关联代码：

- `src/detail/DetailPanel.tsx`
- `src/table/OptionFieldEditor.tsx`

关键检索词：`.option-field-popover-shell`、`window pointerdown`、`outside-click`、`rating`、`portal`