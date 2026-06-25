# shared view 个人模式 / 团队模式切换：自动保存与显式发布边界

status: accepted

## context

shared view 的保存语义已经不只是一个按钮文案问题，而是会长期影响团队协作边界、个人工作流、配置持久化位置和重置语义的工作流决策。

当前实现里，`toolbar-search-actions` 上的“保存团队共享视图”按钮并不是常驻操作，而是由当前 shared draft 是否存在驱动：

- `src/App.tsx` 通过 `sharedViewPublishVisible` / `sharedViewPublishEnabled` 计算显示与启用状态
- 两者都依赖 `hasViewDraft(currentSharedViewDraftState(), activeCollectionKey, activeSharedView.id)`
- `src/components/ViewFilterBar.tsx` 的“重置”同样只在存在个人 draft 或结构 draft 时显示
- `src/view/view-state.mjs` 的 `saveSharedViewDraftsToConfig(...)` 仍然是“把 draft 合并后显式写回团队配置”的入口

完成的 plan 进一步收敛出一个长期结论：不应把团队共享视图默认改成对整个团队自动发布；更稳妥的方向是保留团队模式的显式发布边界，同时引入项目级个人模式承接单人工作流。

这轮 closeout 还确认了一条和模式持久化直接相关的排障优先级：如果前端 `POST /api/view-profile` 的请求体里已经出现了 `sharedViewCollaborationMode`，但随后同名 `GET /api/view-profile` 与写盘结果仍丢字段，优先判定正式服务进程陈旧，而不是继续猜测前端切换逻辑或 profile 选择状态。

## decision

### 1. 团队模式保留显式发布边界，不改成默认自动发布

团队模式继续维持当前语义：

- 视图编辑先进入个人 draft
- 只有显式点击“保存团队共享视图”才会把 draft 合并到 `.data-editor/shared-views.json`
- “重置”负责丢弃尚未发布的 draft

这条边界不应被“默认自动保存”吞掉，也不应把团队共享配置改成普通编辑即全员可见的直写模式。

### 2. 新增项目级个人模式，个人模式下 shared view 常规编辑可直存共享配置

个人模式作为单人工作流承接者，允许 shared view 常规编辑直接写入 `.data-editor/shared-views.json`，不再要求先走团队 draft 再发布。

但个人模式只是一种项目级工作流选择，不是新的共享数据模型：

- 模式值只保存在个人命名 profile 中
- 该模式不应污染团队共享配置
- 模式切换应由个人 profile 控制，而不是全局共享状态控制

### 3. 团队模式与个人模式必须保持不同的 reset 语义

团队模式的 reset 继续表示“撤销未发布 draft”。

个人模式因为直接持久化 shared-views.json，不应复用团队 draft 的 reset 语义；其 reset 需要独立定义，以免把“撤销草稿”和“回退已保存的个人工作流状态”混为一谈。

### 4. 团队发布按钮不能成为个人模式的回流入口

如果个人模式存在直存路径，团队发布按钮的显示条件和可点击条件都必须和模式语义对齐，不能让 personal mode fallback 再把用户拉回“保存团队共享视图”的旧语义。

这意味着按钮可见性不只依赖 draft 是否存在，还必须受当前模式约束。

### 5. 个人模式的普通编辑必须走串行直存入口

个人模式下，普通 shared view 内容编辑与结构拖拽不能各自并发写回 `shared-views.json`，而要进入串行直存入口。

这样做的长期原因是：

- 避免连续编辑、快速切换和结构拖拽产生写入乱序
- 保证 fallback draft、pending 标记和 retry affordance 的状态收敛一致
- 让 personal mode 的正式配置落盘只存在一条可审计写入路径

### 6. 个人模式失败降级只保留轻量 retry + reset cleanup

`personal` 模式下，直存失败后只保留轻量重试入口，并允许 `重置` 清理 fallback draft、pending 标记和 retry affordance。

不恢复常驻团队保存按钮，原因是：

- 失败降级的目标是局部恢复，而不是把模式切回 team 语义
- 团队保存按钮一旦重新常驻，会把 personal mode 的失败路径重新解释成“需要发布到团队”，破坏模式边界
- 轻量 retry 能保留用户刚输入的工作上下文，同时不把失败状态扩散成新的常驻 UI 结构

### 7. 模式字段写入但 GET/写盘丢失时，优先排查正式服务进程陈旧

当 `sharedViewCollaborationMode` 已经进入前端 POST 请求体，但随后 GET 与个人配置写盘仍丢字段时，排障优先级应固定为：

1. 先确认运行中的正式服务是否仍在加载旧版 `src/view-profile.mjs` 或旧序列化逻辑
2. 再确认正式服务是否已经重启并真正接管当前代码
3. 最后才回头检查前端模式切换与 profile 选择逻辑

这条顺序是长期工作流合同，不是一次性的故障定位技巧。它的核心原因是：如果请求体已经正确携带新字段，而后续读回和落盘仍丢字段，那么前端输入路径大概率已正确，真正的偏差点通常在正式服务进程本身是否陈旧。

## alternatives considered

- 直接把 shared view 改成默认自动发布到团队：会让单人编辑立即影响其他人，下次加载看到的共享结果失去明确的发布边界，风险最高。
- 继续只保留团队 draft + 显式发布：语义清晰，但无法给个人工作流提供更低摩擦的直存路径。
- 引入项目级个人模式：既保留团队协作的显式发布边界，又允许个人工作流直存共享配置，是当前更稳妥的折中。

## consequences

- 团队共享视图继续保持“先草稿、后发布”的协作合同，避免误把编辑动作当成全员发布。
- 个人模式可以把 shared view 编辑降到更低摩擦，但必须单独处理模式切换、串行写入和 reset 语义。
- `sharedViewPublishVisible` / `sharedViewPublishEnabled` 不能再只看 draft，还要看当前模式是否允许团队发布。
- 个人模式失败时只保留轻量 retry + reset cleanup，不把失败态升级成常驻团队发布 UI。
- 模式字段在 POST 已写入但 GET/写盘仍丢失时，排障入口应先查正式服务进程是否陈旧，而不是先推翻前端逻辑。
- 后续实现个人模式时，至少要额外关注跨 collection draft 迁移、直存串行化、团队按钮回流和 personal mode reset 语义。

## related code

- `src/App.tsx`
- `src/components/Toolbar.tsx`
- `src/components/ViewFilterBar.tsx`
- `src/view/view-state.mjs`
- `src/shared-views.mjs`
- `src/view-profile.mjs`
- `docs/04_信息架构与交互.md`
- `docs/05_数据与配置模型.md`
- `tests/data-editor.spec.ts`

## search terms

`sharedViewPublishVisible`、`sharedViewPublishEnabled`、`hasViewDraft`、`saveSharedViewDraftsToConfig`、`handleSaveViewForEveryone`、`handleResetSharedViewDraft`、`shared-views.json`、`个人模式`、`团队模式`、`显式发布`
