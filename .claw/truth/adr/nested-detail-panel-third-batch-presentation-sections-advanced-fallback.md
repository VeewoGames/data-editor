# nested 编辑界面体验优化第三批：字段分组与 fallback 收口

status: accepted

## context

这条 ADR 记录的是 `nested` 编辑界面体验优化第三批完成后的固定决策，不是阶段进度日志。

本轮完成态计划确认的范围是：

- supported schema node 的字段分组与高级区表达
- supported unknown fields 的主流收口
- unsupported nested object/array 的只读 fallback 收口

稳定基础仍然是：

- `src/detail/NodeEditorHost.tsx`
- `src/detail/DetailPanel.tsx`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`

## decision

### 1. 字段分组真值进入 `schema.presentation.sections`

nested 节点详情区的字段分组真值正式进入：

- `schema.presentation.sections`

并由 `NodeEditorHost` 通用消费。

这意味着字段分组不再由组件层按 `fieldName` 零散硬编码，也不再依赖渲染层临时拼接分区逻辑。后续支持分组的节点，应优先在 schema presentation metadata 中声明 sections，再由 host 统一渲染。

### 2. supported unknown fields 进入默认折叠的 advanced 区

supported node 中未被 schema 覆盖的字段，正式收口为默认折叠的 advanced 区：

- 默认不展开
- 不占据主编辑流
- 仍保持可见和可读

这条 contract 的长期含义是：unknown fields 仍然保留，但它们只属于高级信息层，不再继续和主字段并列铺开。

### 3. unsupported nested object/array 统一收口为说明卡 + 只读 JSON 预览

unsupported nested object/array 的正式语义统一为：

- 说明卡
- 只读 JSON 预览

这条 contract 取代了任何“看起来还能编辑”的 legacy 表单幻觉。unsupported 结构必须以受控只读 fallback 呈现，并与 supported node 的可编辑状态形成清晰视觉区分。

### 4. supported unknown fields 与 unsupported fallback 维持两套语义

第三批进一步确认两类信息不能共用一套主编辑流文案：

- supported unknown fields 是 advanced 区中的预览和排障信息
- unsupported nested object/array 是正式只读 fallback

两者都可见，但语义不同，不能混成一种“未完成编辑”的表现。

## alternatives considered

- 继续在组件里按 `fieldName` 分组：会让分组真值继续分散在实现层，因此不接受。
- 把 unknown fields 继续混在主字段流里：会破坏主编辑流收口，因此不接受。
- 把 unsupported nested object/array 继续做成可编辑的 legacy 表单：会制造伪能力，因此不接受。

## consequences

- `NodeEditorHost` 成为 schema presentation metadata 的统一消费点。
- supported node 的分组逻辑进入 schema 真值层，后续扩展更一致。
- unknown fields 会以折叠 advanced 区形式保留，而不是继续占据主编辑流。
- unsupported nested object/array 会稳定表现为只读 fallback，不再伪装成可编辑表单。

## related code

- `src/detail/NodeEditorHost.tsx`
- `src/detail/DetailPanel.tsx`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`
- `.claw/archive/tasks/nested-编辑界面体验优化第三批实现/plan.json`

## search terms

- `schema.presentation.sections`
- `NodeEditorHost`
- `advanced 区`
- `unknown fields`
- `unsupported nested object`
- `unsupported nested array`
- `read-only fallback`
- `presentation metadata`
- `fieldName`
- `sections`
