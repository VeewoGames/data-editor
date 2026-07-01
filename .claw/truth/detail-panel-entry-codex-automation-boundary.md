# detail panel 条目级 Codex 自动化：正式维护入口与稳定运行边界

status: accepted

## context

这条 truth 记录 `data-editor` 中条目级 `entryActions` 的正式维护入口、运行时真值链路和 UI 可见性边界。

它只保留长期可复用的稳定事实，不记录单次实施过程。

## 结论

### 1. `entryActions` 的正式维护入口已经进入 Project Settings

当前项目的 `entryActions` 由 Project Settings 对话框直接维护，前端编辑格式是 JSON 数组文本。

主要锚点：

- `src/App.tsx`
  - `serializeEntryActions(...)`
  - `parseEntryActionsText(...)`
  - `renderEntryActionSummary(...)`
  - `ProjectSettingsDialog`

这意味着条目动作配置已经不再只是“后端可读的隐藏字段”，而是有正式 UI 入口的项目设置项。

### 2. 保存链必须复用现有项目设置保存链，不能绕过 registry 校验

Project Settings 中保存 `entryActions` 时，稳定链路是：

`ProjectSettingsDialog.saveCurrentProject()`  
`-> props.onSaveProject(...)`  
`-> src/App.tsx::saveProjectSettings(...)`  
`-> src/api/client.ts::updateProject(...)`  
`-> POST /api/project-update`  
`-> server.mjs::handleUpdateProject(...)`  
`-> src/project-registry.mjs`

因此，`entryActions` 的正式运行时真值当前就在现有 `project-registry -> server -> client` 链路中，且继续受 `normalizeEntryActions(...)` 与 registry 校验约束。

### 3. 当前版本没有新增第二套项目真值源

在这条已落地链路里，`entryActions` 没有切到独立的 `data-editor.project.json` 真值源，也没有绕开现有项目注册模型。

对后续代理来说，这意味着：

- 如果要查“当前运行中的项目动作配置从哪里来”，先看 `src/project-registry.mjs`
- 如果要查“前端保存入口在哪里”，先看 `ProjectSettingsDialog` 与 `saveProjectSettings(...)`
- 不要把 `data-editor.project.json` 当成当前运行时 `entryActions` 的正式来源

### 4. 详情面板按钮显示由当前项目配置和当前条目目标共同决定

`src/App.tsx` 中的 `visibleEntryActions` 会从当前活动项目的 `entryActions` 里筛出同时命中：

- `targets.files`
- `targets.collections`

的动作，再通过 `detailSnapshot` 传给 `src/detail/DetailPanel.tsx`。

因此，详情面板右上角动作按钮是否可见，不是静态 UI 开关，而是当前项目配置与当前条目位置共同作用的结果。

### 5. 详情面板动作执行边界仍然是受控 `actionId` 与服务端 handoff 流程

前端继续只暴露 `actionId`，不直接暴露任意 `skillName` 或执行命令。

当前稳定执行边界是：

- `src/detail/DetailPanel.tsx` 渲染按钮并触发动作
- `src/App.tsx::handleRunDetailEntryAction(...)` 发起请求并维护 `entryActionRunningId`
- 服务端根据项目 `entryActions` 白名单解析动作
- `src/entry-actions.mjs` 生成 handoff 文件与 started 记录
- `scripts/run-entry-action.mjs` 消费 handoff

所以，这轮落地补的是“正式维护入口进入项目设置”，不是改写 executor 架构。

### 6. Project Settings 弹窗的可保存性已经成为这类扩展的固定 UI 约束

因为项目设置内容会继续增长，`project-settings-dialog` 现在需要依赖专用布局规则保证底部操作区始终可达：

- `src/styles.css`
  - `.project-settings-dialog`
  - `.project-settings-dialog .dialog-actions`

当前稳定约束是：

- 对话框本体负责 `max-height` 与 `overflow-y`
- 底部 `dialog-actions` 通过 `position: sticky` 固定在可视区域底部

后续再往 Project Settings 增加长表单时，应优先复用这套约束，而不是回退到通用弹窗尺寸。

## 验证标准

满足以下条件时，可认为这条链路仍然成立：

- Project Settings 能保存合法 `entryActions`
- `/api/projects` 能回显保存后的 `entryActions`
- 详情面板右上角能按目标过滤显示动作按钮
- 点击动作按钮后，服务端 handoff 文件流程仍然真实触发

## 关联代码

- `src/App.tsx`
- `src/detail/DetailPanel.tsx`
- `src/api/client.ts`
- `src/project-registry.mjs`
- `src/entry-actions.mjs`
- `server.mjs`
- `scripts/run-entry-action.mjs`
- `src/styles.css`
- `tests/project-registry.test.mjs`
- `tests/data-editor.spec.ts`
- `tests/open-stop.test.mjs`

## 关键检索词

- `entryActions`
- `Project Settings`
- `project-update`
- `project-registry`
- `visibleEntryActions`
- `run-entry-action`
- `project-settings-dialog`
