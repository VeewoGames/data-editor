# skills Targeting 项目级合同与保存门禁

status: accepted

## context

已完成计划 `.claw/archive/tasks/将最新技能-Targeting-合同编辑能力合入当前-data-editor/plan.json` 将技能 Targeting 合同编辑能力接入当前 data-editor。需要固定的长期边界不是本次提交移植过程，而是 `skills.nodes` 的合同所有权、正式数据结构、失配行为、并发保存协议和跨接入形态验证范围。

`skills.nodes` 属于项目业务模型，不是 data-editor 自身可以独立定义的通用 schema。若编辑器保留静态 skills schema 或在项目合同不可用时继续写入，会形成双真值，并可能把过期结构保存回项目数据。

## decision

### 1. `skills.nodes` 只消费项目级 `skill_nodes` 合同

编辑器从当前项目的 `data/contracts/skill_nodes.json` 加载版本化合同。该合同是 `skills.nodes` 的唯一结构与约束真值；data-editor 只负责加载、解释、展示、校验和保存，不维护第二套 skills 节点定义。

### 2. Targeting 的正式结构固定为 `selection`、`area`、`affects`

Targeting 节点顶层只按合同暴露 `selection`、`area`、`affects`。`selection` 与 `area` 根据各自 discriminator 展开合同声明字段，`affects` 使用合同声明的 `relations` 与 `entity_types` 等约束。

旧平铺字段 `range_type`、`range_value`、`target_type`、`area_shape`、`area_size`、`target_count`、`target_alignment` 不再属于正式编辑结构，也不得作为静态 fallback 重新进入保存链路。

### 3. 合同缺失或版本不匹配时只读并阻止保存

当项目合同缺失、无法加载、响应缺少必要元数据，或 `contract_version` 与编辑器支持版本不匹配时，`skills.nodes` 必须进入明确只读状态并阻止保存。不得回退到旧静态 skills schema，也不得以通用可编辑 JSON 绕过合同门禁。

### 4. 保存执行项目级 `version + ETag + token` 双重校验

技能文档保存必须携带当前项目合同的 `contractVersion`、`contractEtag` 和项目级 `saveToken`。`saveToken` 至少绑定 `projectId`、合同版本和 ETag。

服务端同时校验请求版本与文档根 `skill_node_contract_version`、当前合同版本与 ETag，以及 token 的项目、版本和 ETag；通过保存门禁后还要在实际写入前再次确认合同 ETag 未变化。任何项目错配、版本错配、陈旧 ETag 或校验期间合同变化都必须拒绝保存。

### 5. 独立仓库与 Nocturnel submodule 是同一能力的正式测试路径

合同能力必须同时支持两种接入形态：直接在独立 `C:/Code/data-editor` 仓库运行，以及由 Nocturnel 的 `tools/data-editor` submodule 使用。测试 fixture、合同单测和 targeted Playwright 应覆盖项目级合同读取与 `skills.nodes` 编辑链，不得把某一种物理检出路径写成产品语义。

## alternatives considered

- 保留旧静态 skills schema 作为合同故障 fallback：会形成双真值并允许旧结构重新写入，因此拒绝。
- 只用前端加载时版本判断保护保存：无法防止跨项目 token、并发合同更新或请求篡改，因此拒绝。
- 只支持独立 data-editor 或只支持 Nocturnel submodule：会把部署形态误当成合同所有权，降低同一能力在两条正式使用路径上的可信度，因此拒绝。

## consequences

- 项目合同演进必须先更新项目级 `skill_nodes` 合同，再由编辑器按受支持版本消费；data-editor 不得先行发明 Targeting 字段。
- 合同不可用时可读性优先于错误写入，用户必须先恢复匹配合同才能继续保存。
- 保存协议比普通文档保存更严格，客户端和服务端必须共同保留版本、ETag、项目 token 与写入前复核。
- Targeting 的视图派生、表单模型和端到端断言都应围绕 `selection/area/affects`，不得恢复旧平铺字段断言。
- 仓库位置和 submodule 位置可以不同，但合同语义、保存门禁与测试结论必须一致。

## related code

- `server.mjs`
- `src/skill-node-contract-service.mjs`
- `src/skill-node-contract-version.mjs`
- `src/api/skill-node-contract-client.mjs`
- `src/api/save-documents.mjs`
- `src/detail/skill-node-contract-form-model.mjs`
- `src/detail/skill-node-contract-state.mjs`
- `src/detail/NodeEditorHost.tsx`
- `src/view/derived-field-projection.mjs`
- `tests/skill-node-contract-*.test.mjs`
- `tests/api-client.test.mjs`
- `tests/data-editor.spec.ts`

## search terms

`skill_nodes`、`skill_node_contract_version`、`selection`、`area`、`affects`、`contractVersion`、`contractEtag`、`saveToken`、`ETag`、`read-only`、`Nocturnel submodule`
