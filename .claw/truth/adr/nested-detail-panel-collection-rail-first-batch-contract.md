# nested 编辑界面体验优化第一批：collection rail 固定契约

status: accepted

## context

这条 ADR 记录的是 `nested` 编辑界面体验优化第一批实现的固定契约，不是阶段进度日志。

本轮已经归档完成的计划明确了第一批的边界：

- 只做 collection rail
- 不扩散到节点详情分组
- 不重做 `unknown` 高级区
- 不做 `fallback` 大改

稳定基础仍然是：

- `src/detail/DetailPanel.tsx`
- `src/detail/NodeEditorHost.tsx`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`

## decision

### 1. 第一批只做 collection rail

`nested` 编辑界面体验优化按批次推进时，第一批范围固定为 collection rail：

- 列表卡片摘要
- 上下文工具栏

这一批不向节点详情分组、`unknown` 高级区或 `fallback` 大改扩散。

### 2. 数组项列表的正式卡片契约固定为 `meta / title / summary / status`

数组项列表不再采用“随机主值 + 字段名拼接”的弱摘要，而是固定为四层卡片契约：

- `meta`
- `title`
- `summary`
- `status`

其中 `meta` 负责承载弱元信息或辅助识别信息，`title` 负责节点主标题，`summary` 负责业务摘要，`status` 负责状态表达。

### 3. 动作区契约固定为上下文工具栏

collection rail 的动作区固定为：

- `Add item` 永远可见
- `Duplicate`、`Move`、`Delete` 只在选中项存在时出现

这意味着动作区不再是平铺裸按钮堆，而是与当前选中状态绑定的上下文工具栏。

### 4. 列表层必须承载状态摘要，但详情层的大改留到后续批次

`supported item` 的状态摘要和 `unsupported fallback` 的状态表达，都会进入列表层，让用户在 collection rail 里就能看见状态边界。

但以下内容仍然留到后续批次：

- 节点详情分组
- `unknown` 高级区
- `fallback` 大改

因此第一批只收口列表层与动作层，不把后续批次的详情结构提前混进来。

## alternatives considered

- 先把详情分组和 fallback 一起做完：会超出第一批边界，破坏批次切分，因此不接受。
- 继续保留随机值摘要和裸按钮堆：会延续半成品感，因此不接受。
- 把 unsupported 状态完全从列表层移除：会削弱能力边界表达，因此不接受。

## consequences

- 第一批 nested 体验改造的验收重点会稳定落在 collection rail。
- 数组项卡片摘要会统一收敛为 `meta / title / summary / status` 四层契约。
- `Add item`、`Duplicate`、`Move`、`Delete` 的可见性会和选中态绑定。
- supported item 与 unsupported fallback 的状态边界会先在列表层显式出现，详情分组和 fallback 重做则留给后续批次。

## related code

- `src/detail/DetailPanel.tsx`
- `src/detail/NodeEditorHost.tsx`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`
- `docs/plans/2026-07-09-nested-编辑界面体验优化第一批实现.md`

## search terms

- `nested detail`
- `collection rail`
- `meta`
- `title`
- `summary`
- `status`
- `Add item`
- `Duplicate`
- `Move`
- `Delete`
- `supported item`
- `unsupported fallback`
- `first batch`
