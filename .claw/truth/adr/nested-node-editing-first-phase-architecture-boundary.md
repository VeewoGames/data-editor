# ADR: nested node editing 第一阶段架构边界

<!-- document-state: accepted -->
<!-- state: accepted -->

## Context

nested编辑需要稳定的项目schema owner、节点宿主、导航和路径写回合同。通用编辑器不拥有具体项目节点结构，也不把某个项目的数据文件、字段或物理检出位置固化为产品语义。

当前机制来自项目capability：`.data-editor/project.json` 声明 `nested-schema-v1`，`src/detail/nested-schema-capability.mjs` 解析匹配，`src/detail/node-schema.mjs` 保存通用schema形状与lookup key。详细通用行为继续由[同路径nested Truth](C:/Code/data-editor/.claw/truth/nested-detail-panel-first-phase-boundary-and-resolver-key.md)维护。

## Decision

### 1. 范围、owner与导航

第一阶段重构只替换右侧nested secondary panel的复杂object/array内容层，不扩大为primary detail顶层字段系统重写。`DetailPanel.nestedStack` 与 `openNestedField(...)` 继续作为唯一nested导航入口；host和resolver不另建状态树。

项目声明拥有领域schema、默认值、判别字段和展示结构；编辑器只解释受支持JSON。扩展项目能力改声明与schema，不恢复旧静态registry，也不在 `DetailPanel`、`NodeEditorHost` 或旧legacy层添加业务path分支。

### 2. 完整匹配身份

项目binding匹配使用data source、文档相对path、collection、rootField和nestedPath；lookup身份保留sourcePath、collectionPath、rootField、nestedPath和discriminator。基础身份与variant选择分两段处理，不能只看字段名、当前值或判别值。

数值nested segment归一为 `[]`。文件或集合迁移须同步项目声明、fixture和测试，按实际 `/api/files` 路径与声明对照排查；旧路径测试通过不等于真实UI命中。当前匹配是声明式精确匹配，不将旧后缀表或业务递归参数当作现行API。

### 3. 单一host、叶子editor与写回

supported object统一由 `NodeEditorHost` 承载，supported collection item以内嵌host接入。旧 `NestedObjectPanel`、`NestedEditor` 和按值推断复杂表单不作为长期双轨保留。

nested relation/select/multi-select复用正式editor并通过路径adapter写回；携带关联选项、关联配置、sourcePath、collectionPath、完整fieldPath、打开目标和active editor等上下文，不复制第二套控件或强行套回顶层draft模型。

对象summary、schema标题、填写信息、placeholder和defaultValue继续作为节点能力；数组新增、复制、上/下移动、删除复用原path writeback及clone/move/update helper，不另建保存模型、缓存或节点状态。

### 4. 多态、父级context与深层结构

variant从当前value或parent context判别；只有可在当前节点切换时才显示selector。切换按目标variant defaultValue完整重建并写入discriminator，不能merge旧变体脏字段。

父级判别字段经schemaContextValue/contextValue传递，不在子对象镜像另一份判别字段。更深层或重复结构必须按项目声明的匹配/schema验证；新增item用目标schema默认variant，不能继承父项业务类型，不假定根级匹配即可自动支持任意深度。

### 5. 明确能力与只读fallback

未命中schema或variant返回unsupported及reason；复杂object/array进入只读fallback和原始结构预览，不能恢复legacy可编辑表单。primitive最小安全编辑不代表复杂结构可编辑。

fallback与supported schema主链使用独立短用例验证，不用历史mixed长用例暗示未支持结构具有正式编辑能力。新增覆盖须通过项目声明和通用解析/宿主接线进入，不静默放宽fallback。

## Consequences

- schema owner、导航和写回各自唯一，避免UI状态、业务定义与保存模型分叉。
- 路径漂移先核对binding和真实路径；context漂移先核对父级传递，再检查布局，不能把旧测试通过当作UI验收。
- 项目节点、父级判别和递归示例不再是编辑器内置规则；通用契约通过独立fixture和受支持能力验证。
- 正式scope、默认值、默认variant和展示分组由项目声明决定；编辑器扩展不授予任何新游戏业务决定。

## Alternatives

- 组件内维护零散schema/path判断：使项目语义侵入通用产品，拒绝。
- 为旧真实路径保留隐式兼容注册：制造单测假通过及双入口，拒绝。
- 另建nested导航、数组保存模型或relation/select简化控件：形成长期双轨，拒绝。
- unsupported复杂结构继续按值编辑：隐藏能力缺口并可能写坏业务结构，拒绝。

## References

- [文档合同与嵌套Schema](C:/Code/data-editor/docs/11_文档合同与嵌套Schema.md)
- [nested详细通用合同](C:/Code/data-editor/.claw/truth/nested-detail-panel-first-phase-boundary-and-resolver-key.md)
- [当前capability解析](C:/Code/data-editor/src/detail/nested-schema-capability.mjs)
- [通用schema形状](C:/Code/data-editor/src/detail/node-schema.mjs)
- [节点宿主](C:/Code/data-editor/src/detail/NodeEditorHost.tsx)
- [导航与路径写回](C:/Code/data-editor/src/detail/DetailPanel.tsx)

<!-- state: history -->
## Evolution history

<!-- dated: 2026-10-25 -->
### 项目接入历史

旧阶段任务、具体游戏节点和正式数据路径修复的原始证据由[项目历史索引](C:/Code/Nocturnel/.claw/truth/tech/data-editor/编辑器侧项目知识承接与历史索引.md)承接；[原字节对象](C:/Code/Nocturnel/docs/records/data-editor知识迁回来源/2026-10-25/objects/77e523dfd3900de3548457627accafc443e64bf2caffd4e0ba52420078718c8f.source)保留原决策及演进全文。它们不重新建立当前业务schema或旧静态registry authority。
