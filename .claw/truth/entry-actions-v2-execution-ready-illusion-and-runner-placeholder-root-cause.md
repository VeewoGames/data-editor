# entryActions 第二版：绑定看起来已就绪但实际不执行的根因

status: superseded

## context

这条 truth 只沉淀 `entryActions` 第二版里一个可复用的长期排障事实：**Automation Settings 顶部出现“绑定就绪”并不等于本机真的具备可执行自动化能力**。

它不重复第二版为什么转向双层个人化配置，也不重复存储/API 基础设施本身。这里固定的是：前端和后端已经切到 `automation profile + machine-local bindings`，但真实执行器仍然没有接上本机 Codex/skill。

这条 truth 现在只保留历史根因语义；当前已接通的真实执行链与新的回写核对边界，见 [`./entry-actions-v2-codex-local-exec-chain-and-writeback-verification.md`](./entry-actions-v2-codex-local-exec-chain-and-writeback-verification.md)。

## 结论

### 1. “绑定就绪”只代表结构校验通过，不代表 skill 真实可用

`src/App.tsx::validateAutomationSettings(...)` 里对启用中的 rule 只做了静态检查：

- `binding` 是否存在
- `binding.provider` 是否为 `codex`
- `binding.skill` 是否非空

`src/App.tsx::resolveVisibleEntryActions(...)` 也只是用同一套结构条件决定按钮是否可见：

- rule 命中当前 `selectedPath`
- rule 命中当前 `collectionPath`
- rule 处于启用状态
- binding 存在、启用且 `skill` 非空

因此，UI 上看到的“绑定就绪”只能说明当前配置结构完整，不能证明这个 `skill` 在本机上真的能启动 Codex、找到目标 skill，或完成实际自动化执行。

### 2. 真实失效根因在 `scripts/run-entry-action.mjs` 还是占位实现

服务端入口 `server.mjs::handleRunEntryAction(...)` 已经把请求送进 `scripts/run-entry-action.mjs`，但这个脚本当前只做了一件事：

- 读取 handoff
- 写出 `<runId>.started.json`
- 把 `status` 固定成 `started`

它没有真正调用本机 Codex，也没有调用实际 skill，更没有把 handoff 转成可执行的自动化动作。

这才是“看起来已就绪，但点击后没有真正自动化执行”的真实根因。

### 3. 当前用户看到的假象来自“前端结构就绪”与“执行器未接通”之间的断层

这条链路现在会制造一种稳定假象：

- 前端保存后，规则和 binding 能通过静态校验
- `Automation Settings` 顶部会显示 binding 已存在、skill 非空
- 详情按钮也会按 profile + bindings 逻辑正常出现
- 但点击后只会走到 `started` 记录，不会产生真实自动化结果

所以，后续排查时不能把“按钮出现了”或“binding 显示就绪”当作执行成功证据。

### 4. 这个问题的判断边界必须落在执行器，而不是 UI

如果用户反馈“规则看起来已经就绪，但点了没反应”，优先检查顺序应是：

1. `scripts/run-entry-action.mjs` 是否还是占位实现
2. `server.mjs::handleRunEntryAction(...)` 是否只是把 handoff 送给占位脚本
3. `src/App.tsx::validateAutomationSettings(...)` / `resolveVisibleEntryActions(...)` 是否只是做了结构性 ready 判断

不要把这个问题误判成 rule 过滤、binding 缺失，或者前端按钮渲染失败。

## 长期规则

### 1. `binding.skill` 非空不是执行能力证明

后续任何关于 entry action 的状态文案、summary chip、validation issue 或提示文案，只要只是检查 `skill` 字段是否存在，都只能叫“结构就绪”，不能叫“真实可执行”。

### 2. 排障时要区分“可见性真值”和“执行真值”

这条链路现在有两个层次：

- `resolveVisibleEntryActions(...)` 决定按钮是否可见
- `scripts/run-entry-action.mjs` 决定点击后是否真的执行

前者已经按 `automation profile + machine-local bindings` 收口，后者仍是占位实现。两者不能混为一谈。

### 3. 只要 runner 还是占位实现，就不能把 `started` 当成自动化完成

`POST /api/entry-actions/run` 返回 `started` 只说明 handoff 被写入并进入启动态，不说明 Codex 或 skill 真正执行成功。

## 关联代码

- `scripts/run-entry-action.mjs`
- `server.mjs::handleRunEntryAction(...)`
- `src/App.tsx::validateAutomationSettings(...)`
- `src/App.tsx::resolveVisibleEntryActions(...)`
- `src/entry-actions.mjs`

## 关键检索词

- `binding ready`
- `started.json`
- `run-entry-action`
- `resolveVisibleEntryActions`
- `validateAutomationSettings`
- `automation profile + machine-local bindings`
