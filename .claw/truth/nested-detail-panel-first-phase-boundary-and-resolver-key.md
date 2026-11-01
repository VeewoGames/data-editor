# nested 节点完整编辑第一阶段执行边界与 resolver key 约束

<!-- document-state: current -->
<!-- state: current -->

## Current behavior

本文保留 nested 编辑的通用框架、导航、解析、显示、写回和验证边界。项目拥有领域 schema 与 capability 声明；Data Editor 解释声明并承载编辑，不在通用代码中维护项目节点表。当前协议总览见 [文档合同与嵌套 Schema](C:/Code/data-editor/docs/11_文档合同与嵌套Schema.md)。

`NodeSchema` 的通用形状和 lookup key 由 `src/detail/node-schema.mjs` 维护；当前项目 schema 的匹配由 `src/detail/nested-schema-capability.mjs` 负责，接入入口是 `.data-editor/project.json` 的 `nested-schema-v1`。旧静态 registry、项目文件后缀表和业务节点模板不是当前扩展入口。

## 长期规则

### 1. 框架改造范围与唯一导航

第一阶段重构对象是右侧 nested secondary panel 的 object/collection 内容层，不等于重写整个 `DetailPanel` 或 primary detail 顶层字段系统。后续局部改造仍须明确这条职责边界，不能借“完整编辑”扩张为全量字段重构。

`DetailPanel.nestedStack` 与 `openNestedField(...)` 是既有 nested 导航入口；`NodeEditorHost` 消费当前根字段、路径和值，不另建导航状态机、局部保存模型或并行节点状态。旧 `NestedObjectPanel`、`renderNestedItemEditor(...)` 和已删除的 `NestedEditor.tsx` 不再承担复杂 nested 编辑主路径。

primary detail 仍有 `defaultTypeFor(value)` 等通用字段显示用途。清理 secondary panel 旧值推断，不授权顺手删除顶层用途，也不代表全库已无值推断。

### 2. 项目 schema 与当前解析入口

项目通过 active capability 绑定提供 schema；通用编辑器只加载声明的 JSON 并解释其字段、默认值、判别字段和展示信息，不导入项目代码、不猜业务文件名。新增支持应修改项目声明及其受支持 schema，不能回到宿主组件追加项目 path/field 特判。

当前匹配身份是 `dataSourceId + path + collection + rootField + nestedPath`；`sourcePath + collectionPath + rootField + nestedPath + discriminator` 继续构成节点 lookup/诊断身份。基础匹配先确定 schema，discriminator 再选择 variant，不能让判别值代替文档或集合身份。

`nestedPath` 中数值下标归一化为 `[]`；数组第一个和后续元素不应因为具体下标不同而落入不同schema。当前 capability matcher 对归一后的路径逐段精确匹配，不能把旧 `sourcePathSuffix` 或旧 `recursiveItemPaths` 参数当作仍在生效的通用API。

### 3. 叶子 editor 复用与完整上下文

nested 的 text/number/boolean/select/relation/multi-select 复用现有字段编辑器。允许增加 adapter/resolver/host 分层，不复制第二套简化 relation/select 交互。

字段分发必须显式携带 `relationOptions`、`relationConfigs`、`sourcePath`、`collectionPath`、路径级写回、打开关联目标和 active text editor 等上下文；只有字段名和值不足以保持编辑语义。

relation key 保持 `buildRelationKey({ sourceFile: sourcePath, sourceCollection: collectionPath, fieldPath: pathParts })` 的完整语义。不能因嵌套编辑而退化为仅看叶子字段名。

### 4. 单一宿主与路径写回

supported fixed object 由 `NodeEditorHost` 承载；supported array item 在 collection panel 内使用 embedded host，避免 collection item 成为 schema 到真实UI的接线断点。判断支持程度必须同时看 resolver、host与交互，不把“存在schema”当作已支持编辑。

nested select 将 `nextSelectedValues[0] ?? null` 写入当前路径，multi-select 写入 `nextSelectedValues`；复用的是控件交互，不能强行套回顶层 `fieldName` 粒度draft提交链。所有修改继续走原 nested path writeback。

### 5. 对象默认值与空值语义

schema 的 `title`、字段、`defaultValue` 和 `placeholder` 是节点含义的一部分。默认值恢复以 schema 为准，placeholder 表达空值语义；不能在渲染层复制业务默认值或硬编码提示。

节点层须保留可识别身份与填写信息，避免只呈现无上下文的字段平铺。当前 section header 显示已填写/字段数，collection卡片显示标题、摘要与状态；扩展应沿通用摘要和 schema 展示能力实现。

### 6. 数组操作不产生第二套保存机制

数组支持新增、复制、上移、下移、删除；`cloneNestedValue(...)`、`moveArrayItem(...)` 等操作沿既有真实路径写回。不能给object array另起保存模型、草稿缓存或局部状态真值。

新增项使用当前目标item schema的默认值；不能从父节点或上一项静默继承判别值和脏字段。具体默认variant由项目schema声明，编辑器不固定任何业务类型名。

### 7. 多态切换、父级context与嵌套深度

判别字段可从当前 `value` 或 `contextValue` 解析。判别来源在父级/context时，不给子对象展示可独立切换的selector，也不在子对象镜像另一份业务判别字段。

本地允许切换时，selector复用公共 `SearchablePicker` 并保留筛选。切换按目标variant的 `defaultValue` 完整重建，再写入discriminator，不局部merge旧variant字段。

`nestedStack`、host drill-down和resolver之间必须持续传递 `schemaContextValue`/`contextValue`。出现单测命中而真实UI fallback时，先核对父级context是否丢失。

重复或递归结构在每一实际路径和深度都需要合法项目schema承接。根级命中不足以证明更深子数组支持；不能恢复旧业务递归模板、假定任意深度自动匹配，或另建一套递归编辑器。验证必须覆盖真实深层路径、新增默认项和返回导航。

### 8. unsupported与primitive安全编辑

未命中binding或variant时，resolver返回 `kind: "unsupported"`、lookup key和稳定reason。复杂object/array进入受控只读fallback，显示说明及原始结构预览；不回退旧按值表单、完整JSON编辑或伪装成“可编辑但不完整”。

primitive item可保留最小安全编辑；它不授予复杂结构编辑能力。复制JSON仅为只读排障辅助，依赖clipboard可用性，不写nested值、不改变fallback权限。

### 9. collection rail的信息结构与动作

rail卡片使用meta/title/summary/status分层，显示supported节点填写及unknown状态，unsupported结构显示只读fallback。摘要应表达节点身份、关键内容和状态，不拼接随机主值与字段碎片。

主动作“增加项目”持续可见；复制、移动、删除是选中项上下文动作，使用图标和单行优先工具栏，删除保持danger语义。卡片选中态、摘要层级、纯色表面和fallback样式属于交互可读性，不在清理时抹平为裸按钮和高噪声原始JSON。

### 10. schema展示信息与分组兜底

字段分组来自 `schema.presentation.sections`，不是host中的业务fieldName特判。正式字段中未被section覆盖的剩余字段自动收口到main section；metadata无需脆弱地枚举全部字段，也不能因漏分组丢字段。

supported node的unknown字段与unsupported node是两套状态：前者是可支持节点内的默认折叠高级信息，后者是编辑态之外的只读fallback。unknown数量可作为摘要提示，但不能把未知字段重新推回主编辑流。

`presentation.titleField`、`summaryFields`等展示信息的维护仍归schema声明；实际呈现须核对当前宿主/摘要函数支持，不能把旧模板策略或仅被保留的metadata误写成当前全部消费者均已实现。已有通用能力是section与填写信息、collection摘要和高级区；具体项目模板移交项目维护。

### 11. 双panel布局、宽度与portal交互

array secondary panel保留collection rail，所选item及后续活跃nested detail由tertiary panel承载。双panel是array详情分层，不扩张为无限层级窗口；不能把rail与item detail重新压回同一块secondary区。

primary/secondary/tertiary/document这些sibling aside都必须能读取同一组宽度CSS变量。只挂primary会让兄弟面板无法继承并重新叠到 `right:0`；布局去向与变量挂载是配套合同。

outside-click关闭须把 `.searchable-picker-content`、`.select-content` 等正式portal弹层视为面板内交互白名单；否则选择器点击会误关面板。白名单按真实公共控件维护，不能因重排DOM而遗漏。

### 12. 文档路径迁移与故障定位

当前项目声明的data source/path/collection是匹配真值。路径或集合迁移时，同步更新项目capability声明、对应fixture和resolver用例，不保留旧隐式路径来制造假通过。

排障先区分：单测与UI都不命中，检查binding、lookup key、判别字段；单测命中但UI fallback，检查 `/api/files` 的真实路径、data source、集合、声明及父级context。不能跳过这些身份核对就归因于tertiary布局或宿主渲染。

根集合 `$` 和命名集合是独立匹配身份。只有项目明确声明其为相同语义并配置绑定时才能共享schema，不能在编辑器中全局硬编码别名。

## 验证边界

通用回归使用仓库自有fixture；`tests/fixtures/make-scratch-root.mjs` 默认来源为 `tests/fixtures/projects/e2e-schema-project`，可通过 `DATA_EDITOR_FIXTURE_PROJECT_ROOT` 显式选择测试来源。默认不得依赖相邻真实游戏目录，也不能为了测试写入真实项目。

验证应分层覆盖capability匹配、完整lookup key、数值下标归一、discriminator/context、host接线、默认值恢复、数组操作、深层路径、schema分组、portal关闭及双panel呈现。supported主链、只读fallback、primitive安全编辑与autosave分别验证，不借旧mixed长用例证明未支持结构可编辑。

最小相关入口为 `tests/nested-schema-capability.test.mjs`、`tests/project-capability-manifest.test.mjs`、`tests/data-editor.spec.ts`，配合当前typecheck/build。旧测试数量、旧typecheck失败位置及旧正式UI快照不代表当前状态；每轮按实际执行结果报告，先辨别既有问题再归因。

## References

- [通用文档合同与嵌套Schema](C:/Code/data-editor/docs/11_文档合同与嵌套Schema.md)
- [项目manifest解释](C:/Code/data-editor/src/project-capability-manifest.mjs)
- [当前nested解析器](C:/Code/data-editor/src/detail/nested-schema-capability.mjs)
- [NodeSchema与lookup key](C:/Code/data-editor/src/detail/node-schema.mjs)
- [节点宿主](C:/Code/data-editor/src/detail/NodeEditorHost.tsx)
- [详情导航与路径写回](C:/Code/data-editor/src/detail/DetailPanel.tsx)
- [表格入口通用合同](C:/Code/data-editor/.claw/truth/table-nested-detail-panel-nested-editing.md)

<!-- state: history -->
## Evolution history

<!-- dated: 2026-10-25 -->
### 项目来源与演进记录

本文件原含特定游戏的节点字段、旧静态registry路径、真实数据迁移、正式UI验收与当次测试/类型检查快照。它们已移交[项目历史索引](C:/Code/Nocturnel/.claw/truth/tech/data-editor/编辑器侧项目知识承接与历史索引.md)，原字节见[来源对象](C:/Code/Nocturnel/docs/records/data-editor知识迁回来源/2026-10-25/objects/e7cd494ab649dfbf37eebcba76ec6f2b10938aa536c22f5a09fad0bd253ab33b.source)。历史不授予当前业务schema或真实项目fixture默认地位。
