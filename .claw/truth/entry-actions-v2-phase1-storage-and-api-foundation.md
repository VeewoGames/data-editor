# entryActions 第二版第一阶段：共享规则与本地绑定的存储/API 基础设施已落地

status: accepted

## context

这条 truth 只沉淀 `entryActions` 第二版第一阶段已经正式落地的实现态事实，不重复“为什么要转成双层个人化配置”的方向性判断。

当前代码已经把第二版的最小基础设施拆成两条独立真值链：

- 共享规则层：`automation profile`
- 设备本地绑定层：`automation bindings`

这轮实现仍然没有改动旧的 `run-entry-action` 执行真值，也没有移除 `Project Settings` 中的第一版 `entryActions`。因此这里记录的是“phase-1 基础设施已经存在”，而不是“第二版迁移已经完成”。

## 结论

### 1. 共享规则层已经有独立的一阶段正式存储形态

`automation profile` 已经不是 `UserViewProfile` 的附属字段，也不是临时挂在 `selectedViewProfile` 上的旁路状态。

当前正式结构是“每项目唯一一份”的 singleton profile，文件职责独立，且有专门的 `load/save/normalize` 帮助函数。后续校验收口后，读取和保存已经拆成两条语义：

- `loadAutomationProfile(...)` / `loadAutomationBindings(...)` 仍可宽松 `normalize`
- `saveAutomationProfile(...)` / `saveAutomationBindings(...)` 则走 `validateAutomationProfile(...)` / `validateAutomationBindings(...)`

- `src/automation-profile.mjs`
- `src/project-context.mjs`
- `server.mjs`

默认项目内路径是 `.data-editor/automation-profile.json`；当 `DATA_EDITOR_PROFILE_HOME` 存在时，profile 会改为落在 profile home 下按 `projectId` 分隔的目录中，而不是继续和 `UserViewProfile` 混存。

### 2. 设备本地绑定层已经和 `DATA_EDITOR_PROFILE_HOME` 明确硬分离

`automation bindings` 的正式文件路径已经固定为项目本地：

- `<project-root>/.data-editor/local/automation-bindings.json`

这条路径不跟随 `DATA_EDITOR_PROFILE_HOME` 迁移。即使共享规则层已经外置到 profile home，本地绑定仍然只落在当前项目目录下。

这一点的主锚点是：

- `src/project-context.mjs` 中 `localAutomationBindingsPath`
- `src/automation-bindings.mjs` 的 `saveAutomationBindings(...)`
- `tests/automation-bindings.test.mjs`
- `tests/open-stop.test.mjs`

因此，第二版第一阶段已经把“共享规则”和“设备本地绑定”做成真实的双路径存储，而不是同一个 profile home 下的两份配置。

### 3. 第一阶段服务端保存校验已经是正式协议的一部分

这轮不是简单透传 JSON。当前保存时已经通过显式 validate 层做正式拒绝规则，读取侧仍保留宽松 normalize：

`automation profile` 保存时会拒绝：

- 非法根结构
- 重复 `id`
- 不匹配 `/^[a-z0-9_-]+$/` 的 `id`
- 空 `label`
- 非法或不受支持的 `icon`
- 空的 `targets.files` 或 `targets.collections`

`automation bindings` 保存时会拒绝：

- 非法根结构
- 除 `provider`、`skill`、`enabled` 之外的额外字段
- 不受支持的 `provider`
- 空 `skill`
- 非 boolean 的 `enabled`

当前允许的 binding provider 只有 `codex`。

这说明 phase-1 的后端协议已经从“先落盘再说”收敛为“带 schema 约束的正式保存入口”。

### 4. 第二版第一阶段 API 面已经独立存在，且旧执行链暂未切换

服务端已经新增并接通四个正式接口：

- `GET /api/automation-profile`
- `POST /api/automation-profile`
- `GET /api/automation-bindings`
- `POST /api/automation-bindings`

对应前端 client 锚点在 `src/api/client.ts`，服务端入口在 `server.mjs`。

但这轮仍然保留第一版执行链：

- `POST /api/entry-actions/run` 仍从项目级 `entryActions` 取动作白名单
- `Project Settings` 里的旧 `entryActions` 编辑入口也仍然存在

因此，当前真实状态是“第二版存储/API 基础设施已落地，执行真值迁移尚未发生”。后续排障或需求评审时，不能把 phase-1 误判为已经完成旧链清理。

### 5. 自动化保存请求和 `saveViewProfile` 一样，当前都不再使用 `keepalive`

`src/api/client.ts` 里：

- `saveViewProfile(...)` 已改为直接 `POST /api/view-profile`
- `saveAutomationProfile(...)` 直接 `POST /api/automation-profile`
- `saveAutomationBindings(...)` 直接 `POST /api/automation-bindings`

这三条请求当前都不再带 `keepalive`。

`keepalive` 逻辑仍然只保留在 `saveSharedViews(...)` 这一类请求上，不再默认扩展到 profile autosave 或 automation save。

## 长期行为 / 规则

### 1. 看到 `automation profile` 时，默认按“独立用户自动化配置”理解，不要再把它当成 `UserViewProfile` 扩展位

如果后续排查第二版自动化配置丢失、路径漂移或 schema 变化，优先检查：

- `src/automation-profile.mjs`
- `src/project-context.mjs`
- `server.mjs` 的 `/api/automation-profile`

而不是先回头猜 `src/view-profile.mjs` 或 `selectedViewProfile` 流程。

### 2. 看到 `automation bindings` 时，默认按“当前机器正式本地文件”理解，不要再猜它会跟 profile home 走

排查当前设备为什么显示可执行按钮、为什么某台机器没有绑定时，优先检查项目内：

- `.data-editor/local/automation-bindings.json`

不要把 `DATA_EDITOR_PROFILE_HOME` 误当成 bindings 真值源。

### 3. phase-1 之后，不能把新 API 的存在误读成第二版执行链已切换完成

只要 `server.mjs` 中的 `handleRunEntryAction(...)` 仍然通过 `findEntryAction(project, body.actionId)` 读取项目级 `entryActions`，就说明旧执行真值仍在生效。

这时：

- 新的 profile/bindings API 属于基础设施已落地
- 旧的 `entryActions` 运行时链属于尚未清理的迁移前状态

## 关联代码

- `src/automation-profile.mjs`
- `src/automation-bindings.mjs`
- `src/project-context.mjs`
- `src/api/client.ts`
- `server.mjs`
- `tests/automation-profile.test.mjs`
- `tests/automation-bindings.test.mjs`
- `tests/api-client.test.mjs`
- `tests/open-stop.test.mjs`

## 验证标准

- `tests/automation-profile.test.mjs` 覆盖 profile 缺省值、宽松 normalize、规则 id 约束、重复 id 拒绝、profile home 落盘路径
- `tests/automation-bindings.test.mjs` 覆盖 bindings 缺省值、项目本地落盘路径、根结构校验、provider 白名单与 `enabled` 类型校验
- `tests/api-client.test.mjs` 覆盖 `saveViewProfile`、`saveAutomationProfile`、`saveAutomationBindings` 均不带 `keepalive`
- `tests/open-stop.test.mjs` 覆盖 server 真实读写 `automation profile` 与 machine-local bindings 的 API 闭环

## 关键检索词

- `automation-profile`
- `automation-bindings`
- `DATA_EDITOR_PROFILE_HOME`
- `localAutomationBindingsPath`
- `saveAutomationProfile`
- `saveAutomationBindings`
- `keepalive`
- `entryActions v2 phase 1`
