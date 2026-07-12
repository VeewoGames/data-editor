# 选择器视觉状态半合并模型

status: accepted

## context

data-editor 的列表型选择弹层同时存在 `selected`、`default-candidate`、`is-keyboard-active`、`:hover`、Radix `[data-highlighted]` 与 `[data-state="checked"]` 等视觉来源。多套规则叠加会产生多个视觉焦点、高饱和背景、双描边，并模糊“已经选中”与“下一次交互目标”的区别。

本 ADR 沉淀正式方案 `docs/plans/2026-07-12-选择器交互状态视觉统一方案.md` 及其完成实施中的长期视觉模型。自定义 picker 与作用域内 Radix `Select` 已完成迁移，旧视觉职责已清理。

## decision

### 1. 采用 selected 独立、hover 与 keyboard active 合并的半合并模型

`selected` 是已经写入当前值的持久业务状态，必须保持独立。鼠标 `hover` 与键盘活动项统一为唯一的 `active target`，表示当前点击或按 `Enter` 将操作的候选。

pointer enter 与键盘导航写入同一个 `activeIndex`，任意时刻最多只允许一个 active target。输入来源可以作为内部信息保留，但不能产生第二套行级视觉。

### 2. 五态模型固定为 default、selected、active target、selected + active、disabled

视觉优先级固定为：

```text
active target > selected > default
```

active target 负责整行背景和单层 1px 边框；selected 通过 check、checkbox 等非颜色标识表达。`selected + active` 使用 active target 的背景和边框，同时保留 selected 的非颜色标识，不叠加第二套背景、描边或 `box-shadow`。disabled 最后覆盖交互能力与透明度，且不能成为 active target。

彩色 chip 只表达选项类别，不承担 selected 状态说明，也不因 selected 或 active target 改变类别色。

### 3. default-candidate 退出视觉合同

`default-candidate` 只允许保留为弹层打开时初始化活动项的内部逻辑，不再拥有独立 class 视觉或 CSS 规则。

自定义选择器的状态 class 收口为 `.is-selected`、`.is-active-target` 与 `.is-disabled`；旧 `.default-candidate`、`.is-keyboard-active` 的视觉职责已随迁移清理，不保留新旧并行的兼容分支。

### 4. 自定义选择器与 Radix 共享语义 token，不强求相同 DOM

选择器状态颜色、边框、图标、圆角、disabled 透明度和 transition 应集中为 picker 语义 token，组件局部不再追加同等职责的十六进制色值或高特异性覆盖。

自定义 picker 使用统一状态 class；Radix 保留原生焦点与键盘管理，但 selected / active 映射只作用于 `.select-content` 内的 `Select`：通过 `[data-highlighted]` 映射 active target、`[data-state="checked"]` 映射 selected、二者组合映射 `selected + active`。普通 action menu 不共享选择语义，也不接受全局裸 data attribute 样式。共享的是视觉语义与 token，而不是 DOM 结构。

### 5. pointer 只有在 mouse / pen 真实移动时接管 active target

pointer 与键盘共享 `activeIndex`，但 pointer 接管必须满足两个条件：来源是 mouse 或 pen，且发生真实坐标移动。

touch 不接管 active target；布局变化、滚动或浏览器合成产生的零位移 pointer 事件也必须忽略。这一边界避免触摸滚动制造粘滞 hover，也避免页面重排或滚动把键盘活动项意外抢走。

### 6. 多选默认候选、selected 标识与 contextual action 各自保持职责

多选弹层打开或搜索复位时，活动项继续优先首个未选候选，以保持 `Enter` 新增语义。selected check 位于主选择按钮内部；重命名、删除、改色、relation 跳转等 contextual action 使用独立尾槽，不能替代 selected 标识，也不能改变主选择动作。

事务式 draft、`Escape` 恢复、正常提交、单选关闭、拖拽和 relation action 等既有业务语义不因视觉统一而改变。

### 7. 实施与验证顺序固定为 token、状态、组件迁移、Radix 映射、验证

本轮按以下顺序完成实施：

1. 建立状态矩阵、picker 语义 token 和集中式 CSS 状态层。
2. 让 pointer 与键盘导航共用 `activeIndex`，移除 default-candidate 的视觉职责。
3. 依次迁移 `SearchablePicker`、字段与 relation 选择器、筛选器及 Automation Settings picker。
4. 映射 Radix 状态并清理冲突的 hover / selected 规则。
5. 通过状态组合、输入方式切换、ARIA 指向、Playwright 与正式 8787 Browser 视觉检查验收。

该顺序也是后续扩展新 picker 或调整视觉合同的默认迁移顺序。

## alternatives considered

- hover 与 keyboard active 完全分开：可能同时强调两行，并让最醒目的 hover 行与 `aria-activedescendant` 指向不同目标，因此不采用。
- 将 selected 也并入 active target：活动项移动后会丢失对既有选中值的持久识别，因此不采用。
- 保留 `default-candidate` 独立视觉：会继续制造第三种临时高亮并与 active target 叠加，因此不采用。
- 按组件继续追加局部 CSS 覆盖：会扩大状态语义和特异性差异，因此不采用。

## consequences

- 后续选择器视觉评审以五态矩阵和唯一 active target 为准，不再按输入设备分别设计两套行高亮。
- selected 必须至少有 check、checkbox 等非颜色标识，不能只依靠背景色。
- 组合态只能覆盖属性，禁止多层 `box-shadow`、双边框、大面积高饱和蓝底，以及位移、缩放或浮起动画。
- 自定义 picker 与作用域内 Radix `Select` 可以保留不同 DOM 和焦点实现，但必须消费同一套状态语义与视觉 token；普通 action menu 保持独立。
- 迁移组件时必须同步删除旧视觉规则，避免通过更高特异性强压遗留 CSS。
- pointer 接管需要真实 movement 证据，touch 与零位移合成事件不能改变键盘活动项。
- 多选默认 active target 优先未选候选，视觉统一不得把打开后的 `Enter` 语义退化为取消既有选择。

## related code

- `docs/plans/2026-07-12-选择器交互状态视觉统一方案.md`
- `src/components/SearchablePicker.tsx`
- `src/table/OptionFieldEditor.tsx`
- `src/table/RelationCellEditor.tsx`
- `src/components/filters/MultiSelectFilterPopover.tsx`
- `src/components/filters/AdvancedFilterRuleEditor.tsx`
- `src/styles.css`
- `tests/data-editor.spec.ts`

## search terms

`selector visual state`、`半合并模型`、`selected`、`active target`、`activeIndex`、`pointer movement`、`touch`、`default-candidate`、`is-keyboard-active`、`is-active-target`、`.select-content`、`data-highlighted`、`data-state=checked`、`picker token`、`contextual action trailing slot`
