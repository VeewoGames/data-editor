# entry-action legacy direct-write 协议的硬禁用与安全前置边界

<!-- document-state: accepted -->

## Context

legacy entry-action 会启动可写工作区的 detached runner，且没有同源文件提交互斥或可证明的
恢复所有权。它不能在这些缺口仍存在时继续接收新任务。

## Decision

`POST /api/entry-actions/run` 在服务端统一硬禁用，固定返回
`ENTRY_ACTION_PROTOCOL_DISABLED`。该决定优先于 profile、binding、环境变量和前端状态，直到
新的受控执行协议完整接入且获得独立启用授权。

在禁用期间，先建立可复用的安全前置层：canonical physical file identity、原子文件写入、
Windows Job Object ownership、持久 fencing 及 claim-first recovery。recovery 只接受
`project + runId`，并以完整持久证据决定是否释放；不得仅凭 PID、超时或缺失路径释放锁。

## Alternatives

- 继续接受 legacy direct-write：拒绝，因为旧链路不能证明同源写入隔离或安全恢复。
- 只用环境变量或前端隐藏开关：拒绝，因为这会保留可绕过的服务端启动路径。
- 在完成安全前置层后自动恢复入口：拒绝；pre-enable 基础不等于 proposal、handoff、受控提交
与真实项目写回已经实现或获授权。即使隔离 proposal 和真实 CLI scratch E2E 已完成，也不自动
改变这个结论。

## Consequences

- 新任务在 API 边界失败关闭；历史结果读取不因此删除。
- 后续恢复命令有明确的 inspect / recover 退出码与不可证明状态的保留规则。
- 批次 C 已完成工具层 writeback policy、profile ETag / `writableFields`、Strict RowId 与
  authority snapshot guard；本 ADR 不因此授予 proposal、handoff、真实项目写回或入口恢复的权限。
- 批次 D 已完成严格单字段 proposal、仅 scratch 的真实 Codex CLI success / timeout 与 Job / fencing
  证据；它不包含入口恢复。
- 批次 E 已完成 `/api/save` 的 `canonicalFileKey` 提交互斥、严格 ETag、稳定 `idempotencyKey`
  与四阶段 commit journal，并让 proposal commit 复用 journal executor。这些提交能力仍不授予
  `/api/entry-actions/run` 的启用权限。

<!-- state: history -->
## Evolution history

<!-- dated: 2026-07-27 -->
### 从 legacy 可写 runner 转为安全升级门禁

此前接受的本机 `codex exec` direct-write 执行面在运行时已被硬禁用；它的历史协议由
[`entry-actions-codex-exec-runtime-protocol.md`](./entry-actions-codex-exec-runtime-protocol.md)
保留。本 ADR 只拥有当前禁用与安全前置边界的决定。

<!-- dated: 2026-07-27 -->
### 批次 C 已完成，启用授权仍保持独立

批次 C 的 authority 基础已落地，但它没有连接到被禁用的 `POST /api/entry-actions/run`。因此
“C 待实施”的旧表述已退出当前决定；“不得自动启用”仍是本 ADR 的有效后果。

<!-- dated: 2026-07-27 -->
### 批次 D 的隔离执行证据不等于生产启用

proposal 只能在隔离目录发布，真实 CLI E2E 也只运行于 scratch fixture。保留硬禁用可避免把
测试面 success / timeout 证据误解为真实项目写回或生产提交通行证。

<!-- dated: 2026-07-27 -->
### 批次 E 补齐正式提交合同，启用决定仍保持独立

正式保存已采用文件级提交互斥、严格 ETag、幂等键和可恢复 journal，proposal commit 也复用
同一执行器。这些能力消除了“生产提交尚未实现”的前置缺口，但不改变本 ADR：新任务入口仍须在
完整运行时接入和独立授权后才能启用。
