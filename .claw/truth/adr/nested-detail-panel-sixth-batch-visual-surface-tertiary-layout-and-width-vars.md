# nested 编辑界面体验优化第六批：视觉表面与三级布局收口

status: accepted

## context

这条 ADR 记录的是 `nested` 编辑界面体验优化第六批完成后的固定决策，不是阶段进度日志。

本轮完成态计划确认的范围是：

- nested card / fallback card 的视觉表面收口
- array nested panel 的二级 rail + 三级 detail 布局收口
- detail width 相关 CSS 变量的 sibling aside 承载方式收口

稳定基础仍然是：

- `src/detail/DetailPanel.tsx`
- `src/detail/NodeEditorHost.tsx`
- `src/styles.css`

## decision

### 1. 本轮触及的 nested card / fallback card 统一去掉渐变

第六批触及的 nested 视觉表面不再使用渐变背景，统一回到项目已有的纯色表面风格。

同时，collection rail 的动作文案与形态固定为：

- 主按钮文案使用中文 `增加项目`
- 其余上下文动作固定为图标按钮
- 图标动作作为上下文能力存在，不再以文字按钮堆叠暴露

这条 contract 的长期含义是：本轮触及的 nested 卡片和 fallback 卡片都应维持纯色、克制的表面，不再借渐变制造层次感。

### 2. array nested panel 的布局固定为 `secondary rail + tertiary detail`

array nested panel 的长期布局正式收口为：

- `secondary rail` 只保留列表
- `tertiary detail` 承接选中项详情
- 选中项详情不再在 rail 下方展开

这意味着 array item 的详情呈现从“列表下方展开”切换为“右侧独立 detail 面板”，形成稳定的二级 rail + 三级 detail 结构。

### 3. detail width 相关 CSS 变量必须同时挂到 sibling aside

detail width 相关 CSS 变量不能只挂在 primary 上。

必须同时挂到 sibling aside 上，至少覆盖：

- `primary`
- `secondary`
- `tertiary`
- `document`

否则 `secondary / tertiary / document` 无法读取宽度变量，布局会重新叠回 `right:0` 一类的失效状态。

这条规则是 nested panel 宽度协同的正式 contract，不是单一 CSS 实现细节。

## alternatives considered

- 继续使用渐变背景：会让本轮视觉表面收口不彻底，因此不接受。
- 继续把 array item 详情展开在 rail 下方：会破坏 secondary rail + tertiary detail 的长期布局，因此不接受。
- 只在 primary aside 上挂宽度变量：会导致其它 sibling aside 失去宽度读取能力，因此不接受。

## consequences

- 本轮触及的 nested card / fallback card 会统一回到纯色表面。
- collection rail 的主按钮会以 `增加项目` 作为固定中文文案，其余动作以图标按钮呈现。
- array nested panel 的长期结构固定为 secondary rail + tertiary detail。
- detail width 变量成为 sibling aside 级 contract，后续布局调整必须同步考虑所有相关 aside。

## related code

- `src/detail/DetailPanel.tsx`
- `src/detail/NodeEditorHost.tsx`
- `src/styles.css`
- `.claw/archive/tasks/nested-编辑界面体验优化第六批实现/plan.json`

## search terms

- `nested card`
- `fallback card`
- `增加项目`
- `secondary rail`
- `tertiary detail`
- `detail width`
- `sibling aside`
- `primary`
- `secondary`
- `document`
- `gradient`
