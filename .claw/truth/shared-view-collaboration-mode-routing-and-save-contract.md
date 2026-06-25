# shared view 个人模式 / 团队模式切换：现状、保存链路与复核结论

status: accepted

## context

这条 truth 记录 shared view 个人模式 / 团队模式切换相关的稳定事实、真实保存链路，以及本轮实施计划复核后识别出的长期约束。它不是实施承诺，也不展开具体改法。

## 结论

### 1. 当前 Toolbar 已包含协作模式设置区块

`src/components/Toolbar.tsx` 的设置浮框已经包含 shared view 协作模式区块，和主题、基础字号一起组成现有设置面。

该区块提供：

- `团队模式 / 个人模式` 切换按钮
- 个人模式禁用态
- 帮助文案
- 无命名 profile 时的 `需先选择或创建命名视图配置` 提示

### 2. 当前团队保存按钮位于搜索框右侧，并受模式与 draft 双重约束

团队保存按钮现在渲染在 `toolbar-search-actions`，即搜索框右侧的 icon-only 位置。

它的可见性和可用性由 `App.tsx` 的 `toolbarSnapshot` 控制：

- `sharedViewPublishVisible`
- `sharedViewPublishEnabled`

在 team mode 下，这两个值仍与 `hasViewDraft(currentSharedViewDraftState(), activeCollectionKey, activeSharedView.id)` 相关；在 personal mode 下会被显式抑制，因此不会因为 fallback draft 再次露出 `保存团队共享视图`。

### 3. 当前 shared view 编辑已经按模式分流

`src/App.tsx` 的 shared view 编辑路径已经按模式分流：

- team mode 仍保留 draft 持久化语义，普通编辑和结构拖拽继续经由 draft state 处理。
- personal mode 的内容编辑与结构拖拽改为直存正式配置，不再把常规编辑停留在 draft 作为主路径。

因此，shared view 的常规编辑语义已经从单一草稿态，变成了按模式分流的保存链路。

### 4. 当前显式发布团队共享视图时，会先把 draft 合并进正式配置

`src/App.tsx` 的 `handleSaveViewForEveryone()` 会先调用 `saveSharedViewDraftsToConfig(...)` 生成 `nextConfig`，然后再调用 `saveSharedViews(nextConfig, activeProjectId)`。

这条链路是当前团队模式显式发布的真实路径。

### 5. 当前已有可复用的结构 helper

下面两个 helper 已经存在，可直接作为 shared view 结构与草稿合并的基础能力：

- `saveSharedViewDraftsToConfig(...)`，位于 `src/view/view-state.mjs`
- `draftSharedViewStructure(...)` / `applyStructureDraftToConfig(...)`，位于 `src/view/shared-view-structure.mjs`

后续如果再处理 shared view 编辑保存语义，应优先沿这些既有 helper 追踪，而不是默认新增平行管线。

## 复核结论

### 6. 个人模式切换不能只迁移当前 collection 的 drafts

如果个人模式是项目级全局切换，那么切到个人模式时只处理当前 collection 的 drafts 不够。那样会残留跨 collection 的旧 drafts，和“全局模式切换”语义冲突。

### 7. 个人模式直存如果直接按 `sharedViewsConfig` 快照串行 POST，缺少 stale 写入控制

个人模式若走直存，但没有串行化或防 stale 写入控制，连续编辑时更容易丢状态。这与“强化个人视图保存稳定性”的目标不一致。

### 8. 团队保存按钮的显示条件必须显式改写

如果 personal mode 的失败回退仍可能产生 draft，而 `toolbarSnapshot` 还继续按 `hasViewDraft(...)` 计算按钮可见性，那么团队保存按钮可能重新出现。

因此，协作模式相关逻辑不能只改保存路径，按钮可见性条件也需要和新语义对齐。

### 9. personal mode 的 reset 语义当前还没有独立定义

在 personal mode 的直存失败降级链路中，`handleResetSharedViewDraft()` 现在会同时清空 `sharedViewDirectSavePending` 与 `sharedViewDirectSaveRetryRef`。因此，reset 已经承担了清理 fallback draft、pending 标记和 retry affordance 的联动语义，而不只是普通草稿清除。

## 阶段事实

### 10. 第一阶段已经把 profile 模型、归一化链路和最小 UI 契约接通

本阶段已确认以下稳定事实：

- `src/api/client.ts` 里的 `UserViewProfile` 已新增 `sharedViewCollaborationMode: "team" | "personal"`。
- `src/view-profile.mjs` 的 `emptyViewProfile()`、`normalizeViewProfile()`、`serializeViewProfile()` 已把该字段纳入 profile 持久化链路，默认值是 `team`，`loadViewProfile()` 可保留 `personal`，`saveViewProfile()` 会显式写出该字段。
- `src/App.tsx` 的 `emptyUserViewProfile()` 与 `normalizeUserViewProfile()` 已同步接入 `sharedViewCollaborationMode`，并且 `Toolbar snapshot` 已暴露 `sharedViewCollaborationMode`、`canUsePersonalSharedViewMode`、`sharedViewModeHelpText`。
- `src/components/Toolbar.tsx` 里已经存在协作模式区块和 `onChangeSharedViewCollaborationMode` 接线骨架。
- `node --test tests/view-profile.test.mjs tests/view-state.test.mjs` 已通过，说明 profile 模型与设置面板契约的第一阶段代码已经落地。

### 11. 第二阶段已经把模式切换、个人模式抑制保存按钮和 profile 落盘接通

本阶段已确认以下稳定事实：

- `src/components/Toolbar.tsx` 里的协作模式区块已经可见，提供“团队模式 / 个人模式”切换按钮、禁用态和帮助文案；无命名 profile 时，个人模式按钮禁用并显示“需先选择或创建命名视图配置”。
- `src/App.tsx` 的 `toolbarSnapshot` 已显式携带 `sharedViewCollaborationMode`、`canUsePersonalSharedViewMode`、`sharedViewModeHelpText`，并且 personal mode 下 `sharedViewPublishVisible` / `sharedViewPublishEnabled` 会被抑制，不再显示团队保存按钮。
- 模式切换时已接入 `publishCurrentSharedDraftsForModeSwitch()`：切到个人模式前，会遍历当前 profile draft state 中出现的 collection keys，按 collection 调用 `saveSharedViewDraftsToConfig(...)` 生成 `nextConfig`，再通过 `saveSharedViews(...)` 发布，然后清除对应 drafts。
- `sharedViewCollaborationMode` 切换后会立即通过 `commitProfileSave(...)` 持久化到命名 profile 文件，而不是只留在内存脏状态里等待通用 autosave。
- `node --test tests/view-profile.test.mjs tests/view-state.test.mjs` 已通过，并且 Playwright 用例 `shared view personal mode is disabled until a named profile is selected` 与 `switching from team mode to personal mode publishes current shared drafts before flipping mode` 已通过。

### 12. 第五阶段已经把 personal mode 直存、失败降级和 reset 联动接通

本阶段已确认以下稳定事实：

- `src/App.tsx` 新增了 `sharedViewDirectSavePending`、`sharedViewDirectSaveRetryRef`、`sharedViewsConfigRef`、`sharedViewDirectSaveQueueRef`，并通过 `enqueueSharedViewDirectSave(...)` 串行化 personal mode 的 shared view 正式配置写回。
- personal mode 下，普通 shared view 内容编辑仍经 `updateActiveViewDraft(...)` 入口触发，但会改走 `enqueueSharedViewDirectSave(...)`，直接更新 `shared-views.json`，而不是常态写 draft。
- personal mode 下，结构拖拽在 `handleReorderSharedViews(...)` 内改走 `draftSharedViewStructure(...) + applyStructureDraftToConfig(...) + enqueueSharedViewDirectSave(...)`，正式配置会直接落盘。
- Toolbar 的团队保存按钮显示条件已显式受模式约束；personal mode 下即使存在 fallback draft，也不会重新显示 `保存团队共享视图`。
- 直存失败时，前端固定反馈 `共享视图自动保存失败`，并保留当前 collection 的 fallback draft；设置面板里通过 `sharedViewDirectSaveRetryVisible` 暴露轻量 `重试共享视图保存` 入口。
- 如果 personal mode 后续有新的 shared view 直存成功，当前 collection 的 fallback draft 会被清理，避免出现失败后又成功但 dirty/reset 残留的半脏状态。
- `handleResetSharedViewDraft()` 现在会同时清空 `sharedViewDirectSavePending` 与 `sharedViewDirectSaveRetryRef`，因此 personal mode 下用 `重置` 清理 fallback draft 时，会一并移除 retry affordance。
- `node --test tests/view-profile.test.mjs tests/view-state.test.mjs` 已通过；Playwright 目标集 `shared view personal mode is disabled until a named profile is selected`、`switching from team mode to personal mode publishes current shared drafts before flipping mode`、`personal mode saves shared view structure reorders directly without surfacing publish buttons`、`personal mode direct save failure keeps publish hidden and reset clears pending retry state` 已通过。

## 关联代码

- `src/components/Toolbar.tsx`
- `src/App.tsx`
- `src/view/view-state.mjs`
- `src/view/shared-view-structure.mjs`

## 真实调用链路

- 现有团队保存：`toolbar-search-actions` -> `sharedViewPublishVisible/sharedViewPublishEnabled` -> `hasViewDraft(...)` -> `handleSaveViewForEveryone()` -> `saveSharedViewDraftsToConfig(...)` -> `saveSharedViews(...)`
- 现有普通编辑：`updateActiveViewDraft()` -> `updateSharedViewDraftState(...)` / `persistSharedDraftProfileState(...)`
- 现有结构编辑：`handleReorderSharedViews()` -> `draftSharedViewStructure(...)` -> `updateSharedViewDraftState(...)`

## 已知边界

- `team` 和 `personal` 仍共享同一套 shared view 数据模型与工具函数入口，差异主要体现在保存路径和按钮可见性上。
- `personal` 模式下的直存失败会保留 fallback draft，并通过 reset 清理 pending/retry 状态。
- `team` 模式仍保留显式发布语义，没有被 personal mode 的直存路径替代。

## 完成态

### 13. 最终完成态已经补齐文档与验证

本轮完成态已确认以下稳定事实：

- `docs/05_数据与配置模型.md` 已补 `sharedViewCollaborationMode`、team/personal 保存边界与 fallback draft 说明。
- `docs/07_校验与保存机制.md` 已补 shared view personal mode 的直存、pending/retry 和 reset cleanup 语义。
- `node --test tests/view-profile.test.mjs tests/view-state.test.mjs` 通过。
- 目标 Playwright 用例全部通过：
  - `shared view personal mode is disabled until a named profile is selected`
  - `switching from team mode to personal mode publishes current shared drafts before flipping mode`
  - `personal mode saves shared view structure reorders directly without surfacing publish buttons`
  - `personal mode direct save failure keeps publish hidden and reset clears pending retry state`
- `npm run typecheck` 通过。

### 14. 刷新后看似未保存时，优先排查正式服务进程是否陈旧

本轮排障确认：如果前端点个人模式时，`POST /api/view-profile` 的请求体已经带上 `sharedViewCollaborationMode: "personal"`，但随后同名 `GET /api/view-profile?name=<profile>` 仍然读不到该字段，刷新后 UI 又回到团队模式，优先怀疑运行中的正式服务进程还在加载旧版 `src/view-profile.mjs` 序列化逻辑。

可复用的判断顺序是：

- 先看前端是否已经发出带新字段的 `POST /api/view-profile`
- 再看随后同名 `GET /api/view-profile?name=<profile>` 是否真的读回该字段
- 如果前端 `dist` 已经包含新模式代码，但 GET 和写盘仍丢字段，就优先把问题归到后端 `node server.mjs` 进程陈旧，而不是前端静态资源未更新

修复层面的稳定动作是重启正式服务对应的后端进程后再复验，而不是只刷新页面。

## 关键检索词

`Theme settings`、`Base font size settings`、`toolbar-search-actions`、`sharedViewPublishVisible`、`sharedViewPublishEnabled`、`hasViewDraft`、`updateActiveViewDraft`、`handleReorderSharedViews`、`handleSaveViewForEveryone`、`saveSharedViewDraftsToConfig`、`draftSharedViewStructure`、`applyStructureDraftToConfig`
