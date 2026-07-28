# entry-action legacy 协议已硬禁用，pre-enable 文件安全与恢复基础已落地

<!-- state: current -->
## 当前行为

### 新任务入口统一拒绝，既有结果读取不属于本次门禁

`server.mjs` 在调用项目初始化和 legacy `handleRunEntryAction(...)` 之前处理
`POST /api/entry-actions/run`：它固定返回 HTTP 503、
`ENTRY_ACTION_PROTOCOL_DISABLED` 与 `protocolMode: "legacy-disabled"`。该门禁不读取
环境变量、profile、binding 或前端状态，因此不能由这些输入绕过。

此状态只禁止启动新的 legacy direct-write action；它没有把历史 handoff、result、latest
或 output 读取能力改写成新的提交协议。不得把旧 runner 文件仍在仓库中，或旧结果仍可读，
解释为该入口可执行。

### 正式保存路径使用 allowlist、物理身份与原子写基础设施

`src/file-service.mjs` 现在先把虚拟路径规范化并解析到 allowlist 中的真实文件，再交给
`atomicWrite(...)` 写入。`src/canonical-file-identity.mjs` 只对已允许的数据文件取得
`realpath`，将 Windows 的物理路径规范化后计算 `canonicalFileKey`；同一物理文件的别名、
大小写或 junction 不能获得不同的文件身份。

`src/atomic-file.mjs` 提供三项基础原语：

- `exclusiveCreateLock(...)` 用 `wx` 创建并同步落盘；
- `atomicWrite(...)` 用唯一临时文件完成 write、sync、close、同目录 replace；
- `atomicReplace(...)` 只允许同目录同卷替换，并对 `EPERM` / `EBUSY` 做有界重试，不先删
  target 作为 fallback。

`file-service`、runtime state 与 project registry 已迁移到该原子写原语。它们也是批次 E
正式文档提交的基础；这不等于恢复自动化入口或建立跨文件事务。

### 正式文档保存已收敛到按物理文件串行的 journal 提交

`server.mjs` 的 `/api/save` 在 `src/document-commit-coordinator.mjs` 的
`canonicalFileKey` 临界区内完成读盘、`documentEtag` 校验、保存合同校验和写入。`documentEtag`
与稳定 `idempotencyKey` 都是必填合同；同一逻辑保存的重试复用同一 key，已完成且源文件仍能证明
一致的记录会重放原结果，而同 key 的不同请求会以
`DOCUMENT_SAVE_IDEMPOTENCY_CONFLICT` 拒绝。

`src/commit-journal.mjs` 为 `document_save` 和 `proposal_commit` 持久记录
`commit_intent → source_replaced → verified → result_published` 四阶段，以及 save type、文件身份、
前后 ETag、内容 digest 与请求 digest。`src/document-commit-executor.mjs` 只允许按该顺序前进；
replace 后若阶段落盘失败，会保留 `commit_intent` 作为恢复证据而不回退或猜测覆盖。
`src/commit-journal-recovery.mjs` 仅在当前 ETag 与 digest 能证明 base 或新内容时收敛；无法证明的
组合返回 `failed_needs_recovery`。

`src/entry-action-proposal-commit.mjs` 的已授权 proposal 提交复用同一 journal executor，并把
`runId + proposalDigest` 派生为 `proposal_…` 幂等键。它仍是受控服务能力，未连接到被禁用的
`/api/entry-actions/run`，因此不改变 legacy 新任务入口的拒绝状态。

### Windows job ownership、fencing 与 recovery 仅服务于安全前置层

`src/job-supervisor.mjs` 为每次 launch 生成独立 UUID `jobInstanceId`，并使用 protocol v2
的 helper / child 双层 PID + FILETIME 身份证据。`src/fencing-lock.mjs` 按
`canonicalFileKey` 维护单调 fencing token、不可变 allocation ledger、tail anchor 与
admission owner；未知 schema、损坏、身份不一致或证据不完整均 fail closed。

`src/entry-action-recovery.mjs` 与 `npm run entry-action:recover -- inspect|recover --project
<root> --run-id <id>` 使用 claim-first：固定 admission 只能先迁移到唯一 quarantine claim，
之后只按 claim 内证据判断。`inspect` 对完整的 `active`、`releasable` 或 `insufficient`
返回 exit 0；不可证明的目标缺失、I/O、JSON 或 schema 问题返回 exit 2。`recover` 只在
可释放证据下移除 claim，并在成功后写入完整 lease 绑定的 completed recovery record；
`active` / `insufficient` 返回 exit 3 并保留锁。

批次 D 已在隔离测试面接入严格 proposal 与真实 Codex CLI，但仍没有连接回
`/api/entry-actions/run`，也没有启用 handoff 或真实项目写回：

- `src/entry-action-proposal.mjs` 只接受 version 1、UUID `runId`、64 位
  `canonicalFileKey` / `authorityDigest`、fencing、ETag 与一个已存在字段的显式替换；第二目标、
  整文档 payload、未知字段和字段新增/删除都会拒绝。
- `src/entry-action-proposal-publisher.mjs` 只有在 Codex 退出码为 0 且 schema 合法时，才在隔离
  proposal 目录内原子发布；失败、无效 schema 或越界路径不留下 proposal。
- `tests/entry-action-cli-e2e.test.mjs` 只复制独立 fixture 到临时 scratch。它先建立 fencing
  admission，再以 `resolveCodexCli()` 定位 CLI；success 仅发布合法 proposal，timeout 在观察到
  readiness 后以 `terminate("timeout")` 终止 Job，并检查 Job 树退出、fencing 释放、10 秒无晚写与
  proposal 目录为空。

这些是批次 D 的隔离执行证据；随后完成的批次 E 已补齐 production proposal commit、journal 与
恢复合同，但仍不构成入口恢复。

批次 C 已在工具层补齐受控提交所需的 authority 基础，但没有改变上述入口门禁：

- `src/entry-action-policy.mjs` 定义 version 1 的严格 writeback policy；顶层、target 和字段
  rule 出现未知或损坏结构时 fail closed，`validateAuthorizedPatch(...)` 只接受 policy 已授权的
  file、collection、field 与值类型。
- `src/automation-profile.mjs` 为 profile 内容提供 ETag compare-and-save；陈旧保存返回
  `AUTOMATION_PROFILE_ETAG_STALE`。每个启用规则 target 都必须有非空 `writableFields`，缺失
  字段的旧规则失去启用资格。
- `src/entry-actions.mjs` 的 Strict RowId resolver 只接受唯一的持久 `__entry_id`，不回退
  `sourceRowIndex`。
- `src/entry-action-authority.mjs` 的 snapshot 绑定 policy digest、profile ETag、action、target
  与字段集合；任何 authority 变化、权限收窄、target 失效或 schema 损坏均以
  `ENTRY_ACTION_AUTHORITY_STALE` 拒绝。

这些是未启用执行协议的前置能力，不构成 proposal、handoff、真实项目写回或入口恢复。

### 运行状态、诊断与同物理文件活动查询使用显式合同

`src/entry-action-state.mjs` 将运行记录统一为 `phase` 与 `outcome`：只有
`phase: "terminal"` 且 `outcome` 属于允许的终态集合才是可信终态；旧 `status` 记录仅在读取时
规范化为该合同。`src/entry-action-result-wait.ts` 的观察上限是独立的
`kind: "timed_out"` 结果，不能被解释为 runner 已进入终态；这是页面停止观察的结果，
与终态 `outcome: "timed_out"` 的 runner 语义分离。

`/api/entry-actions/result` 返回的 `proposal`、`reply` 与 `diagnostics` 都是包含 `path` 和
`available` 的产物描述，调用方不能仅凭预期路径存在来声称产物可用。
`/api/entry-actions/active?sourcePath=...` 则先取得 `canonicalFileKey`，再返回同一物理文件上所有
未终态运行；路径别名、大小写或 junction 不会分裂该活动查询范围。

### 条目临时目录清理必须保留无法证明安全的产物

`scripts/service-finalize.mjs` 会枚举 `data-editor-entry-action-*` 临时目录，但只有目录名匹配的
owner marker、无活动锁、可信终态或已完成 recovery、已验证的进程身份，以及已验证的 fencing 释放
同时成立时，`src/service-finalizer.mjs` 才会将目录列入删除计划。符号链接或 junction、marker 不匹配、
活动锁、缺少任一证明，或 `failed_needs_recovery`，都会保留目录并给出跳过原因。

当前 legacy 产物尚不写入可供 finalizer 验证的 PID/FILETIME 与 fencing-release 证明；
`describeTempDirectory(...)` 因此将两项证明标为 `false`。这意味着现阶段 finalizer 对这类目录的
正确行为是保留，而不是从命令行、超时或缺失文件推断其可安全删除。

## 验证边界

批次 E 完成记录报告 E4 定向测试 13/13、相关回归 28/28 与 TypeScript 检查通过；全量
`open-stop` 组超过 120 秒时限，但其中的全局禁用入口用例已单独通过。它们支持本页所述的提交
合同，不替代将来重新启用入口所需的真实项目端到端验证与独立启用授权。

## 代码锚点

- `server.mjs`
- `src/file-service.mjs`
- `src/canonical-file-identity.mjs`
- `src/atomic-file.mjs`
- `src/job-supervisor.mjs`
- `src/fencing-lock.mjs`
- `src/entry-action-recovery.mjs`
- `src/entry-action-policy.mjs`
- `src/entry-action-authority.mjs`
- `src/entry-action-state.mjs`
- `src/entry-action-result-wait.ts`
- `src/entry-action-proposal.mjs`
- `src/entry-action-proposal-publisher.mjs`
- `src/document-commit-coordinator.mjs`
- `src/commit-journal.mjs`
- `src/document-commit-executor.mjs`
- `src/commit-journal-recovery.mjs`
- `src/entry-action-proposal-commit.mjs`
- `src/codex-runtime.mjs`
- `src/automation-profile.mjs`
- `src/entry-actions.mjs`
- `scripts/entry-action-recover.mjs`
- `scripts/service-finalize.mjs`
- `src/service-finalizer.mjs`
- `package.json`

## 关联决策

- [`adr/entry-actions-legacy-direct-write-hard-disable.md`](./adr/entry-actions-legacy-direct-write-hard-disable.md)
- 历史 direct-write 风险快照：[`entry-actions-same-source-concurrency-and-timeout-evidence-gap.md`](./entry-actions-same-source-concurrency-and-timeout-evidence-gap.md)

<!-- state: history -->
## 演进记录

<!-- dated: 2026-07-27 -->
### 批次 C authority 基础完成但入口继续禁用

writeback policy、profile version、Strict RowId 与 authority snapshot guard 已成为工具层事实；
它们不改变 legacy direct-write 禁用决定。后续启用仍须在独立范围内完成并获得授权。

<!-- dated: 2026-07-27 -->
### 批次 D 隔离 proposal 与真实 CLI E2E 完成

批次 D 将严格单字段 proposal、scratch-only 真实 CLI success / timeout、Job 树 timeout 证据和
fencing 释放验证为工具层事实。它没有接入正式写回；批次 E 的 coordinator、proposal commit、
journal 与恢复仍是未实施的后续计划。

<!-- dated: 2026-07-27 -->
### 批次 E 完成正式提交收敛，legacy 入口继续关闭

批次 E 将 `/api/save` 的严格 ETag、`canonicalFileKey` 提交互斥、稳定幂等重放与四阶段
commit journal 收敛为同一正式保存合同，并让 proposal commit 复用 journal executor。该推进
消除了“批次 E 尚未实施”的旧当前表述；但 proposal 服务没有接回 `/api/entry-actions/run`，因此
硬禁用决定保持有效。

<!-- dated: 2026-07-27 -->
### 批次 F 收敛状态诊断并将清理限制固定为 fail-closed

运行记录改用 `phase/outcome` 区分终态与观察超时，结果读取暴露产物可用性，并可按
`canonicalFileKey` 查询同物理文件的未终态运行。finalizer 同时开始识别 entry-action 临时目录；
由于旧生产者尚未提供进程与 fencing 释放证明，它保留这些目录而不进行推断式删除。该演进没有
恢复 legacy 入口。
