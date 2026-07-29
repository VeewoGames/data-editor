# entry-action proposal-only 安全执行、组合提交与恢复边界

<!-- state: current -->
## 当前行为

### 生产入口只接受显式 eligible 的 proposal-only action

`server.mjs` 将 `POST /api/entry-actions/run` 交给 `src/entry-action-route.mjs`，该路由只调用
`startProposalOnlyEntryAction(...)`。项目必须提供 version 1 的
`.data-editor/entry-action-eligibility.json`，并同时满足
`protocolMode: "proposal-only"` 与 action allowlist；缺失、损坏或 action 未列入时返回
`ENTRY_ACTION_PROTOCOL_DISABLED`。

legacy direct-write runner 已从生产入口和脚本面移除；环境变量、旧 handler、旧结果文件或前端
状态都不能恢复该路径。历史运行结果仍可读取，但它们不构成新任务的执行资格或 fallback。

### proposal v2 只表达同一条目的既有字段与一个受控文本产物

`src/entry-action-proposal.mjs` 只接受严格 version 2 schema：

- `changes[]` 包含同一稳定 `rowId` 上 1 至 64 个互不重复的既有字段变更；
- `textArtifact` 为 `null`，或为一个完整的受控 Markdown 产物；
- proposal 绑定 `runId`、`actionId`、源路径、collection、`canonicalFileKey`、文档 ETag、
  profile ETag、authority digest 与 fencing token；
- 未知字段、字段新增/删除、no-op、任意文件列表、任意路径、删除、二进制或命令均被拒绝。

`src/entry-action-policy.mjs` 的 version 3 policy 定义精确 target、可选 `rowMatch`，以及由稳定
源字段推导的唯一 Markdown `pathTemplate`、create/update 权限和大小上限；它不再定义 JSON
字段白名单、字段类型或 validator。

`src/entry-action-authority.mjs` 在启动快照中把目标条目的全部现有字段记录为
`proposalContract.writableFields`，具体 Skill 决定实际提交其中哪些字段。提交锁内仍会重新检查
policy、profile、行身份、字段仍然存在、before 值、文本产物身份及所有并发令牌；新增/删除字段
或任一快照、目标范围与权限漂移都会失败关闭。

### JSON/CSV 与 Markdown 使用持久 group journal 前向收敛

`src/entry-action-group-commit.mjs` 对源文档与文本产物计算 canonical identity，按稳定顺序取得
多目标锁，并通过 `src/entry-action-group-journal.mjs` 持久记录：
`group_intent → artifact_committed → source_committed → verified → result_published`。
每个目标仍复用单文件 child journal、`atomicWrite(...)`、ETag/digest 与幂等提交能力。

该合同不宣称文件系统级瞬时原子事务。崩溃后，恢复器只在当前内容能证明处于 base 或已提交状态时
继续前向完成；外部漂移、身份不一致或证据不足会进入人工恢复边界，不自动回滚覆盖外部合法修改。
同一 `runId` 的幂等重放必须与原 group intent 一致。

### supervisor、fencing、结果发布与重启恢复属于同一生产编排

`src/job-supervisor.mjs` 为每次 launch 生成独立 UUID `jobInstanceId`，并使用 protocol v2
的 helper / child 双层 PID + FILETIME 身份证据。`src/fencing-lock.mjs` 按
`canonicalFileKey` 维护单调 fencing token、不可变 allocation ledger、tail anchor 与
admission owner；未知 schema、损坏、身份不一致或证据不完整均 fail closed。

`src/entry-action-service.mjs` 将 eligibility、policy/profile authority、fencing admission、
supervised Codex、proposal 发布、group commit 和终态结果发布串成生产链。服务启动时先恢复
未完成 group journal，再释放对应 fencing ownership；不能安全证明的恢复不会猜测放行。

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

前端关闭详情后会继续通过正式结果接口恢复运行状态；观察超时不等于 runner 终态。任何状态协议
更新都必须重启本地服务，确保服务端与前端装载同一 `phase/outcome` 合同。

## 验证边界

当前生产链已通过 Data Editor proposal-only 定向测试、Nocturnel owner 合同、typecheck、生产
构建与正式 Browser 写回验收。该证据只支持上述执行链与项目 owner 边界，不应扩张解释为整个
仓库的全量测试均通过。

## 代码锚点

- `server.mjs`
- `src/entry-action-route.mjs`
- `src/entry-action-service.mjs`
- `src/entry-action-eligibility.mjs`
- `src/job-supervisor.mjs`
- `src/fencing-lock.mjs`
- `src/entry-action-policy.mjs`
- `src/entry-action-authority.mjs`
- `src/entry-action-proposal.mjs`
- `src/entry-action-proposal-publisher.mjs`
- `src/entry-action-proposal-commit.mjs`
- `src/entry-action-group-commit.mjs`
- `src/entry-action-group-journal.mjs`
- `src/commit-journal.mjs`
- `src/document-commit-executor.mjs`
- `src/entry-action-state.mjs`
- `src/entry-action-result-wait.ts`
- `src/automation-profile.mjs`
- `src/entry-actions.mjs`
- `scripts/entry-action-recover.mjs`

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

<!-- dated: 2026-07-28 -->
### 本地陈旧服务曾导致已完成记录被显示为运行中

一次本地运行中，服务进程未装载已落地的 `phase/outcome` 读取归一化逻辑，只返回旧 `status`，
而新版前端按 `phase/outcome` 判断终态。重建并重启后，同一历史记录恢复为
`terminal/completed_without_changes`，界面不再显示“运行中”。该事件保留为协议升级后的服务
装载排障依据，不改变 legacy 新任务入口继续硬禁用的决定。

<!-- dated: 2026-07-29 -->
### 从全局禁用切换到 eligible proposal-only 生产链

生产入口移除了 legacy direct-write 并只接入 proposal-only service。proposal 从单字段 version 1
升级为同一条目 `changes[]` 加最多一个受控 Markdown 的 version 2；group journal、确定性多目标锁
与前向恢复进入正式编排。全局 503 因此不再是当前行为，但未列入项目 eligibility allowlist 的
action 仍以 `ENTRY_ACTION_PROTOCOL_DISABLED` 失败关闭。

<!-- dated: 2026-07-29 -->
### policy v3 移除通用字段白名单

旧 policy v2 曾用字段类型、validator 与 allowlist 限制 JSON 写回。当前 policy v3 只拥有目标、
行谓词和文本产物边界；单次 authority snapshot 将目标条目的现有字段提供给具体 Skill。平台仍
禁止字段新增/删除并执行完整并发提交门禁，但不再替项目或 Skill 决定现有字段中的业务修改范围。
