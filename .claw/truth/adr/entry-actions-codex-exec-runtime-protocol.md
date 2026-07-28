# entryActions 真实执行面固定为本机 codex exec

<!-- document-state: superseded -->

## context

`entryActions` 第二版的配置归属已经收口到 `automation profile + machine-local bindings`，但执行器本身仍需要一个稳定、可长期复用的运行时协议。

本轮完成的闭环把“能否执行”与“如何执行”进一步分离出来：

- 规则真值继续来自 `automation profile`
- 设备本地可用性继续来自 `machine-local bindings`
- 真正启动本机自动化的执行面，固定为本机 `codex exec`

这条 ADR 只沉淀执行链的长期边界，不重复配置模型和入口拆分本身。

## decision

### 1. 真实执行面固定为本机 `codex exec`

`run-entry-action` 后续不再停留在抽象包装器占位，也不再把执行面外包给前端直传命令。

服务端在接到动作请求后，应把 handoff 交给本机 `codex exec` 处理，作为唯一正式执行入口。

### 2. 运行时真值继续以 `automation profile + machine-local bindings` 为准

执行器只负责把已经通过配置层判定的动作真正跑起来，不重新引入项目级 `entryActions` 作为正式真值。

前端仍只传 `actionId`，是否可见、是否可执行、绑定到哪个 skill，继续由：

- `automation profile`
- `machine-local bindings`

共同决定。

### 3. 项目内 `.agents/skills` 需要由运行时解析

执行时不能只依赖全局技能目录；项目内 `.agents/skills` 也必须进入运行时解析范围。

这使得项目自带技能可以在当前工作区内被命中，而不要求用户把同名技能复制到全局环境。

### 4. 服务端主路径必须 `started` 即返，后台执行

`/api/entry-actions/run` 的语义固定为：

- 请求被接受后立即返回 `started`
- 真正的 `codex exec` 在后台继续执行

HTTP 主路径不承担真实 Codex skill 的运行时长，避免阻塞详情面板的交互响应。

### 5. prompt 交互改为 `stdin`

与 `codex exec` 的 prompt 交互固定走 `stdin`，不再把长 prompt 或多行内容塞进命令行参数。

这样可以避免平台差异、参数长度和 shell 转义带来的不稳定行为。

### 6. 执行时显式启用可写工作区

执行器必须显式启用 writable workspace，不把默认只读沙箱当成正式执行方式。

这是本轮执行链能真实落地的必要条件，尤其是涉及项目内技能与工作区写回时。

### 7. Windows 后台执行固定使用 `detached: true` 的 fire-and-forget spawn

Windows 下 `run-entry-action.mjs` 发起后台执行时，正式协议固定采用 `detached: true` 的 fire-and-forget `spawn` 方式。

服务端主请求在写出 `started` 后，不再等待子进程生命周期收尾；后台 runner 自行负责把 `started`、`result`、`reply` 等产物稳定落盘。

### 8. 前端结果观察必须采用两段式等待，而不是把 `started` 长尾直接判失败

既然正式协议已经固定为：

- `/api/entry-actions/run` 立即返回 `started`
- `result.json` 在 `codex exec` 结束并完成写回核对后才落盘

那么详情面板前端就不能把固定 60 秒内未拿到 `result.json` 直接解释成执行失败。

正式前端等待语义应固定为：

- 先做一段较短的前台等待
- 若仍为 `started`，切到后台继续轮询
- 只有真实 `failed` / `rejected` 或明确停止观察时才进入失败或警告语义

## consequences

- `run-entry-action` 从“写 started 记录”升级为“started 之后后台驱动本机 `codex exec`”。
- 项目内 `.agents/skills` 成为正式可解析来源，项目技能不再只能靠全局安装命中。
- 详情按钮的运行反馈继续保留最小面，但 `started` 只代表任务已进入后台，不代表最终结果已写回。
- `codex exec`、`stdin` 和 writable workspace 共同组成执行协议后，服务端主路径更稳定，但也更依赖本机 Codex 环境是否真实可用。
- 当前结果已分流为 `completed_with_writeback` / `completed_without_observed_writeback` 并附带 `writebackCheck`，但这些仍只是执行前后快照的观察证据，不能证明变化可唯一归因于当前 `runId`，也不能替代同源文件互斥、严格定位或受控提交门禁。当前缺口由 [`../entry-actions-same-source-concurrency-and-timeout-evidence-gap.md`](../entry-actions-same-source-concurrency-and-timeout-evidence-gap.md) 维护。
- Windows 运行时对父进程退出时机的依赖被进一步收窄，`run-entry-action.mjs` 可以把产物落盘职责完整交给后台 runner，减少 `started` 已返回但结果文件缺失的竞态。
- 前端详情状态与执行协议之间新增了一层长期合同：`started` 的长尾窗口是协议正常部分，不是默认失败信号；后续若调整等待窗口或结果提示，必须保留这条区分。

## related code

- `scripts/run-entry-action.mjs`
- `src/entry-actions.mjs`
- `src/codex-runtime.mjs`
- `server.mjs`
- `src/App.tsx`
- `src/entry-action-result-wait.ts`
- `src/automation-profile.mjs`
- `src/automation-bindings.mjs`

<!-- state: history -->
## Evolution history

<!-- dated: 2026-07-27 -->
### legacy direct-write 执行面已被硬禁用

当前 `POST /api/entry-actions/run` 固定拒绝新任务，因此本 ADR 的 writable runner 决定不再是
当前可执行协议。现行门禁与 pre-enable 安全边界由
[`entry-actions-legacy-direct-write-hard-disable.md`](./entry-actions-legacy-direct-write-hard-disable.md)
维护；未来是否采用新的执行面必须另行决策和授权。
