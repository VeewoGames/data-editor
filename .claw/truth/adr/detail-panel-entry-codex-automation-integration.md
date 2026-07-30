# detail panel 条目级 Codex 自动化集成边界

<!-- document-state: superseded -->

## context

这条 ADR 记录的是条目级 Codex 自动化在方案阶段的初始集成判断。

其中一部分判断已经被后续正式实现替代，尤其是 `entryActions` 的维护入口与运行时承载位置。

当前长期方向应以 [`./entry-actions-user-local-personalized-configuration.md`](./entry-actions-user-local-personalized-configuration.md) 中的“双层个人化配置”决策为准。

## 初始集成阶段保留过的约束

以下内容只解释该 ADR 被替代前的集成边界；当前配置、执行与写回协议必须分别引用其 canonical
Truth 和后继 ADR，不能从本节恢复 legacy 实现。

### 1. 前后端协议使用 `actionId`，不直接暴露 `skillName`

前端发起动作时只传受控 `actionId`，不直接传任意 `skillName`。

后端维护 `actionId -> executor` 的稳定映射。

### 2. 服务端受控执行边界仍然存在

`DetailPanel` 不直接调用 Codex，而是通过服务端接口发起条目动作，由服务端负责：

- 校验动作是否存在
- 校验当前条目是否允许执行该动作
- 构造最小必要条目 payload
- 调用受控 executor / handoff 流程

### 3. MVP 阶段不做自动回写

第一版只要求：

- 展示条目动作按钮
- 发起受控自动化请求
- 返回 started / rejected / error 一类状态反馈

自动回写仍然留到后续阶段再做。

### 4. 条目动作运行状态与 `commandSaving` 分离仍然成立

条目级自动化运行状态不并入现有 `commandSaving`。

### 5. 详情面板关闭态必须彻底隐藏

未 `open` 的详情面板不得继续停留在视口中，哪怕按钮或容器已经不可交互，也不能留下可见的动作入口、边框或占位壳。

对条目级自动化来说，这不是纯样式问题，而是详情按钮可见性合同的一部分：只有当前真正打开的详情面板，才允许暴露 entry-action 入口和状态反馈。

### 6. `openDocumentAt` 自动 reload 不能清空当前详情面板的动作反馈

entry-action 完成后如果通过 `openDocumentAt` 触发自动 reload，前端仍需保留当前详情面板里刚生成的完成态或失败态反馈。

自动 reload 只能刷新文档内容和定位结果，不能把本轮动作的最近状态立即抹掉，否则用户会看到“动作刚结束就消失”的假阴性反馈。

## 已被后续实现替代的判断

### 1. `entryActions` 不进入 registry

这一条已经失效。

当前正式运行时真值就是现有 `project-registry -> server -> client` 链路中的 `entryActions`，并且 Project Settings 已经提供正式维护入口。

### 2. 当前轮次需要新增独立项目配置读取链

这一条也已失效。

当前已落地方案明确复用现有 `onSaveProject -> /api/project-update -> project-registry` 保存链，不新增第二套运行时真值源。

## superseded by

- `./entry-actions-user-local-personalized-configuration.md`

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
- `src/styles.css`
