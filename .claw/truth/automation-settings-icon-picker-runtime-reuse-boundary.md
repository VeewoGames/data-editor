# Automation Settings 图标选择器：shared icon runtime 复用边界与单一状态源

status: accepted

## context

这条 truth 只沉淀 `Automation Settings` 图标选择器这一轮可复用的长期结论：自动化规则的 `icon` 不应演化成第二套 automation 专属图标系统，而应继续作为 shared icon runtime 的消费面。

范围只覆盖图标选择器的真值、共享状态、组件切口与 pack 保护边界，不扩展到后续 `Skill` 选择、刷新或校验任务。

## decision

### 1. 自动化规则图标继续复用 shared view 的合法值空间，不重开第二套 icon schema

`automationProfile.rules[].icon` 继续是自动化规则图标的唯一正式真值；其合法值仍由 `normalizeSharedViewIcon(...)` 约束，而不是引入 automation 专属 icon registry 或第二套白名单。

这意味着 `Automation Settings` 的图标需求本质上是 shared icon runtime 的第二个消费面，而不是新的图标语义分支。

### 2. `Automation Settings` 与 `ViewTabs` 必须共用同一套 picker 底座，而不是复制一份内联 JSX

长期可复用的正式切口是：

- 共享 picker 组件 / 状态层承担搜索、候选、收藏、最近与 pack 操作
- `ViewTabs` 只保留视图自身的 open state 与 icon 写回
- `Automation Settings` 只保留 rule-level `icon` 写回与表单布局

后续再出现“第二个界面也想接 shared icon picker”的需求，应优先走共享底座扩展，而不是在新界面复制 `ViewTabs` 里的交互实现。

### 3. 收藏 / 最近 / pack 加载状态在 `Automation Settings` 与 `ViewTabs` 中保持同源，不新增 automation 专属偏好配置

这一轮固定下来的长期 contract 是：

- 收藏继续来自当前 `selectedViewProfile.favoriteSharedViewIconIds`
- 最近继续来自 shared icon runtime 的 recent 存储
- pack 加载 / 卸载继续来自 shared icon runtime 与其持久化链路

因此，禁止新增以下第二份状态源：

- `automationFavoriteIconIds`
- `automationRecentIconIds`
- `automationLoadedIconPacks`

如果未来要把收藏语义升级成更中性的用户偏好，也应先升级 shared icon runtime 现有模型，而不是给 `Automation Settings` 单独开分支。

### 4. automation rules 对图标包的依赖也要进入同一套 pack 保护语义

shared icon runtime 的 pack 保护不能只看 shared views 当前正在使用的图标；`Automation Settings` 中各条 rule 已选的 `icon` 也必须通过同一套 helper 纳入受保护 pack 集合。

长期排障与实现上，应把“哪些 pack 因当前配置被占用”理解成统一问题，而不是拆成 shared view 一套、automation 一套。

## consequences

- 自动化规则图标的产品交互可以升级，但 `automationProfile.rules[].icon` 不应因图标选择器需求而改 schema。
- 任一消费面新增图标能力时，默认先查 shared picker / runtime 是否可扩展，而不是复制 UI 或重新保存偏好。
- `Automation Settings` 与 `ViewTabs` 之间若出现收藏、最近或 pack 加载状态不一致，应先按“同一状态源被绕开或被复制”排查。
- pack 卸载保护若只覆盖 shared views、不覆盖 automation rules，属于共享 runtime 保护边界回退。

## related code

- `src/automation-profile.mjs`
- `src/components/icons.ts`
- `src/components/SharedViewIconPicker.tsx`
- `src/components/ViewTabs.tsx`
- `src/App.tsx`
- `docs/plans/2026-07-08-Automation-Settings-图标选择器方案.md`
- `docs/plans/2026-07-08-Automation-Settings-图标选择器具体执行方案.md`

## search terms

`Automation Settings`、`SharedViewIconPicker`、`automationProfile.rules[].icon`、`normalizeSharedViewIcon`、`favoriteSharedViewIconIds`、`recent icons`、`loaded icon packs`、`collectProtectedIconPackIdsFromIcons`