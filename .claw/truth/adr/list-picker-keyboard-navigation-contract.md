# 列表型选择弹层键盘导航合同

status: accepted

## context

data-editor 的列表型筛选器、单选、多选、relation 与公共 `SearchablePicker` 此前分别维护键盘行为，容易造成导航按键、确认后的开合语义、焦点归属和可访问性表达分叉。本轮已完成统一迁移，需要固定共享算法与业务状态之间的长期职责边界。

本 ADR 只覆盖列表型选择弹层；非列表型对话框、纯文本输入弹窗和全局快捷键不在此合同内。

## decision

### 1. 自定义列表复用无 UI 导航算法，Radix 原生组件保留内建语义

自定义列表统一通过 `src/components/listbox-keyboard-navigation.mjs` 解析 `ArrowUp`、`ArrowDown`、`Home` 与 `End`：上下方向循环移动，首尾键直接跳转，无候选时不产生有效活动项。

Radix `Select` / `Menu` 继续使用其内建键盘交互。业务代码只移除或修复会阻断原生行为的部分，不为这些组件复制一套并行导航实现。

### 2. 公共层只管理临时活动项与 ARIA 关系

`SearchablePicker` 继续由业务侧控制 `open` 与 `query`。公共选择器及其他接入组件只管理当前弹层生命周期内的活动项、滚动入视图、视觉活动态，以及 `combobox` / `listbox`、`aria-activedescendant`、`aria-selected` 等关联。

候选值、提交结果、创建行为和长期业务状态仍归各业务组件所有，不进入共享导航算法。

### 3. 输入焦点与确认语义按选择类型固定

可搜索选择器打开后，文本输入框保持实际焦点，导航键只移动活动候选；`Enter` 优先执行活动候选。只有没有可执行候选时，业务组件才可继续其合法的创建行为。

单选通过 `Enter` 确认后关闭弹层；多选切换后保持弹层打开并继续聚焦搜索输入，允许连续操作。`Escape` 不提交临时创建内容，并由弹层基础设施关闭弹层、恢复触发器焦点。

### 4. 活动项复位依赖稳定标量

候选变化时需要复位或校正活动索引，但 effect 依赖必须使用 query、候选数量、默认候选等稳定标量，不能依赖 render 中重新创建的候选数组。

此约束用于避免活动项因引用变化反复重置，并防止键盘高亮与用户当前输入节奏脱节。

## alternatives considered

- 每个业务弹层独立实现键盘处理：会重复维护循环、首尾跳转、滚动和 ARIA 细节，容易继续分叉，因此不采用。
- 把 `open`、`query` 或提交真值收进公共选择器：会破坏现有受控状态归属，并混淆导航层与业务层职责，因此不采用。
- 为 Radix `Select` / `Menu` 重写统一算法：会与成熟的原生语义竞争并增加回归面，因此不采用。

## consequences

- 新增自定义列表型选择弹层时，应优先复用共享导航算法，并由业务组件提供候选集合与确认动作。
- 鼠标 hover、键盘活动态和选中态必须保持可辨识，活动项变化后需要自动滚动到可视区域。
- 单选和多选共享导航按键，但确认后的弹层生命周期不同，接入时不能用一个无差别的 close 行为覆盖两者。
- 共享算法保持无 UI、无业务状态，便于以纯逻辑测试锁定循环和首尾行为；真实组件路径继续由 Playwright 验证。

## related code

- `src/components/listbox-keyboard-navigation.mjs`
- `src/components/SearchablePicker.tsx`
- `src/components/filters/AdvancedFilterRuleEditor.tsx`
- `src/components/filters/MultiSelectFilterPopover.tsx`
- `src/table/OptionFieldEditor.tsx`
- `src/table/RelationCellEditor.tsx`
- `src/styles.css`
- `tests/listbox-keyboard-navigation.test.mjs`
- `tests/data-editor.spec.ts`

## search terms

`listbox-keyboard-navigation`、`resolveListboxNavigationIndex`、`SearchablePicker`、`ArrowUp`、`ArrowDown`、`Home`、`End`、`aria-activedescendant`、`is-keyboard-active`、`OptionFieldEditor`、`RelationCellEditor`、`MultiSelectFilterPopover`
