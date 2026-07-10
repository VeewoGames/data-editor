# nested 节点完整编辑第一阶段执行边界与 resolver key 约束

status: accepted

## context

这条 truth 只沉淀 2026-07-09 这轮 claw planning 收口后已经固定的长期边界，用于约束右侧 `nested detail` 的第一阶段实现范围和 schema 命中真值。

它不是进度日志。本条现在同时包含两类已固定事实：

- planning 收口后的长期边界
- 第一阶段 `NodeSchema` / registry / resolver 已落地后的稳定真值与测试合同

稳定来源包括：

- `docs/plans/2026-07-09-嵌套节点完整编辑方案.md`
- `docs/plans/2026-07-09-嵌套节点完整编辑执行方案.md`
- `.claw/truth/table-nested-detail-panel-nested-editing.md`
- `.claw/truth/entry-actions-v2-target-pair-selector-and-dollar-collection-routing.md`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`
- `tests/node-schema-registry.test.mjs`

## 结论

### 1. 本轮正式 round 的目标是第一阶段 schema 真值与第二阶段基础底座，不是一次性做完全量 nested 编辑

本轮计划标题已经固定为“实现嵌套节点完整编辑第一阶段与基础底座”。

对应的长期语义是：

- 第一阶段先固定 `nested node editing framework` 的 schema 真值
- 第二阶段只落统一宿主和基础底座
- 目标不是把所有 nested 节点类型和所有顶层字段编辑链一次性全部重做完

未来排查如果看到实现范围继续外扩，应该先回到这条 round 标题判断是否越过既定阶段边界。

### 2. 本轮重构只允许改 nested secondary panel 主路径，顶层 primary detail 不在范围内

当前已经固定的执行边界是：

- 只清理和替换 `DetailPanel` 里的 nested secondary panel 主路径
- 顶层 primary detail 字段编辑链不在本轮重构范围内
- 不把顶层非 nested 字段编辑系统混入这轮框架升级

这意味着“完整编辑”一词只针对右侧 nested detail 的主流程，不应被解释成对整个 `DetailPanel` 字段系统做同步改写。

### 3. nested 叶子字段必须复用现有字段编辑器，不允许再造第二套简化实现

这轮已经固定的长期约束是：

- nested `text / number / boolean / select / relation / multi-select` 叶子字段必须复用现有字段编辑器
- 可以新增 adapter / resolver / host 分层
- 不允许在 nested 场景复制一套 relation/select 等简化控件

因此后续实现若出现“nested 专用 relation editor”“nested 专用 select editor”之类新分叉，应直接视为偏离既定边界。

### 4. nested 导航状态继续以 `DetailPanel.nestedStack` 为真值，不再引入第二套状态机

本轮没有重写 secondary panel 导航状态机，已经固定的真值仍然是：

- `src/detail/DetailPanel.tsx` 中的 `nestedStack`
- `src/detail/DetailPanel.tsx` 中的 `openNestedField(...)`
- 新框架只替换“当前 path 对应节点如何编辑”
- 不额外新建第二套 nested 导航状态源

因此任何 `NodeEditorHost`、schema resolver 或节点宿主层的后续实现，都必须消费既有 nested 导航真值，而不是绕开 `nestedStack` 自行维护并行状态。

### 5. 第一阶段真正要替换的是 secondary panel 的值推断内容层，不是整个 `DetailPanel`

当前需要被新框架替换的主路径已经可以收口到 secondary panel object / collection 内容层：

- `NestedObjectPanel`
- `renderNestedItemEditor(...)`
- `NestedEditor`

这条边界的长期含义是：

- 第一阶段替换的是 nested secondary panel 里的值推断渲染主路径
- 不应把整个 `DetailPanel` 一起重写
- 也不应把 primary detail 顶层字段编辑链误归入这轮清理范围

### 6. 顶层字段 editor 的正式复用锚点是 `renderValueEditor(...)`，新框架必须显式承接它依赖的运行时上下文

当前字段 editor 复用链的真实锚点在 `src/detail/DetailPanel.tsx::renderValueEditor(...)`。

这里已经直接复用：

- `RelationCellEditor`
- `SelectCellEditor`
- `MultiSelectCellEditor`

并且依赖一组不能丢失的运行时上下文：

- `relationOptions`
- `relationConfigs`
- `sourcePath`
- `collectionPath`
- draft commit / `commitDraft`
- `onOpenRelationTarget`
- active text editor / `activeTextEditor`

因此第一阶段如果新增 `FieldEditorResolver` 或同等分发层，必须把这些上下文显式接进 nested 叶子字段链路，而不是只把“字段名 + 当前值”传进去。

### 7. relation 解析依赖完整路径语义，不能退化成只看字段名

当前 relation 命中的真实锚点在 `src/detail/DetailPanel.tsx`：

- `buildRelationKey({ sourceFile: sourcePath, sourceCollection: collectionPath, fieldPath: pathParts })`

这意味着 nested 场景下的 relation 解析必须同时保留：

- `sourcePath`
- `collectionPath`
- `pathParts`

因此新框架里的 `FieldEditorResolver`、relation adapter 或 schema resolver 都不能只靠字段名推断 relation 语义，否则会丢失正式 relation key 所需的完整上下文。

### 8. schema resolver 的稳定命中键已经固定为 `sourcePath + collectionPath + rootField + nestedPath + discriminator`

这条约束现在已经落地到独立 schema 模块，而不再留在组件内值推断逻辑里：

- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`

当前 `NodeSchema` 真值已经从组件内值推断抽离出来，后续 nested node 命中和 schema 扩展都应优先落在这两个模块，而不是重新回到 `DetailPanel.tsx` 内联写死。

当前已落地的命中键是：

- `sourcePath`
- `collectionPath`
- `rootField`
- `nestedPath`
- `discriminator`

其中职责分工也已经固定：

- `sourcePath + collectionPath + rootField + nestedPath` 负责命中基础 schema
- `discriminator` 只在命中多态节点后参与第二段分流

其中 `nestedPath` 的 numeric segment 在 lookup key 和 registry 匹配里都按 `[]` 归一化。

这条约束的长期含义是：

- 不能把 resolver key 退化成只看当前值或只看 `nestedPath`
- 不能跳过 `collectionPath`，否则不同 collection 下的同名 nested path 会失去稳定区分
- 不能让 `discriminator` 反向承担基础 schema 定位职责
- 不能把数组下标本身当成 schema 真值的一部分；`effects[0].params` 和 `effects[3].params` 在 registry 里应命中同一条 `effects[].params`

这和 `.claw/truth/entry-actions-v2-target-pair-selector-and-dollar-collection-routing.md` 的长期模式一致：当路径语义需要稳定命中时，正式真值必须保留完整上下文，而不是退化成松散字符串匹配。

### 9. 第一批 registry 覆盖范围已经固定，后续扩展应继续走注册而不是回退组件分支判断

当前已注册的 fixed / discriminated schema 覆盖是：

- `data/classes.json::$::starting_equipments`
- `data/classes.json::$::starting_stats`
- `data/classes.json::$::stat_growth`
- `data/affixes.json::affixes::value_model`
- `data/affixes.json::affixes::constraints`
- `data/affixes_mechanic.json::affixes_mechanic::effect_spec`
- `data/affixes_mechanic.json::affixes_mechanic::effect_spec.value_model`
- `data/affixes_mechanic.json::affixes_mechanic::constraints`
- `data/runes.json::$::effects[].params`，按 `effect_type`
- `data/skills.json::skills::nodes[]`，按 `type`
- `data/traits.json::traits::effects[]`，按 `type`

这条落地后的长期含义是：

- 第一阶段 schema 覆盖已经有明确注册表入口
- 后续新增 nested node 支持时，优先在 registry 增加正式条目
- 不应回退到在 `NestedEditor`、`DetailPanel` 或 `NodeEditorHost` 里追加零散 path 判断

### 10. 第四阶段接入前，多态 / 递归 schema 只停留在 resolver 真值层，不等于已经进入正式 nested host

在第四阶段正式接入多态 / 递归节点之前，`node-schema-registry` 里已经存在这些 discriminated schema 真值：

- `traits.effects[]`
- `runes.effects[].params`
- `skills.nodes[]`

但它们当时的稳定状态仍然只是：

- 已进入 resolver
- 已被 `tests/node-schema-registry.test.mjs` 锁到单测层
- 尚未等价于“正式 nested node host 已经支持”

这条边界的长期含义是：

- registry 命中成功不代表 secondary panel 主路径已经真正切到 schema-driven host
- 判断多态 / 递归能力是否正式可用，不能只看 resolver 和 unit test，还要看 `DetailPanel` / `NestedCollectionPanel` 的真实接线

### 11. 第四阶段接入前，`NestedCollectionPanel` 的数组项主路径仍会卡在旧值驱动链

在第四阶段接入前，`NestedCollectionPanel` 的数组项编辑主路径仍然走：

- `renderNestedItemEditor(...)`

因此即使某个数组项 path 在 registry 里已经能命中 schema，也不会自动进入 `NodeEditorHost`。

这条边界的长期含义是：

- array item 是否“理论可命中 schema”和“真实 UI 是否进入 schema-driven host”是两回事
- 排查多态 / 递归 nested 断链时，应优先看 secondary panel array item 的接线路径，而不是只看 registry 命中结果

### 12. 第四阶段前的递归支持必须是 path pattern / recursive path 级别，不能只靠一条平面 registry 记录

`skills.nodes[]` 的递归子节点存在稳定结构特征：

- 下一层继续出现在 `then_nodes[]`
- 下一层继续出现在 `else_nodes[]`

因此如果 registry 只注册根路径：

- `["[]"]`

那么递归节点会在更深一层的 `then_nodes[]` / `else_nodes[]` 处断链。

这条边界的长期含义是：

- 递归 nested 支持必须是 path pattern / recursive path 级别能力
- 不能把递归节点理解成“多配一条平面 path 记录”就能解决
- 后续若出现更深层 nested node 命不中，应优先检查 recursive path 规则，而不是先怀疑顶层 registry 总开关

### 13. 第四阶段前的 `runes.effects[].params` 需要父级 schema context，不能只看当前对象值

`runes.effects[].params` 的 discriminator 是：

- `effect_type`

但它位于父级 effect item，而不在 `params` 对象自身内部。

因此在第四阶段正式接入前，真实 UI 如果只把当前 `params` 对象传给 host / resolver，就会出现一种稳定分裂：

- registry / unit test 可以命中
- 真实 nested host 因缺少父级 schema context 而命不中

这条边界的长期含义是：

- 多态 nested node 的 discriminator 不一定和当前编辑对象共址
- host 接线若不显式传递父级 context，就会出现“resolver 能命中、真实 UI 命不中”的假象

### 14. 第四阶段的正式接入边界仍然只能沿 secondary panel + `nestedStack` 主链扩展

第四阶段规划收口后的稳定边界是：

- 继续沿 secondary panel 主路径扩展多态 / 递归能力
- 继续复用 `nestedStack`
- 不另起独立编辑器
- 不重写导航状态机
- 不把顶层 primary detail 纳入同轮改造

这条边界把多态 / 递归节点接入继续约束在既有 nested detail 主链上，而不是把“需要更多 context”误解成另起一套 UI 或状态模型。

### 15. 第四阶段后，多态 / 递归 schema 已正式进入 nested host 主链，不再只停留在 resolver / 单测层

当前第四阶段已正式接入的 nested node 主链包括：

- `traits.effects[]`
- `runes.effects[]`
- `runes.effects[].params`
- `skills.nodes[]`

对应锚点在：

- `src/detail/node-schema-registry.mjs`
- `src/detail/NodeEditorHost.tsx`
- `src/detail/DetailPanel.tsx`

这条落地后的长期含义是：

- 这些多态 / 递归节点现在不再只是 registry 可命中
- 它们已经进入正式 nested node host
- 后续判断这几类节点是否“已支持”，应以 host 主链和回归测试为准，而不是只看 resolver 条目存在

### 16. 多态节点切换的正式合同是“仅在本地 discriminator 可写时展示 selector，切换后按 variant `defaultValue` 完整重建节点”

当前 `src/detail/NodeEditorHost.tsx` 已经支持 discriminator selector，但显示条件已经固定为：

- 只有当前节点本地持有 discriminator 字段
- 只有该 discriminator 可以在当前节点内直接切换

对应长期语义是：

- selector 不应在 discriminator 来自父级 / context 的节点上暴露
- 不能让用户在缺少本地写入语义的节点上误以为可以独立切 variant

切换行为本身的正式合同也已固定：

- 按目标 variant 的 `defaultValue` 完整重建当前节点
- 不保留旧 variant 的脏字段残留

因此后续若扩多态节点编辑，默认应坚持“切换即重建”的 schema 真值模型，而不是做字段级拼接迁移。

### 17. 父级 discriminator context 已成为 nested schema 真值的一部分

当前 `src/detail/node-schema-registry.mjs::resolveNestedNodeSchema(...)` 已支持从两处读取 discriminator：

- 当前 `value`
- `contextValue`

这条能力是 `runes.effects[].params` 正式接通的关键，因为它的 discriminator：

- `effect_type`

位于父级 effect item，而不在 `params` 对象内部。

对应的长期含义是：

- 对 `runes.params` 这类 sibling / parent 判别字段场景，父级 schema context 已经是 resolver 真值的一部分
- `DetailPanel` 的 nested stack 现在必须携带 `schemaContextValue`
- `NodeEditorHost` 的 nested object drill-down 也必须继续下传父级 schema context

如果后续再出现“registry 能命中但真实 UI fallback”的多态节点，先检查是否丢了 `contextValue` / `schemaContextValue`，而不是先怀疑 schema 本体。

### 18. 递归节点命中必须是 recursive path pattern，`skills` 子节点新增默认项不能继承父节点 discriminator

当前 `src/detail/node-schema-registry.mjs` 已正式引入：

- `recursiveItemPaths`

用于让：

- `skills.nodes[] -> then_nodes[]`
- `skills.nodes[] -> else_nodes[]`

在任意递归深度继续命中同一套 schema。

这条落地后的长期含义是：

- 递归 nested 命中正式依赖 recursive path pattern，而不是平面 exact path
- `skills` 递归子数组新增节点时，默认项应按目标 item schema 的默认 variant 起项
- 子节点不能错误继承父节点 discriminator；当前正式默认 variant 是 `targeting`

### 19. `embedded` 模式让数组项在 collection panel 内直接走正式 `NodeEditorHost`

当前 `src/detail/NodeEditorHost.tsx` 已支持：

- `embedded`

并且 `src/detail/DetailPanel.tsx` 在 nested collection item 命中 schema 时，已经直接以内嵌方式走 `NodeEditorHost`；只有未命中 schema 的数组项才继续回落 legacy item editor。

这条落地后的长期含义是：

- `NestedCollectionPanel` 不再是多态 / 递归节点进入 host 的断点
- array item 已经可以在 collection panel 内走正式 schema-driven host
- legacy item editor 现在只应作为未命中 schema 的 fallback，而不是继续承担已覆盖节点的主路径

### 20. 第五阶段后，secondary panel collection item 内容层的旧值推断主路径已经正式清理

当前 `src/detail/DetailPanel.tsx` 的 `NestedCollectionPanel` 已不再让：

- `renderNestedItemEditor(...)`
- `NestedEditor`

承担正式 nested object 编辑主路径。

这条清理后的长期语义是：

- 命中 schema 的 collection item 继续走 embedded `NodeEditorHost`
- 未命中 schema 的复杂 object / array item 统一进入只读 fallback
- primitive item 仅保留最小安全编辑

因此 secondary panel 旧值推断的正式清理点，已经收口为 `DetailPanel` collection item 内容层，而不是更泛化地声称“全库已无值推断”。

### 21. `NestedEditor.tsx` 已从 secondary panel 主路径彻底移除并删除

当前 `src/detail/NestedEditor.tsx` 已不再存在于仓库中，说明它已经从 secondary panel 主路径彻底退出。

这条事实的长期含义是：

- `NestedEditor` 不再是 nested detail 的正式实现锚点
- 未来若排查 secondary panel object / array 编辑主路径，不应再沿 `NestedEditor.tsx` 找行为真值
- 若再次出现针对复杂 nested object / array 的“legacy 可编辑表单”回流，应视为对既定清理边界的偏离

### 22. unsupported nested object / array 的正式长期语义已经固定为只读 fallback

当前 collection item 未命中 schema 时，复杂 object / array 会统一进入只读 fallback，显示：

- unsupported 说明
- JSON 预览

这条语义的长期含义是：

- unsupported nested structure 不再被当成“还能编辑但不完整”的 legacy 表单
- fallback 是正式、受控、只读的长期行为
- primitive item 仍可保留最小安全编辑，但复杂 object / array 不再回退成 legacy 可编辑能力

### 23. fallback 回归必须独立于历史 mixed 用例，不能再把 unsupported 结构误当正式编辑能力

当前回归面已经显式区分：

- `unsupported nested collection item falls back to read-only JSON`
- 正式 schema 场景 `data/runes.json`
- schema-driven autosave 场景 `data/classes.json`

这条验证边界的长期含义是：

- unsupported fallback 要有独立回归，不应继续借历史 mixed nested 用例间接覆盖
- 正式 schema-driven 编辑能力和 unsupported fallback 必须分开验证
- 这样可以避免把“旧 mixed 结构还能改”误解成正式产品能力

### 24. unsupported nested path 现在必须显式返回 `unsupported` + `reason`

当前 resolver 对未注册 path 或未注册 discriminator variant 的正式合同是：

- 返回 `kind: "unsupported"`
- 返回稳定 `reason`
- 不静默退回“看起来还能编辑”的伪完整模式

这条规则和项目里其他路径语义的长期边界一致：当能力明确未覆盖时，应显式暴露 unsupported，而不是悄悄降级后制造能力错觉。

### 25. `NodeEditorHost` 已经成为 fixed-schema object node 的 secondary panel 主路径宿主

当前 fixed-schema object node 的 secondary panel 主路径已经落到：

- `src/detail/NodeEditorHost.tsx`

并且 `src/detail/DetailPanel.tsx` 在：

- `activeNested && isPlainObjectValue(activeNestedValue)`

这条分支里，已经改为使用 `NodeEditorHost`，不再走旧的 `NestedObjectPanel` 主路径。

这条落地后的长期含义是：

- fixed-schema object node 的正式宿主已经从旧值推断 object panel 切到 `NodeEditorHost`
- `NodeEditorHost` 只消费当前 `rootField + basePath + value`
- 它继续复用 `nestedStack` 作为导航真值，不自建第二套 nested 导航状态
- 被它替换的旧 `NestedObjectPanel` 主路径分支已经删除，object node secondary panel 不再长期保留双轨

### 26. nested 字段 editor 复用已经在 `NodeEditorHost` 内落地，select / multi-select 走 path 级写回

当前 `NodeEditorHost.tsx` 内的字段分发已经直接复用：

- `RelationCellEditor`
- `SelectCellEditor`
- `MultiSelectCellEditor`

而不是为 nested 场景再造一套 relation / select 控件。

其中当前阶段的 select / multi-select 写回合同也已经固定：

- nested `SelectCellEditor` 通过本地 draft -> `nextSelectedValues[0] ?? null` 映射写回当前 nested path
- nested `MultiSelectCellEditor` 通过本地 draft -> `nextSelectedValues` 映射写回当前 nested path
- 它复用的是既有 editor 交互，不是顶层 `fieldName` 粒度的 draft commit 提交链

因此后续如果继续扩展 nested field editor，默认方向应是沿 path 级写回 adapter 扩展，而不是强行把 nested path 包装回顶层 field draft 模型。

### 27. schema-driven placeholder 已经成为 nested 空值语义真值的一部分

当前 `NodeFieldSchema` 已经正式支持：

- `placeholder?: string`

对应锚点在：

- `src/detail/node-schema.d.ts`
- `src/detail/node-schema-registry.mjs`
- `src/detail/NodeEditorHost.tsx`

这条能力的长期含义是：

- nested object node 的空值文案不再只靠通用 `null / empty` 显示
- placeholder 和 `defaultValue` 一样，属于 schema 真值的一部分
- text / number / textarea 等基础字段在 `NodeEditorHost` 中应直接消费 schema placeholder，而不是回退到组件内硬编码文案

当前已明确以 schema-driven placeholder + 空值语义覆盖的 fixed object node 包括：

- `classes.starting_equipments`
- `classes.starting_stats`
- `classes.stat_growth`
- `affixes.value_model`
- `affixes_mechanic.effect_spec`

后续如果要补更多基础节点层，默认应继续在 registry 中声明 placeholder，而不是在渲染层追加特判。

### 28. object node 当前已经有节点级 summary，正式显示 schema 标题与填写进度

当前 `src/detail/NodeEditorHost.tsx::ObjectNodeEditor(...)` 已经提供节点级 summary 区块，正式显示：

- schema `title`
- 已填写字段计数

这条行为的长期含义是：

- object node secondary panel 不再只是字段平铺列表
- 当前 schema 命中到的节点身份和填写进度，已经成为 object node 的正式可见能力
- 后续如果要扩 object node 验证或默认值恢复，应把 summary 当作这个节点层的正式 UI 锚点之一

### 29. object array 节点操作继续走现有 nested path writeback，不新建独立保存模型

当前 `src/detail/DetailPanel.tsx` 的 nested collection panel 已经正式提供：

- `Add item`
- `Duplicate`
- `Move up`
- `Move down`
- `Delete`

并继续复用既有 `nestedStack` / nested path 写回链。

相关主锚点包括：

- `src/detail/DetailPanel.tsx::cloneNestedValue(...)`
- `src/detail/DetailPanel.tsx::moveArrayItem(...)`
- nested collection panel 的 `onAddItem` / `onDuplicateItem` / `onMoveItem` / `onDeleteItem`

这条落地后的长期含义是：

- object array 节点已经进入第一批正式可编辑能力
- 数组级操作应继续沿现有 nested path writeback 更新真实值
- 不应为 object array 再单独引入一套保存模型、草稿缓存或第二套节点状态

### 30. unsupported object node 已经收口为只读 schema fallback，不再伪装成可完整编辑

当前 unsupported object node 的正式承接点已经是：

- `src/detail/NodeEditorHost.tsx::UnsupportedNodeFallback`

它会显示：

- `reason`
- 原始结构预览

并且 `src/styles.css` 已补最小 fallback 呈现样式。

这条落地后的长期含义是：

- unsupported object node 进入受控、只读的 schema fallback
- UI 应明确暴露“当前结构未被正式 schema 覆盖”，而不是继续走旧值推断编辑造成伪能力
- fallback 样式属于这条行为合同的一部分，不应在后续清理时一并误删

### 31. 第四阶段回归合同已覆盖递归 path、父级 discriminator context 与多态切换

当前新增的可复用回归锚点包括：

- `then_nodes[]` 递归 path 命中
- `runes.params` 从 parent effect context 命中
- `skills` 节点切到 `condition` 后，可继续打开 `then_nodes`、新增子节点，并默认起成 `targeting`
- `runes.params` 在真实 UI 中可从父级 `effect_type` 解析 schema，不再 fallback

主测试锚点在：

- `tests/node-schema-registry.test.mjs`
- `tests/data-editor.spec.ts`

### 32. 第五阶段最终 nested matrix 已覆盖正式 schema、unsupported fallback 与历史 mixed 场景迁移

当前最终 nested matrix 的可复用验证锚点包括：

- `unsupported nested collection item falls back to read-only JSON`
- 原先依赖 mixed legacy nested 编辑的 autosave 场景已迁到 `data/classes.json` 的 schema-driven node
- `nested detail panel renders object items without falling back to raw JSON` 已收口到正式 schema 场景 `data/runes.json`
- 10 条 Playwright nested 回归通过
- 6 条 registry 单测通过
- build 通过

这条验证边界的长期含义是：

- 最终 nested 回归不再依赖 mixed legacy object 编辑链
- 正式 schema 场景、unsupported fallback、autosave 真正能力点已经拆成独立验证面
- 后续若继续调整 nested host / fallback，默认要维持这组分层回归，而不是重新混回历史 legacy 用例

### 33. 目前回归合同已覆盖 object node summary / 默认值恢复 / object array 操作

当前新增的可复用回归锚点包括：

- schema-driven object node 显示 summary
- reset 后恢复 schema `defaultValue` 与 placeholder
- nested collection panel 支持 duplicate / move / delete

主测试锚点在：

- `tests/data-editor.spec.ts`
- `tests/fixtures/make-scratch-root.mjs`

其中 `classes.json` 已被纳入 scratch fixture，作为 object node 基础能力的稳定验证入口。

### 34. resolver 命中合同已经被 `tests/node-schema-registry.test.mjs` 锁成单测真值

当前最小回归锚点已经固定在 `tests/node-schema-registry.test.mjs`，覆盖四类命中规则：

- `classes.starting_equipments` fixed object
- `runes effects[].params` 按 `effect_type` 分流
- `skills nodes[]` 按 `type=condition` 分流
- unknown / unregistered path 返回 unsupported fallback

后续如果调整 registry 结构、lookup key 归一化或 discriminator 分流，应该先看这组测试是否需要同步作为正式合同变更，而不是只看 UI 是否还能渲染。

### 35. 当前最小回归证据已经固定为 unit + targeted Playwright + build 三层

当前可复用的最小回归证据包括：

- `node --test tests/node-schema-registry.test.mjs` 通过 6/6
- `npx playwright test tests/data-editor.spec.ts -g "nested detail panel renders object items|table nested cell|schema-driven object node|nested collection panel supports|skills nested nodes support discriminator switching|rune params nested detail resolves discriminator from parent effect context|unsupported nested collection item falls back to read-only JSON"` 通过 10 条 nested 回归
- `npm run build` 通过

后续如果继续改 nested detail 主路径、fallback 或 field editor reuse，这三层应继续作为最小稳定回归面，而不是只验证其中一层。

### 36. `npm run typecheck` 当前仍被仓库既有错误阻塞，不应误记为这轮 schema / host 改造回归

当前 `npm run typecheck` 仍未通过，但剩余错误集中在：

- `src/api/client.ts`
- `src/App.tsx`
- `src/table/DataTable.tsx`

这条验证边界的长期含义是：

- typecheck 当前不是这轮 `NodeEditorHost` / `node-schema` 模块改造的有效负向证据
- 后续若要把这轮 nested 改造声明为“全绿”，需要先单独清掉仓库既有类型面问题
- 在既有阻塞未清前，应继续以 unit + targeted Playwright + build 作为这条功能线的最小验证面

### 37. `defaultTypeFor(value)` 仍同时服务 primary detail 与 nested 路径，因此旧值推断清理只能限定在 secondary panel

当前 `defaultTypeFor(value)` 不只用于 nested secondary panel，也仍用于 primary detail 顶层字段渲染。

因此本轮“清理旧值推断路径”的长期边界必须固定为：

- 只清理 nested secondary panel 的旧值推断主路径
- 不顺手扩大到顶层 primary detail 字段编辑
- 不把顶层 `defaultTypeFor(value)` 用途误判成可以一并删除的 nested 遗留逻辑

### 38. 当前 nested 编辑界面的半成品感主要是信息架构和交互层未收口，不是 schema-driven 能力缺失

这轮任务的长期结论是：nested 编辑界面的“不完整感”主要来自界面组织方式，而不是底层 schema-driven 编辑能力本身不足。

稳定表现包括：

- collection 列表摘要更像原始值碎片，尚未形成清晰的节点级信息入口
- 操作区容易退化成裸按钮堆，缺少上下文工具栏语义
- 节点详情区缺少稳定的节点级摘要和字段分组，导致编辑焦点分散
- unknown / fallback 仍会以过强的工程实现视角暴露，打断主编辑流

因此，后续优化必须继续建立在现有 `DetailPanel` + `nestedStack` + `NodeEditorHost` + schema registry 上，不新增第二套 nested 编辑器，也不改成独立弹窗流。

设计收口的优先顺序已经固定为：

1. collection 列表摘要与上下文工具栏
2. 节点详情分组与节点级摘要
3. unknown / fallback 高级区
4. 再补样式细节与数据类型模板

其中 `arrays` 的节点卡片摘要不应继续采用“随机主值 + 字段名拼接”的弱摘要，而应升级为：

- 节点类型 / 标题
- 关键业务摘要
- 状态信息

并且允许按数据类型模板化，避免不同数组项共用同一种粗糙摘要策略。

unknown fields / unsupported fallback 不应被隐藏，但必须退出主编辑流，进入折叠式高级区，或者保留为受控的只读 fallback；它们不能继续以主编辑态的形式占据核心交互面。

### 39. 第一批 nested 体验优化已经先收口到 collection rail，不扩散到详情分组或 fallback 重做

这轮已落地的第一批体验优化只作用于 `NestedCollectionPanel` 所在的 collection rail，没有顺手把节点详情分组或 fallback 再重做一遍。

当前稳定行为是：

- 数组项列表摘要已从旧的随机值碎片升级为四层卡片：`meta` / `title` / `summary` / `status`
- 列表摘要采用通用 contract + schema 增强的组合策略
- supported object 节点可以显示 `filled` / `unknown` 状态
- unsupported object / array 会显式显示 `read-only fallback` 状态
- 动作区已经从平铺裸按钮收口为上下文工具栏
- `Add item` 永远可见
- `Duplicate` / `Move` / `Delete` 仅在选中项存在时出现

这条落地后的长期含义是：

- collection rail 的摘要层和动作层已经有了更强的结构化入口语义
- 后续如果继续优化 nested 体验，应继续围绕这套 rail contract 演进，而不是回退到“原始值 + 裸按钮”的平铺式 UI
- 这批改动没有改变现有 `DetailPanel` + `nestedStack` + `NodeEditorHost` 主链，也没有新建第二套 nested 编辑器或保存状态机

已确认的验证边界包括：

- `npm run typecheck`
- `npm run build`
- `table nested cell opens matching nested detail directly`
- `nested collection panel supports duplicate move and delete actions`
- `unsupported nested collection item falls back to read-only JSON`

额外复跑 `skills/runes` 的 schema-driven collection 长链时，仍出现入口未自动展开 secondary panel 的既有不稳定现象；这次没有把它归因到 collection rail 改动，也没有顺手扩修，后续排查仍应把它视为独立既有问题。

### 40. 第二批体验优化继续沿现有主链收口，重点是选择器、工具栏图标层级和关闭白名单

这批落地继续只是在既有 `DetailPanel` / `NodeEditorHost` / `nestedStack` 主链上做体验收敛，没有改成另一套 nested 编辑机制。

当前稳定事实包括：

- `NodeEditorHost` 的 discriminator / type 切换已经从原生 `select` 统一切到项目内公共 `SearchablePicker`
- 选择器仍保留筛选能力，便于处理较长的 discriminator / type 选项
- nested collection rail 工具栏按钮已带图标和层级语义
- `Add item` 是主操作
- `Duplicate` / `Move` / `Delete` 是选中项上下文动作
- `Delete` 继续保留 `danger` 语义，不能和普通移动操作混为一类
- 节点卡片的选中态、摘要层级和 `NodeEditorHost` 内的 node summary 区块已经做了第二轮视觉精修，不再停留在默认白卡 + 文字堆叠

这条落地后的长期含义是：

- discriminator / type 选择应继续复用项目内公共 picker 语义，而不是回退到原生下拉
- collection rail 的按钮层级和危险操作语义已经是正式 UI contract，不应在后续清理中被抹平
- 节点卡片选中态和 node summary 的视觉层级已经属于 nested 体验的一部分，不应再视为纯样式装饰

面板关闭逻辑也已经形成稳定约束：

- `DetailPanel` 的 outside-click 关闭逻辑必须把 `.searchable-picker-content` 和 `.select-content` 这类 portal 弹层视为面板内交互白名单
- 否则在选择器里点击会误关 secondary panel
- 这条白名单属于交互合同，不是某个局部组件的临时兼容

已确认的验证边界包括：

- `npm run typecheck`
- `npm run build`
- `table nested cell opens matching nested detail directly`
- `nested collection panel supports duplicate move and delete actions`
- `skills nested nodes support discriminator switching`
- `rune params nested detail resolves discriminator from parent effect context`

这批验证说明 selector 切换、rail 交互和既有 skills / runes discriminator 场景仍保持在同一条正式 nested 主链上。

### 41. 字段分组真值已经进入 schema presentation metadata，而不是继续散落在 host 的 fieldName 特判里

这批改造把 nested node detail 的字段分组真值正式前移到了 schema/presentation metadata 层，而不是继续在 `NodeEditorHost` 里按 `fieldName` 做零散硬编码。

当前稳定事实是：

- `createObjectNodeSchema(...)` 已支持 `presentation`
- `node-schema-registry` 的 `createSchema(...)` 也可以传入 `presentation`
- 已为 `classes.starting_equipments`、`starting_stats`、`stat_growth` 以及 `skills.condition` / `skills.targeting` / `skills.damage` 补入 sections
- `NodeEditorHost` 现在按 `schema.presentation.sections` 渲染 section
- 未分组字段会自动落入兜底 section

这条落地后的长期含义是：

- 字段分组已经是 schema 真值的一部分，而不是 host 渲染层附会
- 后续如果要调整分组，应优先改 schema/presentation metadata，而不是继续扩散 host 内联特判
- section 结构现在承担的是正式信息架构，不只是视觉排版

### 42. supported unknown fields 与 unsupported fallback 是两套不同语义，不能再混成同一种“未知态”

这批改造把 supported node 的 unknown fields 和 unsupported nested fallback 明确拆成了两套语义。

当前稳定事实是：

- supported node 的 unknown fields 会进入默认折叠的“高级信息” details 区
- 摘要卡会显示 unknown 数量
- unsupported nested node fallback 已改成说明卡 + 只读 JSON 预览
- supported unknown fields 仍属于正式编辑态内部的补充信息
- unsupported fallback 则是正式编辑态之外的受控只读承接

这条落地后的长期含义是：

- supported unknown fields 应继续作为 advanced 区处理
- unsupported fallback 应继续作为 read-only fallback 处理
- 这两类状态不能再共用同一套 UI 语义，否则会把“可编辑但未分组”与“不可编辑的 fallback”混淆

### 43. section 渲染存在剩余字段自动收口到 main section 的兜底规则

`NodeEditorHost` 的 section 渲染除了按 `schema.presentation.sections` 显式分组外，还存在一个正式兜底规则：未被 section 显式覆盖的剩余字段，会自动收口到 main section。

这条长期规则的含义是：

- section definition 不必为了覆盖所有字段而写成脆弱的全量枚举
- 只要 schema/presentation 里没有显式分配，字段就会被安全收口到 main section
- 这保证了 section 渲染不会因为 metadata 不完整而丢字段，也不会把未分组字段散落成无序碎片

这条兜底规则和上一条的 `advanced info` 语义并不冲突：

- supported unknown fields 进入 `advanced info` details 区
- 仍然属于正式字段集合的剩余字段，继续自动收口到 main section

### 44. node summary card 的摘要表达已经进入 schema presentation 真值层，不再只靠 schema.title 与 filled 计数

这批改造把 nested node detail 的摘要表达正式放进 `schema presentation` 真值层，而不是继续只显示 `schema.title + x/y 已填写`。

当前稳定事实是：

- `node-schema` 的 presentation 现在可以承载 `summaryFields` 与 `titleField`
- `NodeEditorHost` 会基于这些 metadata 渲染 node summary card
- 标题优先取 `presentation.titleField`
- 其次取当前 discriminator
- 再退回 `schemaTitle`
- 摘要优先取 `presentation.summaryFields`
- 摘要最多展示前几项格式化字段
- `schema label` 可携带 unknown 数量，但 unknown 仍然留在高级区，不回流主编辑流

这条落地后的长期含义是：

- node summary card 的信息架构已经是 schema 真值的一部分
- 后续如果要调整摘要表达，应优先改 presentation metadata，而不是在 host 里追加新的字段拼接特判
- unknown 计数属于摘要提示层，不意味着 unknown 字段可以离开 advanced 区重新回到主编辑流

当前已补模板的高频 schema 包括：

- `shared/effectSpec value_model`
- 多组 rune params，如 `trigger_on_cast`
- `trigger_on_minion_hit`
- `add_on_hit`
- `apply_ailment`

### 45. unsupported fallback 的 helper action 只允许受控复制 JSON，不得回流成完整 JSON 编辑

unsupported nested fallback 现在允许受控的只读辅助动作，但边界固定为“排障帮助”，不是重新引入完整 JSON 编辑。

当前稳定事实是：

- `UnsupportedNodeFallback` 与 collection item fallback 都提供复制 JSON 入口
- 复制能力依赖 `navigator.clipboard.writeText`
- 这类按钮只能复制只读结构
- 它们不会修改 nested 值
- 它们不会改变 fallback 语义

这条落地后的长期含义是：

- fallback 的 helper action 只能作为排障辅助，不是编辑能力的回流口
- 只读 fallback 仍然保持只读
- 后续如果增加更多 helper action，也必须保持“只读、受控、排障帮助”的边界，不得重建完整 JSON 编辑通道

### 46. `affixes_mechanic.effect_spec` 的 presentation contract 已固定为机制范围 / 触发规则 / 数值模型三段式

剩余高频 schema 中，`affixes_mechanic.effect_spec` 已正式补入 `presentation` metadata，并成为 node summary / section 渲染的稳定真值。

当前固定 contract 是：

- 顶层 `titleField` 使用 `mechanic_scope`
- `summaryFields` 取 `mechanic_scope` / `timing` / `target` / `threshold`
- sections 拆为：
  - `机制范围(scope)`
  - `触发规则(trigger)`
  - `数值模型(value)`
- 其子节点 `value_model` 继续复用 `effectSpecValueModelSchema`

这条落地后的长期含义是：

- `effect_spec` 的信息架构已经不是 host 临时拼装，而是 schema presentation 真值
- `value_model` 仍然是 `effectSpecValueModelSchema` 的正式复用点，不应为这条路径再复制一套平行 schema
- 后续如果调整该节点的展示结构，应优先改 presentation metadata，而不是回退到 host 里按字段名硬编码分组

### 47. `affixes_mechanic.json` 在真实 UI / fixture 中同时存在 `$` 与 `affixes_mechanic` 两种 collectionPath

另一个固定点是：`affixes_mechanic.json` 在当前真实 UI 和 fixture 中是以根集合 `$` 打开的，因此 registry 不能只假设 `affixes_mechanic` 这一种 collectionPath。

当前长期边界是：

- registry 需要同时覆盖 `$` 与 `affixes_mechanic` 两种 collectionPath
- 不能只按 `affixes_mechanic` 单一路径建立 schema 命中
- 真正的 collectionPath 命中语义必须兼容根集合打开态与显式命名集合态

这条规则的长期含义是：

- fixture / UI 里从 `$` 打开的根集合，和 registry 里按命名 collectionPath 命中的场景，应该指向同一条 schema 真值
- 后续如果新增 collectionPath 变体，必须先确认是否属于同一正式路径语义，再决定是否纳入 registry
- 不能因为 fixture 里当前是 `$` 打开，就把 schema 命中逻辑缩窄到单一 collectionPath 字面量

### 48. nested collection rail 的视觉与文案 contract 已切到纯色表面、中文主动作文案与图标化上下文动作

这批改动把 nested collection rail 的视觉和文案收口为一组稳定 UI contract，而不是继续沿用渐变背景和英文按钮文案。

当前固定规则是：

- 本轮触及的 nested item card 与 fallback card 不再使用渐变背景，改回纯色表面
- collection rail 主动作文案改为中文 `增加项目`
- 选中项上下文动作保留图标按钮，不再显示 `Duplicate` / `Move` / `Delete` 文字
- toolbar 需要保持单行优先，不再依赖多行堆叠

这条落地后的长期含义是：

- collection rail 的视觉层级已经从“示意性样式”收口为稳定表面风格
- 主动作和上下文动作的语言风格已经统一为中文产品文案
- 图标化上下文动作不应再回退成文字按钮堆叠，否则会破坏单行 toolbar 的信息密度和可扫读性
- fallback card 也属于同一套 rail contract，不能在样式上重新滑回高噪声表现

这条 contract 的验证锚点仍然是：

- `src/styles.css`
- `src/detail/DetailPanel.tsx`
- `tests/data-editor.spec.ts`

### 49. array nested panel 的长期布局 contract 已固定为“双 panel”模式

array nested panel 的长期布局已经从“在 secondary 下方继续展开”收口为双 panel 模式。

当前固定语义是：

- secondary panel 只承载 collection rail
- 选中某个 item 时，它的详情进入右侧 tertiary panel
- 从该 item 继续打开子节点时，tertiary panel 承载当前活跃 nested detail
- secondary panel 始终保留 array rail

这条 contract 的长期含义是：

- array item detail 只覆盖到双 panel 这一层，不扩展为无限层级面板系统
- tertiary panel 是 array item 详情的承接层，不是新增的通用嵌套窗口模型
- 后续如果调整 nested 布局，不能把“item 详情”和“collection rail”重新压回同一块 secondary 区域，否则会破坏当前信息分层

### 50. detail panel 的宽度 CSS 变量必须挂到所有 sibling aside，而不是只挂 primary

另一个固定实现边界是：detail panel 的宽度变量必须同时挂到 `primary` / `secondary` / `tertiary` / `document` 这些 sibling aside 上，不能只挂在 `primary`。

这条边界的长期含义是：

- sibling aside 需要能直接读取同一组 CSS 变量
- 如果只挂在 primary，其他 sibling 无法继承变量，会重新叠到 `right:0`
- 因此宽度 contract 本质上是 sibling 级共享 contract，不是单个面板的局部样式

这条规则和上一条双 panel contract 是配套的：

- 布局分层决定 item detail 去向
- CSS 变量挂载决定 sibling aside 能否稳定读取同一套宽度语义

## 长期行为 / 规则

- “完整 nested 编辑”在本轮只指向右侧 nested detail 主路径升级，不等于全量字段系统重构。
- nested secondary panel 继续复用 `DetailPanel` 既有导航真值，直接锚定 `openNestedField(...)` 和 `nestedStack`；不要新增并行 nested 状态树。
- 第一阶段主要替换 `NestedObjectPanel`、`renderNestedItemEditor(...)`、`NestedEditor` 这条值推断内容层，不是整个 `DetailPanel`。
- nested 叶子字段复用正式字段编辑器；允许加 adapter，不允许复制业务编辑逻辑。
- `FieldEditorResolver` 一类分发层必须显式承接 `relationOptions`、`relationConfigs`、`sourcePath`、`collectionPath`、draft commit、`onOpenRelationTarget`、`activeTextEditor` 等运行时上下文。
- relation 解析必须保留 `buildRelationKey({ sourceFile: sourcePath, sourceCollection: collectionPath, fieldPath: pathParts })` 这套完整路径语义，不能退化成只看字段名。
- `NodeSchema` 真值已经正式落到 `src/detail/node-schema.mjs` 和 `src/detail/node-schema-registry.mjs`，后续 schema 扩展优先改 registry，不回退组件内联分支。
- 在第四阶段正式接入前，`traits.effects[]`、`runes.effects[].params`、`skills.nodes[]` 这类多态 / 递归 schema 只能视为 resolver 真值已存在，不等于 host 已经打通。
- 多态 / 递归节点是否真正可用，必须同时检查 `NestedCollectionPanel` / `renderNestedItemEditor(...)` 的主路径是否已接到 `NodeEditorHost`。
- 递归 nested 支持要按 path pattern / recursive path 建模；只注册根级 `["[]"]` 不足以覆盖 `then_nodes[]` / `else_nodes[]` 一类递归分支。
- 当 discriminator 位于父级对象而不在当前编辑对象内部时，host 必须显式携带父级 context；否则会出现 resolver 能命中、真实 UI 命不中的分裂。
- 第四阶段后，多态 / 递归 schema 已正式进入 nested host 主链；`traits.effects[]`、`runes.effects[]`、`runes.effects[].params`、`skills.nodes[]` 不再只是 resolver 条目。
- discriminator selector 只应在当前节点本地持有且可写 discriminator 时出现；切换后按目标 variant `defaultValue` 完整重建节点，避免旧变体脏字段残留。
- 父级 discriminator context 已经是 nested schema 真值的一部分；`runes.params` 一类场景必须继续通过 `contextValue` / `schemaContextValue` 传递父级判别字段。
- `skills` 递归节点命中正式依赖 `recursiveItemPaths`；递归子数组新增项按目标 item schema 的默认 variant 起项，不能继承父节点 discriminator。
- schema 命中的 collection item 已以内嵌 `NodeEditorHost` 进入正式主路径；legacy item editor 只保留给未命中 schema 的 fallback。
- 第五阶段后，secondary panel collection item 内容层的旧值推断正式清理点就是 `renderNestedItemEditor(...)` / `NestedEditor`；它们不再承担正式 nested object 编辑主路径。
- `NestedEditor.tsx` 已删除；未来不应再把它视为 nested detail 主路径的一部分。
- unsupported nested object / array 的正式长期语义是只读 fallback，而不是 legacy 可编辑表单。
- fallback 回归必须和正式 schema-driven 场景分开维护，避免继续把 unsupported 结构误当正式编辑能力。
- fixed-schema object node 的 secondary panel 主路径已经切到 `NodeEditorHost`；`DetailPanel` 的 plain-object activeNested 分支不再继续走旧 `NestedObjectPanel`。
- 被 `NodeEditorHost` 替换的旧 `NestedObjectPanel` object 主路径已经删除，避免长期双轨。
- `NodeEditorHost` 只消费当前 `rootField + basePath + value`，继续复用 `nestedStack` 导航真值，不自建第二套 nested 状态。
- object node 的 summary、placeholder 和默认值恢复已经进入正式能力面；其中 placeholder 属于 schema 真值，而不是渲染层附会文案。
- `NodeEditorHost` 内的 nested relation/select/multi-select 直接复用正式 cell editor；其中 select / multi-select 当前通过 `nextSelectedValues` 做 path 级写回。
- object array 节点的 Add / Duplicate / Move up / Move down / Delete 继续走现有 nested path writeback，不新建独立保存模型。
- resolver 必须以 `sourcePath + collectionPath + rootField + nestedPath + discriminator` 为稳定命中语义。
- `nestedPath` 中的 numeric segment 必须按 `[]` 归一化；数组下标不是 schema key 的正式组成部分。
- 未注册 nested path 或未注册 discriminator variant 必须显式返回 `unsupported` + `reason`。
- unsupported object node 进入 `UnsupportedNodeFallback` 只读 schema fallback，并保留 `reason` + 原始结构预览。
- `tests/node-schema-registry.test.mjs` 是当前 resolver 命中合同的最小单测真值。
- 当前最小回归面是 `tests/node-schema-registry.test.mjs` + object node / object array / table nested cell 的 targeted Playwright + build。
- `npm run typecheck` 目前仍被仓库既有错误阻塞，不应直接归因到这轮 nested schema / host 改造。
- `defaultTypeFor(value)` 的旧值推断清理范围只限 nested secondary panel，不扩散到 primary detail。
- 这条 truth 记录的是长期边界和已落地的 schema / resolver 真值，不是阶段进度日志。

## 关联文档

- `docs/plans/2026-07-09-嵌套节点完整编辑方案.md`
- `docs/plans/2026-07-09-嵌套节点完整编辑执行方案.md`
- `.claw/truth/table-nested-detail-panel-nested-editing.md`
- `.claw/truth/entry-actions-v2-target-pair-selector-and-dollar-collection-routing.md`

## 关联代码

- `src/detail/DetailPanel.tsx`
- `src/detail/NodeEditorHost.tsx`
- `src/table/CellRenderer.tsx`
- `src/styles.css`
- `src/detail/node-schema.mjs`
- `src/detail/node-schema-registry.mjs`
- `src/detail/node-schema.d.ts`
- `tests/node-schema-registry.test.mjs`
- `tests/data-editor.spec.ts`
- `tests/fixtures/make-scratch-root.mjs`

## 关键检索词

- `nested node editing framework`
- `nestedStack`
- `openNestedField`
- `NestedObjectPanel`
- `renderNestedItemEditor`
- `NestedCollectionPanel`
- `NodeSchema`
- `node-schema-registry`
- `NodeEditorHost`
- `UnsupportedNodeFallback`
- `property-block--fallback`
- `placeholder`
- `defaultValue`
- `cloneNestedValue`
- `moveArrayItem`
- `renderValueEditor`
- `FieldEditorResolver`
- `nextSelectedValues`
- `buildRelationKey`
- `recursiveItemPaths`
- `contextValue`
- `schemaContextValue`
- `embedded`
- `then_nodes`
- `else_nodes`
- `defaultTypeFor`
- `read-only JSON`
- `schema resolver`
- `sourcePath`
- `collectionPath`
- `rootField`
- `nestedPath`
- `discriminator`
