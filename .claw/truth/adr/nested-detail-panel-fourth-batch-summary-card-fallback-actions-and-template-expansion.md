# nested 编辑界面体验优化第四批：摘要卡与模板扩展收口

status: accepted

## context

这条 ADR 记录的是 `nested` 编辑界面体验优化第四批完成后的固定决策，不是阶段进度日志。

本轮完成态计划确认的范围是：

- node summary card 继续由 schema presentation metadata 驱动
- unsupported fallback 增加受控只读辅助动作
- 高频 dataset template 继续在 registry 中补齐

稳定基础仍然是：

- `src/detail/NodeEditorHost.tsx`
- `src/detail/DetailPanel.tsx`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`

## decision

### 1. node summary card 继续由 schema presentation metadata 驱动

nested node detail 的节点级摘要信息继续由 schema presentation 真值层提供。

正式 contract 固定为：

- `titleField` 进入真值层，作为摘要卡标题来源
- `summaryFields` 进入真值层，作为摘要卡正文来源
- `NodeEditorHost` 只做通用消费，不再手写少数字段拼摘要

这条决策的长期含义是：节点摘要卡属于 schema metadata 的一部分，而不是组件里临时拼出来的 UI 文案。

### 2. unsupported fallback 只补只读辅助动作

unsupported fallback 的可用性只补只读辅助动作，例如：

- 复制 JSON

这类动作的边界固定为：

- 只能服务排障和查看
- 不能写回值
- 不能重新引入 JSON 编辑
- 不能把 fallback 伪装成正式编辑器

因此 fallback 仍然是受控只读态，只是在只读态里补了辅助操作。

### 3. 高频 dataset template 扩展继续在 registry 中补充

高频 schema 的 summary / group template 扩展继续收敛在 registry 真值层，而不是留在组件内临时分支。

当前已补到的主要对象包括：

- `value_model`
- 多组 `rune params`

这条决策的长期含义是：后续若继续补 dataset-specific template，优先扩 registry 中的 sections 和 summary metadata，而不是在 `NodeEditorHost` 里按数据集名称散落判断。

## alternatives considered

- 继续在组件里手写摘要字段：会让摘要真值继续分散，不接受。
- 让 fallback 继续只展示静态说明而不提供辅助动作：会削弱排障体验，不接受。
- 把模板扩展放到组件层或临时分支：会破坏 registry 真值收口，不接受。

## consequences

- 节点摘要卡会稳定由 `titleField` / `summaryFields` 驱动。
- `NodeEditorHost` 继续作为摘要卡的通用消费层，而不是摘要规则的持有者。
- unsupported fallback 继续保持只读语义，但允许复制 JSON 一类辅助动作。
- 高频 dataset template 继续沉淀在 registry 中，`value_model` 和多组 `rune params` 已成为这条模板收口链路的已知覆盖面。

## related code

- `src/detail/NodeEditorHost.tsx`
- `src/detail/DetailPanel.tsx`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`
- `.claw/archive/tasks/nested-编辑界面体验优化第四批实现/plan.json`

## search terms

- `titleField`
- `summaryFields`
- `node summary card`
- `copy JSON`
- `unsupported fallback`
- `read-only`
- `registry`
- `value_model`
- `rune params`
- `summary metadata`
- `group template`
