# 项目合同能力提交移植与脏工作树合入边界

<!-- document-state: current -->
<!-- state: current -->

## Current behavior

本文保留跨层合同能力的依赖识别、脏工作树保护、交付顺序和验证边界。历史提交已完成合入，不再要求重放某次提交，也不把当时的文件总数和重叠集合当作下一次迁移清单。

当前合同与嵌套能力通过通用capability manifest进入，项目拥有结构、约束和派生语义，编辑器拥有加载、解释、admission和保存。协议入口见[通用合同总览](C:/Code/data-editor/docs/11_文档合同与嵌套Schema.md)及[合同保存ADR](C:/Code/data-editor/.claw/truth/adr/skill-targeting-project-contract-and-save-gate.md)。

## 长期合入规则

### 1. 先按调用链确定完整依赖闭包

不能只看新增文件。合同service/compiler/client、schema/form/state、host/detail、表格派生、视图迁移、server/API/App和测试可能共同构成交付闭环；遗漏已有文件中的接线会形成表面可编译但功能断链的候选。

每轮从精确提交和当前文件树重新取得依赖及变更清单。排除无关提交和ignore规则等附带变更，不从旧“52文件”快照推断本轮范围。

### 2. dirty tree逐文件三方保护

先核对当前status/diff与目标提交，区分无重叠文件和重叠文件；无重叠按精确来源引入，重叠人工三方合并，不以整文件覆盖当前成果。

合入必须保留既有自动化、project registry、nested导航/路径接线及当前项目声明的匹配修复。禁止因文件名属于另一条功能线就误删同文件中的必要逻辑。需要dirty-tree逐文件保护的任务，不用pull/cherry-pick替代已约定的保护过程，也不做跨提交整仓同步。

### 3. 按依赖顺序形成可验证切片

通常先形成service/compiler/client和类型/状态，再接schema/host/detail、派生及迁移、server/API/App，最后完成相应测试与端到端验证。具体顺序以当前调用链为准，不把旧组件名称固定为永久架构。

前层先提供语义、类型与接口，后层再接入消费和写回。不能在依赖尚未落地时把UI或保存入口置于不可验证的中间态。

### 4. 保存和合同必须使用当前owner

当前加载由 `project-capability-manifest/registry` 及 `document-contract-service/grammar/compiler` 承担；nested由 `nested-schema-capability`、`NodeSchema` 与 `NodeEditorHost` 解释。旧业务service、固定文件名和静态schema不是当前真值。

合同不可用时失败关闭；不能用旧静态结构放行。保存必须维护当前documentContracts admission集合、候选合法性和替换前后复核，拒绝陈旧或跨context内容；具体token和失败语义由当前通用owner负责，本文不另定义旧saveToken协议。

### 5. 派生展示与旧视图引用同批核对

结构变化时同时追踪派生输出及view/profile/local引用迁移，不能仅改变表单schema。当前项目声明决定领域字段与派生含义；通用编辑器不能从历史业务节点字段列表推导新的游戏规则。

## 验证与证据边界

完成标准是本轮冻结依赖清单逐项处理、重叠三方合并保留既有功能、无附带ignore/无关提交、service到UI和保存及迁移闭环成立。每轮实际运行适用的typecheck/build及定向测试，不以旧测试数字代替本轮结果。

验证覆盖项目capability、合同加载/compiler、token拒旧/候选及替换后校验、nested host、派生/引用迁移与保存。仅UI展示、单元测试或普通health成功均不足以单独证明完整链。

历史服务健康与维护验收是当次快照。文档整理不需要启动服务；若实施任务实际启动服务或执行停止/恢复，按项目服务收尾规则检查正式main/bridge，不复用旧健康结果。

## References

- [通用文档合同与嵌套Schema](C:/Code/data-editor/docs/11_文档合同与嵌套Schema.md)
- [当前合同保存ADR](C:/Code/data-editor/.claw/truth/adr/skill-targeting-project-contract-and-save-gate.md)
- [capability registry](C:/Code/data-editor/src/project-capability-registry.mjs)
- [合同compiler与保存校验](C:/Code/data-editor/src/document-contract-compiler.mjs)
- [nested解释](C:/Code/data-editor/src/detail/nested-schema-capability.mjs)
- [客户端保存](C:/Code/data-editor/src/api/save-documents.mjs)
- [服务端保存](C:/Code/data-editor/server.mjs)

<!-- state: history -->
## Evolution history

<!-- dated: 2026-10-25 -->
### 旧移植现场与业务合同历史

原题“技能 Targeting 合同提交移植与脏工作树合入边界”中提交 `4539067f`、排除提交 `3247e55e`、52文件/5重叠清单、具体游戏路径修复、旧字段结构及71项测试等证据，统一由[项目历史索引](C:/Code/Nocturnel/.claw/truth/tech/data-editor/编辑器侧项目知识承接与历史索引.md)承接，[原字节对象](C:/Code/Nocturnel/docs/records/data-editor知识迁回来源/2026-10-25/objects/50e9080da6c19b5e1ebb846239790bc17ba803cb36d26627ae72c357e03ce929.source)完整保存。它们不能作为重新合入旧提交、恢复旧字段或旧业务保存协议的依据。
