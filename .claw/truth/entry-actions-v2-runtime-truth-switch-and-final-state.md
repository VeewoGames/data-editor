# entryActions 第二版运行时真值切换完成：详情按钮与服务端执行都已转向个人自动化

<!-- document-state: historical -->

<!-- state: history -->
## 历史运行时快照

<!-- dated: 2026-07-28 -->
### profile 与 binding 曾进入 legacy 执行链，但当前入口已硬禁用

本文保留的是 `automation profile + machine-local automation bindings` 接入 legacy
`handleRunEntryAction(...)` 前的运行时快照。当前 `POST /api/entry-actions/run` 在进入该 handler
前固定返回 HTTP 503 `ENTRY_ACTION_PROTOCOL_DISABLED`；其当前安全边界由
`entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md` 拥有。本文不能证明
该入口现可执行，也不能把 profile / binding 解释为绕过门禁的依据。

## context

这条 truth 只沉淀 `entryActions` 第二版在第二阶段之后的最终运行时实现态，不重复入口拆分、Automation Settings 编辑面或第一阶段存储/API 基础设施本身。

这里要固定的是：**运行时真值已经切到 `automation profile + machine-local automation bindings`**。旧的 `project.entryActions` 只剩迁移来源，不再是按钮可见性或执行调度的正式来源。

## 结论

### 1. 详情面板按钮的正式真值已经不再读取 `activeProject.entryActions`

当前详情面板是否展示 entry action，来自个人自动化配置而不是项目共享配置。

主链路在 `src/App.tsx`：

- `resolveVisibleEntryActions(...)` 读取 `automationProfileState`
- 再结合 `automationBindingsState` 过滤
- 最后把可见动作交给详情面板渲染

当前过滤条件已经收敛为四个运行时门槛：

- rule 命中 `selectedPath`
- rule 命中 `collectionPath`
- rule `enabled`
- binding 存在且 `enabled`
- binding `skill` 非空

换句话说，UI 上能看到的按钮，已经同时依赖共享规则层和本机执行绑定层，而不是项目级 `entryActions`。

### 2. 服务端 `POST /api/entry-actions/run` 也已经切到个人自动化真值

执行入口在 `server.mjs::handleRunEntryAction(...)`。

当前运行时顺序是：

- 读取 active project
- 构造 `projectContext`
- 加载 `automation profile`
- 加载 `automation bindings`
- 用 `findAutomationEntryAction(profile, body.actionId)` 找 rule
- 用 `resolveAutomationEntryActionBinding(bindings, action.id)` 找 binding
- 校验 `sourcePath` / `collectionPath` 目标命中
- 再构造 handoff 并执行 `scripts/run-entry-action.mjs`

这意味着服务端已经不再把 `project.entryActions` 当成正式白名单来源；它只保留在迁移入口里。

### 3. `handoff.action` 已正式携带 `binding.provider` 与 `binding.skill`

`src/entry-actions.mjs::buildEntryActionHandoff(...)` 现在会把 binding 写进 handoff：

- `action.binding.provider`
- `action.binding.skill`

这条字段链是运行时真值切换的关键证据：handoff 不再只表达“某个按钮被点了”，而是明确表达“这个按钮对应哪一个设备本地执行绑定”。

### 4. 旧 `project.entryActions` 现在只作为一次性迁移来源

当前保留的旧字段不是正式运行时依赖，而是导入来源。

`src/App.tsx` 里只有在以下条件同时满足时才会自动迁移：

- `automation profile` 为空
- 当前项目仍有旧 `project.entryActions`

迁移动作会把旧规则层导入到个人 `Automation Settings`，并提示用户为当前设备补全 `skill` 绑定。

这条逻辑的长期含义是：

- 旧字段不再承担 runtime 责任
- 旧字段也不应再被当成新链路的第二份正式真值
- 后续彻底删除 `ProjectDefinition.entryActions` 类型和 registry 持久化字段，属于后续收尾，不影响这条 truth 的成立

### 5. 当前实现的正式边界是“规则层 + 设备绑定层”，不是“项目级 entryActions”

现在真正决定按钮能否出现在详情面板、以及点击后能否跑起来的，是这两个层次：

- `automation profile` 负责规则和目标
- `automation bindings` 负责当前机器的执行技能绑定

项目级 `entryActions` 仍然存在于 registry 中，但它已经退回到迁移辅助角色。

## 长期行为 / 规则

### 1. 排查 runtime 问题时，优先看 automation profile 和 automation bindings

如果遇到“按钮不显示”“按钮显示但不可执行”“某台机器无法运行”的问题，默认顺序是：

- 先看 `automation profile` 的 rule 是否命中当前 `selectedPath` / `collectionPath`
- 再看本机 `automation bindings` 是否存在、启用且有 `skill`
- 最后才去看旧 `project.entryActions` 是否还在做迁移来源

### 2. `project.entryActions` 不应再被误判成正式执行真值

只要当前实现还保持：

- `resolveVisibleEntryActions(...)` 走 profile + bindings
- `handleRunEntryAction(...)` 走 profile + bindings

就说明项目级 `entryActions` 已经退出 runtime 主链。

### 3. 运行时切换完成不等于历史字段立刻消失

这轮完成的是“正式执行态切换”，不是“历史数据结构立刻删除”。

因此后续做清理时要区分：

- 正式运行时职责
- 迁移/导入历史职责
- registry 持久化中的残留字段

## 关联代码

- `src/App.tsx`
- `src/entry-actions.mjs`
- `src/automation-bindings.mjs`
- `server.mjs`
- `src/project-registry.mjs`
- `tests/data-editor.spec.ts`
- `tests/open-stop.test.mjs`

## 验证标准

- 详情面板按钮仅由 `automation profile + automation bindings` 决定
- `POST /api/entry-actions/run` 不再依赖 `project.entryActions`
- handoff 中能看到 `action.binding.provider` 和 `action.binding.skill`
- 当 `automation profile` 为空且项目仍有旧 `entryActions` 时，前端只做一次性迁移提示
- `npm run typecheck`、`node --test tests/open-stop.test.mjs` 和定向 Playwright 均已通过

## 关键检索词

- `resolveVisibleEntryActions`
- `handleRunEntryAction`
- `automation profile`
- `automation bindings`
- `binding.provider`
- `binding.skill`
- `handoff.action`
- `entryActions v2 runtime truth switch`
