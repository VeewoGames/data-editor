# detail panel 条目级 Codex 自动化集成边界

status: superseded

## context

这条 ADR 记录的是条目级 Codex 自动化在方案阶段的初始集成判断。

其中一部分判断已经被后续正式实现替代，尤其是 `entryActions` 的维护入口与运行时承载位置。

当前现状应以 [`../detail-panel-entry-codex-automation-boundary.md`](../detail-panel-entry-codex-automation-boundary.md) 为准。

## 仍然有效的决策

### 1. 前后端协议使用 `actionId`，不直接暴露 `skillName`

前端发起动作时只传受控 `actionId`，不直接传任意 `skillName`。

后端维护 `actionId -> executor` 的稳定映射。

### 2. 服务端受控执行边界仍然存在

`DetailPanel` 不直接调用 Codex，而是通过服务端接口发起条目动作，由服务端负责：

- 校验动作是否存在
- 校验当前条目是否允许执行该动作
- 构造最小必要条目 payload
- 调用受控 executor / handoff 流程

### 3. MVP 不做自动回写仍然成立

第一版只要求：

- 展示条目动作按钮
- 发起受控自动化请求
- 返回 started / rejected / error 一类状态反馈

自动回写仍然留到后续阶段再做。

### 4. 条目动作运行状态与 `commandSaving` 分离仍然成立

条目级自动化运行状态不并入现有 `commandSaving`。

## 已被后续实现替代的判断

### 1. `entryActions` 不进入 registry

这一条已经失效。

当前正式运行时真值就是现有 `project-registry -> server -> client` 链路中的 `entryActions`，并且 Project Settings 已经提供正式维护入口。

### 2. 当前轮次需要新增独立项目配置读取链

这一条也已失效。

当前已落地方案明确复用现有 `onSaveProject -> /api/project-update -> project-registry` 保存链，不新增第二套运行时真值源。

## superseded by

- `../detail-panel-entry-codex-automation-boundary.md`

## related code

- `src/detail/DetailPanel.tsx`
- `src/App.tsx`
- `server.mjs`
- `src/entry-actions.mjs`
- `src/project-registry.mjs`
- `src/api/client.ts`
- `scripts/run-entry-action.mjs`
- `docs/plans/2026-07-01-详情面板条目级Codex自动化方案.md`
- `docs/plans/2026-07-01-详情面板条目级Codex自动化执行方案.md`
