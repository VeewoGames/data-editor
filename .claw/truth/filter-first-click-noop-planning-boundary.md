# 筛选条件首次点击无效：普通筛选弹层交互边界与最小修复入口

status: accepted

## context

这条 truth 只沉淀“修复筛选条件首次点击无效”这类问题在当前 data-editor 中的真实排障入口与执行边界。它不是对整个筛选栏/弹层体系的重构方案，也不重新定义 shared view 的筛选模型。

当前已确认，这类问题的首要观察面不在 `App.tsx` 的 shared view 保存链，而在 `src/components/ViewFilterBar.tsx` 与普通筛选弹层组件之间的前端交互时序。

## planning truth

### 1. 问题范围先收敛到 `ViewFilterBar` 与普通筛选弹层的交互，不要先怀疑整个筛选系统

当用户报告“筛选条件首次点击无效”时，当前默认排障范围应先收敛到：

- `src/components/ViewFilterBar.tsx`
- `src/components/filters/MultiSelectFilterPopover.tsx`
- `src/components/filters/TextFilterPopover.tsx`

原因是普通筛选 rule chip 的打开、定位、关闭都由 `ViewFilterBar` 自己维护，而 `MultiSelectFilterPopover` / `TextFilterPopover` 只负责弹层内部的条件和值编辑。首次点击失效这类问题，优先看这条宿主与子弹层的交界面，不要一开始就把范围扩大到整个 shared view、`App.tsx`、高级筛选树或数据保存链。

### 2. `ViewFilterBar` 目前自己承担普通筛选弹层的打开状态、portal 定位与全局关闭逻辑

当前普通筛选 chips 不是直接使用 Radix Popover 自管开关，而是由 `ViewFilterBar` 维护以下状态与行为：

- `openRuleId`：决定当前哪个顶层 rule chip 处于打开态
- `openRuleRect`：基于 chip wrapper 的 `getBoundingClientRect()` 计算 portal 弹层位置
- `createPortal(...)`：把 `.filter-popover-content` 挂到 `document.body`
- 全局 `pointerdown` capture 监听：点击 chip 外区域时关闭当前弹层

这意味着“首次点击无效”如果发生在普通筛选的“条件”下拉，很大概率与这套宿主层的开关/关闭时序有关，而不只是下拉组件本身没响应。

### 3. 普通筛选里的“条件”下拉是 Radix Select，并且同时存在于多值筛选与文本筛选

当前普通筛选弹层内部，“条件”下拉都直接使用 `@radix-ui/react-select`：

- `src/components/filters/MultiSelectFilterPopover.tsx` 负责 `Select` / `Multi-select` / `Relation` 的普通筛选值弹层
- `src/components/filters/TextFilterPopover.tsx` 负责文本类普通筛选弹层

因此，只要问题描述是“条件下拉第一次点不开、第一次点了没反应、第一次选择没生效”，默认要把 Radix Select 触发器与 `ViewFilterBar` 的外层 `pointerdown` 关闭逻辑一起看，而不是只改单个字段类型分支。

### 4. 这轮执行边界固定为最小修复，不重构整个筛选栏/弹层体系

本轮正式规则是：

- 只修复“筛选条件首次点击无效”所必需的交互缺陷
- 不顺手把普通筛选 chips 改成另一套弹层框架
- 不在同一轮里重写 `ViewFilterBar` 的 portal / 定位 / 全局关闭机制
- 不把问题扩展为 shared view 筛选模型、高级筛选树或保存链的整体重构

如果后续发现需要更大范围的弹层治理，应另开方案或 ADR；本条 truth 只规定当前 bugfix 轮次的收口边界。

## 真实调用链路

- 普通筛选新增：`ViewFilterBar` 的 `+ 筛选` / 列头 `add-filter` 动作 -> `createDefaultFilterRule(...)` -> `setOpenRuleId(nextRule.id)` -> 对应 chip 打开 portal 弹层
- 普通筛选弹层打开：`ViewFilterBar` 依据 `openRuleId` 渲染 `createPortal(...)` -> `renderFilterPopover(...)`
- 弹层分发：
  - `Select` / `Multi-select` / `Relation` -> `MultiSelectFilterPopover`
  - 其他文本字段 -> `TextFilterPopover`
- 普通筛选弹层关闭：`ViewFilterBar` 的全局 `pointerdown` capture 监听判断目标是否落在 `.filter-popover-content`、`.filter-select-content`、`.filter-action-menu` 等白名单外，命中则 `setOpenRuleId(null)`

## 验证锚点

当前已有与普通筛选相关的 e2e 主锚点在 `tests/data-editor.spec.ts`，至少包括：

- `shared view filter and sort drafts persist through save and reload`
- `multi-select filter popover uses shared shell and scroll section`
- `multi-select filter popover supports operator text, selected chips, search, and checkbox rows`
- `filter operator select stays above the filter popover surface`
- `text filter popover keeps shared shell without scroll section`

后续补“首次点击无效”回归时，优先把新断言放在这段普通筛选 e2e 语境附近，而不是新开完全脱离筛选上下文的零散用例。

## 关联代码

- `src/components/ViewFilterBar.tsx`
- `src/components/filters/MultiSelectFilterPopover.tsx`
- `src/components/filters/TextFilterPopover.tsx`
- `src/components/filters/FilterActionMenu.tsx`
- `tests/data-editor.spec.ts`

## 适用边界

- 适用于顶部普通筛选 chips 对应弹层的首次点击、首次打开、首次选择、首次下拉无效等交互问题。
- 不适用于高级筛选树内部 rule editor 的独立交互问题；那条链路应优先看 `AdvancedFilterRuleEditor` / `AdvancedFilterSelect`。
- 不适用于 shared view 保存、draft 持久化、`shared-views.json` 对齐或 profile `viewLayouts` 覆盖问题。

## implementation truth

### 5. 已确认根因不是 Radix Select 本身，而是 `ViewFilterBar` 的短暂 click suppression 窗口会吞掉第一次真实点击

本轮实现已确认，问题根因位于 `src/components/ViewFilterBar.tsx` 对“新建后自动打开”或“程序触发自动打开”的普通筛选 chip 使用了 `suppressCloseRuleIdRef` 保护，并且旧实现通过 `setTimeout(0)` 在事件循环下一拍才解除这层抑制。

这会制造一个短暂但真实存在的 click suppression 窗口：

- rule 被创建或自动打开时，`suppressCloseRuleIdRef.current` 先被设置为对应 `rule.id`
- 用户紧接着发出的第一次真实点击，仍可能落在这段 timeout 窗口内
- 结果是 chip 的 `onClick` 提前返回，第一次本应发生的开关动作被吞掉

因此，这个 bug 的根因应固定记录为“`ViewFilterBar` 自己的短暂 click suppression 吞掉首次真实点击”，而不是“Radix Select 首次点击不稳定”或“popover 定位偶发失效”。

### 6. 最终修复是把 suppression 的释放时机改到该 chip 的下一次 `pointerdown`，不再依赖 `setTimeout(0)`

当前稳定修复做法已经落地在 `src/components/ViewFilterBar.tsx`：

- 保留 `suppressCloseRuleIdRef` 作为“刚创建/刚自动打开时避免立即反向关闭”的局部保护
- 移除基于 `setTimeout(0)` 的 suppression 自动清除窗口
- 改为在对应 chip 的下一次 `pointerdown` 上先判断并清除 `suppressCloseRuleIdRef.current`
- 随后的 `onClick` 再按正常逻辑处理 `openRuleId` 的开关

这条修复规则的关键不是“取消 suppression”，而是“把 suppression 的解除绑定到同一真实交互序列里的下一次 `pointerdown`”。后续若再处理同类“新建后自动打开”的 click 吞没问题，默认应沿这条时序修复，不要再退回 timeout 窗口做法。

### 7. 当前回归锚点已经同时覆盖源码约束与真实筛选结果

本轮已确认的稳定验证锚点有两层：

- `tests/view-state.test.mjs` 新增源码级约束，要求 `ViewFilterBar` 改为在 chip 的 `pointerdown` 上清除 suppression，并显式禁止恢复 `setTimeout(...)` 释放窗口
- `npx playwright test tests/data-editor.spec.ts --grep "value filters support does_not_contain and is_not_empty with real row results"` 已通过，说明普通 value filter 的真实交互和行结果回归链路正常

后续如果这类 bug 再回归，先看这两个锚点是否同时失守：一个负责锁死实现时序，一个负责确认真实筛选结果没有再次受首次点击问题影响

## 关键检索词

`筛选条件首次点击无效`、`ViewFilterBar`、`openRuleId`、`openRuleRect`、`createPortal`、`pointerdown capture`、`filter-popover-content`、`filter-select-content`、`MultiSelectFilterPopover`、`TextFilterPopover`、`Radix Select`
