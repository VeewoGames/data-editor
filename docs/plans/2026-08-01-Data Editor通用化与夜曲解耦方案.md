# Data Editor 通用化与夜曲解耦方案

> **已被取代（2026-08-05）**：本文件仅保留为通用化历史设计与阶段 0 identity disposition 的证据来源，
> 不再是当前实施真值，也不得继续驱动阶段 1～8。后续唯一跨仓执行计划为
> `docs/plans/2026-08-05-Data Editor夜曲解耦后续执行方案.md`；其中 Data Editor 不承接 Nocturnel 技能节点规则，
> Godot 承接、Data Editor 预备能力、G4 验收、专属通道退场和 Nocturnel gitlink/声明切换由同一个当前任务串行执行。

## 概述

### 1. 总体目标和范围

本方案将 Data Editor 收敛为可独立安装、启动、开发、测试和发布的通用本地数据编辑器，
并将 Nocturnel 从“工具内置的默认业务项目”调整为“通过项目声明接入 Data Editor 的普通消费方”。

本方案解决以下已核实问题：

- Data Editor 的默认 `adapter`、项目创建和服务生命周期仍写死为 `nocturnel`；
- `data/content/skills.json` 仅凭路径就被强制套用 Nocturnel 的技能节点合同和保存门；
- `classes / affixes / runes / traits` 的 Nocturnel 嵌套 schema 固化在通用运行时代码中；
- 默认 `npm test` 直接读取相邻或父级 Nocturnel 仓库，独立 clone 无法自证；
- Nocturnel 通过 submodule 固定旧版 Data Editor，但工具仓库和消费项目缺少明确的版本交接门。

本轮方案覆盖目标架构、数据合同、迁移阶段、测试矩阵、Nocturnel owner handoff、发布顺序、
回退和零残留审计。方案本身不授权修改 runtime、tests、Nocturnel、submodule 指针、用户 registry，
也不授权 commit 或 push。

本段为历史口径，不再有效。本文件曾是“Data Editor 通用化与夜曲解耦”的单一技术实施方案真值。`Data Editor 按需长期条目身份`
作为本文件阶段 3 的独立工作包维护；同名独立文档仅保留为历史设计依据，不能脱离本文件的依赖、owner handoff
和授权边界单独实施。该单一真值只负责防止技术方案与阶段顺序分叉，不承担跨任务总控或实施授权职责。

阶段 0 的耦合证据、旧行为和 identity disposition 已完成冻结；后续由普通 Claw 续作计划承接阶段 1～8。
已移除的跨任务总控、受控自动编排和旧 SDD activation/approval source/trace/verification plan 均不再是本方案的
启动、恢复或验收前置。`process.wait` 只用于真实阻塞、缺少当前实施授权或外部依赖，不作为每个工作包之间的
强制仪式。

阶段 1～8 的任何 runtime、tests、registry、Nocturnel、Git 提交或推送工作仍须获得与实际工作包匹配的明确
实施授权；授权可以单独或成组授予。计划中的待办顺序、方案批准或 Claw 状态本身均不构成实施授权。

### 2. 各阶段任务概要

1. **冻结边界和旧行为证据**：确定最终归属，建立机器可读 disposition 和 Nocturnel 编辑行为矩阵。
2. **先隔离默认测试**：把工具层合同测试改为 Data Editor 自有合成 fixture，建立独立开发基线。
3. **建立项目 capability 合同**：新增声明式 manifest、明确失效状态机和按数据源隔离的匹配身份。
4. **先建立合同保存门，再执行身份专项**：复用现有合同加载、ETag 与表单投影，先完成 `document-contract-v1`
   save guard，再接入 session RowId、按需 promotion 与 Entry Action 切换；首版只保留三个声明式 engine。
5. **安全删除 adapter 与 legacy 路径**：服务完全静默后执行 registry v2 迁移，再删除旧 CLI、状态和 view fallback。
6. **完成工具仓发布门**：更新文档，执行 hermetic CI、机器零残留审计并先发布 Data Editor。
7. **执行 Nocturnel owner handoff**：工具 commit 远端可达后，才迁移真实配置、脚本和 submodule 指针。
8. **完成 clean-clone 双仓验收**：证明 Data Editor 独立可用、Nocturnel 能力无回退且交付可重建。

执行顺序必须遵守“通用合同先稳定、项目能力后迁移、旧机制最后删除、先推工具仓库再推消费仓库”。
不得长期双读旧 `adapter` 和新 capability，也不得为了兼容旧 registry 保留隐式 `nocturnel` fallback。

### 3. 整体结构框架

```text
Data Editor 通用核心
  ProjectRegistry
    -> id / name / root / dataSources / filePolicy
  ProjectCapabilityLoader
    -> 可选读取 <projectRoot>/.data-editor/project.json
    -> manifest ETag + last-known-good binding snapshot
  CapabilityRegistry（按 registry projectId 隔离）
    -> nested-schema-v1
    -> document-contract-v1
         -> schema projection facet
         -> save guard facet
         -> derived rule facet
    -> identity-policy-v1
         -> session-only 默认身份
         -> embedded-v1 / declared-key-v1 durable identity
         -> promotion authority / journal / recovery
  通用 JSON / CSV 浏览、编辑、写回、自动化与并发保护

Nocturnel 仓库
  .data-editor/project.json
    -> 声明启用的 capability 和匹配范围
  .data-editor/contracts/**
    -> 仅编辑器专用的嵌套 schema 与 capability 声明
  data/contracts/**
    -> 仍由游戏与编辑器共同消费的正式业务合同单一真值
  .data-editor/automation-profile.json
    -> 项目动作与目标
  .agents/skills/**
    -> Nocturnel 业务设计与审查语义
  tools/data-editor
    -> 仅固定已发布 Data Editor 版本的 submodule
```

## 一、当前问题与处理原则

### 1. 当前耦合不是单一依赖，而是四种边界混合

| 类型 | 当前表现 | 处理方向 |
| --- | --- | --- |
| 默认值耦合 | CLI、registry、UI、service state 默认 `nocturnel` | 删除 `adapter`；无项目声明时进入纯 generic 模式 |
| 运行时语义耦合 | 特定路径自动启用技能合同、嵌套 schema 和保存门 | 改为项目 capability 显式声明后才启用 |
| 测试数据耦合 | 默认测试读取相邻 Nocturnel 的合同文件 | 将合同最小样本复制为工具仓库 fixture；真实项目验收回到 Nocturnel |
| 发布耦合 | Nocturnel submodule 固定旧 Data Editor commit | 建立工具版本发布与消费项目升级的串行 handoff |

### 2. 核心原则

1. **通用核心不知道 Nocturnel**：生产代码不得包含 `Nocturnel` 名称、绝对路径或夜曲文件路径判断。
2. **项目能力必须显式启用**：仅文件名相同不能触发额外校验、只读、派生或保存阻断。
3. **项目声明只描述能力，不执行任意代码**：首版禁止从业务项目动态 `import` JavaScript/TypeScript。
4. **保存安全不能弱化**：迁移保存门的触发来源，不移除合同版本、ETag、schema 和并发一致性检查。
5. **默认测试必须自给自足**：`npm test` 不读取环境变量指向的业务仓库，也不依赖相邻目录结构。
6. **旧机制原子删除**：项目处于早期阶段，不保留 `adapter ?? "nocturnel"`、双 registry schema 或双保存门。
7. **双仓分 owner 交付**：Data Editor 负责解释器和 fixture；Nocturnel 负责业务合同、配置、skill 与 submodule。

## 二、目标架构

### 1. ProjectRegistry 只保存通用发现信息

registry 项目定义收敛为：

```json
{
  "id": "nocturnel-e621a436",
  "name": "Nocturnel",
  "root": "C:\\Code\\Nocturnel",
  "dataSources": [
    { "id": "data", "label": "Data", "path": "data", "kind": "relative" }
  ],
  "filePolicy": { "includeExtensions": [".json", ".csv"] }
}
```

删除 `adapter` 的理由：当前字段没有形成真实的 `adapterId -> implementation` 分派，只在 registry、
context 和服务状态之间传递，却把所有项目默认标记为 Nocturnel。继续把默认值改成 `generic` 只会保留
一个没有职责的抽象，不解决业务能力如何进入运行时的问题。

registry schema 升级时采用一次性受控迁移：先备份现有 `projects.json`，生成不含 `adapter` 的新版本，
校验项目数量、active project、root、dataSources 和 filePolicy 一致后替换。运行时只支持新版本，不保留双读。

### 2. 项目 capability 描述文件

项目可选提供 `.data-editor/project.json`。需要 capability 安全门的项目还必须提交独立的
`.data-editor/enrollment.json`，它只声明“该项目必须存在 capability manifest”，不复制业务合同。匹配键使用
Data Editor 已有虚拟文件身份，不能假设 data source 一定位于项目根内：

```json
{
  "version": 1,
  "mode": "required",
  "manifest": ".data-editor/project.json"
}
```

enrollment schema 和固定 manifest 相对路径由 Data Editor owner 管理；首版不允许 marker 指向任意项目脚本或
根外文件。

```json
{
  "version": 1,
  "requires": { "capabilityApi": 1 },
  "capabilities": {
    "nestedSchemas": [
      {
        "id": "nocturnel-content-schemas",
        "engine": "nested-schema-v1",
        "manifest": ".data-editor/contracts/content-schemas.json"
      }
    ],
    "documentContracts": [
      {
        "id": "nocturnel-skill-nodes",
        "match": {
          "dataSourceId": "data",
          "innerPath": "content/skills.json",
          "collection": "skills",
          "rootField": "nodes"
        },
        "contract": "data/contracts/skill_nodes.json",
        "contractSchema": "data/contracts/skill_nodes.schema.json",
        "engine": "document-contract-v1"
      }
    ],
    "identityPolicies": [
      {
        "id": "nocturnel-entry-identity",
        "match": {
          "dataSourceId": "data",
          "innerPath": "content/items.json",
          "collection": "items"
        },
        "engine": "identity-policy-v1",
        "provider": {
          "kind": "embedded-v1",
          "field": "__entry_id"
        }
      }
    ]
  }
}
```

约束：

- capability 资源路径必须通过 `resolveInsideRoot` 限制在项目根内；data source 仍可使用现有 absolute source；
- 文档匹配固定使用服务端解析后的 `{projectId, dataSourceId, normalizedInnerPath}`，collection/rootField
  只做更窄的表单选择；写回锁和并发身份继续复用 `canonicalFileIdentity`；
- `projectId` 必须来自 registry 的 `project.id`。所有 `registry -> createProjectContext(...)` 接线都必须显式
  传入它，禁止回退到 root-derived id；
- `version`、`requires.capabilityApi`、capability id、engine id 和 manifest schema 必须严格校验；
- 未知 engine、重复 id、越界路径或非法 schema 必须进入明确的 degraded 状态，不能静默忽略；
- 不允许配置任意模块路径、shell 命令、skill 名称或 executable；
- capability registry 按 registry `projectId` 隔离，切换项目时不得复用另一项目的合同缓存；
- 已 enrollment 项目的 registry id、root 或 dataSources 变更必须经过静默后的受控 rebind/migration，验证旧 LKG
  身份与新身份后提升 generation；不能作为普通 project update 覆盖；
- manifest 使用规范化内容 digest 作为 ETag。合同 save token 同时固定 manifest digest、contract digest 和
  canonical match identity、`canonicalFileKey`、data-source definition digest 与 capability generation；任一变化
  都使旧 token 失效；
- 缓存必须按 digest 重验或在每次合同读取/保存门前重载，不能只在服务启动时冻结后永久复用。

### 3. Capability 生命周期与 fail-closed 状态机

manifest 不存在和 manifest 损坏不是同一状态：

| 状态 | 判定 | 读行为 | 写行为 |
| --- | --- | --- | --- |
| `generic_absent` | enrollment marker、manifest 和本机 LKG 均不存在 | 正常 | 按通用保存门正常写入 |
| `active` | manifest、engine 和资源全部合法 | 正常 | 命中文档执行合同门，其他文档执行通用门 |
| `manifest_invalid` | manifest 文件存在但 JSON/schema/version/engine 非法 | 正常只读 | 项目范围写入全部阻断，先修复 manifest |
| `binding_degraded` | enrollment/LKG 证明项目受保护，但 manifest 缺失；或 binding identity、engine config、保护范围缩小声明无法可信解析 | 正常只读 | LKG 覆盖的文档 fail-closed；无法确定范围时项目范围阻断 |
| `contract_invalid` | binding identity 已可信确定，但其合同或业务 schema 缺失、损坏或语义校验失败 | 正常只读 | 仅该 binding 命中的文档 fail-closed |

状态判定顺序固定为：先校验 enrollment 与 manifest 外壳，再校验 binding identity/engine config，最后校验
binding 指向的合同/schema。每个错误码必须唯一映射到上述状态和阻断范围，禁止同一错误在
`binding_degraded` 与 `contract_invalid` 之间随实现漂移。

每次成功加载 `active` manifest 后，在持久化 registry home 下的版本化路径
`<DATA_EDITOR_HOME>/capabilities/lkg/<projectId>.json` 保存 last-known-good snapshot，不放入可被 service state
清理的 runtime 目录。snapshot 至少固定：`projectId`、规范化 root identity/root hash、data-source definition
digest、manifest digest、binding identity、capability API version、generation、最近已应用 transition id 和自身
checksum。它采用候选校验与 atomic write；损坏、generation 不一致或已 enrollment 但 snapshot 无法读取时
fail-closed，不能当作“没有 LKG”。LKG 只用于识别必须阻断的范围，不能作为旧合同继续写入。

显式移除 binding 或停用 capability 必须使用 Data Editor owner 提供的受控 cutover 操作。新 manifest 必须携带
`transitionId + previousManifestDigest + removedBindingIds`；服务端校验当前 LKG，并阻断 active commit/promotion lease、
未终结 `identity_promotion` journal 与 `recovery_pending`。每次 transition/rebind 必须单调提升 `G → G+1`，将
capability registry 与 LKG 候选都标记为 `G+1` 后原子发布；旧 save token 由 generation 失效，而不是枚举“在途 token”。
transition 允许按 `transitionId + result digest` 幂等重放；普通合法 manifest 如果在没有有效 transition 的情况下缩小 LKG 保护范围，必须进入
`binding_degraded`。完整 unenroll 还必须显式移除 enrollment marker 并生成 receipt；直接删除或损坏 manifest
不构成停用。

clean-clone 门负责防止仓库发布时漏带 manifest；last-known-good snapshot 负责防止已登记项目运行过程中因误删、
损坏或版本升级而静默降级。fresh machine 依靠仓库提交的 enrollment marker 识别“manifest 必须存在”；marker 与
manifest 同时被删除无法仅凭 runtime 推断，必须由 consumer clean-clone/机器审计阻断该版本发布。

### 4. 通用 capability 解释器与 authority

首版只维护三个通用 engine：

- `nested-schema-v1`：根据 `dataSourceId + normalizedInnerPath + collection + rootField + nestedPath` 投影嵌套表单；
- `document-contract-v1`：统一加载合同、投影节点 schema，并提供 save guard 与 derived rule facets；
- `identity-policy-v1`：声明 collection 的长期身份 provider、受保护身份字段和 promotion 规则；普通编辑仍使用 session RowId，只有 Entry Action 等 Data Editor 内置能力固有声明需要长期身份时才允许升级。

当前 `skill-node-contract-*` 中可泛化的加载、缓存、ETag、AJV 校验、保存 token 和错误协议保留在核心，
但名称应改为 `document-contract-*`。`charge`、`targeting`、`movement`、夜曲节点类型和中文提示属于合同数据，
不得继续成为通用模块中的硬编码分支。

Data Editor owner 持有 manifest schema、三个 engine 的配置 grammar、支持的操作符、语义 validator 和
capability API 版本。项目 owner 持有业务合同、业务 document schema、枚举、默认值和规则参数。项目提供的
`contractSchema` 只能校验业务合同，不能替代 Data Editor 对 engine grammar 和操作符的固定校验。

`document-contract-v1` 内部的 schema、save guard 和 derived rule facets 共用同一个合同 authority、manifest digest、
contract digest、缓存 owner 与失效事务。首版不拆成四个可独立组合的 engine；只有出现第二个真实消费项目并证明
独立复用价值后，才另行评估拆分。

`identity-policy-v1` 与 `document-contract-v1` 是两个并列 authority：前者回答“目标条目如何获得和保持长期身份”，
后者回答“包含该身份的候选文档是否合法”。promotion 不得绕过命中文档的 save guard；identity policy 也不得被
document contract 隐式推断。Entry Action 的 `requiresDurableIdentity` 是引擎固有安全属性，项目 profile 不能关闭。

### 5. 无 capability 项目的行为

当项目不存在 `.data-editor/project.json` 时：

- 正常发现和编辑配置 data source 内的 JSON/CSV；
- 仅在状态为 `generic_absent` 时不请求任何业务合同；
- 不因路径为 `data/content/skills.json` 而进入特殊模式；
- 嵌套对象使用通用 JSON 编辑能力，未注册的高级节点表单只显示为普通结构；
- 自动化仍由项目的 `.data-editor/automation-profile.json` 和本机 bindings 控制；
- 普通编辑只使用 session RowId，打开文件不补种长期身份；
- 未匹配 `identity-policy-v1` 时，任何需要长期身份的 Entry Action 或其他能力失败关闭，不硬编码默认 `__entry_id`；
- 保存只执行通用路径安全、文档 ETag、原子写入和 journal/fencing 门。

## 三、职责边界与文件归属

### 1. Data Editor 保留内容

- project registry、project context、data source 与 file policy；
- JSON/CSV 文档模型、session RowId、按需 durable identity 框架、表格和详情面板；
- manifest loader、last-known-good binding snapshot、三个通用 engine 及严格输入校验；
- 文档 ETag、原子写入、journal、fencing、recovery 和 entry-action authority；
- 完全自包含的 fixture 项目和通用合同测试；
- capability 配置格式及用户错误反馈。

### 2. 迁出 Data Editor 的 Nocturnel 内容

- `classes.json` 的 `starting_equipments / starting_stats / stat_growth` schema；
- `affixes.json`、`affixes_mechanic.json` 的 `value_model / constraints / effect_spec` schema；
- `runes.json`、`traits.json` 的 effect schema；
- `skills.json` 的技能节点匹配条件、节点类型、派生规则和保存阻断语义；
- `Nocturnel` 项目名称、`C:\Code\Nocturnel` 路径和默认 adapter；
- 真实 `skill_nodes.json`、真实业务条目和项目级验收。

正式 `data/contracts/skill_nodes.json` 和 `skill_nodes.schema.json` 继续留在 Nocturnel 的 `data/contracts`，
保持游戏 runtime 与编辑器共享的单一业务合同真值；不得复制到 `.data-editor/contracts`。后者只承载编辑器专用的
manifest/schema 声明。

### 3. 可以保留的显式集成样例

`examples/nocturnel/**` 可以保留，但必须满足：

- 不被默认 runtime、build、`npm test` 或首次启动读取；
- README 明确标为“可选消费项目示例”；
- 示例不包含用户绝对路径、真实项目数据或必须同步的第二份业务真值；
- 示例过期不会影响 Data Editor 发布门。

当前未被 runtime 消费的 `examples/nocturnel/data-editor.project.json` 不得与新 manifest 并存为第二种项目描述格式。
实施时二选一：按新 `.data-editor/project.json` 格式重写为最小示例，或物理删除；disposition 必须记录最终选择。

## 四、分阶段实施方案

### 阶段 0：冻结决策、旧行为矩阵与机器清单

主要工作：

1. 确认本方案末尾的架构决策。
2. 固定两个仓库的 Git commit、dirty paths 和 submodule commit，避免覆盖并发任务。
3. 生成 coupling disposition JSON，字段至少包括：`matchId`、`producer`、`consumer`、`currentPath`、
   `targetOwner`、`targetPath`、`action`、`pattern`、`scope`、`allowlist`、`expectedCount`、
   `verification`、`deletionGate`。
4. 将命中分为 `move-to-nocturnel`、`generalize-in-core`、`fixture-only`、`keep-as-example`、`delete`。
5. 冻结 Nocturnel 当前详情面板字段、默认值、可见/禁用/只读状态、derived summary、阻断 code 和保存结果矩阵；
   本阶段只读取证，不修改 Nocturnel。
6. 建立 identity disposition：对每个历史 `__entry_id` collection 记录 `formatStatus`、`uniquenessStatus`、
   `referenceStatus`、`contractStatus` 与 `disposition`。缺失、非法或重复 ID 不是可直接复用的 durable identity；
   被 journal/recovery 引用、合同 required 或合法唯一的 ID 分别保留其证据与处理结论。
7. 建立共享 dirty-path owner map：记录路径、`ownerTaskId`、`state: owned|quiescent|transferred`、baseline diff/hash、
   允许修改集、最终 path set、receipt 时间、recipient 与 handoff receipt。任一工作包首次触碰该清单中的路径前，
   必须取得对应 owner 的 serial handoff，并在首次写入前重取当前 diff/hash；不匹配时回到 owner 重新交接。没有回执时
   只可处理不重叠文件。

完成条件：所有生产代码、测试、配置、文档和发布入口都有唯一 disposition；旧行为矩阵可在最终 handoff
逐项重放；identity disposition 与共享路径 owner map 可审计；没有未经批准的物理删除项。

### 阶段 1：先建立 Data Editor 自包含测试基线

主要工作：

1. 在 `tests/fixtures/projects/contract-project/**` 保存最小合成合同和数据，不复制真实 Nocturnel 内容。
2. 默认 `tests/*.test.mjs` 删除 `NOCTURNEL_ROOT`、相邻 `Nocturnel` 和 `../..` 业务根推断。
3. `open-stop`、service、registry 测试使用临时项目或合成路径，不把 Nocturnel 当默认 fixture。
4. E2E smoke 改用仓库内 fixture；真实项目规模 perf 保留为显式可选命令，不进入默认发布门。

完成条件：只 checkout Data Editor 的隔离目录可运行改造前的默认合同测试、`npm test` 与最小 E2E smoke；
后续通用化不再依赖 Nocturnel 在本机存在。

### 阶段 2：建立 capability 基座与安全状态机

Data Editor 预计改动入口：

- 新增 `src/project-capability-manifest.mjs`：加载、规范化、校验并计算 manifest digest；
- 新增 `src/project-capability-registry.mjs`：按 registry projectId 编译和隔离 capability；
- 新增 enrollment marker loader、受控 cutover/unenroll 操作和 last-known-good binding snapshot；LKG 只保存阻断
  身份、generation 和 digest，不保存可继续写入的旧合同；
- 新增 manifest/engine grammar JSON Schema 和对应 fixture；
- 编译 `identity-policy-v1` 的 match、provider、受保护字段和 generation；provider 仅允许 Data Editor 内置的声明式实现；
- 修正所有 `registry -> createProjectContext(...)` 接线，显式传递 `projectId: project.id`；
- 服务端以 `{projectId, dataSourceId, normalizedInnerPath}` 做 binding 匹配；
- registry root/dataSources 更新必须提升 capability generation，清空缓存并使全部旧 save token 失效；
- 前端 API 返回 capability 状态，不再无条件请求技能合同。

验证重点：`generic_absent / active / manifest_invalid / binding_degraded / contract_invalid`、absolute source、
同名 inner path、多项目切换、registry id 与 root-derived id 不同、fresh-machine enrollment、受控 binding removal、
root/dataSources 重映射、manifest digest 变化、LKG 损坏和缓存隔离。

完成条件：无 manifest 的合成项目正常工作；合法 fixture 仅在显式声明后启用能力；manifest/合同损坏不会降级绕过写门。

### 阶段 3：通用 document-contract-v1 保存门与按需长期条目身份专项

本阶段仍只修改 Data Editor，并以合成 fixture 代替真实 Nocturnel。内部顺序不可倒置：3.1 是身份专项的
前置能力；3.2 是依赖 capability 基座和 3.1 的独立工作包。

#### 3.1 `document-contract-v1`、schema 与 save guard 前置门

1. 将 `skill-node-contract-service/client/state/form-model` 收敛为 `document-contract-v1` 基座。
2. 将静态嵌套 schema 投影收敛为 `nested-schema-v1`。
3. save guard 与 derived rule 作为 document contract facets，共享合同 authority、digest、缓存和失效事务。
4. `server.mjs` 删除 `isSkillDocumentPath(...)`；保存链查询当前项目 capability registry。
5. 保存请求携带服务端已匹配的 `contractId + manifestDigest + contractDigest + version`；客户端自报 id
   不能扩大范围。
6. 把当前 Nocturnel schema/规则转换为合成 fixture 所需的声明数据；不得在核心写项目 id、业务路径或节点名分支。
7. 对暂时无法声明的规则，只在能由第二组合成场景证明通用时扩展 engine grammar。

完成条件：通用合同门、保存 token、缓存失效和合成 fixture 全部通过；同名 `skills.json`、无 capability 时可普通保存。

#### 3.2 独立工作包：Data Editor 按需长期条目身份

依赖：阶段 2 的 enrollment/LKG/project isolation/三个 engine grammar，以及 3.1 已可用的
`document-contract-v1` save guard。不得新建第二套 manifest loader 或 capability registry。

1. **session RowId 与零侵入打开**：普通编辑只使用 session RowId；打开无 ID 文件不补种、不 dirty、不 autosave。
   搜索、筛选、排序、详情、重排、复制和删除保持会话内稳定定位。
2. **首版 provider**：实现 `identity-policy-v1` 的 `embedded-v1`；只有 Entry Action 等引擎固有声明
   `requiresDurableIdentity` 的能力才可请求升级，项目 automation profile 不能关闭该要求。未匹配合法 policy 时，
   此类能力失败关闭；普通编辑仍保持 session-only。
3. **固定 promotion 安全时序**：`capability/identity policy ready → document-contract-v1 save guard ready →
   action/binding/target authority preflight → canonical-file fencing admission → commit mutex 内 canonical re-read 与
   ETag/row digest/authority/generation 重验 → 构造 promotion candidate → identity invariant + applicable save guard →
   identity_promotion journal intent → atomic replace → canonical verify → receipt + pending action token → 前端用响应中的
   canonical snapshot 重建 DocumentStore/RowHandle → client ACK/start → 服务端重验 generation/authority/durable identity/
   idempotency → 创建 durable-only handoff/run`。升级前的 `sourceRowIndex + expectedRowDigest` 仅用于定位候选，
   handoff 后不得作为 durable 回退。identity policy 命中但 document contract 未命中时，执行 generic document save
   guard 与 provider invariant；合同命中但 invalid/degraded 时失败关闭。
4. **generation lease、journal 与恢复**：promotion admission 取得并固定 `capabilityGeneration`、manifest digest、
   identityPolicy digest 与 `canonicalFileKey`，atomic replace 前再次重验。`identity_promotion` journal/receipt 至少固定
   provider/config digest、目标摘要、旧/新 ETag、durable ID、before/after digest、idempotency key、`actionId`、
   authority/request digest、run identity、handoff state 与 receipt digest，
   并有 durable journal、`recovery_pending` 和启动 admission barrier。replace 后 receipt 前崩溃时按 journal/receipt
   恢复，禁止重新生成第二个 ID；cutover/rebind 必须等待 active promotion lease，恢复时 generation 或 authority
   不兼容则保持 `recovery_pending` 并进入人工裁决。
5. **embedded-v1 invariant**：provider 仅能作用于阶段 0 已冻结且 schema 允许的 collection shape；未声明形状、CSV、
   primitive array、record-map 或不允许 identity 字段的业务 schema 均失败关闭。durable field 默认隐藏且不可编辑，
   所有正式 writer（普通编辑、批量保存、复制、proposal/group commit、导入/维护与恢复）必须拒绝修改或删除。
   建立 DocumentStore 前校验 format/uniqueness；历史非法或重复 ID 进入 conflict，不能作为 durable identity。
   session 与 durable namespace 不得碰撞；receipt 明确映射旧 session RowId 至新 durable identity，前端重建时迁移
   selection、pending edit 与 validation state。复制 durable 条目的副本保持 session-only。
6. **Entry Action 切换**：canonical verify 后服务端仅返回 receipt、pending action token、canonical snapshot/new ETag，
   不创建可执行 handoff/run；前端重建成功后才调用 ACK/start，服务端重验后创建只含 durable identity 的 handoff/run。
   前端重建失败不回滚已提交 promotion，也不启动 action，可由 receipt 在刷新后恢复。handoff、proposal、commit 和
   recovery 只接受 durable identity；删除升级后 `sourceRowIndex` 回退。pending action token 必须是服务端签发或持久登记的
   opaque、single-use、expiring admission capability，绑定 `projectId`、`canonicalFileKey`、durable identity、`actionId`、
   authority/request digest、receipt digest、generation 和 idempotency key。ACK/start 响应丢失后，以同一 token/idempotency
   key 返回同一 run；authority/generation 变化时拒绝启动并记录明确终态，不创建 handoff/run。
7. **后续 provider 边界**：`declared-key-v1` 是 deferred provider，不阻塞 `embedded-v1` 首版发布；只有出现真实消费方、
   完成机器可读 writer inventory，且 `protectedIdentityFields` 已被全部正式写路径保护后，经单独授权接入。它只解析
   既有非空唯一业务键，不生成技术 ID；复制时必须生成新业务键或失败关闭。`sidecar-v1` 等待真实消费者。历史
   `__entry_id` 默认保留，任何物理治理必须另建专项，先完成 producer/consumer/save/data/reference/disposition
   审计并取得单独批准。

owner handoff 门：当前工作树存在未提交的 Entry Action authority/proposal/group-commit 改动。身份专项在进入
`App.tsx`、DocumentStore、writeback、Entry Action、journal 或 capability registry 前，必须取得原 owner 的
**serial owner handoff**；本专项不得并行覆盖、回退、整理或归因这些改动。

完成条件：无 identity policy 的项目打开零写入；合法 `embedded-v1` 仅在首次实际执行需要长期身份的能力时升级目标
条目；promotion 在 replace 前通过 candidate guard，并按固定时序通过 authority、fencing、generation lease、journal、
canonical verify 与 snapshot；intent/replace/receipt/handoff/响应丢失/前端重建失败/恢复时 generation 变化均不生成重复 ID
或越过 admission；Entry Action 只在 durable identity 就绪后 handoff。`declared-key-v1` 与历史 ID 治理均不作为本工作包的
默认完成条件。

Data Editor 生产代码中的 Nocturnel 业务路径与业务分支清零。真实 Nocturnel 等价性留到阶段 7。

### 阶段 4：服务静默、registry v2 迁移与旧机制删除

#### 4.1 Quiescence gate

1. 使用旧版本执行正式 `npm run service:finalize`，只用于保全正式实例、清理已确认的临时进程并记录健康状态；
   不把它当作停服命令。
2. 对目标 runtime 执行旧版本 `npm run stop`，停止主 service 和 recovery bridge；如有自定义
   `--registry-home/--runtime-dir/--port/--bridge-port` 实例，必须分别按其正式参数停止。
3. 新 migrator 的 preflight 按规范化 registryHome 审计所有 `server.mjs/dev.mjs/recovery-bridge.mjs` 进程、监听端口、
   controller/service/bridge state 与迁移锁；任何仍使用目标 registryHome 的旧进程、无法证明身份的占用或残留写 owner
   都阻断 cutover，不能只检查 `8787/8791`。
4. 确认静默后才允许迁移；adapter cutover 期间禁止并发 `open/add/activate/update`。迁移完成并启动新版后，再执行新版
   `npm run service:finalize` 验证正式服务和 bridge 健康。
5. 增加“旧 state/旧 bridge + 新 CLI”测试；bridge/state 必须增加 protocol version，新客户端拒绝复用旧 controller。

#### 4.2 独立 registry v1 → v2 migrator

1. 新增唯一升级入口 `npm run registry:migrate:v2 -- --registry-home <path>`；它只能在 4.1 静默门通过后运行。
   `npm run open` 遇到 v1 时必须 fail-closed 并输出该命令，不能在服务已启动后隐式迁移或双读。
2. 在调用现有 normalize/load 前读取 `projects.json` 原始字节并校验 source version。
3. 取得独占迁移锁；生成含时间戳、source hash、`fromVersion`、`toVersion` 的唯一备份。
4. 生成 `version: 2` 候选文件并删除 `adapter`，保留 id、name、root、active project、dataSources 和 filePolicy。
5. 重新解析候选并逐字段比较，再用原子替换发布；未来未知版本直接拒绝。
6. 明确 stale root 只保留登记、不要求迁移时可达；不得静默过滤、改选或 quarantine。
7. registry 文件不存在时记录 `not_applicable`，不伪造 backup；由 v2 bootstrap 创建合法空 registry。空 registry
   与迁移后的 registry 都必须通过相同 v2 validator 后才能允许 `open/add/activate/update`。
8. 覆盖并发写、中断、重复执行、无源 registry、备份恢复和 hash 不匹配测试。

#### 4.3 物理删除

- 从 context、registry、UI、API、CLI、service lifecycle、recovery bridge 和 state identity 删除 `adapter/adapterId`；
- `--adapter` 成为明确未知参数；Nocturnel 启动脚本此时尚不修改；
- 删除 `tools/data-editor/view-config.json` 与 `tools/data-editor/view-configs` legacy fallback、loader 和测试；
- 项目创建只提交通用发现字段，capability 从项目根读取。

完成条件：新旧 bridge 不能跨协议复用；同 registryHome 的全部旧实例已静默；registry v2 升级入口、空 registry
bootstrap 与恢复路径均可验证；生产代码不存在 adapter 默认链和 legacy view fallback；stop/finalize/recovery 与现有
并发安全测试通过。

### 阶段 5：工具仓文档、机器审计与 hermetic 发布门

主要工作：

- README、快速开始和配置模型以任意 `<projectRoot>` 为主，不要求 adapter；
- 合同文档改为通用 capability 合同，Nocturnel 业务说明从工具正式文档移除；
- Codex 打开入口不再硬编码项目根或 `--adapter nocturnel`；
- 旧 `examples/nocturnel/data-editor.project.json` 按 disposition 重写为最小新格式或删除；
- 新增可重复的耦合审计脚本，读取 disposition 的 `pattern/scope/allowlist/expectedCount`，分别扫描 production、
  default tests 和明确示例；排除 `.git/node_modules/dist/work`，任何未登记命中或计数漂移均非零退出。

hermetic 门在只有 Data Editor checkout 的临时目录或 CI job 中执行：

1. 安装锁定依赖；
2. `npm test`；
3. `npm run build`；
4. 一条独立命名的 generic fixture E2E smoke；
5. 机器耦合审计。

以隔离 checkout 作为“不访问 Nocturnel”的正式证据，不依赖未定义的全文件访问 instrumentation。

完成条件：新用户不接触 Nocturnel 即可完成安装、注册、编辑、保存、停止和收尾；全部 hermetic 门通过。

### 阶段 6：Data Editor scoped 交付与远端可达门

1. 重取当前 dirty state，只暂存本专项文件，不混入既有 entry-action 等并发改动。
2. 经用户明确提交授权后，单独提交 Data Editor。
3. 经用户再次确认后 push；验证目标 commit 被正式远端分支或 tag 引用，可由新目录 fetch/checkout。
4. 记录 Data Editor commit、capability API version、manifest schema digest 和测试证据。

完成条件：Nocturnel handoff 所需 Data Editor commit 已远端可达；此前不得更新主仓 submodule 指针。

### 阶段 7：Nocturnel owner handoff 与 submodule 升级

只有本阶段可以修改 Nocturnel：

1. 重取 Nocturnel dirty state 和 submodule 状态，确认嵌套仓库没有未提交改动。
2. 添加真实 `.data-editor/enrollment.json`、`.data-editor/project.json` 和仅编辑器专用的
   `.data-editor/contracts/**`；正式
   `data/contracts/skill_nodes*.json` 保持原路径单一真值。
3. 将阶段 0 冻结的 classes/affixes/runes/traits/skills 行为映射到新声明，并逐项做等价验收。
4. 修改 `scripts/tools/open-data-editor.ps1`，删除 `$Adapter` 和 `--adapter nocturnel`。
5. 更新 `tools/data-editor` gitlink 到阶段 6 已远端可达的 commit，主仓 diff 只记录预期 gitlink 与项目配置改动。
6. 运行 consumer contract、entry action、Node、Godot 资源隔离和真实 Data Editor 集成验收。
7. 经用户授权后单独提交 Nocturnel candidate commit；本阶段不 push，先进入阶段 8 的本地 clean-room 门。

完成条件：真实 Nocturnel 行为矩阵等价，不依赖独立 `C:\Code\data-editor` 或个人 registry；submodule 指针可重建。

### 阶段 8：clean-clone 双仓总验收与 handoff receipt

Data Editor 验收矩阵：

| 场景 | 预期 |
| --- | --- |
| 无 `.data-editor/project.json` 的任意 JSON/CSV 项目 | 浏览、编辑和保存正常，无业务合同请求 |
| 状态为 `generic_absent`，且存在 `data/content/skills.json` | 作为普通 JSON 保存，不触发技能合同 |
| 合法合成 capability 项目 | 专用节点表单和保存门仅对匹配文档生效 |
| 无 identity policy 的普通编辑 | 文件打开零写入，session RowId 支持全部普通表格能力 |
| 无 identity policy 的 Entry Action | promotion 前失败关闭，不生成 handoff 或修改文件 |
| 合法 identity policy 首次执行 Entry Action | generation lease、authority/fencing、candidate guard 均通过后按需建立 ID；先返回 receipt/pending token/snapshot，ACK/start 重验后才创建 durable-only handoff/run |
| promotion 在 intent、replace、receipt、pending token、ACK/start 或响应丢失时崩溃/重试 | journal/recovery 复用同一 durable ID、receipt 与 action admission 结果，不生成第二个 ID 或 action run |
| promotion 恢复时 generation/authority 已变化 | 保持 `recovery_pending`，不自动继续或重写 |
| 前端 canonical snapshot 重建失败 | promotion 不回滚；不发送 ACK/start，不创建 handoff/run；刷新后从 receipt/canonical snapshot 恢复 |
| receipt 已发布但 ACK/start 前 generation/authority 改变 | promotion 保持完成；token 进入拒绝终态且不创建 run；新请求复用 durable identity，不再次 promotion |
| 历史 `__entry_id` 非法或重复 | 普通打开零写入；需要 durable identity 的能力 fail-closed 并进入 conflict |
| 任意正式 writer 修改/删除 protected identity field | 普通编辑、批量保存、复制、proposal/group commit、导入与恢复均失败关闭 |
| session/durable namespace 碰撞或 session mapping 进入服务端重试 | fail-closed；session mapping 仅用于 UI correlation，服务端仅信任 canonical identity/journal/receipt |
| identity policy 无 document contract / document contract invalid | 前者执行 generic guard + provider invariant；后者 fail-closed |
| cutover/rebind 遇到 active lease、未终结 journal 或 `recovery_pending` | 阻断 transition；仅 barrier 清空后以 `G → G+1` 发布 registry 与 LKG |
| manifest 非法 | 项目可读但写入 fail-closed，不越界读取 |
| 合同/schema 非法 | 命中 binding 的文档 fail-closed，其他文档不受影响 |
| manifest 误删且存在 LKG | LKG 覆盖范围 fail-closed，不降级为 generic |
| fresh machine 上 enrollment marker 存在但 manifest 缺失 | 项目范围 fail-closed，不依赖本机历史 |
| 未携带有效 transition 的合法 manifest 缩小 binding 范围 | 进入 `binding_degraded`，不得更新 LKG |
| absolute data source | 以 source id + inner path 正确匹配，不要求 project-relative path |
| registry root/dataSources 在加载后重映射 | capability generation 变化，旧缓存与 save token 全部失效 |
| 两个项目使用不同合同 | 缓存、ETag、表单和保存门完全隔离 |
| 独立 clone | `npm test`、typecheck、build、E2E smoke 不访问 Nocturnel |

Nocturnel 验收矩阵：

| 场景 | 预期 |
| --- | --- |
| 技能节点合法编辑 | 合同表单、派生摘要和保存成功 |
| 合同版本/ETag 过期 | 保存被拒绝，错误码与当前安全语义一致 |
| targeting/movement/charge 冲突 | 对应字段级阻断保持有效 |
| classes/affixes/runes/traits | 迁移后的嵌套 schema 与迁移前一致 |
| entry actions | 项目 profile、bindings、稳定条目身份与写回门正常 |
| Godot runtime | 不加载或依赖 `tools/data-editor`；资源扫描隔离保持有效 |

验收拆成两个不可互相替代的门：

1. **push 前本地 clean-room 门**：从 Nocturnel 本地 candidate commit 或只含该 commit 的 bundle 在新目录 clone，
   recursive init 使用阶段 6 已远端可达的 Data Editor gitlink；不复用现有 registry、node_modules、dist 或嵌套
   checkout。确认 enrollment/manifest 均被 candidate commit 跟踪、启动脚本可用且 consumer tests 通过。
2. **push 后远端重建门**：本地门通过并再次取得用户 push 授权后，push Nocturnel candidate；随后只从正式远端
   recursive clone，在全新 registry home 下重放双仓验收。该门通过前不得宣布解耦完成或把 candidate 提升为正式发布。

零残留机器门至少检查：

- Data Editor 生产代码：`Nocturnel`、`C:\Code\Nocturnel`、业务文件路径、`adapterId`、`--adapter`；
- Data Editor 默认测试：`NOCTURNEL_ROOT`、相邻 `Nocturnel` 推断、真实合同读取；
- Nocturnel：旧 adapter 参数、指向独立 `C:\Code\data-editor` 的默认入口、未更新 submodule 指针；
- `skill-node-contract-*`、`skill_nodes`、`targeting/movement/charge` 等业务语义是否已按 disposition 迁移或获批保留；
- `tools/data-editor/view-config.json`、`tools/data-editor/view-configs` legacy 消费者为零；
- disposition 中每项均为已迁移、已删除或明确保留，不存在“暂时忽略”；审计脚本未登记命中即失败。

最终生成 handoff receipt。它是被验收 commit 之外的 CI/release artifact，或位于后续独立证明提交中，不能存入并
自引用其绑定的 Nocturnel candidate commit。receipt 绑定 Data Editor commit、被验收的 Nocturnel commit、
submodule SHA、capability API version、enrollment/manifest/schema digest、测试报告和回退命令。registry 证据记录
脱敏 backup 标识及 `sourceHash/backupHash/resultHash`；无 v1 registry 时明确记录 `not_applicable`。缺少任一适用项
不得宣布完成。

## 五、测试与验证命令规划

实施时按阶段使用定向门，最终才运行全量门：

```powershell
node --test tests/project-capability-manifest.test.mjs tests/project-capability-registry.test.mjs
node --test tests/document-contract-service.test.mjs tests/document-contract-save-gate.test.mjs
node --test tests/node-schema-registry.test.mjs tests/api-client.test.mjs
node --test tests/project-registry-migration.test.mjs tests/runtime-state.test.mjs
node --test tests/project-registry.test.mjs tests/open-stop.test.mjs tests/service-finalizer.test.mjs
npm test
npm run build
npm run test:e2e:generic-smoke
node scripts/audit-project-coupling.mjs --disposition artifacts/project-coupling-disposition.json
```

如启动本地服务、临时端口、Browser 或 Playwright，必须执行 `npm run service:finalize`，并报告
`8787/api/health`、`8791/health`、正式 URL 和临时进程/目录清理结果。`test:e2e:generic-smoke` 和
`audit-project-coupling.mjs` 是实施时需要新增的正式命令；在它们存在并进入 CI 前不能引用为已通过证据。

Nocturnel 的具体测试命令应在 owner handoff 时按当前 checkout 的正式测试入口重新确定，不能在本方案中
沿用可能漂移的旧命令。

## 六、风险与控制

| 风险 | 控制措施 |
| --- | --- |
| 泛化表达力不足，迁移后夜曲表单能力退化 | 先做行为矩阵与合成 fixture；只扩展可由第二个合成项目证明通用的 engine 能力 |
| capability 变成执行任意项目代码的插件入口 | 首版仅接受严格 JSON 与已注册 engine id；禁止动态 import、shell 和任意命令 |
| 保存门迁移期间被绕过 | 新门通过定向测试和 Nocturnel 等价测试后，才原子删除旧路径判断 |
| manifest 损坏或误删导致 generic 降级 | 使用 enrollment marker、五态 lifecycle、LKG binding snapshot 与受控 cutover；degraded 状态写入 fail-closed |
| absolute/multiple data source 匹配错误 | 使用 projectId + dataSourceId + normalizedInnerPath，锁身份复用 canonicalFileIdentity |
| registry 迁移丢失 active project 或数据源 | 独立 v1→v2 migrator 在 normalize 前备份原始字节，候选重验后才原子替换 |
| 旧 recovery bridge 或自定义端口实例跨版本写 registry | adapter cutover 前按 registryHome 执行 quiescence 审计，并以 controller protocol version 拒绝旧 bridge |
| 双仓版本错配 | Data Editor 先 push；Nocturnel manifest 声明最低 capability contract version，并固定已存在的 commit |
| 当前脏工作树被覆盖 | 每阶段先重取 `git status` 和 scoped diff；不 reset/restore，不混入无关 entry-action 改动 |
| 示例重新成为隐式真值 | 示例不进入 build/test/runtime，真实业务合同只在 Nocturnel 维护 |

## 七、回退策略

回退单位不是在 runtime 中保留旧分支，而是 Git 和配置备份：

1. Data Editor 每个阶段保持 scoped diff；只有取得提交授权后才形成提交，未进入 handoff 前可回退工具 commit。
2. registry v2 migrator 在 handoff receipt 中记录脱敏 backup 标识及 `sourceHash/backupHash/resultHash`。回退旧工具
   版本前必须先静默服务，并同时校验备份原始 hash、迁移结果 hash 和当前 registry hash；当前 registry 已发生合法
   用户修改时停止自动恢复，进入人工合并，不能覆盖。
3. Nocturnel handoff 单独提交 capability、启动脚本和 submodule 指针；失败时整体回退该提交和 gitlink。
4. push 前本地 clean-room 验收失败时，不推进 Nocturnel push；push 后远端重建门失败时停止正式发布并形成修复
   commit，不重写远端历史。已 push 的 Data Editor commit 可以保留为未采用版本。
5. 不允许在新版本中重新加入 `adapter ?? "nocturnel"`、业务路径 fallback 或 legacy view 双读作为临时修复。
6. 已产生的业务数据修改不与架构回退混合；本方案不授权修改任何 Nocturnel 内容数据。

## 八、交付物

### Data Editor

- capability enrollment/manifest schema、loader、受控 cutover、LKG snapshot、按 source 匹配的 registry 和 API；
- `nested-schema-v1`、含 save guard/derived rule facets 的 `document-contract-v1`，以及含 promotion/recovery 合同的 `identity-policy-v1`；
- 不含 adapter 的 project registry/context/service lifecycle；
- registry v2 bootstrap/migrator、按 registryHome 的 quiescence gate、controller protocol gate、legacy view fallback 删除证据；
- 自包含 fixture、定向测试、hermetic CI 和独立 clone 证据；
- 通用 README、配置模型和 capability 文档；
- coupling disposition、机器零残留审计和 Data Editor release receipt。

### Nocturnel

- `.data-editor/enrollment.json` 与 `.data-editor/project.json`；
- `.data-editor/contracts/**`；
- 更新后的启动脚本和 consumer contract tests；
- 指向已发布 Data Editor commit 的 submodule；
- 真实技能/特质/符文/词缀/职业 schema 与保存门等价验收记录；
- clean-clone 证据和绑定双仓 commit/submodule/config digest 的 handoff receipt。

## 九、已确认架构决策

### 决策 1：项目扩展采用声明式 capability，还是可执行插件

**推荐：声明式 capability。** Data Editor 只解释经过 schema 校验的 JSON，首版仅提供
`nested-schema-v1`、`document-contract-v1` 与 `identity-policy-v1`。`document-contract-v1` 内聚 schema projection、
save guard 和 derived rule facets；`identity-policy-v1` 独立管理长期身份 provider 与 promotion 安全合同。
这样业务语义归项目所有，同时避免编辑器加载任意项目代码。可执行插件仅在未来出现无法声明且确实跨项目复用的
需求时另行立项。

### 决策 2：删除 adapter 字段，还是改名为 generic

**推荐：删除。** 当前 adapter 没有真实实现分派；改名只会保留伪抽象。项目能力由 capability manifest 表达，
registry 只负责项目发现。

### 决策 3：Nocturnel 示例是否保留在 Data Editor

**推荐：保留一个最小、非运行时、非测试依赖的示例。** 它只展示 capability 配置结构，不复制真实业务合同。
如果维护成本仍造成漂移，则后续可以单独删除示例，不影响架构。

### 决策 4：迁移与发布是否按双仓串行 handoff

**推荐：是。** Data Editor 先完成、验证、提交并经确认 push；Nocturnel 再迁移配置、更新 submodule、验证并形成
candidate commit。candidate 先通过本地 clean-room 门，取得单独 push 授权后再推送，最后从正式远端 recursive
clone 完成发布验收。不得把两个仓库改动混为一个提交，也不得在工具 commit 尚未远端可用时提交消费项目指针。

### 决策 5：fresh machine 如何识别必须启用 capability 的项目

**采用 committed enrollment marker。** 需要保存安全门的项目同时提交 `.data-editor/enrollment.json` 与 manifest；
marker 存在但 manifest 缺失时项目范围 fail-closed。LKG 提供本机运行期间的第二层保护，但不作为 fresh-machine
事实来源。marker 与 manifest 同时缺失的错误发布由 consumer clean-clone 和机器审计阻断。

### 决策 6：registry v2 自动迁移还是显式 bootstrap

**采用显式 bootstrap。** `open` 发现 v1 时拒绝启动并提示执行唯一 migrator；migrator 只有在同 registryHome
全部实例静默后才运行。registry 不存在时走空 v2 bootstrap 并记录 `not_applicable`，不伪造迁移备份。

### 决策 7：长期条目身份是否属于首版 capability

**采用独立的 `identity-policy-v1`。** 普通编辑默认只使用 session RowId；需要跨重载异步写回的 Entry Action
由引擎固有声明要求 durable identity，并且只有 collection 命中合法 identity policy 时才允许 promotion。
身份策略不得塞入 automation profile，也不得由文件名、字段名或业务项目类型隐式推断。

## 十、完成标准与授权边界

全部满足以下条件才可宣布解耦完成：

1. Data Editor 独立 clone 不需要 Nocturnel 即可启动、构建和执行默认测试。
2. 无 capability 的项目不会因业务文件名触发额外 UI、合同请求或保存阻断。
3. enrollment 项目的 capability 损坏、单独误删、未授权缩小、版本不支持或合同失效不会降级绕过保存门；fresh
   machine 能由 committed enrollment marker 得到相同结论。
4. absolute/multiple data source 与自定义 registry projectId 均能正确隔离合同、缓存和写锁；root/dataSources
   重映射会使缓存和旧 save token 失效。
5. Data Editor 生产代码不包含 Nocturnel 名称、路径、业务 schema、默认 adapter 或 legacy view fallback。
6. Nocturnel 通过项目内声明恢复全部既有编辑能力和保存安全门。
7. 无 identity policy 的项目打开文件零写入；需要 durable identity 的能力失败关闭。合法 policy 下首次 promotion
   经过 authority、fencing、journal、save guard 和 canonical reload，且崩溃后可确定恢复。
8. Nocturnel Godot runtime 与 Data Editor 仍无加载依赖。
9. submodule 指针指向远端可达、可从 clean clone 重建的 Data Editor commit；Nocturnel 同时通过 push 前本地
   clean-room 与 push 后正式远端 recursive clone。
10. 双仓 scoped diff、hermetic CI、非自引用 handoff receipt、disposition 和机器零残留审计均通过。

本方案获批仅表示目标架构和实施顺序获批，不等于实施授权。进入 runtime、tests、Nocturnel 配置、
registry 迁移或 submodule 修改前，仍需用户明确授权实施。
