# nested 编辑界面的信息架构收口与实施顺序

status: accepted

## context

这条 ADR 记录的是 `nested` 编辑界面优化的长期决策，不是实施进度说明。

本轮决策确认了两件事：

- `nested` 编辑界面的半成品感主要来自信息架构和交互层尚未收口，而不是底层编辑能力缺失
- 后续优化必须继续建立在既有 `DetailPanel + nestedStack + NodeEditorHost + schema registry` 上，不新增第二套 nested 编辑器

已知稳定基础包括：

- `src/detail/DetailPanel.tsx`
- `src/detail/NodeEditorHost.tsx`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`

## decision

### 1. nested 编辑界面的优化继续建立在现有主链上

后续 nested 编辑优化只在既有架构边界内推进：

- `DetailPanel` 继续作为 nested 入口与导航宿主
- `nestedStack` 继续作为导航真值
- `NodeEditorHost` 继续作为 schema-driven 节点承接层
- `schema registry` 继续作为节点命中与分流真值

本轮不重新造一套独立 nested 编辑器，也不把问题解释成“只补样式就够了”。

### 2. 当前问题的定性固定为信息架构与交互层未收口

`nested` 面板当前的主要问题被固定为：

- 列表摘要还像原始值碎片，未形成稳定节点入口
- 操作按钮层级不清晰，容易退化成裸按钮堆
- 节点详情缺少分组与阅读节奏
- `unknown` / `fallback` 信息仍以过强的工程视角进入主编辑流

因此，本轮优化的重点是把“能编辑”收口成“像一个完整工作区”，而不是继续堆叠实现细节。

### 3. 实施顺序固定为四段

后续实施顺序固定为：

1. 列表摘要与操作层级
2. 节点详情分组与节点级摘要
3. `unknown` / `fallback` 高级区
4. 样式细节与数据类型模板

这个顺序是长期决策，不是临时排期。

### 4. `unknown` / `fallback` 不能从主编辑流里消失

`unknown` / `fallback` 信息需要保留，但必须降级到次要层：

- 可以折叠
- 可以只读
- 可以作为高级区出现

但不能继续像普通字段一样打断主编辑路径，也不能因为体验优化就静默隐藏掉。

### 5. 样式细节只能放在最后一层补齐

视觉细节、空值文案、节点模板、数据类型特化等工作，必须在信息架构和交互收口之后再补。

这条约束的含义是：

- 不能先靠样式掩盖结构问题
- 不能把模板和分组逻辑留到最后才做整体收口
- 不能因为界面“看起来更像产品”就把核心交互顺序打乱

## alternatives considered

- 先做一轮纯样式美化：会掩盖列表摘要、操作层级和详情分组的问题，不能解决半成品感的根因，因此不接受。
- 重新设计一套独立 nested 编辑器：会破坏现有 `DetailPanel + nestedStack + NodeEditorHost + schema registry` 的收口边界，因此不接受。
- 直接隐藏 `unknown` / `fallback`：会损失排障和能力边界表达，因此不接受。

## consequences

- 后续实现必须先收口信息架构，再补视觉细节。
- 列表摘要、上下文操作、节点详情分组会成为 nested 编辑界面的长期主轴。
- `unknown` / `fallback` 会保留为受控高级区，而不是主编辑流的一部分。
- 后续任何 nested 体验优化，如果跳过上述顺序，都应视为偏离既定决策。

## related code

- `src/detail/DetailPanel.tsx`
- `src/detail/NodeEditorHost.tsx`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`
- `src/styles.css`
- `docs/plans/2026-07-09-nested-编辑界面设计与交互体验优化方案.md`

## search terms

- `nested detail`
- `DetailPanel`
- `nestedStack`
- `NodeEditorHost`
- `schema registry`
- `collection summary`
- `action hierarchy`
- `node summary`
- `unknown fields`
- `fallback`
- `information architecture`
- `rollout order`
