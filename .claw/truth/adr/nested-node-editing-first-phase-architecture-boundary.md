# nested node editing 第一阶段架构边界

status: accepted

## context

“实现嵌套节点完整编辑第一阶段与基础底座”这一轮已经完成，归档计划见：

- `.claw/archive/tasks/实现嵌套节点完整编辑第一阶段与基础底座/plan.json`

当前需要沉淀的不是阶段进度，而是会长期约束后续 nested detail 演进的架构边界。相关已完成 round 现在至少包括：

- `.claw/archive/tasks/实现嵌套节点完整编辑第一阶段与基础底座/plan.json`
- `.claw/archive/tasks/实现嵌套节点编辑第一批可见能力/plan.json`
- `.claw/archive/tasks/实现嵌套节点多态与递归节点接入/plan.json`
- `.claw/archive/tasks/清理嵌套节点旧值推断路径并完成最终回归/plan.json`
- `.claw/tasks/修复嵌套结构统一落入-Schema-fallback-的回归/plan.json`

已存在的 planning / closeout truth 已确认以下事实已经成为稳定真值：

- `NodeSchema` 真值已经正式抽离到 `src/detail/node-schema.mjs` 与 `src/detail/node-schema-registry.mjs`
- fixed object node 的 secondary panel 主路径已经切到 `src/detail/NodeEditorHost.tsx`
- nested 导航状态仍以 `src/detail/DetailPanel.tsx` 中的 `nestedStack` 为唯一真值
- nested relation/select/multi-select 不再新造控件，而是复用现有 editor，通过 host 内 adapter 直接写回 nested path
- fixed object node 的 summary / 默认值恢复 / schema placeholder 已进入正式可见能力
- object array 的第一批正式操作已经固定为新增、复制、上移、下移、删除，并继续复用 path writeback
- discriminated schema 已进入 `NodeEditorHost` 正式编辑链，类型切换在 host 内完成并按 variant `defaultValue` 重建
- `runes.effects[].params` 已通过父级 schema context 继承 `effect_type`，不在 `params` 自身重复持有 discriminator
- `skills.nodes[]` 的递归子节点已通过 recursive path pattern 命中同一套 schema，新增默认项不继承父节点 discriminator
- collection item 命中 schema 时进入 embedded `NodeEditorHost`，未命中继续走 fallback / legacy 路径
- secondary panel collection item 的 legacy 内容层已经退出正式 nested object / array 主路径
- `NestedEditor.tsx` 已从 secondary panel 主路径移除，不再作为 nested detail 的行为真值
- unsupported nested object / array 的长期语义已经固定为只读 fallback，不再提供 legacy 表单编辑
- 最终 nested matrix 已切到 schema-driven node 主链 + 独立 fallback 短用例，不再依赖 mixed 长用例的旧编辑语义
- unsupported object node 不再伪装成可完整编辑，而是进入受控只读 fallback
- Nocturnel nested schema registry 对 `sourcePath` 仍采用精确匹配；当正式数据文件迁移到 `data/content/*.json` 后，旧 `data/*.json` 注册即使还能让旧 fixture 命中，也会让真实 UI 中已注册路径整体退回 `Schema fallback`

## decision

### 1. nested node editing 第一阶段只重构右侧 nested secondary panel 主路径

这一阶段的正式范围固定为：

- 清理并替换 `DetailPanel` 内 nested secondary panel 的 object-node 主路径
- 不扩大到 primary detail 顶层字段编辑链
- 不把“完整 nested 编辑”解释成整个 `DetailPanel` 的同步重写

### 2. schema 真值固定在独立 resolver/registry 模块，组件层不再维护 nested schema 规则

nested node 的正式 schema source of truth 固定为：

- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`

后续 schema 扩展必须优先通过 registry/resolver 注册进入，不再回退到 `DetailPanel.tsx`、`NestedEditor.tsx` 或 `NodeEditorHost.tsx` 中追加零散 path 判断。

### 3. resolver 稳定命中键固定为 `sourcePath + collectionPath + rootField + nestedPath + discriminator`

resolver 的稳定 lookup 语义固定为：

- `sourcePath`
- `collectionPath`
- `rootField`
- `nestedPath`
- `discriminator`

其中 numeric nested segment 必须统一归一化为 `[]`。数组下标不是 schema 真值的一部分，因此 `effects[0].params` 与 `effects[3].params` 必须命中同一条 registry 记录。

### 4. registry 的 `sourcePath` 真值必须跟随当前正式数据路径，不保留旧路径兼容注册

当外部数据目录迁移导致正式文件路径变化时，nested schema registry 的 `sourcePath` / `sourcePathSuffix` 必须直接切到当前真实路径，例如 Nocturnel 已切换到 `data/content/*.json` 后，就不再继续保留旧 `data/*.json` 兼容注册作为正式真值。

这条 contract 的含义是：

- registry 的路径身份以当前产品真实文件路径为准
- 旧路径 fixture 或历史兼容命中不能代表真实 UI 正常
- 若真实 UI 已统一落入 `Schema fallback`，优先检查 registry 的 `sourcePath` 是否仍停留在历史路径

### 5. 外部数据目录迁移时，必须同步更新真实路径测试与 registry 对照排查

只更新单测或只更新 registry 其中一侧都不够。凡是发生 source file 迁移，都必须同时完成：

- `sourcePathSuffix` 注册更新到真实路径
- 基于真实路径的 resolver 合同测试更新
- 真实 UI / `/api/files` 返回路径与 registry 对照排查

当“旧测试仍通过，但真实 UI 全面 fallback”同时出现时，这应被视为优先级最高的 registry 身份错位信号，而不是继续怀疑 `DetailPanel`、`nestedStack`、`NodeEditorHost` 或 tertiary 布局链路。

### 6. `DetailPanel.nestedStack` 继续作为唯一 nested 导航真值

第一阶段不引入第二套 nested 导航状态机。`NodeEditorHost` 及后续 node-driven 分层必须消费既有：

- `src/detail/DetailPanel.tsx::nestedStack`
- `src/detail/DetailPanel.tsx::openNestedField(...)`

不得绕开这套导航真值，在 host 或 resolver 层并行维护另一套 nested 状态。

### 7. fixed object node 的 secondary panel 正式宿主切到 `NodeEditorHost`

fixed-schema object node 的 nested secondary panel 主路径正式固定为：

- `src/detail/NodeEditorHost.tsx`

这意味着旧 `NestedObjectPanel` object 主路径不再作为长期双轨保留，后续 object-node 能力扩展默认在 `NodeEditorHost` 下继续推进。

### 8. fixed object node 的第一批正式可见能力固定为 summary、默认值恢复与 schema placeholder

fixed-schema object node 在 `NodeEditorHost` 下的第一批正式可见能力已经固定为：

- 节点级 summary
- schema `defaultValue` 驱动的恢复默认值
- schema placeholder 驱动的空值语义

这意味着 fixed object node 不再只是字段列表。后续如果继续扩基础节点层，应默认把：

- `title`
- `defaultValue`
- `placeholder`

都当成 schema 真值的一部分维护，而不是在渲染层补散落特判。

### 9. nested 叶子字段必须复用现有 editor，并通过 path 级 adapter 写回

第一阶段已经固定的复用边界是：

- relation/select/multi-select 继续复用现有 editor
- host 内 adapter 直接把编辑结果写回当前 nested path
- 不再为 nested 场景复制第二套 relation/select/multi-select 实现

后续新增 nested 叶子字段能力时，默认方向是扩展 path 级 adapter，而不是回退到顶层字段 draft 模型或重造专用控件。

### 10. object array 节点的正式基础操作固定为新增、复制、上移、下移、删除

第一批可见能力已经把 object array 节点操作固定为：

- `Add item`
- `Duplicate item`
- `Move item up`
- `Move item down`
- `Delete item`

这些操作继续沿 `src/detail/DetailPanel.tsx` 中既有 nested path writeback 生效，依赖现有：

- `cloneNestedValue(...)`
- `moveArrayItem(...)`
- `updateNestedValue(...)`

不得为 object array 再引入独立保存模型、局部草稿缓存或第二套节点状态。

### 11. discriminated schema 切换继续放在 `NodeEditorHost` 内，并按 variant `defaultValue` 完整重建节点

第四阶段接入后，多态节点的正式切换边界已经固定为：

- 切换入口继续放在 `src/detail/NodeEditorHost.tsx`
- 当前节点值在切换后按目标 variant `defaultValue` 完整重建
- 同时通过 `ensureDiscriminatorValue(...)` 写回目标 discriminator

这意味着类型切换不是在旧值上做局部修补，也不保留旧变体脏字段；默认 contract 就是“按目标 schema 重建当前节点”。

### 12. `runes.effects[].params` 的 discriminator 通过父级 schema context 继承，不在 `params` 层本地持有 `effect_type`

`runes.effects[].params` 的正式 discriminator 仍然是：

- `effect_type`

但实际承接方式已经固定为：

- `NodeEditorHost` 通过 `schemaContextValue`
- `resolveNestedNodeSchema(...)` 通过 `contextValue`
- `resolveDiscriminatorValue(...)` 从父级 effect item 继承 `effect_type`

因此 `params` 节点本身不需要再额外保存或镜像一份 `effect_type`。后续如果这条链路断掉，应优先排查 context 传递，而不是回退到在 `params` 对象里补本地 discriminator 字段。

### 13. `skills` 递归子节点通过 recursive path pattern 继续命中同一套 discriminated schema

`skills.nodes[]` 的递归接入已经固定为：

- registry 通过 `recursiveItemPaths`
- `then_nodes[]` / `else_nodes[]` 继续命中同一套 `skillsNodesSchema`
- 更深层子节点继续复用现有 nested path writeback 与 `nestedStack`

这里的长期 contract 是：

- 递归节点不是另一套 schema 系统
- 递归命中依赖 path pattern / recursive path，而不是临时复制平面 path 规则
- 子数组新增默认项使用目标 collection item 的默认 variant，不继承父节点当前 discriminator

### 14. collection item 命中 schema 时进入 embedded `NodeEditorHost`，未命中继续 fallback / legacy

当前 secondary panel collection item 的正式承接边界已经固定为：

- item 命中 supported schema 时，走 embedded `NodeEditorHost`
- item 未命中 schema 时，继续走现有 fallback / legacy 渲染链

这条边界把“schema-driven item”与“legacy item”收口在同一个 collection panel 中，而不是为 collection item 再另起独立编辑器。

### 15. secondary panel collection item 的 legacy 内容层已经退出正式 nested 主路径

第五阶段收口后，secondary panel collection item 的长期边界已经进一步固定为：

- 命中 schema 的 object / array / polymorphic / recursive item 统一走 embedded `NodeEditorHost`
- 未命中 schema 的复杂 object / array item 统一进入只读 fallback
- legacy 按值内容层不再承担正式 nested object / array 编辑职责

仍然保留的 legacy 内容层只用于 primitive 安全结构的最小编辑，不再代表 nested complex structure 的正式编辑能力。

### 16. `NestedEditor.tsx` 已从 secondary panel 主路径移除

第五阶段的正式清理点已经固定为：

- `renderNestedItemEditor(...)`
- `NestedEditor`

其中 `NestedEditor.tsx` 已不再是 secondary panel 主路径的一部分。后续若继续排查 nested detail 主链，不应再把它当作行为真值或扩展入口。

### 17. unsupported nested object / array 的正式长期语义已经固定为只读 fallback

当前 unsupported nested object / array 的正式语义是：

- secondary panel 中显示只读 fallback
- 展示 `Unsupported nested structure.`
- 展示原始 JSON 预览
- 不再提供 legacy 表单编辑入口

这条 contract 同时适用于 object node 与 collection item，不再区分“暂时没 schema，但还能先按值编辑”的过渡语义。

### 18. 最终 nested matrix 以 schema-driven node 主链 + 独立 fallback 短用例为准

第五阶段后，最终 nested 回归矩阵的长期验证边界已经固定为：

- 正式 schema-driven node 主链单独覆盖
- unsupported fallback 单独用短用例覆盖
- 历史 mixed 长用例不再承担 legacy nested 编辑语义的间接证明

这意味着未来如果继续调整 nested host / fallback，应继续维持“正式能力”和“unsupported 结构”分层验证，而不是重新把两类语义混回一条 mixed 长链路。

### 19. 第四阶段已进入多态 / 递归节点接入，但仍只限 nested secondary panel 主路径

当前已接受的推进顺序已经从基础节点层推进到多态 / 递归节点接入，但约束没有改变：

- 仍只改 nested secondary panel 主路径
- 仍继续复用 `DetailPanel.nestedStack`
- 仍不把顶层 primary detail 的非 nested 字段链纳入改造

因此这轮新增的多态切换、父级 context、recursive path 和 embedded host，不应被误读成可以脱离当前 secondary panel 主链另起新状态机或新编辑表面。

### 20. unsupported object node 统一进入只读 fallback

未注册 path、未命中 discriminator variant，或当前 object node 不在正式 schema 覆盖面内时，统一进入受控只读 fallback，而不是继续走旧值推断形成“看起来还能完整编辑”的伪能力。

## alternatives considered

- 把 schema 规则继续散落在组件层：会让 nested path 扩展继续依赖零散分支，无法维持稳定命中合同，因此不接受。
- 为已迁移的数据文件继续保留旧 `data/*.json` 兼容注册：会制造“旧测试通过、真实 UI fallback”的假阳性，因此不接受。
- 为新框架另建第二套 nested 导航状态：会与 `DetailPanel.nestedStack` 并行竞争，不符合当前 secondary panel 导航真值，因此不接受。
- 继续保留旧 `NestedObjectPanel` 与 `NodeEditorHost` 双轨：会让 object-node 主路径长期分叉，不利于后续扩展，因此不接受。
- 为 nested relation/select 单独实现简化控件：会复制既有业务编辑语义，不符合本轮复用边界，因此不接受。

## related code

- `src/detail/DetailPanel.tsx`
- `src/detail/NodeEditorHost.tsx`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`
- `tests/data-editor.spec.ts`
- `tests/node-schema-registry.test.mjs`
- `.claw/truth/nested-detail-panel-first-phase-boundary-and-resolver-key.md`
- `.claw/tasks/修复嵌套结构统一落入-Schema-fallback-的回归/plan.json`
- `.claw/archive/tasks/实现嵌套节点完整编辑第一阶段与基础底座/plan.json`
- `.claw/archive/tasks/实现嵌套节点编辑第一批可见能力/plan.json`
- `.claw/archive/tasks/实现嵌套节点多态与递归节点接入/plan.json`
- `.claw/archive/tasks/清理嵌套节点旧值推断路径并完成最终回归/plan.json`

## consequences

- 后续 nested node 支持扩展时，优先改 registry/resolver 与 `NodeEditorHost`，而不是回退到组件内联 path 判断。
- 当 source file 发生迁移时，registry `sourcePath` 与真实路径测试必须同步更新；不再接受“保留旧路径兼容注册”来维持假通过。
- 若真实 UI 已统一落入 `Schema fallback`，排查顺序应先对比 `/api/files` 与 registry 的路径身份，再怀疑 UI 宿主链路。
- object-node secondary panel 的长期宿主已经统一，避免 `NestedObjectPanel`/`NodeEditorHost` 双轨并存。
- nested 导航真值继续集中在 `DetailPanel.nestedStack`，后续功能扩展必须遵守现有导航合同。
- fixed object node 的 summary、默认值恢复和 schema placeholder 已经成为正式能力面；后续若继续扩 object node，不应回退到“只有字段列表”的弱节点 UI。
- nested relation/select/multi-select 的业务语义继续与正式 editor 对齐，避免出现 nested 专用控件和顶层控件行为漂移。
- object array 的基础操作集合已经固定，后续实现应默认复用现有 path writeback，而不是分裂出第二套 object-array editor 状态模型。
- discriminated node 的切换 contract 已经固定为 host 内切换 + variant `defaultValue` 重建；后续不应回退到局部 merge 旧变体字段。
- `runes.params` 一类父级持有 discriminator 的节点，必须继续通过 schema context 继承父级字段，而不是在子对象本地复制 discriminator。
- `skills` 递归子节点的 schema 命中已经固定为 recursive path pattern；若更深层断链，优先排查 recursive path 与 context 传递，而不是另起一套递归编辑器。
- collection item 的 schema-driven 承接边界已经固定为 embedded `NodeEditorHost`；未命中 schema 的 item 继续 fallback / legacy，而不是强制统一到伪完整编辑。
- secondary panel collection item 的 legacy 内容层已经退出正式 nested object / array 主路径；后续不应再把按值编辑 fallback 当成可持续双轨。
- `NestedEditor.tsx` 已不再是 nested detail 主路径的一部分；后续排查和扩展都应围绕 `DetailPanel`、embedded `NodeEditorHost` 与 fallback 收口。
- unsupported nested object / array 的正式语义已经收窄为只读 fallback，不再保留 legacy 表单编辑幻想。
- 最终 nested 回归矩阵应继续保持“schema-driven 主链”和“unsupported fallback”分层短用例，而不是重新依赖 mixed 长用例的旧编辑语义。
- unsupported object node 的能力边界会保持显式可见；未来若要支持更多结构，应通过新增 schema 覆盖或新的独立 ADR 进入，而不是静默放宽 fallback。

## search terms

- `nested node editing`
- `node-schema-registry`
- `NodeEditorHost`
- `nestedStack`
- `sourcePath`
- `sourcePathSuffix`
- `data/content`
- `/api/files`
- `Schema fallback`
- `collectionPath`
- `rootField`
- `nestedPath`
- `discriminator`
- `schema placeholder`
- `defaultValue`
- `object array`
- `Duplicate item`
- `Move item down`
- `recursive path`
- `schemaContextValue`
- `contextValue`
- `effect_type`
- `then_nodes`
- `else_nodes`
- `embedded NodeEditorHost`
- `NestedEditor`
- `renderNestedItemEditor`
- `mixed`
- `unsupported fallback`
