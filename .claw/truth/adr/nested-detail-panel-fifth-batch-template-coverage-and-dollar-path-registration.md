# nested 编辑界面体验优化第五批：模板覆盖与 `$` 路径注册收口

status: accepted

## context

这条 ADR 记录的是 `nested` 编辑界面体验优化第五批完成后的固定决策，不是阶段进度日志。

本轮完成态计划确认的范围是：

- 剩余高频 schema template 的覆盖面补齐
- `affixes_mechanic.effect_spec` 的独立 presentation metadata 收口
- 同一 source file 的真实 `$` collectionPath 注册补齐

稳定基础仍然是：

- `src/detail/node-schema-registry.mjs`
- `src/detail/NodeEditorHost.tsx`
- `src/detail/DetailPanel.tsx`

## decision

### 1. `affixes_mechanic.effect_spec` 已纳入 registry presentation metadata

`affixes_mechanic.effect_spec` 已正式纳入 registry 的 presentation metadata，并拥有独立的：

- `sections`
- `summaryFields`
- `titleField`

这条决策的长期含义是：`affixes_mechanic.effect_spec` 不再只是一个能命中的 schema 条目，而是一个拥有完整摘要与分组真值的正式 nested node template。

### 2. 真实 UI 若以 `$` collection 打开，registry 也必须补 `$` 路径注册

对于同一 source file，registry 的 collectionPath 不能只按理想命名假设。

如果真实 UI 或 fixture 以 `$` collection 打开，那么 registry 也必须补齐：

- `$` 路径注册

不能只保留语义上更“理想”的 collection 名，否则真实 UI 命中会退回 fallback，形成 schema 真值与真实路径的分裂。

### 3. 第五批只补 template 覆盖面，不混入交互体验细节

第五批的正式边界固定为：

- 只补 template 覆盖面
- 不混入键盘导航
- 不混入 tooltip
- 不混入更细的交互提示

这意味着第五批是 template coverage 的收口批，不是交互体验再设计批。键盘导航、tooltip 与更细的体验细节，继续留给后续单独批次。

## alternatives considered

- 只注册理想 collection 名，不补 `$`：会让真实 UI 命中退回 fallback，因此不接受。
- 把键盘导航和 tooltip 一并塞进本轮：会破坏第五批的 template coverage 收口目标，因此不接受。
- 让 `affixes_mechanic.effect_spec` 继续只靠基础 schema 命中而不补 presentation metadata：会使摘要与分组真值不完整，因此不接受。

## consequences

- `affixes_mechanic.effect_spec` 成为具备独立 sections / summaryFields / titleField 的正式 template。
- 真实 UI/fixture 以 `$` 打开时，registry 必须同步具备 `$` collectionPath 注册。
- 第五批只负责 template 覆盖面收口，不承担键盘导航、tooltip 等后续体验批职责。
- 未来若真实路径与理想 collection 名不一致，应优先补 registry path 注册，而不是让 UI 静默回退到 fallback。

## related code

- `src/detail/node-schema-registry.mjs`
- `src/detail/NodeEditorHost.tsx`
- `src/detail/DetailPanel.tsx`
- `.claw/archive/tasks/nested-编辑界面体验优化第五批实现/plan.json`

## search terms

- `affixes_mechanic.effect_spec`
- `sections`
- `summaryFields`
- `titleField`
- `$`
- `collectionPath`
- `registry`
- `presentation metadata`
- `template coverage`
- `keyboard navigation`
- `tooltip`
