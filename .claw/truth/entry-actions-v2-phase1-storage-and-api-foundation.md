# entryActions 第二版第一阶段：共享规则与本地绑定的存储/API 基础设施已落地

<!-- state: current -->
## 当前行为

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

### 4. profile 保存使用内容 ETag，规则 target 必须声明可写字段

`loadAutomationProfile(...)` 返回由 profile 内容计算的 `etag`；
`saveAutomationProfile(..., expectedEtag)` 按同一 profile 路径串行 compare-and-save。陈旧 ETag
会以 `AUTOMATION_PROFILE_ETAG_STALE` 拒绝，HTTP 保存接口映射为 409。

每个 target 现在还必须有非空 `writableFields`。读取旧 profile 时缺失该字段会归一化为空数组，
并使规则失去启用资格；新保存显式提交空字段列表则被拒绝。profile 只能表达候选可写字段，
实际写回仍必须同时通过 project-scoped policy 的最大权限校验。

### 5. 第二版第一阶段 API 面已经独立存在，legacy 执行链当前不可达

服务端已经新增并接通四个正式接口：

- `GET /api/automation-profile`
- `POST /api/automation-profile`
- `GET /api/automation-bindings`
- `POST /api/automation-bindings`

对应前端 client 锚点在 `src/api/client.ts`，服务端入口在 `server.mjs`。

仓库仍保留旧执行 handler 与项目级 `entryActions` 的历史实现，但它不再是当前可执行路径：

- `server.mjs::handleRunEntryAction(...)` 的旧实现仍会读取项目级 `entryActions`
- `POST /api/entry-actions/run` 的当前运行时门禁由
  [`entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md`](./entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md)
  统一维护
- `Project Settings` 里的旧 `entryActions` 编辑入口仍然存在

因此，当前真实状态是“第二版存储/API 基础设施已落地，执行真值迁移尚未发生”。当前
`POST /api/entry-actions/run` 的具体禁用合同由上述 canonical Truth 维护；不能把 profile API、ETag
或 `writableFields` 误判为入口已经恢复。

### 6. 自动化保存请求和 `saveViewProfile` 一样，当前都不再使用 `keepalive`

`src/api/client.ts` 里：

- `saveViewProfile(...)` 已改为直接 `POST /api/view-profile`
- `saveAutomationProfile(...)` 直接 `POST /api/automation-profile`
- `saveAutomationBindings(...)` 直接 `POST /api/automation-bindings`

这三条请求当前都不再带 `keepalive`。

`keepalive` 逻辑仍然只保留在 `saveSharedViews(...)` 这一类请求上，不再默认扩展到 profile autosave 或 automation save。

## 长期行为 / 规则

### 1. profile 更新必须携带并保留服务端 ETag

客户端在读取后保存 profile 时必须回传当前 ETag；收到
`AUTOMATION_PROFILE_ETAG_STALE` 后应重新读取，而不是用陈旧内容覆盖。规则未声明非空
`writableFields` 时不得被视为可启用。

### 2. 看到 `automation profile` 时，默认按“独立用户自动化配置”理解，不要再把它当成 `UserViewProfile` 扩展位

如果后续排查第二版自动化配置丢失、路径漂移或 schema 变化，优先检查：

- `src/automation-profile.mjs`
- `src/project-context.mjs`
- `server.mjs` 的 `/api/automation-profile`

而不是先回头猜 `src/view-profile.mjs` 或 `selectedViewProfile` 流程。

### 3. 看到 `automation bindings` 时，默认按“当前机器正式本地文件”理解，不要再猜它会跟 profile home 走

排查当前设备为什么显示可执行按钮、为什么某台机器没有绑定时，优先检查项目内：

- `.data-editor/local/automation-bindings.json`

不要把 `DATA_EDITOR_PROFILE_HOME` 误当成 bindings 真值源。

### 4. 不能把 dormant legacy handler、profile ETag、`writableFields` 或新 API 误读为入口已恢复

`server.mjs::handleRunEntryAction(...)` 仍保留历史实现，不等于旧执行真值正在生效；当前 API 门禁
的行为与代码锚点见上述 canonical Truth。

这时：

- 新的 profile/bindings API、ETag 和 `writableFields` 属于受控执行的基础设施
- 新任务入口的禁用合同由上述 canonical Truth 维护

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
- `AUTOMATION_PROFILE_ETAG_STALE`
- `writableFields`

<!-- state: history -->
## 演进记录

<!-- dated: 2026-07-27 -->
### profile 版本与可写字段门禁完成

phase-1 初始 API 只提供 schema 保存边界。当前 ETag compare-and-save 与 `writableFields` 资格
门禁已补齐；它们仍不改变新任务入口的禁用状态。
