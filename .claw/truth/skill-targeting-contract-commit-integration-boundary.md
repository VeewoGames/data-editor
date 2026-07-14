# 技能 Targeting 合同提交移植与脏工作树合入边界

## 结论

目标提交 `4539067f`（`接入技能节点合同编辑支持`）包含 52 个文件。这 52 个文件共同构成技能 Targeting 合同编辑的完整依赖链，不能把其中的 service、client、schema、form/state、host/detail、表格派生、迁移或测试文件误判为无关改动后拆除。

向当前脏工作树合入该提交时，不得执行 `pull`、`cherry-pick`，也不得用目标版本整文件覆盖已有修改。应从精确提交逐文件引入无重叠文件，并只对重叠文件做人工三方合并。

## 精确提交边界

- 来源提交：`4539067f`
- 文件总数：52
- 变更主题：技能节点合同编辑、Targeting 派生字段与视图迁移，以及贯穿服务端、API、详情宿主、表格和测试的配套依赖
- 排除提交：`3247e55e`
- `3247e55e` 只修改 `.gitignore`，不属于本轮 Targeting 合同依赖链，不得随合入带入

## 脏工作树重叠边界

目标提交的 52 个文件与当前未提交修改的精确交集只有以下 5 个文件：

- `server.mjs`
- `src/api/client.ts`
- `src/App.tsx`
- `src/detail/DetailPanel.tsx`
- `src/detail/node-schema-registry.mjs`

这 5 个文件必须人工三方合并，合并时同时保留目标提交中的 Targeting 合同能力与当前工作树中的既有成果：

- `server.mjs`、`src/api/client.ts`、`src/App.tsx`：保护 entry actions 与 project registry 的服务/API/应用接线
- `src/detail/DetailPanel.tsx`：保护 entry actions 详情入口与 nested detail 行为
- `src/detail/node-schema-registry.mjs`：保护 Nocturnel 正式 `data/content/*.json` nested schema 路径修复

其余 47 个目标文件当前没有未提交重叠，可以从 `4539067f` 精确引入，但仍应保持提交原有依赖链和后述顺序，不做跨提交的整仓同步。

## 长期合入顺序

技能 Targeting 合同依赖链的稳定合入顺序为：

1. 基础 service/client
2. schema/form/state
3. host/detail
4. 表格派生/迁移
5. `server.mjs` / API / `src/App.tsx`
6. 测试

该顺序用于降低中间态断链和重叠文件误覆盖风险。前序层先提供语义、类型、状态和调用能力，后序层再接入 UI、迁移、服务入口与合同测试。

## 主要代码锚点

- 基础合同与服务：`src/skill-node-contract-semantics.mjs`、`src/skill-node-contract-service.mjs`、`src/skill-node-contract-version.mjs`
- client 与保存：`src/api/skill-node-contract-client.mjs`、`src/api/save-documents.mjs`、`src/api/client.ts`
- schema/form/state：`src/detail/node-schema.mjs`、`src/detail/node-schema-registry.mjs`、`src/detail/skill-node-contract-form-model.mjs`、`src/detail/skill-node-contract-state.mjs`
- host/detail：`src/detail/NodeEditorHost.tsx`、`src/detail/DetailPanel.tsx`
- 表格派生与迁移：`src/view/derived-field-projection.mjs`、`src/view/targeting-view-field-migration.mjs`、`src/view/targeting-view-file-migration.mjs`、`src/table/CellRenderer.tsx`
- 最终接线：`server.mjs`、`src/api/client.ts`、`src/App.tsx`
- 合同测试：`tests/skill-node-contract-*.test.mjs`、`tests/derived-field-projection.test.mjs`、`tests/targeting-view-field-migration.test.mjs`

## 已知陷阱

- 只看新增文件会漏掉已有 schema、detail、table 和 API 文件中的必要修改，形成表面可编译但合同链不完整的状态。
- 对 5 个重叠文件执行整文件覆盖会回退 entry actions、project registry 或 nested `data/content` 路径修复。
- 直接 `cherry-pick 4539067f` 会把冲突处理交给整提交级流程，不符合当前脏工作树的逐文件保护边界。
- 把 `3247e55e` 的 `.gitignore` 一并带入会扩大本轮范围，且不属于 Targeting 合同依赖。
- 跳过既定层级顺序会让 host/detail 或 App 在依赖尚未落地时进入不可验证的中间态。

## 验证标准

后续执行合入时，至少应确认：

- `4539067f` 的 52 个目标文件均已按依赖链处理，没有遗漏
- 只有上述 5 个重叠文件采用人工三方合并
- entry actions、project registry、nested `data/content` 路径修复仍保留
- `.gitignore` 不包含来自 `3247e55e` 的附带修改
- Targeting service/client、schema/form/state、host/detail、表格派生/迁移、server/API/App 与测试形成完整闭环

## 关键检索词

`4539067f`、`3247e55e`、`Targeting`、`skill-node-contract`、`derived-field-projection`、`targeting-view-field-migration`、`targeting-view-file-migration`、`三方合并`、`entry actions`、`project registry`、`data/content`、`52 files`

## 合入完成态与当前正式合同

`4539067f` 的技能 Targeting 合同编辑能力已经完成增量合入。上文“脏工作树重叠边界”和“长期合入顺序”保留为本次移植的审计与复用规则；当前产品行为以本节为准，不再处于待合入状态。

归档计划位于：

- `.claw/archive/tasks/将最新技能-Targeting-合同编辑能力合入当前-data-editor/plan.json`

### 1. `skills.nodes` 的唯一合同真值来自当前项目

正式加载入口是 `src/skill-node-contract-service.mjs`：

- 合同固定读取当前项目的 `data/contracts/skill_nodes.json`
- 合同 meta-schema 固定读取当前项目的 `data/contracts/skill_nodes.schema.json`
- 服务端先执行 JSON Schema、支持版本与运行时语义校验，再返回合同和基于原始合同字节生成的 ETag

`skills.nodes` 不复制第二套 Targeting schema，也不回退旧静态 skills targeting 定义。`src/detail/node-schema-registry.mjs` 的合同 adapter 根据项目合同生成 nested schema；无合同 adapter 时，skills targeting 不应被旧静态 resolver 接管。

### 2. Targeting 正式结构只有 `selection` / `area` / `affects`

Targeting 顶层正式字段固定为：

- `selection`
- `area`
- `affects`

`selection` 和 `area` 根据合同 discriminator 展示各 variant 声明的字段；`affects` 承载 `relations` 与 `entity_types`，并参与合同约束。旧平铺字段 `range_type`、`range_value`、`target_type`、`area_shape`、`area_size`、`target_count`、`target_alignment` 已退出 `skills.nodes` 正式编辑路径。

主要生成与约束锚点是 `src/detail/node-schema-registry.mjs` 和 `src/detail/skill-node-contract-form-model.mjs`；宿主写回继续由 `src/detail/NodeEditorHost.tsx` 与 `src/detail/DetailPanel.tsx` 承担。

### 3. 合同不可用时采用失败关闭，不做静态 fallback

`src/detail/skill-node-contract-state.mjs` 将合同状态收敛为 `loading`、`ready`、`error`、`version_mismatch`。只有完整合同、受支持版本、响应版本一致且 ETag 有效时 `canEdit=true`。

合同缺失、加载失败、版本不受支持、响应版本不一致或 ETag 缺失时，`skills.nodes` 必须进入明确只读状态，并阻止保存；不得为了继续编辑而恢复旧静态 Targeting schema。文档根的 `skill_node_contract_version` 与当前项目合同版本不一致时同样只读并禁止保存。

### 4. 保存必须通过版本、ETag 与 project-scoped save token 门禁

保存链路由 `src/api/save-documents.mjs`、`src/api/client.ts`、`server.mjs` 和 `src/detail/skill-node-contract-state.mjs` 共同约束。正式保存请求必须携带：

- `contractVersion`
- `contractEtag`
- project-scoped `saveToken`
- 文档根 `skill_node_contract_version`

服务端会校验 token 的 `projectId`、版本与 ETag，校验文档根版本，并在写入前后重新核对当前合同，拒绝 stale ETag、版本漂移、跨项目 token 或保存期间合同变化。该门禁是并发与合同一致性边界，不是可选前端提示。

### 5. 派生字段与旧视图迁移是同一交付链

`src/view/derived-field-projection.mjs` 从正式 Targeting 结构投影 `@selection_type`、`@selection_distance`、`@selection_relations`、`@area_shape`、`@affects_relations` 等只读派生字段，`src/view/view-engine.mjs` 在视图计算前接入该投影。

`src/view/targeting-view-field-migration.mjs` 与 `src/view/targeting-view-file-migration.mjs` 负责把旧 Targeting 视图字段引用迁移到新的 `@...` 派生字段，并覆盖项目文件、profile 与 localStorage 相关存储。后续调整正式结构时，不能只改 schema 而漏掉派生字段和视图迁移。

## 完成验证基线

本次合入完成时的验证基线为：

- `npm run typecheck` 通过
- `npm run build` 通过
- 合同相关单元测试共 71 项通过
- 新增 Targeting Playwright 用例 `skills targeting nodes use the shared selection area affects contract` 通过
- `service:finalize` 完成后，正式服务与 recovery bridge 均健康
- `http://127.0.0.1:8787/api/health` 返回 `{"ok":true,"bridgePort":8791}`
- `http://127.0.0.1:8791/health` 返回 `{"ok":true}`

后续回归至少应同时覆盖合同 service/client、registry/form model、save gate、派生字段、视图迁移和 Targeting Playwright；只验证 UI 展示不足以证明保存门禁与迁移链完整。

## 完成态补充检索词

`data/contracts/skill_nodes.json`、`data/contracts/skill_nodes.schema.json`、`selection`、`area`、`affects`、`skill_node_contract_version`、`contractVersion`、`contractEtag`、`saveToken`、`ETag`、`version_mismatch`、`@selection_type`、`@area_shape`、`71 tests`
