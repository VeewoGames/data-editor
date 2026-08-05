# Data Editor 通用文档合同通道迁移方案

> **后续执行口径（2026-08-05）**：本方案的阶段 0～2 通用引擎工作继续有效；阶段 3～6 中“为 Nocturnel
> 保留 opaque `skill-node-contract` binding、补充技能 `nested-schema-v1/document-contract-v1` 声明、继续由
> Data Editor 编辑技能节点”的路线已被废止。后续唯一执行口径见
> `docs/plans/2026-08-05-Data Editor夜曲解耦后续执行方案.md`，跨仓上游口径见 Nocturnel
> `docs/plans/2026-08-05-Godot技能编辑器完整承接与Data Editor夜曲解耦方案.md`。Data Editor 不再提供或加载
> Nocturnel 技能节点专属编辑声明；Godot 是唯一技能节点编辑与手动规则检查入口。

## 方案概述

### 1. 总体目标和范围

本方案用于清除 Data Editor 生产核心中仍然存在的 Nocturnel 技能领域知识，将当前
`skill-node-contract`、`skills.nodes` 和技能专属节点表单链迁移为统一的项目声明式合同能力。

迁移完成后：

- Data Editor 核心只认识 `document-contract-v1`、`nested-schema-v1` 及其通用编辑、校验和保存语义；
- 项目通过 `.data-editor/project.json` 声明合同、匹配范围和 schema 资源；
- Nocturnel 自己持有技能节点类型、默认值、展示、校验、派生规则和中文提示；
- 无 manifest、无合同或使用其他业务模型的项目仍能独立启动并进行普通 JSON/CSV 编辑；
- 不保留 `/api/skill-node-contract` 与通用 API 并存的长期兼容层。

本方案覆盖 Data Editor 核心、合成 fixture、Nocturnel 项目声明及跨仓验证。FieldSpec 数据迁移不在本方案范围内，
必须等待本方案完成并由上游重新取证后才能解除阻塞。

### 2. 各阶段任务概要

| 阶段 | 主要工作 | 预期成果 | 执行顺序 |
| --- | --- | --- | --- |
| 0 | 冻结基线、专属调用链和路径 owner | 可审计的迁移清单与共享路径门 | 最先执行 |
| 1 | 冻结非技能 fixture 规格与验收矩阵 | 通用能力有独立、非技能的目标行为真值 | 依赖阶段 0 |
| 2 | 建立通用 grammar/compiler 与 path-driven admission | 候选文档不能缩小合同保护范围 | 依赖阶段 1 |
| 3 | 原子切换服务端、前端与 Nocturnel 声明 | 新通道完整接管且不发布断链中间态 | 依赖阶段 2 |
| 4 | 在 scratch project 验证 Nocturnel | `skills.json` 保持完整编辑和安全保存 | 依赖阶段 3 |
| 5 | 删除旧入口、重命名测试和文档 | 生产核心零技能领域硬编码 | 依赖阶段 4 |
| 6 | 跨仓验证、提交与 FieldSpec handoff | 可复核提交、验证回执和解阻依据 | 最后执行 |

### 3. 整体结构框架

```text
消费项目 .data-editor/project.json
  ├─ documentContracts[]
  │    ├─ admission：dataSourceId + path
  │    ├─ validation target：collection
  │    ├─ contract + contractSchema
  │    └─ document-contract-v1：校验、派生规则、保存门禁
  └─ nestedSchemas[]
       ├─ 通用字段匹配：rootField + nestedPath
       └─ nested-schema-v1：对象/判别联合节点表单

Data Editor capability registry
  ├─ 唯一 manifest loader / registry / generation
  ├─ path-driven contract admission + 通用合同 compiler
  ├─ 通用编辑器状态与 schema resolver
  └─ documentContracts token + ETag + journaled save

Nocturnel
  ├─ 持有 skill_nodes.json 与 meta-schema
  ├─ 持有技能节点 schema、枚举、默认值和业务提示
  └─ 通过 manifest 接入通用引擎
```

## 一、现状与问题证据

### 1. 已完成的通用基础

当前实现已经具备以下可复用基础：

- `src/project-capability-manifest.mjs` 统一解析 `nested-schema-v1`、`document-contract-v1` 和
  `identity-policy-v1`；
- `src/project-capability-registry.mjs` 按项目隔离 binding、digest 与 generation；
- `src/document-contract-service.mjs` 已能按 binding 加载合同和 meta-schema，并计算合同摘要；
- `GET /api/document-contracts` 与普通保存链已使用 `contractId + manifestDigest + contractDigest + version`；
- `src/api/save-documents.mjs` 已在普通文档保存前请求通用合同 token；
- `src/detail/nested-schema-capability.mjs` 已能按项目声明匹配通用嵌套 schema。

这意味着迁移无需创建第二套 manifest loader、registry 或保存事务，只需把残留技能通道收敛到现有基础。

### 2. 仍然存在的专属通道

生产核心中仍有以下领域耦合：

1. `server.mjs` 导入 `skill-node-contract-*`，暴露 `GET /api/skill-node-contract`，固定查找
   `binding.id === "skill-node-contract"`，并维护技能专属错误码和保存校验。
2. `src/api/client.ts` 与 `src/api/skill-node-contract-client.mjs` 维护独立客户端、缓存和返回类型。
3. `src/App.tsx` 维护 `SkillNodeContractEditorState`、`SkillNodeContractMatch`、专属加载 effect、版本检查、
   表单模型和保存分支。
4. `src/detail/node-schema-registry.mjs` 的 `matchesContractSkillSource()` 固定匹配
   `collectionPath === "skills" && rootField === "nodes"`。
5. `DetailPanel.tsx` 与 `NodeEditorHost.tsx` 为上述固定范围绕过普通 `nestedSchemas` resolver。
6. `skill-node-contract-*`、`skill-node-derived-rules-*` 和对应测试继续使用技能命名、字段与提示语。
7. `tests/fixtures/projects/contract-project` 虽然在仓内独立，但仍使用 `skills.json` 和 `skill_nodes.json`，
   无法证明合同引擎与技能领域无关。

当前状态属于“通用保存基础已存在，但技能专属 UI/读取链仍并行存在”，尚未达到核心零 Nocturnel 领域知识。

## 二、目标边界与架构决定

### 1. 唯一能力入口

项目能力只通过现有 `.data-editor/project.json`、capability registry 和 generation 状态进入核心。

- 不新增 adapter；
- 不新增第二个 manifest loader 或业务 registry；
- 不允许通过文件名、collection 名或字段名猜测项目能力；
- 不允许客户端提交一个未由服务端 binding 匹配到的合同 id 来扩大能力范围；
- manifest 缺失、无匹配 binding、合同损坏或 generation 失效时，按现有通用状态机失败关闭。

### 2. `document-contract-v1` 的职责

`document-contract-v1` 负责文档级权威：

- 合同及 meta-schema 的加载、严格校验和 digest；
- 由服务端按项目、data source 和规范化文件路径枚举全部适用 binding；
- 对 binding 声明的 collection 执行候选值业务校验；collection 缺失也必须进入校验，不能让候选文档缩小保护范围；
- 通用一致性规则、派生摘要和保存阻断 facets 的声明与执行；
- 保存 token、manifest/contract digest 重验和并发失效；
- 与文档 ETag、commit mutex、journal 和原子写入共同组成安全保存链。

Data Editor 只校验通用 grammar 和操作符，不内置技能节点类型、技能字段、夜曲业务错误码或中文提示。

### 3. `nested-schema-v1` 的职责

`nested-schema-v1` 是字段级 UI 投影的唯一声明源，负责：

- 通过 `dataSourceId + path + collection + rootField + nestedPath` 匹配编辑位置；
- 描述对象节点或 discriminated-node 的字段、类型、默认值、枚举、显示/只读/必填条件和递归路径；
- 为 `DetailPanel` 与 `NodeEditorHost` 提供统一 resolver；
- 无匹配 schema 时返回普通嵌套 JSON 编辑能力或显式 unsupported 状态，不进入技能特殊模式。

节点表单只使用 `nested-schema-v1`；`document-contract-v1` 不再声明第二份 UI 字段、枚举或条件规则。
文档级一致性校验可以读取 candidate document 和已编译的 nested schema，但只能输出 issue、派生摘要或保存阻断，
不能反向覆盖 UI schema。两者共享同一个 capability registry 与 generation，依赖方向固定为
`nested schema definition -> document validator input`，不得双向推断或维护两份同义配置。

### 4. Nocturnel 的所有权

以下内容继续由 Nocturnel 持有：

- `skills.json`、`skill_nodes.json` 与 `skill_nodes.schema.json`；
- `nodes`、`selection`、`area`、`affects` 等技能字段的业务含义；
- damage、movement、charge、targeting 等节点类型；
- 枚举、默认值、只读/可见条件、派生规则、阻断规则和业务提示语；
- manifest 中对 `skills.json`、collection 和嵌套字段的匹配声明；
- Nocturnel capability 编译及真实数据集成验证。

Data Editor 不复制这些真值到默认 fixture，也不通过绝对路径读取 Nocturnel。

### 5. 不保留双入口

项目处于早期阶段，本次迁移采用一次性切换：

- 删除 `/api/skill-node-contract`；
- 删除 `SkillNodeContract*` API、状态和表单入口；
- 删除 `matchesContractSkillSource()`；
- 删除旧 `contractVersion / contractEtag / saveToken` 技能专属请求字段，统一使用 `documentContracts[]`；
- 迁移或删除所有 `skill-node-contract-*` 文件、符号和测试名；
- 不提供旧 API alias、旧字段兼容解析或双写逻辑。

## 三、通用合同数据形态

### 1. Manifest 匹配

文档合同继续使用现有 binding：

```json
{
  "id": "combat-actions-contract",
  "engine": "document-contract-v1",
  "match": {
    "dataSourceId": "data",
    "path": "content/actions.json",
    "collection": "actions"
  },
  "contract": "data/contracts/actions.json",
  "contractSchema": "data/contracts/actions.schema.json"
}
```

`id` 仅是项目内稳定标识，核心不得根据 id 内容选择执行路径。

### 2. 嵌套节点匹配

节点表单由独立 `nestedSchemas` binding 声明：

```json
{
  "id": "action-steps",
  "engine": "nested-schema-v1",
  "match": {
    "dataSourceId": "data",
    "path": "content/actions.json",
    "collection": "actions",
    "rootField": "steps",
    "nestedPath": []
  },
  "manifest": ".data-editor/contracts/nested-schemas.json"
}
```

递归数组继续通过显式 nested path 或 schema 内的递归声明解析，不在核心硬编码 `nodes` 字段。

### 3. 通用派生规则

若现有技能表单依赖 derived rule，则将“影响文档合法性或生成只读摘要”的部分定义为
`document-contract-v1` facet。字段显示、只读、必填和枚举收窄仍由 `nested-schema-v1` 唯一负责。

首版通用合同 grammar 必须由 Data Editor 自有 JSON Schema 固定，并至少声明：

- `contract_version` 与 engine grammar 版本；
- `collections[]`：目标 collection、允许缺失与否、候选值 schema/ref；
- `invariants[]`：规则 id、输入 selector、受限操作符、错误 code/message 和 severity；
- `derivedOutputs[]`：只读摘要 id、输入 selector 和纯函数表达式；
- `savePolicy`：哪些 issue 阻断保存。

compiler 在 capability 编译阶段把上述 grammar 编译为不可变执行计划，并产生 `compiledContractDigest`；客户端和服务端
共享 grammar 类型与 fixture，但服务端是保存裁决权威。候选校验固定发生在 commit mutex 内 canonical re-read 之后、
journal intent 和 atomic replace 之前。replace 前的 generation/manifest/compiled contract 重验负责拒绝写入；replace 后
再次读取 capability 与合同只用于确认结果能否发布，不能声称撤销已经发生的物理写入。若 replace 后发现漂移，journal
必须进入 durable `recovery_pending`，不得返回成功、不得自动重放第二次 replace，也不得在没有证据时回滚。启动恢复
重新读取 canonical file 和当前合同：candidate 仍合法时幂等完成 receipt；不合法或无法证明时保持 fail-closed 并要求
明确恢复处置。identity promotion 使用同一 compiler、admission 和 recovery 语义，不得另建简化路径。

首版只允许有限、可验证的声明式操作符，例如：

- 从当前对象或父级上下文读取字段；
- 类型/存在性/枚举/数值范围与数组基数判断；
- 同一 candidate document 内的字段比较、集合量化和唯一性判断；
- 生成只读摘要或校验 issue；
- 使用合同声明的 message/code 返回错误。

禁止项目合同注入 JavaScript、正则回溯型任意表达式、任意命令、网络或文件系统访问。selector 只能读取当前候选
document、命中 collection、当前条目及其父级上下文。只有被 Nocturnel 真实行为和非技能 fixture 同时证明需要的
通用操作符才进入 engine grammar；无法表达的技能 UI 行为进入 `nested-schema-v1`，无法表达的技能一致性规则继续由
Nocturnel 自有离线 validator 持有，不能伪装成核心特判。

### 4. 服务端合同 admission

合同是否适用必须只由服务端 authority 决定：

1. 将虚拟文件路径规范化为 `dataSourceId + innerPath`；
2. 从 active capability state 中枚举所有匹配该二元组的 `document-contract-v1` binding，不先读取候选 collection；
3. 在 commit mutex 内解析 canonical preimage 与 candidate，分别记录 binding 所指 collection 的存在性和值；
4. 对每个 path-matched binding 加载并编译合同；collection 缺失也执行合同的 `allowMissing`/required 规则；
5. 请求中的 `documentContracts[]` 必须与服务端枚举结果完全一致，客户端 id 只能用于证明，不能扩大或缩小集合；
6. manifest、binding、compiled contract 或 generation 在保存期间变化时拒绝写入；
7. identity promotion、普通保存、批量保存和主键同步共用此 admission。

不得继续使用 `buildDocumentModel(body.root).collections` 作为“是否需要合同”的前置条件。必须新增回归测试：删除受保护
collection、把 collection 改成标量、同文件多个受保护 collection、canonical 有但 candidate 无、canonical 无但 candidate
新增，均不能绕过服务端合同门。

## 四、分阶段实施方案

### 阶段 0：冻结基线与 owner

主要工作：

1. 记录 Data Editor 与 Nocturnel commit、dirty paths、submodule/gitlink、tracked diff hash。
2. 将 `.claw/project.json` 和其他无关脏改动登记为非本工作包 owner，不纳入提交。
3. 冻结技能合同旧行为矩阵：加载、缓存、304、错误码、只读、表单字段、derived rule、保存成功和失败结果。
4. 冻结完整领域符号与语义清单，至少覆盖 `skill-node-contract`、`skills.nodes`、`targeting`、`movement`、
   `charge`、`selection`、`area`、`affects`、节点类型、技能中文提示及 derived rule 分支。
5. 产出精确文件 disposition：`generalize`、`move-to-nocturnel`、`rename-test`、`delete-after-cutover`；每个领域命中
   必须记录目标 owner、目标声明或通用操作符，不允许只做字符串改名。
6. 首次触碰 Nocturnel 共享路径前重取 hash；若存在其他 owner，必须串行 handoff。

完成条件：所有拟修改路径都有 owner、baseline 和允许修改集，不混入无关工作树改动。

### 阶段 1：冻结非技能 fixture 规格与验收矩阵

设计纯合成、非技能项目，例如 `workflows.json`，并冻结将在阶段 2 实现的 fixture 与验收矩阵：

- collection 使用 `workflows`；
- 判别联合字段使用 `steps`；
- 示例节点使用 `message / delay / branch`；
- nested schema 包含至少一条显示/只读规则；document contract 包含至少一条 invariant 和一条 derived summary；
- fixture 最终自带 `.data-editor/project.json`、合同、meta-schema、nested schema 和数据；
- 默认测试不读取 Nocturnel，也不要求相邻仓库存在。

本阶段只冻结数据形状、规则需求、预期 issue/token 和测试用例，不提前提交必然失败的测试，也不要求旧技能引擎解释
新 grammar。fixture 文件、测试和 compiler 在阶段 2 的同一可验证工作包中落地。

完成条件：同一个非技能场景的合同加载、UI resolver、derived summary、非法 candidate 拒绝、合法 candidate journaled
save、stale token 拒绝以及删除受保护 collection 的 admission 用例均有明确输入、预期输出和 fixture 路径。

### 阶段 2：建立通用 grammar/compiler 与 path-driven admission

主要改动：

1. 在 Data Editor 中增加 engine-owned grammar JSON Schema、compiler、不可变 compiled plan 和通用 issue/error 协议。
2. 扩展 `document-contract-service`，区分“合同通过 meta-schema 校验”与“candidate 通过 compiled contract 校验”。
3. 将合同 admission 改为按 `projectId + dataSourceId + normalized path` 枚举服务端 binding；collection 只作为校验目标，
   不作为是否启用合同的候选前置条件。
4. 在 commit mutex 内 canonical re-read 后执行 candidate 校验，并在 journal intent/replace 前完成 generation、manifest、
   binding、compiled contract digest 与 token 重验。
5. replace 后重新读取 capability/合同并验证 canonical 结果；漂移时写入 `recovery_pending` 且不发布成功结果，启动恢复
   只能按“当前 canonical candidate 仍合法则完成，否则继续阻断”的证据规则收口。
6. identity promotion、普通保存、批量保存和主键同步切到同一 admission/compiler/recovery。
7. 扩展通用 document contract API，返回服务端 path-matched binding、generation、manifest digest、contract digest、
   compiled contract digest、version 和客户端渲染确实需要的安全只读 projection；不默认返回与 UI 无关的完整业务合同。
8. 落地阶段 1 的非技能 fixture 和测试，用它锁定 grammar/compiler、API、admission、post-replace recovery 和保存链，
   再进入真实项目 cutover。

本阶段允许旧技能入口仍存在于未发布工作树中，但新旧入口不得共同成为发布状态，也不得产生第二套 registry、mutex
或 journal。完成条件：通用链独立通过非技能 fixture 全套验收，尚未删除旧入口且不得单独提交或发布。

### 阶段 3：服务端、前端与 Nocturnel 原子 cutover

> **已废止，禁止执行。** 本节及其阶段 4～6保留为历史方案背景，不再作为实施指令。实际后续顺序、完成门和
> Nocturnel 交接以 `2026-08-05-Data Editor夜曲解耦后续执行方案.md` 为准；尤其不得为 Nocturnel skills 新增
> `nested-schema-v1/document-contract-v1` 声明，也不得保留 opaque `skill-node-contract` binding。

主要改动：

1. 将技能专属 client/cache 替换为通用 document contract client/cache，缓存 key 至少包含
   `projectId + bindingId + generation/contractDigest`。
2. 将 `SkillNodeContractEditorState` 改为通用合同状态；状态只描述 loading、ready、invalid、degraded、absent。
3. `App.tsx` 根据 capability binding 与当前文档上下文选择合同，不检查固定 id、collection 或字段名。
4. `DetailPanel.tsx` 和 `NodeEditorHost.tsx` 始终通过统一 resolver 获取 schema；删除专属绕过分支。
5. 通用表单模型只解释字段类型、枚举、默认值、条件和 issue，不输出技能文案。
6. 保存请求统一走 `saveDocumentsWith()` 的 `documentContracts[]` token。
7. 项目切换、manifest generation 变化、合同 digest 变化时清空相应缓存并重建编辑状态。
8. 删除 `/api/skill-node-contract`、固定 binding id、技能错误协议和旧保存字段；这一删除与前端切换放在同一工作包。
9. 更新 Nocturnel manifest，为技能节点补齐 `nested-schema-v1` 声明。项目自有 binding id 可以保留领域名称；
   `skill-node-contract` 在 Nocturnel manifest 中只是 opaque project-owned id，核心不得根据其内容分支。
10. 默认保留现有 binding id，避免无收益的身份替换。若 Nocturnel owner 另行决定改名，必须作为独立受控 transition，
    携带 `transition.id + previousManifestDigest + removedBindingIds`，并在无 active lease、未终结 journal 或
    recovery pending 时执行；未经单独决策不在本方案中改名。
11. 迁移技能展示、默认值、枚举、派生规则和提示文案；UI 规则只进入 Nocturnel nested schema，文档一致性规则只进入
    Nocturnel document contract。

本阶段是不可拆分发布的原子 cutover：任一时刻准备提交的树必须只有一个完整入口。若中途验证失败，应继续留在本地
未发布状态或回到切换前备份，不得提交“服务端已删旧 API、前端尚未切换”的中间态。

完成条件：同一前端链既能编辑非技能 fixture，也能编辑 Nocturnel 技能节点；Nocturnel capability 为 active；核心组件
无技能分支；旧 API 已无消费者且未保留兼容层。

### 阶段 4：Nocturnel scratch project 验收

主要工作：

1. 创建临时 scratch project，使用独立 `projectId` 与独立临时 `registryHome`，复制本次验收所需的 Nocturnel
   `.data-editor` 声明、合同和 `skills.json`；不复制正式 LKG、runtime、journal、日志或无关内容数据。
2. 记录正式 `skills.json`、合同和 manifest 的前置 SHA-256；所有成功写入测试只对 scratch copy 执行。
3. 在 scratch 中验证加载、递归节点编辑、derived summary、非法 candidate 阻断、合法 candidate journaled save、
   stale token、删除受保护 collection、manifest generation 变化和合同变化。
4. 正式 Nocturnel 只执行只读 capability 编译、合同加载和数据校验；结束后重取 SHA-256，必须与前置值一致。
5. 删除 scratch project、临时 registryHome、LKG 和运行时目录并记录清理结果；不得把 scratch、备份或运行时文件纳入提交。

完成条件：scratch 中完整保存链通过；正式 Nocturnel 文件 hash 不变；所有能力均由项目声明命中。

### 阶段 5：旧入口清理

候选删除或重命名范围：

- `src/skill-node-contract-service.mjs`
- `src/skill-node-contract-semantics.mjs`
- `src/skill-node-contract-version.*`
- `src/api/skill-node-contract-client.*`
- `src/detail/skill-node-contract-state.*`
- `src/detail/skill-node-contract-form-model.*`
- `src/detail/skill-node-derived-rules.*`
- 对应 `tests/skill-node-*` 文件和专属文档章节

处理原则：

- 可泛化实现迁入通用命名模块；
- 业务规则迁往 Nocturnel；
- 切换完成后无消费者的旧文件物理删除；
- 不保留转发模块、deprecated alias 或旧 API 测试；
- 使用阶段 0 冻结的领域 disposition 做生产路径扫描，确认 `skill-node-contract`、`matchesContractSkillSource`、
  固定 `skills.nodes`、`targeting/movement/charge/selection/area/affects` 业务分支、技能节点类型和技能中文提示均已逐项
  迁出、泛化或删除；不能只按三个关键词计数，也不能用改名规避。
- fixture 与历史迁移记录不作为运行时消费者，但必须通过 allowlist 说明保留原因。

完成条件：Data Editor 生产核心不再包含 Nocturnel 技能领域词驱动的路径、分支、错误协议或状态模型。

### 阶段 6：验证、提交与 handoff

验证顺序：

1. 通用 document contract loader/client/state/resolver 定向测试；
2. 非技能 fixture API、UI resolver、derived summary、candidate validator 和 journaled save 测试；
3. 删除/改型受保护 collection、同文件多合同、文档 ETag、合同 token stale、manifest generation stale、
   compiled contract stale、保存期间合同变化测试；
4. Data Editor `npm run typecheck`；
5. Data Editor `npm run build`；
6. Data Editor 适当范围的默认测试与最小 E2E smoke；
7. Nocturnel capability active generation、opaque binding id、scratch `skills.json` 集成验证与正式文件 hash 不变证明；
   只有另行批准 binding 改名时才追加 controlled transition 验证；
8. 生产路径领域词 allowlist 扫描；
9. `git diff --check`、实际路径集与最终 diff/hash 审计。

提交应按仓库边界拆分：先提交并推送 Data Editor 通用引擎，再由 Nocturnel 提交 manifest/schema 与 gitlink 更新。
未经用户单独授权不提交、不推送。

完成后向任务 `019fbb83-df8e-7b90-8126-b992d4d217c5` 发送 handoff，至少包含：

- Data Editor 与 Nocturnel commit；
- 实际修改路径；
- 删除的旧入口；
- 验证命令和结果；
- 生产领域词扫描结果；
- 未解决风险；
- 明确要求上游重新取证，不直接宣称 FieldSpec 已解除阻塞。

## 五、文件处置规划

| 当前范围 | 处置 | 目标所有者 |
| --- | --- | --- |
| `src/document-contract-service.mjs` | 保留并扩展通用读取能力 | Data Editor |
| `src/api/save-documents.mjs` | 保留统一 `documentContracts[]` 保存门 | Data Editor |
| `src/detail/nested-schema-capability.mjs` | 保留为唯一 nested resolver | Data Editor |
| `skill-node-contract-*` | 泛化后删除旧文件/符号 | Data Editor |
| `skill-node-derived-rules-*` | 通用操作符留核心，技能规则迁出 | Data Editor / Nocturnel |
| `App.tsx` 专属状态与分支 | 改为按 binding 驱动 | Data Editor |
| `DetailPanel.tsx` / `NodeEditorHost.tsx` 绕过逻辑 | 删除，统一 resolver | Data Editor |
| `/api/skill-node-contract` | 删除 | Data Editor |
| `tests/fixtures/projects/contract-project` | 改为非技能 fixture | Data Editor |
| Nocturnel `skill_nodes*.json` | 保留业务真值并补足声明 | Nocturnel |
| Nocturnel `.data-editor/project.json` | 保留 opaque 项目 binding id，补充 nested schema 与合同声明 | Nocturnel |

## 六、验收矩阵

| 场景 | 预期结果 |
| --- | --- |
| 无 `.data-editor/project.json` 的普通项目 | 正常编辑 JSON/CSV，不请求业务合同 |
| 有 manifest 但当前文件无匹配合同 | 普通保存，不携带合同 token |
| 非技能 fixture 命中合同 | 通用节点表单、校验和安全保存全部生效 |
| Nocturnel `skills.json` 命中合同 | 技能节点正确编辑、校验和保存 |
| candidate 删除或改型受保护 collection | 仍命中 path binding，并由合同明确允许或拒绝，不能降级为零合同保存 |
| 同一文件存在多个 document contract binding | 服务端枚举全部 path-matched binding，token 集合必须完全一致 |
| 相同文件名但不同项目/路径 | 不因名称猜测能力，不发生跨项目缓存污染 |
| 合同损坏或 meta-schema 不合法 | 合同范围内失败关闭，错误为通用协议 |
| manifest/合同在保存前变化 | token 或 digest stale，保存被拒绝 |
| replace 前合同变化 | generation/digest 重验失败，拒绝写入 |
| replace 后合同漂移 | journal 进入 `recovery_pending`、不发布成功；启动恢复按当前 canonical candidate 合法性幂等完成或继续阻断 |
| Nocturnel 保留领域 binding id | 核心将 id 视为 opaque，不以名称触发任何分支 |
| 经另行批准的 binding id 替换 | controlled transition 成功、generation 单调提升、状态保持 active |
| Nocturnel 成功保存验收 | 只写 scratch；正式 `skills.json` 前后 SHA-256 相同 |
| 项目切换 | 清除旧合同状态，按新 projectId/generation 重载 |
| 生产核心领域 disposition 扫描 | 所有技能语义命中都有迁出/泛化/删除回执，不存在改名残留 |

最低验收对应关系：

1. 生产核心零技能硬编码：阶段 2、3、5 与领域词扫描。
2. Nocturnel 技能合同功能保持：阶段 3 原子 cutover 与阶段 4 scratch/hash 验证。
3. 非技能通用证明：阶段 1 fixture 及其 API/UI/validator/journaled save 测试。
4. 构建与跨仓验证：阶段 6。
5. FieldSpec handoff：阶段 6 的上游重新取证回执。

## 七、风险与控制

### 1. 表单行为丢失

风险：技能专属 form model 中可能包含尚未进入通用 schema 的隐藏行为。

控制：阶段 0 先冻结行为矩阵；每条行为必须明确归入通用 grammar 或 Nocturnel 声明，不能以删除专属文件代替迁移。

### 2. 保存安全门回退

风险：删除旧 `contractVersion/contractEtag/saveToken` 时误删必要并发保护。

控制：只删除重复的技能 token；保留并强化 `documentContracts[]`、manifest digest、contract digest、ETag、mutex、
journal 和保存期间重验。合同 admission 必须由服务端 path binding 枚举，禁止候选文档通过删除 collection 缩小范围。
replace 后发现合同漂移时不得宣称“阻断已发生写入”，而是进入 durable `recovery_pending` 并停止成功结果发布；恢复过程
不做无证据回滚或第二次 replace。

### 3. 通用 grammar 被 Nocturnel 反向污染

风险：为了快速迁移，把 targeting、charge 等业务操作符改名后继续放在核心。

控制：通用操作符必须能由非技能 fixture 证明；无法证明的业务规则留在 Nocturnel schema/meta-schema。

### 4. 跨仓脏路径覆盖

风险：Nocturnel 的 manifest、合同或 gitlink 可能由其他任务持有。

控制：首次写入前重取两个仓库的 status、diff/hash 和 owner；不匹配时暂停并请求 serial handoff。

### 5. FieldSpec 过早解阻

风险：代码提交完成但上游仍基于旧证据继续迁移。

控制：本任务只发送“可复核 handoff”；FieldSpec owner 必须重新检查核心扫描、capability 编译和真实技能行为后，
自行解除阻塞。

## 八、完成定义

只有同时满足以下条件，才可声明本方案完成：

- Data Editor 生产核心没有技能专属 API、binding id、路径匹配、状态类型、错误协议或提示语；
- 通用合同和 nested schema 使用唯一 capability registry；
- `nested-schema-v1` 是 UI 投影唯一声明源，`document-contract-v1` 是 candidate 校验与保存裁决唯一声明源；
- 非技能 fixture 证明同一路径可加载、投影、派生、拒绝非法候选并完成 journaled save；
- path-driven admission 已覆盖 collection 删除/改型、同文件多合同和 identity promotion，候选值不能缩小保护范围；
- replace 前漂移会拒绝写入；replace 后漂移有 durable `recovery_pending`、幂等恢复和不发布成功结果的验证；
- Nocturnel `skills.json` 的加载、节点编辑、校验和 scratch 安全保存通过，正式文件前后 hash 不变；
- Nocturnel 默认保留项目自有 binding id；若另行批准改名，则使用 controlled transition 并保持 capability active；
- 定向测试、类型检查、构建和跨仓 capability 验证通过；
- 旧文件与双入口已清理，没有 deprecated 兼容层；
- 提交范围、验证回执、剩余风险和上游 handoff 完整；
- FieldSpec 任务已收到通知并进入重新取证，而不是由本任务直接解除阻塞。
