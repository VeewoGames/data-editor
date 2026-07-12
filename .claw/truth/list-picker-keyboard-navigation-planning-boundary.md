# 列表型选择弹层键盘交互：统一规划合同与公共导航边界

## 结论

data-editor 后续实现列表型选择弹层键盘交互时，应采用同一套可复用合同：

- `ArrowUp` / `ArrowDown` 在当前可用候选中循环移动活动项。
- `Home` / `End` 分别移动到首个 / 末个可用候选。
- `Enter` 对当前活动项执行选择或切换。
- `Escape` 关闭弹层，并把焦点恢复到原触发器。
- 导航必须跳过禁用项；活动项变化后必须滚动进入可视区域。
- 单选确认后关闭弹层；多选确认后保持弹层打开，允许继续切换其他候选。

这是 planning 阶段已经稳定的目标合同，不代表所有自定义候选列表当前已经完成实现。

## 长期边界

### 1. 原生 Radix 选择控件保留其组件语义

项目中基于 `@radix-ui/react-select` 的 `Select`，以及基于 Radix Menu 的菜单，应继续依赖 Radix 自带的键盘交互，不需要为了统一而重复实现一套自定义导航层。

统一公共能力的主要对象，是自行渲染候选列表、当前没有完整 listbox 键盘语义的组件。

### 2. 自定义候选列表共用同一导航能力

公共导航能力至少应覆盖或可被以下自定义候选面复用：

- `src/components/SearchablePicker.tsx`
- `src/table/OptionFieldEditor.tsx`
- `src/components/filters/MultiSelectFilterPopover.tsx`
- `src/table/RelationCellEditor.tsx`

后续发现新的自定义候选列表时，应先判断它是否属于相同的“活动项移动 + 确认/切换 + 关闭/恢复焦点”交互模型，再决定接入公共能力；不要在各组件内继续复制相似的索引计算与按键分支。

### 3. 公共层负责导航机制，宿主保留业务语义

公共能力应负责：

- 根据候选集合与禁用状态计算下一个活动项。
- 处理循环、首尾跳转与无可用候选的边界。
- 维护活动项和必要的 DOM 定位信息。
- 在活动项变化后将其滚动入视图。
- 暴露关闭后恢复触发器焦点所需的机制。

各宿主组件继续负责：

- `Enter` 最终调用哪个选择或切换回调。
- 当前交互是单选还是多选。
- 单选确认后关闭、多选确认后保持打开的业务分流。
- 候选筛选、创建新选项、relation 跳转等现有业务行为。

### 4. `SearchablePicker` 继续保持受控状态归属

`src/components/SearchablePicker.tsx` 已明确采用受控 `open` / `query` 接口。接入键盘导航时，不应把这两个状态迁入公共导航层，也不应让 `SearchablePicker` 变成新的全局状态源。

调用方仍持有：

- `open` / `onOpenChange`
- `query` / `onQueryChange`

公共导航只补足候选活动项、按键路由、滚动与焦点恢复，不改变现有受控状态合同。

## 关联代码

主要锚点：

- `src/components/SearchablePicker.tsx`：公共可搜索 picker，现有 `open` / `query` 受控合同与自定义 `role="listbox"` 候选容器。
- `src/table/OptionFieldEditor.tsx`：表格与详情中的单选 / 多选字段候选交互。
- `src/components/filters/MultiSelectFilterPopover.tsx`：多选筛选候选与搜索输入。
- `src/table/RelationCellEditor.tsx`：relation 候选列表与编辑交互。

相关原生语义锚点：

- `src/components/RelationConfigDialog.tsx`
- `src/components/Toolbar.tsx`
- `src/components/sort/SortPopover.tsx`
- `src/components/filters/AdvancedFilterSelect.tsx`

这些文件中的 Radix `Select` 可作为“不重复建设自定义导航”的边界证据。

## 验证标准

实现阶段的最小验收矩阵应同时覆盖：

- 单选与多选两种确认后开合行为。
- 首项向上、末项向下时的循环。
- `Home` / `End` 首尾跳转。
- 禁用项位于首尾、中间以及全部禁用的情况。
- 搜索结果变化后活动项仍落在当前可用候选内。
- 长列表活动项自动滚动入视图。
- `Escape` 关闭后焦点回到打开弹层的原触发器。
- Radix `Select` / Menu 的既有键盘语义不因公共能力接入而回归。

## 已知陷阱

- 只处理搜索输入上的 `onKeyDown`，会遗漏候选项或容器取得焦点后的按键路径。
- 只存数组索引而不根据筛选结果、禁用状态重新归一化，会让活动项指向不可见或不可选候选。
- 把关闭逻辑硬编码进公共层，会破坏多选保持打开的合同。
- 在 `SearchablePicker` 内部接管 `open` / `query`，会破坏现有调用方的状态归属。
- 仅设置视觉高亮而不处理滚动和焦点恢复，不能视为完整键盘可用性。

## 关键检索词

`SearchablePicker`、`OptionFieldEditor`、`MultiSelectFilterPopover`、`RelationCellEditor`、`ArrowUp`、`ArrowDown`、`Home`、`End`、`Escape`、`scrollIntoView`、`listbox`、`active option`、`trigger focus`

## 已落地的共享算法与消费面（2026-07-12）

### 无 UI 算法是单一移动规则入口

`src/components/listbox-keyboard-navigation.mjs` 已成为列表活动项移动的无 UI 共享算法：

- `resolveListboxNavigationIndex(...)` 统一处理 `ArrowUp` / `ArrowDown` 循环、`Home` / `End` 首尾跳转和空列表返回 `-1`。
- `isListboxNavigationKey(...)` 只识别移动键；`Enter`、`Escape` 等业务动作仍由宿主决定。

`tests/listbox-keyboard-navigation.test.mjs` 已覆盖循环、首尾、空列表和移动键识别；该测试可作为后续修改共享算法时的最小回归入口。

### 已接入统一 contract 的自定义列表

以下消费面已经复用共享算法，不再各自定义不同的索引移动规则：

- `src/components/SearchablePicker.tsx`
- `src/table/OptionFieldEditor.tsx`
- `src/table/RelationCellEditor.tsx`
- `src/components/filters/MultiSelectFilterPopover.tsx`
- `src/components/filters/AdvancedFilterRuleEditor.tsx`

`src/components/ViewFilterBar.tsx` 的新增筛选字段菜单也已支持 `ArrowUp` / `ArrowDown` / `Home` / `End` 在未禁用的 `menuitem` 间移动焦点。

`src/App.tsx` 中 Automation Settings 的技能、目标文件和目标集合候选已经统一渲染为 `SearchablePicker`，不再保留技能或目标集合的重复内联 picker 结构。它们继续由业务侧持有各自的 open / query 状态。

### 单选、多选与焦点合同已经分流落地

- `SearchablePicker` 保持 `open` / `query` 受控；`Enter` 通过活动 option 的既有点击路径确认，不复制业务回调。
- 单选确认后由宿主关闭 Popover，并沿 Popover 的关闭语义把焦点恢复到 trigger。
- 多选 `Enter` 只切换当前活动候选，弹层继续打开，输入保持焦点，便于连续操作。
- `OptionFieldEditor`、`RelationCellEditor` 等宿主继续决定确认是单选提交还是多选切换，共享算法不接管开合业务。

### 活动项的视觉、DOM 与无障碍合同

键盘活动态使用 `.is-keyboard-active`，与已选择态和 hover 态分离；后续视觉调整不能把“当前键盘位置”与“已选中值”合并成同一状态。

搜索输入保持实际焦点，并通过 combobox / listbox 关系表达虚拟焦点：

- 输入使用 combobox 语义并通过 `aria-controls` 关联候选 listbox。
- `aria-activedescendant` 指向当前活动 option。
- option 维护稳定 `id`、`role="option"` 与 `aria-selected`。
- 活动项变化后调用 `scrollIntoView({ block: "nearest" })`，保证长列表中的活动候选可见。

## 新增稳定陷阱：effect 依赖必须使用稳定标量

筛选候选通常会在 render 中重新构造数组。如果“查询变化后重置 / 归一化活动项”的 effect 直接依赖该候选数组，数组引用会在每次 render 变化，键盘移动触发 render 后 effect 随即再次运行，导致活动项被重置，表现为方向键无法连续移动。

`MultiSelectFilterPopover` 与 `AdvancedFilterRuleEditor` 的稳定依赖方式是使用真正决定候选集合或默认活动项的标量，例如：

- query / search
- 筛选后候选数量
- 默认候选的稳定 value

后续相同组件不得把每次 render 新建的 `filteredOptions` 数组引用直接作为活动项重置 effect 的依赖；如需感知候选身份变化，应先形成稳定 key，而不是依赖临时数组对象。

## 扩展后的关联代码

- `src/components/listbox-keyboard-navigation.mjs`：无 UI 共享移动算法。
- `tests/listbox-keyboard-navigation.test.mjs`：共享算法最小单元测试。
- `src/components/filters/AdvancedFilterRuleEditor.tsx`：高级筛选多选候选的统一导航与稳定 effect 依赖锚点。
- `src/components/ViewFilterBar.tsx`：新增筛选字段 menu 的键盘焦点移动。
- `src/App.tsx`：Automation Settings 技能、目标文件、目标集合统一迁移到受控 `SearchablePicker`。

## 当前验证边界（2026-07-12）

本轮统一键盘交互已经通过以下定向验证：

- `node --test tests/listbox-keyboard-navigation.test.mjs`：共享导航算法测试通过。
- TypeScript typecheck 通过。
- production build 通过。
- 定向 Playwright 共 7 条核心路径通过：Option 的 `Enter` / 方向键、多选切换、single relation 确认后关闭、普通筛选方向键、高级筛选 `Enter`、relation `SearchablePicker`、automation target picker。
- 正式服务健康检查：`8787/api/health` 返回 `{ok:true,bridgePort:8791}`，`8791/health` 返回 `{ok:true}`。

这组证据足以证明共享算法、主要消费面、构建链与正式双端口服务在本轮目标范围内可用，但不能表述为全量 `npm test` 已全绿。全量测试仍存在与本轮无关的既有失败，例如自动化绑定本地路径、`ViewTabs` 源码快照；后续回归报告必须把“本轮定向验证通过”与“仓库全量测试状态”分开陈述。

## Recheck 后的最终收口约束

### `SearchablePicker` 活动项重置依赖稳定结构信号

`src/components/SearchablePicker.tsx` 的活动项初始化 / 重置 effect 依赖 `childCount`、`open`、`query` 和已挂载的 `listElement`，而不是 `children` 节点对象或每次 render 重建的 option 数组。`listElement` 必须由 callback ref 写入 state，使 Radix Portal 中的 list DOM 实际挂载能够触发 effect 重跑。

这条边界与筛选组件的稳定标量规则一致：父组件发生与候选无关的重渲染时，不得因为 React children 引用变化而把用户刚移动到的活动项重置。但 Portal DOM 挂载是必要的结构信号，不能只使用不会触发 render 的普通 ref。

### Searchable option 必须同步选中语义

`SearchablePicker` 在整理候选 DOM 时，会根据 option 的 `.is-selected` 状态同步 `aria-selected`。后续新增 searchable option 时，仍需提供稳定的已选中视觉状态；公共 picker 负责把它转换为 listbox option 的无障碍选中语义，不能只保留颜色或 class 而遗漏 `aria-selected`。

### 单选关闭规则不区分“新选”与“已选项切换”

单选 picker 的 `Enter` 确认合同是“执行当前活动 option 的既有动作后关闭”，即使活动项当前已经选中、业务动作表现为切换或清空，也必须关闭弹层并恢复 trigger 焦点。是否已选中只影响业务值变化，不改变单选确认后的关闭语义。

## 最终完成状态

本轮计划已按 `9/9` 完成，retrospective 与 key decisions 已记录。最终验证保持以下边界：typecheck、共享导航单测 `2/2`、production build、`git diff --check` 与定向 Playwright 7 条核心路径通过；全量 `npm test` 仍有既有非本轮失败，因此长期表述仍应是“目标范围定向验证通过”，不能写成“仓库全量测试全绿”。

## 选择器视觉状态半合并模型（planning）

本轮视觉方案已经稳定采用“半合并”状态模型，但尚未实施业务样式。后续实现与评审必须区分目标合同和当前 UI：

- `selected` 是持久业务语义，表示值已经被选择；它始终是独立状态，不与 hover 或键盘位置合并。
- hover 与 keyboard active 合并为唯一的 `active target`，表示用户下一次确认会作用到的候选。
- pointer enter 与键盘导航更新同一个 `activeIndex`，不再并行维护一套 hover target 和一套 keyboard target。
- `default-candidate` 不再作为独立视觉状态；如果业务仍需计算默认候选，它只能用于初始化 / 回退活动项，不能形成第四套行样式。

### 组合态视觉职责

候选行的视觉职责固定为：

- active 负责整行背景与单层边框，作为唯一的当前目标反馈。
- selected 通过 check 等明确标记表达持久选中语义。
- `selected + active` 可以同时存在：行背景 / 边框仍由 active 负责，check 仍由 selected 负责，不能叠加两套背景、双边框或重复强调。
- 非 active 的 selected 行仍保留 check，但不应伪装成当前交互目标。

这套分工的长期目的，是让用户同时看懂“哪些值已经选中”和“下一次 Enter / 点击将作用于哪一行”，同时避免 hover、keyboard active、default candidate 三套瞬时视觉互相竞争。

### 实现边界

本轮只产出正式方案文档，不授权修改业务样式或交互实现。未来执行时，应以既有统一 `activeIndex` 键盘合同为基础，把 pointer enter 路由到同一活动项状态，并同步更新 CSS 与定向交互测试；不得仅通过 CSS 把 hover 画得像 active，却继续保留两个互不一致的状态源。

### 关键检索词

`selected`、`active target`、`activeIndex`、`pointer enter`、`keyboard active`、`default-candidate`、`.is-keyboard-active`、`check`、`selected + active`

## 视觉统一方案的正式文档锚点

半合并视觉模型的完整正式方案已落盘并通过 recheck：

- `docs/plans/2026-07-12-选择器交互状态视觉统一方案.md`

该文档是后续实施的详细入口，覆盖：

- `default`、`selected`、`active target`、`selected + active target`、`disabled` 状态矩阵与优先级。
- 语义视觉 token、统一状态 class 与 CSS 结构建议。
- `SearchablePicker`、`OptionFieldEditor`、`RelationCellEditor`、普通 / 高级筛选、添加筛选字段菜单、Automation Settings picker 的迁移顺序。
- Radix `[data-highlighted]` / `[data-state="checked"]` 到同一 token 的视觉映射，同时保留 Radix 自身焦点管理与键盘行为。
- 分阶段实施、自动化与正式 `8787` Browser 视觉验证矩阵、风险控制和验收标准。

本轮完成状态仅为“正式方案文档完成且 recheck 通过”。业务状态、CSS token、组件迁移与 Radix 映射均未在本轮实施；后续不得引用这条 truth 声称当前产品视觉已经符合半合并模型。

## 视觉统一实施轮边界（已批准，待落地）

用户已批准继续实施 `docs/plans/2026-07-12-选择器交互状态视觉统一方案.md`。实施轮必须保持以下合同，不得在编码过程中重新分叉状态模型：

- `selected` 继续表示独立、持久的业务选中语义。
- hover 与 keyboard active 共用唯一 `active target` 和同一活动项状态源。
- 多选弹层打开或候选上下文重置时，默认活动项优先落到首个未选候选；没有未选候选时再按方案定义的回退规则处理。
- 尚未提交的选择变化继续属于事务 draft；视觉状态不得越过既有提交 / 取消边界提前写入正式值。
- pointer 与 touch 必须分流：pointer hover 可以更新 active target，touch 不能因为模拟 hover 破坏点按、滚动或既有活动项。
- Radix 视觉映射必须有明确作用域，只统一目标选择器 / 菜单的 token，不得用无边界的全局 data-attribute 选择器污染 Dialog、Tabs 或其他 Radix surface。
- 状态 class 采用一次性迁移：旧的 `default-candidate`、分散 hover / keyboard class 与新 active class 不长期双轨兼容；迁移后以新模型为唯一框架。

### 实施与验证合同

实施顺序继续以正式方案为准：先建立状态 token / class，再统一活动项状态源，随后迁移自定义 picker、做作用域 Radix 映射，最后执行自动化与正式页面视觉验证。

最小验收必须同时证明：

- selected、active、selected + active、disabled 的组合视觉职责没有重叠。
- 鼠标与键盘在同一 active target 上连续切换，不出现双高亮。
- 多选首个未选默认候选、单选确认关闭、事务 draft 的提交 / 取消语义保持正确。
- touch 滚动与点按不被 pointer hover 路径回归。
- Radix 映射只作用于目标选择器范围。
- typecheck、build、定向交互测试与正式 `8787` Browser 视觉核对完成；仓库全量测试若仍有既有失败，继续与本轮结果分开报告。

本节记录的是已批准的实施合同，不表示上述代码和样式当前已经完成。

## 视觉迁移 task 3：组件清单与旧 class 退出

视觉状态迁移已经锁定并开始覆盖以下正式消费面：

- `src/components/SearchablePicker.tsx`
- `src/table/OptionFieldEditor.tsx`
- `src/table/RelationCellEditor.tsx`
- `src/components/filters/MultiSelectFilterPopover.tsx`
- `src/components/filters/AdvancedFilterRuleEditor.tsx`
- `src/components/ViewFilterBar.tsx` 的 add-filter menu
- `src/App.tsx` 中 Automation Settings 的 `SearchablePicker` 消费面
- `src/styles.css` 中以 `.select-content` 为作用域的 Radix `Select` 视觉映射

统一状态 class 的当前真值是：

- `.is-selected`：持久选中语义。
- `.is-active-target`：pointer / keyboard 共用的唯一当前目标语义。
- Radix `Select` 继续通过 `.select-content .menu-item[data-highlighted]` 表示 active，通过 `.select-content .menu-item[data-state="checked"]` 表示 selected；作用域保持在 `.select-content` 内。

`default-candidate` 与 `is-keyboard-active` 已从 `src` 中退出，后续不能重新作为 DOM / CSS class 引入。一次性 class 迁移意味着新旧视觉命名不再双轨兼容。

### 逻辑 `defaultCandidate` 与旧视觉 class 必须区分

逻辑变量 `defaultCandidate` 仍然保留，并继续承担多选弹层“首个未选候选优先成为活动项”以及 Enter 默认命中的计算职责。它存在于 `OptionFieldEditor`、`RelationCellEditor`、`MultiSelectFilterPopover`、`AdvancedFilterRuleEditor` 与 `discrete-value-picker.mjs` 等逻辑链路中。

因此，后续清理时只能删除旧的 `.default-candidate` 视觉 class / 样式，不得因为名称相近而删除 `defaultCandidate` 业务计算。稳定边界是：默认候选是活动项初始化策略，不是独立视觉状态。

### 样式检索锚点

后续审计统一迁移是否完整时，优先检索：

- `is-active-target`
- `is-selected`
- `data-picker-option-row`
- `.select-content .menu-item[data-highlighted]`
- `.select-content .menu-item[data-state="checked"]`

同时用 `rg` 确认 `src` 内不再出现 `default-candidate` / `is-keyboard-active`。

## 视觉迁移 task 4：语义 token 与可访问状态组合

`src/styles.css` 已建立 picker row 的语义视觉层，后续组件样式应消费这组集中规则，不再在各 picker 内增加彼此不同的硬编码状态色。

已落地的稳定样式合同包括：

- light / dark 两套 picker row 语义 token。
- selected、active、selected + active、disabled 的组合规则；active 负责当前目标的行背景 / 边框，selected 继续通过 check 或 checkbox 表达。
- selected 不依赖颜色作为唯一标识，避免 selected 与 active 的背景色竞争，也满足非颜色识别边界。
- 搜索输入使用 focus ring，候选 / 输入容器按需要使用 `:focus-within`，使真实输入焦点与虚拟活动项同时可见但职责分离。
- `forced-colors` 有独立适配，不能只验证常规 light / dark 主题。
- 旧 `.default-candidate` 与 `.is-keyboard-active` 视觉规则已移除；新实现以 `.is-selected` / `.is-active-target` 及作用域 Radix data attributes 为唯一状态样式入口。

后续视觉回归应至少检查 light、dark、forced-colors，以及 selected + active、disabled + selected 等组合态；仅查看默认主题截图不足以证明语义 token 完整。

## 视觉迁移 task 5：统一 pointer 导航模型

`src/components/useListboxPointerNavigation.ts` 已成为自定义候选列表的公共 pointer-to-activeIndex 入口。它采用列表容器事件代理，而不是给每个 option 分别维护 hover 状态。

稳定行为边界如下：

- `pointerType === "touch"` 时不更新活动项，避免触摸滚动 / 点按被桌面 hover 语义干扰。
- 只有当前事件的 `clientX` / `clientY` 与上一次已记录坐标相同时才跳过；首个 pointer move 没有上一坐标，即使 `movementX` / `movementY` 为 `0` 也必须允许命中并同步 `activeIndex`。
- 通过 `itemSelector` 在当前列表容器内定位 option，并把 DOM 顺序映射为统一 `activeIndex`。
- hook 只负责 pointer 命中到索引的转换，不负责 selected、确认、开合或 draft 提交。

已确认的独立浏览器陷阱：Chromium / React 弹层中的正常首个 hover 事件也可能报告 `movementX === 0 && movementY === 0`，因此这两个字段不能作为事件无效判据。它不是本轮 `SearchablePicker` 文件项始终无 hover 的最终根因；可靠 pointer 去重仍只比较已记录的上一组 `clientX` / `clientY`，没有上一坐标时不能过滤。

### `SearchablePicker` Portal 挂载时序是文件项无 hover 的最终根因

`SearchablePicker` 的 list 位于 Radix Portal。父组件 effect 可能先于 Portal list DOM 挂载执行；如果只读取普通 ref，节点后续写入 ref 不会触发 render / effect 重跑。结果是 option 没有被补齐 `role="option"`、稳定 `id`、`aria-selected` 和 `.is-active-target`，而旧 pointer selector 又依赖 `[role="option"]`，因此事件代理永远无法命中文件 option。

最终修复固定为两部分：

- 使用 `listElement` state callback ref（`ref={setListElement}`），让 Portal list 节点挂载成为 effect 依赖并触发 option 初始化。
- pointer hook 的 `itemSelector` 直接使用 `.searchable-picker-option:not(:disabled)`，不再把 effect 后补的 `role` 作为 hover 命中的前置条件。

正式 `8787` Chrome 实测基线：移动到第二项后 `:hover === true`、active 为 true，背景 `rgb(238, 242, 247)`、边框 `rgb(200, 212, 227)`，且唯一 active target 会随鼠标在候选间切换。

当前消费面包括：

- `SearchablePicker`
- `OptionFieldEditor`
- `RelationCellEditor`
- `MultiSelectFilterPopover`
- `AdvancedFilterRuleEditor`
- `ViewFilterBar` add-filter menu

后续新的自定义 picker 应复用该 hook；不得重新添加 option 级 `onMouseEnter` / `onPointerEnter` 形成第二套 hover 状态源。

## 视觉迁移 task 6：Option / Relation 行结构边界

`OptionFieldEditor` 与 `RelationCellEditor` 已统一迁移到 `.is-selected` / `.is-active-target` 状态 class，同时保持原有业务链不变。

稳定 DOM / 视觉职责如下：

- `OptionFieldEditor` 的 selected check 位于主选择按钮内部；编辑 / 更多菜单保留独立尾部槽位。check 不能与菜单 trigger 争用同一个交互节点，也不能让点击 selected 标记误触发更多菜单。
- `RelationCellEditor` 的 selected check 与 open-target 动作分离；check 表示关系值已选，open-target 仍是独立跳转动作，不能因视觉统一把二者合成同一按钮。
- 行背景与边框继续由 `.is-active-target` 负责，check 只表达 `.is-selected`，尾部动作不额外制造第三种行高亮。

本轮只迁移视觉状态与行内标记位置，以下逻辑合同保持不变：

- `defaultCandidate` 的活动项初始化 / Enter 命中计算。
- 多选事务 `draft` 与提交 / 取消边界。
- 单选确认后关闭并恢复 trigger 焦点。
- Option 拖拽与菜单动作。
- Relation 的 open-target 跳转行为。

后续重构这两类 option row 时，应分别回归“主选择动作、selected 标记、尾部菜单 / 跳转动作”，不能只验证整行截图。

## 视觉迁移 task 7：筛选候选与 add-filter menu

`MultiSelectFilterPopover` 与 `AdvancedFilterRuleEditor` 已统一使用 `.is-selected` / `.is-active-target`，并通过 `useListboxPointerNavigation` 让 pointer 与 keyboard 更新同一个 `activeOptionIndex`。

筛选候选中的 checkbox 继续是 selected 的非颜色标识；行 active 背景不能替代 checkbox，也不能因为 option 当前 active 就伪造 checked。selected 与 active 的组合仍允许同时存在。

`ViewFilterBar` 的添加筛选字段菜单已用同一个 `activeIndex` 同步 pointer / keyboard 目标。其 menuitem 只使用 active target 语义，不引入 selected 状态；后续若添加禁用字段，焦点 / pointer 索引仍必须以可交互 menuitem 集合为准。

这三处迁移保持既有筛选值、创建候选、默认候选和规则编辑逻辑不变；视觉统一不能改变筛选条件的提交语义。

## 视觉迁移 task 8：Automation 与作用域 Radix 映射

`src/App.tsx` 中 Automation Settings 的 skills、target files、target collections 继续通过公共 `SearchablePicker` 获得 `.is-selected` / `.is-active-target`、pointer 导航和无障碍状态，不建立 automation 专属状态样式或导航逻辑。

Radix `Select` 的视觉统一固定在 `.select-content` 作用域内：

- `.select-content .menu-item[data-state="checked"]` 映射 selected token。
- `.select-content .menu-item[data-highlighted]` 映射 active target token。
- selected check 通过受控的 `::after` 呈现，使 Radix item 与自定义 option 同样具有非颜色选中标识。
- highlighted + checked 可组合，但仍由 active 负责背景 / 边框、check 负责 selected。

普通 action menu 不属于值选择器，不套 selected 语义，也不因为复用 `.menu-item` class 而显示 check。后续扩展 Radix 映射时必须继续以 `.select-content` 为边界，不能把 `[data-state="checked"]` / `[data-highlighted]` 的 picker 视觉提升为全局 `.menu-item` 规则。

## 视觉统一 task 9：最终验证证据与边界

本轮实施计划记录在：

- `.claw/tasks/实施选择器交互状态视觉统一方案/plan.json`

已完成且可复用的最终验证证据：

- `npm run typecheck` 通过。
- `npm run build` 通过；只出现既有 chunk size warning，不属于本轮构建失败。
- `node --test tests/listbox-keyboard-navigation.test.mjs` 为 `2/2` 通过。
- 核心定向 Playwright 为 `7/7` 通过，覆盖 Option、Relation、普通筛选、Advanced filter、`SearchablePicker` 与 Automation picker 的关键路径。
- `git diff --check` 通过。
- `src` 范围内 `default-candidate` / `is-keyboard-active` 已清零，证明旧视觉 class 没有留在正式源码中。

### 不应归因于本轮的失败

完整 `npm test` 与额外 operator z-index 用例仍可能出现既有失败或重渲染时序波动。这些失败不在已通过的核心视觉 / 交互路径内，当前没有证据证明它们由本轮选择器状态迁移引起。

后续报告必须采用分层表述：

- 可以确认“本轮核心定向验证、类型检查、构建、共享算法单测和 diff-check 通过”。
- 不可以写成“仓库全量测试全绿”。
- operator z-index 或重渲染波动若需处理，应单独复现并沿其自身调用链归因，不能直接作为 picker 视觉回归计入本轮。

该边界与前一轮键盘统一验证规则一致：定向通过是本任务的完成证据，全量既有失败必须保留独立状态。

## 视觉统一 task 10：正式 8787 recheck 与计算样式基线

最终 recheck 结论为 `Proceed`。正式 `8787` UI 的 light-theme 计算样式基线已经确认：

- selected-only：背景 `rgb(247, 247, 245)`，边框透明。
- active-only：背景 `rgb(238, 242, 247)`，边框 `rgb(200, 212, 227)`。
- 普通项：背景与边框透明。
- 以上三种状态均无 `box-shadow`。

这些值是当前正式 UI 的计算样式验收锚点，用于发现双背景、双描边、残留阴影或 selected / active 职责串位；后续主题 token 调整可以改变具体色值，但必须同步更新正式 Browser 基线，且继续保持 selected-only 与 active-only 的语义分工。

recheck 再次确认以下长期约束已经成立：

- hover 与键盘共用唯一 `.is-active-target`；非 touch pointer 只在 `clientX` / `clientY` 与上一条事件完全相同时被去重。
- touch 不接管键盘活动项；不得使用 `movementX === 0 && movementY === 0` 判定事件无效。
- selected 独立于 active，并用 check / checkbox 提供非颜色标识。
- Radix selected / active 只在 `.select-content` 作用域内映射。
- 普通 action menu 不继承 picker selected 视觉，也不显示选择 check。

因此，本轮视觉状态统一可按 `Proceed` 收口；后续回归优先对照上述计算样式、单一 active target 与作用域边界，而不是只凭截图主观判断颜色是否接近。

### 高频 pointer active 不使用颜色过渡

正式 `8787` Chrome 实测确认：hover 对应的 `.is-active-target` class 会在鼠标移动完成时立即切换，但旧公共 token `--picker-row-transition: 110ms ease` 会让背景和边框在 class 已正确的瞬间仍保持透明；约 `35ms` 时只完成约 `75%`，约 `135ms` 才到目标色。连续扫过长列表时，每次 active target 切换都会重启动画，形成明显拖尾，使视觉反馈落后于真实 pointer 目标。

最终 canonical token 已改为 `--picker-row-transition: 0ms linear`。复测时 active class 切换后立即得到背景 `rgb(238, 242, 247)`、边框 `rgb(200, 212, 227)`，计算 `transition` 为 `0s`。

长期约束：列表 hover / keyboard active 属于高频定位反馈，背景与边框不得使用颜色过渡。后续可以为低频装饰或弹层开合设计动画，但不能复用到 picker row active target；验证时应同时检查 class、即时计算样式和 transition duration，不能只在动画结束后截图。

## 视觉状态统一最终完成态（11/11）

`.claw/tasks/实施选择器交互状态视觉统一方案/plan.json` 已 `11/11 done`，retrospective 与 key decisions 已补齐。本节取代前文“仅方案 / 待落地”的阶段性状态：选择器交互状态视觉统一现已完成实施与收尾。

当前 canonical 行为与视觉合同为：

- selected 是独立持久语义，并使用 check / checkbox 提供非颜色标识。
- hover 与 keyboard 共用唯一 `.is-active-target` 和同一 `activeIndex`。
- pointer 在非 touch 时允许接管活动项，仅跳过与上一条事件具有相同 `clientX` / `clientY` 的重复坐标；touch 始终忽略。
- 自定义 picker 使用 `.is-selected` / `.is-active-target`；旧 `default-candidate` / `is-keyboard-active` 视觉 class 已退出正式源码。
- Radix selected / active 只通过 `.select-content` 内的 `data-state="checked"` / `data-highlighted` 映射，普通 action menu 不受污染。
- light / dark token、selected / active / disabled 组合、focus / focus-within 与 forced-colors 规则已经落地。
- Option、Relation、普通 / 高级筛选、add-filter menu、Automation `SearchablePicker` 已纳入统一模型，同时保持 draft、单选关闭、拖拽、跳转和筛选提交等业务合同。

验证、正式 `8787` UI 复核和 data-editor 服务收尾均已完成。最终验收仍遵守既有证据边界：核心定向验证通过；完整 `npm test` 的既有无关失败不应被改写为本轮视觉回归，也不应被表述成全量测试全绿。

后续维护应以本节、task 9 的验证边界和 task 10 的正式计算样式基线为最新真值；此前 planning 章节只用于解释设计来源，不再表示当前实现状态。
