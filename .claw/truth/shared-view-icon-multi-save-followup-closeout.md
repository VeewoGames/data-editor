# shared view 图标多轮保存 follow-up：剩余真实根因、当前验证边界与复现收口

status: accepted

## context

这条 truth 记录“继续排查 shared view 图标在多轮操作后仍会丢失的问题”这一轮 follow-up 的稳定事实。它不重复更早的图标体系方案，而是把这轮实际确认的剩余丢字段链、已经补上的持久化边界、以及当前本地仍未复现出来的部分统一收口，供后续继续排查时复用。

## 结论

### 1. 本轮确认的剩余真实根因不是单一路径，而是多条 icon 丢字段链叠加

这轮继续排查后，确认 shared view 图标“多轮操作后丢失”至少包含以下几条已经落地修复的真实链路：

- `src/view/view-state.mjs` 的 `deleteViewFromItems(...)` 在删除 top-level view 后重建剩余 items 时，没有保留其它 top-level leaf 的 `icon`。
- `src/App.tsx` 的 `handleDuplicateSharedViewGroup(...)` 在复制 group 时，`resolvedGroupSnapshot` 曾经缺少 `group.icon`，导致副本组先天丢 icon。
- `src/App.tsx` 的 `normalizeUserViewProfile(...)` 在序列化命名 profile 的 `structureDrafts` 时，group 项只保留了 `groupId`、`name`、`viewIds`，会把 `icon` 静默丢掉。
- 此前已确认并保留的链路还包括 top-level view rename 未保留 `item.icon`，以及 profile save 请求需要 `keepalive` 才能降低刷新/离页时保存丢失概率。

可复用的判断是：这类问题不是单一“保存请求没发出去”，而是多个结构重建 / normalize / duplicate / delete 入口分别把 `icon` 当成非关键字段漏掉。

### 2. shared view 的顶层 view / group icon 现在必须视为 first-class persisted field

这轮之后，顶层 view icon 和 group icon 不能再被当成“渲染时可推导元信息”。当前稳定要求是：

- collection items 重建时必须显式带回 leaf `icon`
- group duplicate 时必须显式复制 `group.icon`
- 命名 profile 的 `structureDrafts` 落盘与回读时必须保留 group `icon`
- path migration、本地 drafts、profile 文件都要把 group `icon` 当成 schema 内稳定字段

也就是说，icon 现在和 `groupId`、`viewIds`、`name` 一样，属于结构真值的一部分，而不是 UI 装饰字段。

### 3. team mode 与 personal mode 当前都已有稳定保存边界，但语义不同

当前 shared view 编辑仍按模式分流：

- `team mode`：普通编辑与结构拖拽先进入 draft / structure draft，再通过显式 `保存团队共享视图` 发布到正式 shared config。
- `personal mode`：普通 shared view 编辑与结构拖拽直存正式 shared config，不再常态停留在团队 draft 语义里。

本轮补强后，当前本地已验证以下组合不会把 icon 再打回旧值：

- `team mode` 下 top-level view 先带 icon，再做 filter 修改并发布，再刷新
- `team mode` 下 top-level view reorder 并发布，再刷新
- `team mode` 下命名 profile 的 structure draft 对 top-level group reorder 落盘后，刷新仍保留 group icon
- `personal mode` 下 top-level view 先加 filter，再做 reorder，直存 shared config 后刷新仍保留 icon

这说明当前本地证据下，常规的筛选 / 重排 / 发布 / 刷新组合已经被 team 与 personal 两条主路径覆盖。

### 4. Chrome 真实现场最终补出了一条剩余链路：personal mode 的直接保存会读到旧 `sharedViewsConfigRef`

后续按用户要求改用真实 Chrome 现场验证后，这轮最终补出了一条此前没有锁定的剩余链路：

- 先在第一层 top-level view 上修改 icon；
- icon 保存请求先成功，把新值写进 `shared-views.json`；
- 紧接着在 `personal mode` 下拖动该顶层视图位置；
- 结构重排走 `enqueueSharedViewDirectSave(...)`，但它读取的是 `sharedViewsConfigRef.current`；
- 旧实现里这个 ref 只靠 `useEffect` 在下一拍同步，所以“刚改完 icon 又立刻重排”时，第二次保存可能仍拿到旧配置；
- 结果是重排保存把刚写入的新 icon 覆盖回旧值，刷新后 UI 看起来像“移动位置导致图标丢失”。

这条链路和前面那些“结构重建时漏带 `icon` 字段”的问题不同。它不是字段在 helper 里被丢掉，而是连续两次保存之间存在 stale snapshot 覆盖。

### 5. 这次 Chrome 复现证明：要排查“刷新后丢图标”，必须区分“字段没写”与“后写回旧值”

这一轮的最终稳定结论是，shared view icon 丢失至少分成两类：

- 结构重建 / normalize / duplicate / delete 时没有携带 `icon`
- 连续保存时，后一次保存读到旧快照，把前一次刚写入的新 icon 覆盖掉

第二类只有在真实交互节奏里才容易露出来。单看某一次保存成功，不能证明最终刷新后的持久化真值仍然正确。

## 长期规则

### 5. 后续排查必须先按保存入口拆解，不要把所有“刷新后丢图标”混成一个 bug

本轮的有效方法是按入口拆解：

- direct save
- publish draft
- structure reorder
- duplicate
- rename / delete
- profile normalize / serialize

后续再遇到类似反馈，应优先先回答“是哪条保存入口回写了旧值”，而不是先假设是网络波动或同一个 helper 的问题。

### 6. 命名 profile 是这类问题的高风险层，任何结构字段都不能只在 shared config 保留

只要某个 shared view 结构字段还会进入命名 profile 的 `structureDrafts`、`viewDrafts`、`viewLayouts` 或相关迁移链，它就必须在 profile normalize / serialize / migrate 层被完整保留。否则共享配置本身正确，profile 仍可能在刷新后把旧字段覆盖回来。

### 7. 未来仍报“多轮操作后丢失”时，最小必需复现信息必须先拿到

下一轮最该优先补的不是新猜测，而是用户最小操作序列。至少需要确认：

- 当前是 `team mode` 还是 `personal mode`
- 丢的是 top-level view icon、top-level group icon，还是 group 内 leaf icon
- 操作前是否刚改过 icon
- 后续动作具体是什么：filter、sort、rename、delete、duplicate、top-level reorder、group 内拖拽、模式切换、publish、direct save、refresh
- icon 是在“本次页面内立即消失”，还是“刷新后才消失”
- 如果是 team mode，丢失发生在发布前还是发布后

没有这些信息时，继续扩大修复范围的收益会明显下降。

## 验证边界

### 8. 本轮已经补上的自动化覆盖

当前与这轮问题直接相关、已经补齐或扩展的验证包括：

- `tests/view-state.test.mjs`
  - `renameSharedViewConfig keeps top-level view icons`
  - `deleteSharedViewConfig keeps remaining top-level view icons`
  - `normalizeUserViewProfile keeps structure draft group icons`
- `tests/view-state-storage.test.mjs`
  - `readLocalSharedViewDrafts keeps shared view structure draft payload`
  - `writeLocalSharedViewDrafts keeps structure draft group icons`
- `tests/view-profile.test.mjs`
  - `saveViewProfile writes normalized profile file`
  - `loadViewProfile preserves structure draft group icons`
- `tests/path-migration.test.mjs`
  - `rewriteSharedDraftState migrates structureDrafts collection keys together with other shared draft surfaces`
- `tests/data-editor.spec.ts`
  - `saving grouped view filters keeps top-level group icon`
  - `duplicating a view group copies child view snapshots and the current user's local view layout without creating a dirty target draft`
  - `personal mode saves shared view structure reorders directly without surfacing publish buttons`
  - `personal mode keeps a newly changed top-level icon after immediate reorder and reload`
  - `named profile team-mode structure drafts keep top-level group icon through reload`
  - `named profile keeps top-level view icon through team publish and reload`
  - `named profile team-mode top-level view reorder keeps icon through reload`

### 9. Chrome 真实复现与文件层取证的最小契约

这轮最终在真实 Chrome 中稳定确认的最小契约是：

1. 在正式页面 `http://127.0.0.1:8787/` 打开 `data/skills.json`
2. 切到命名 profile `Lans`
3. 在 `personal mode` 下给第一层 top-level view 修改 icon
4. 立即拖动该 top-level view 的位置
5. 刷新页面

文件层真相源需要同时看两步：

- 第一次 icon 更新后，`C:\Code\Nocturnel\.data-editor\shared-views.json` 已经先写入新 icon
- 第二次结构重排保存后，同一个文件又被旧快照覆盖回旧 icon

因此，真实现场里“刷新后丢图标”的本质不是 refresh 自己丢字段，而是 refresh 读到了上一轮交互已经写坏的正式 shared config。

### 10. 本轮修复入口

当前修复入口已经收敛到 `src/App.tsx`：

- 新增 `commitSharedViewsConfig(...)`
- 所有 shared views config 成功保存后的状态提交都要同时同步 `sharedViewsConfigRef.current` 与 React state
- 这样 `enqueueSharedViewDirectSave(...)` 在紧随其后的下一次保存里不会再读到旧 `sharedViewsConfigRef`

这条入口对应的是保存时序一致性，而不是结构 schema 扩展。

## 关联代码

- `src/App.tsx`
- `src/App.tsx#commitSharedViewsConfig`
- `src/api/client.ts`
- `src/view/view-state.mjs`
- `tests/view-state.test.mjs`
- `tests/view-state-storage.test.mjs`
- `tests/view-profile.test.mjs`
- `tests/path-migration.test.mjs`
- `tests/data-editor.spec.ts`
- `.claw/truth/shared-view-collaboration-mode-routing-and-save-contract.md`

## 关键检索词

`sharedViewsConfigRef.current`、`commitSharedViewsConfig`、`enqueueSharedViewDirectSave`、`personal mode keeps a newly changed top-level icon after immediate reorder and reload`、`deleteViewFromItems`、`handleDuplicateSharedViewGroup`、`normalizeUserViewProfile keeps structure draft group icons`、`team publish`、`personal direct save`、`stale snapshot overwrite`
