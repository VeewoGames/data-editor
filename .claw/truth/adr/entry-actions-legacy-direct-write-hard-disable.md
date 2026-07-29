# entry-action legacy direct-write 永久禁用与 proposal-only 启用边界

<!-- document-state: accepted -->

## Context

legacy entry-action 会启动可写工作区的 detached runner，且没有同源文件提交互斥或可证明的
恢复所有权。它不能在这些缺口仍存在时继续接收新任务。

## Decision

legacy direct-write 不再是可恢复或可配置的运行模式。`POST /api/entry-actions/run` 只允许进入
proposal-only service；环境变量、旧 handler、旧结果、前端开关或测试 fallback 都不得重新接回
可写工作区 runner。

proposal-only 的启用采用项目/action 显式 allowlist。项目必须声明
`protocolMode: "proposal-only"` 并列出 action；缺失、损坏或未列入的 action 继续返回
`ENTRY_ACTION_PROTOCOL_DISABLED`。profile 的 `enabled` 只决定界面与规则可见性，不能替代
eligibility、policy、authority 或 fencing admission。

受控写回采用收敛的 compound proposal，而不是任意跨文件事务：同一稳定 `rowId` 的
`changes[]` 加最多一个由 policy 模板推导的 Markdown `textArtifact`。JSON/CSV 与 Markdown
通过持久 group journal、确定性多目标锁和前向恢复形成可识别、可恢复的整体状态；不宣称文件系统级
瞬时原子性，也不自动回滚覆盖外部合法修改。

Data Editor 只拥有通用 proposal、policy、authority、supervisor、commit 与 recovery 机制。
项目字段、行级谓词、文本路径和 action eligibility 由项目配置与 repo-local Skill 持有，不得向
通用服务注入 Nocturnel 等项目专用语义。

通用配置不再提供 JSON `writableFields` 白名单或字段选择器。policy 只限定目标文件、集合、可选
行谓词与文本产物；单次 authority snapshot 把目标条目的全部现有字段交给具体 Skill，Skill 决定
实际修改哪些字段。Data Editor 仍负责禁止字段新增/删除、核对 before 值与条目身份，并执行
ETag、authority、fencing、journal 和恢复门禁。业务字段职责由 Skill 合同拥有，不能反向扩张为
绕过平台提交安全的任意写入权限。

## Alternatives

- 继续接受 legacy direct-write：拒绝，因为旧链路不能证明同源写入隔离或安全恢复。
- 只用环境变量或前端隐藏开关：拒绝，因为这会保留可绕过的服务端启动路径。
- 用单一全局开关恢复所有 action：拒绝。不同项目与 action 的 policy、authority 和安全成熟度
  不同，必须逐 action 显式 eligible。
- 支持任意文件列表的通用事务：拒绝。当前可复用需求可收敛为一个条目与一个受控 Markdown；
  任意目标会扩大 authority、恢复和审计面。
- 把 JSON 与 Markdown 拆成两个独立 action：拒绝。中途失败会产生无法归属于同一设计结果的
  长期半完成状态。
- 在通用 Automation Settings 中配置“允许写入字段”多选器：拒绝。它会让通用编辑器重复拥有
  项目业务字段职责，并使 profile、policy 与 Skill 形成三套易漂移的字段范围；当前边界由 target
  限定作用域、由具体 Skill 选择现有字段。
- 失败后自动回滚两个目标：拒绝。回滚可能覆盖 journal 之外的合法外部修改；无法证明安全时应
  停止并进入人工恢复。

## Consequences

- 未 eligible 的 action 在 API 边界失败关闭；历史结果读取不因此删除。
- eligible action 只能提交严格 proposal，Codex 不直接写 canonical 数据。
- policy/profile/row identity/ETag/fencing 任一漂移都会拒绝提交。
- 字段级业务范围不再由 profile/policy 配置；Skill 获得的是目标条目现有字段集合，平台仍拒绝
  新增/删除字段并保留全部并发与恢复门禁。
- group journal 增加了多阶段状态和恢复成本，但能让中断后的半完成状态可识别、可前向收敛。
- 无法证明当前内容属于 base 或已提交状态时保留 admission 并要求人工恢复，不猜测释放。
- 项目接入必须同时维护 eligibility、policy、profile、repo-local Skill 合同与项目合同测试。

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

<!-- dated: 2026-07-29 -->
### proposal-only 生产链获得按 action 启用授权

生产入口只保留 proposal-only service，legacy runner 与脚本被移除。启用单位从全局门禁收敛为
项目/action eligibility；严格 version 2 compound proposal、group journal、多目标锁和前向恢复
补齐了 JSON/CSV 与单一 Markdown 的受控整体提交。原“所有新任务固定 503”的决定退出当前状态，
但 legacy direct-write 永久禁用与未 eligible action 失败关闭继续有效。

<!-- dated: 2026-07-29 -->
### 通用字段白名单退出 authority 分工

曾接受的 policy 字段 allowlist 与类型 validator 被 policy v3 取代。当前决定把 JSON 业务字段
选择交还给具体 Skill，Data Editor 只拥有目标/行范围、既有字段约束和并发提交安全；这不会恢复
legacy direct-write，也不会允许 Skill 绕过 proposal schema 与 authority snapshot。
