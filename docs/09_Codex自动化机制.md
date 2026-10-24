# Codex 自动化机制

## 概述

### 1. 总体目标和范围

Data Editor 的条目级 Codex 自动化仍在安全升级中。当前正式产品不提供新任务的执行能力：
`POST /api/entry-actions/run` 固定返回 HTTP 503 与
`ENTRY_ACTION_PROTOCOL_DISABLED`。本页只说明已落地的安全边界和隔离验证，不把未启用的
自动化方案描述为可用功能。

### 2. 各阶段任务概要

1. 安全前置：建立物理文件身份、原子写、Windows Job ownership、fencing 与可证明 recovery。
2. Authority：以 policy、profile ETag、Strict RowId 和 authority snapshot 限定允许的目标与字段。
3. 隔离验证：在临时 scratch 中验证真实 Codex CLI 只能产生严格 proposal，不触碰正式项目。
4. 当前提交基础：正式保存已使用 `canonicalFileKey` 提交互斥、严格 ETag、稳定幂等键和可恢复
   commit journal；proposal commit 复用同一执行器。入口启用仍不在范围内。

### 3. 整体结构框架

```text
正式入口 -> 503 ENTRY_ACTION_PROTOCOL_DISABLED

隔离测试面：fixture -> scratch -> Codex CLI -> 严格 proposal -> 隔离目录
                                          \-> timeout -> Job 树终止 / fencing 释放
```

## 当前正式边界

服务端在任何 profile、binding、环境变量或前端状态之前拒绝新的 legacy direct-write action；
旧 runner 文件或历史结果仍可读取，不代表该入口可以执行。正式保存路径的 allowlist、
`canonicalFileIdentity(...)`、原子写、提交互斥与 journal 已形成受控提交基础，但它们不是自动化
写回入口。

## 已完成的隔离验证

批次 D 已完成以下工具层事实：

- proposal 必须是 version 1，绑定 UUID `runId`、canonical file key、`authorityDigest`、profile ETag、
  fencing token，并且只允许一个既有字段的显式替换。
- 只有真实 Codex CLI 退出码为 0 且 proposal 通过严格 schema 时，才会在隔离目录原子发布；失败、
  无效 payload 或路径异常不会留下 proposal。
- success / timeout 都只运行于临时 scratch fixture。timeout 在观察到 CLI readiness 后终止 Windows Job，
  并验证 Job 树退出、fencing release、10 秒无源文件晚写和空 proposal 目录。

这些验证未向正式项目写入，也未恢复 API 入口。

## 配置与可用性

`.data-editor/automation-profile.json`、本机 bindings、
`.data-editor/entry-action-policy.json` 与 authority snapshot 仍共同构成受控执行协议的输入和验证
基础；其中 profile 与 policy 都会参与动作目标的授权判断。当前它们不能绕过入口禁用。用户界面或
配置中出现的动作、绑定或历史运行记录，都不代表可以启动新的写回任务。

已确认的配置断裂是：某个动作即使已经在 Automation Settings 中启用并配置了目标文件和合集，只要
`entry-action-policy.json` 未声明同一 `actionId + file + collection`，authority snapshot 仍会将其
视为授权过期，并以 `ENTRY_ACTION_AUTHORITY_STALE` 拒绝。这是两份动作目标配置未同步造成的当前
限制，不代表所选条目内容本身无效。

## 后续边界

批次 E 已完成统一提交 coordinator、proposal commit 共用执行器、commit journal 与恢复判定；它没有
把 proposal 服务接入新任务路由。正式入口仍须完成完整运行时接入、真实项目端到端验证并取得独立
启用授权，才能解除禁用。


## 固定项目命令的可信结果验证（2026-10-22）

本节描述新增的通用 `project-command` 能力，不代表任何项目已启用机制写回。动作可在 `execution` 声明 `proposalValidator: { version: 1, command: { path, args, readDependencies, timeoutMs } }`。声明即必需，不支持 `required: false` 或失败降级。validator与生成命令共用固定 `.mjs` 路径、无shell、参数/超时/输出上限约束；仅支持JSON源且没有textArtifact，其他执行种类/组合写入不接受该声明。

validator程序、读取依赖、动作profile、动作合同和普通保存策略一起纳入authority/accepted snapshot及提交协调锁。服务接受任务时持久捕获原run、action、文件/合集/条目与语言范围；原作者需求来自同一基线完整行。生成器返回的evidence不代替验证。

服务构造stdin：`version:1, kind:"project-command-validation", mode, request, action, beforeRow, afterRow, changes, snapshot, inputDigest, changesDigest`。mode依次覆盖fresh、commit、admit、no_changes、recovery；后两者分别验证before=after满足原请求、原journal重建后像。inputDigest是附加两摘要之前整个输入JSON的SHA256；changesDigest是changes JSON的SHA256。action含合同/规则摘要，snapshot含原请求摘要及各读取输入摘要。服务端先检查动作predicate/字段权限，再由可信项目程序检查嵌套领域差量和语言要求。

程序必须只输出 `version:1, kind:"project-command-validation-result", status:"pass"|"reject", diagnostics:string[], inputDigest, changesDigest`。额外patch、摘要不符、超时、异常或拒绝都不能提交。程序是经批准的可信纯验证程序；普通Node子进程没有只读文件系统沙箱，纯性/禁写须通过代码审查及定向文件不变测试证明，不能将输出校验冒充任意代码隔离。

正常写回在fresh绑定后验证，并在源/依赖共同锁内的latestPrepared及replace前admit再次验证，随后复核输入未变；不得在验证和写入之间释放锁。no_changes同样持锁验证需求已满足后才发布完成。固定项目动作不能借native proposal、project-skill或group入口绕过验证。项目领域规则由项目程序拥有，Editor不内置业务词法或另一份机制事实。

写后丢回执时，原run恢复必须核对原请求与proposal摘要绑定、原程序/依赖、journal和已写后像，再运行同一validator；不再运行生成器或replace。依赖变化/缺上下文/验证失败保留待恢复，不能宣称源文件未写入。文件提交成功与运行系统发布是两个阶段。
## 工具部署与历史证明承接（2026-10-24）

历史 non-replay receipt 的 `evidence.deploymentDigest` 绑定原部署 policy。工具安全代码升级不能直接改旧 receipt，也不能仅刷新部署文件摘要。正式升级由固定工具交付配置选择一份 `managed-deployment-successor-v1` 承接证书；证书及原部署配置快照保存在 `config/historical-deployment-upgrades/`，按内容摘要命名并不可覆盖创建。

承接证书绑定物理项目根、runtime、anchor、原账本字节、全部原 receipt/evidence、原 policy 与目标 policy。配置的证书引用放在 policy 外部，避免摘要自引用。公共 `readLedger()` 对升级后的项目无条件核验原账本与指定 receipt，清空 records 或仅改变空白字节均拒绝；后续仍校验完整当前代码、原证据及关系闭包。旧任务永久拒绝执行/恢复，未知业务结果不被改写为成功。后续合法人工编辑不要求永远等于旧业务基线。

离线管理入口 `scripts/historical-deployment-upgrade.mjs` 提供显式绝对项目路径的 `prepare/apply`。prepare 输出候选；apply 在共享交付配置锁和项目锁内重验候选、业务维护基线、OPEN/无活动发布状态及无新增未覆盖义务，先写入不可覆盖材料，再原子切换配置。代码、材料或原状态未知时拒绝，没有自动升级、请求传入 verified 或跳过校验模式。升级后须用全新进程验证，主服务与 recovery bridge 都须加载新版解析器。

配置是本机工具交付 authority；内容摘要不是数字签名，不承诺抵抗同账号同时替换代码和配置、或强行恢复整套旧包。备份和原始证明应保留，回滚必须是已验证的完整部署组合。维护操作不写原项目 ledger、receipt、历史文件或业务数据。
