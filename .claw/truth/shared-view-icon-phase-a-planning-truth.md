# 共享视图图标方案文档复核：总方案留存与实施边界分流

status: accepted

## context

本轮 planning 的目标不是重新设计 shared view icon 体系，也不是开启新的实现轮次，而是复核并修订既有上位方案文档 `docs/plans/2026-06-24-共享视图图标收藏与来源分组方案.md`，把其中仍有效、已过时、以及应该迁移到实施计划或 truth/ADR 的内容重新分流。

这份 planning truth 只沉淀本轮复核后仍可长期复用的文档边界规则，不重复 `.claw/truth/adr/shared-view-icon-phase-a.md` 或 `.claw/truth/adr/shared-view-tabler-icon-supply-chain.md` 已定死的结构性决策。

## planning truth

### 1. 本轮 round goal 固定为“复核并修订上位方案文档”

这轮 planning 的交付物是文档复核结论，不是再次设计图标体系，也不是直接展开新的实现阶段拆分。

可复用的长期规则是：

- 先判断上位方案哪些内容仍然有效
- 再标记哪些内容已经被后续实施与 truth/ADR 收敛而过时
- 最后决定哪些内容应迁移到实施计划或 canonical truth，而不是继续堆在总方案正文里

如果后续再出现“已有总方案文档需要复核”的任务，应沿用同一目标定义，不把 round goal漂移成重新开题。

### 2. 上位方案继续保留为总方案，但不再承担 Phase A / Tabler 的执行真相源职责

`docs/plans/2026-06-24-共享视图图标收藏与来源分组方案.md` 仍然保留，原因是它记录了这条需求的原始总目标、阶段划分与整体结构视角。

但这份文档后续只应承担“总方案 / 背景 / 目标态蓝图”角色，不再继续充当以下执行真相源：

- `Phase A` 的正式执行 contract
- `Tabler` 来源接入与供给链 contract
- 已经被后续事实验证并落入 truth/ADR 的稳定规则

后续如果需要回答“现在到底按什么做”，应优先查实施计划与 truth/ADR，而不是直接把总方案全文当成唯一真相源。

### 3. 本轮复核必须把正文内容分成三类

复核总方案正文时，必须显式按三类处理，而不是整体保留或整体覆盖：

1. 仍有效  
   继续保留在总方案中，作为背景、目标态或高层结构说明。
2. 已过时  
   明确标记为已被后续实施事实替代，避免未来读者把旧阶段性判断误读为当前 contract。
3. 应迁移  
   凡是已经收敛成执行步骤、验证口径、供给链合同或架构决策的内容，应迁移到实施计划或 truth/ADR，而不是继续滞留在总方案正文。

这条三分法是本轮最核心的 planning 复核方法，后续复核同类上位方案时可直接复用。

### 4. 本轮复核边界必须对齐四个正式落点

这轮复核不能只盯住总方案单文档，而必须与 4 个已存在或正在使用的正式落点对齐：

- `docs/plans/2026-06-24-共享视图图标Phase-A实施计划.md`
- `docs/plans/2026-06-24-共享视图图标收藏与来源分组方案.md`
- `.claw/truth/adr/shared-view-icon-phase-a.md`
- `.claw/truth/shared-view-tabler-icon-supply-chain.md`

边界分工应固定为：

- `共享视图图标 Phase A 实施计划`：承接 Phase A 的执行入口、阶段顺序、验收与实施口径
- `共享视图图标收藏与来源分组方案`：保留总体目标、范围、整体结构和历史上位方案语境
- `.claw/truth/adr/shared-view-icon-phase-a.md`：承接 Phase A 已定稿的结构性决策
- `.claw/truth/shared-view-tabler-icon-supply-chain.md`：承接 Tabler 来源、生成器、防碰撞与 pack 管理相关长期 contract

未来若再复核或修订总方案，必须先看这 4 处是否已经各自承接了对应真相，避免重复写、交叉覆盖或回写污染。

## related code

- `docs/plans/2026-06-24-共享视图图标收藏与来源分组方案.md`
- `docs/plans/2026-06-24-共享视图图标Phase-A实施计划.md`
- `.claw/truth/adr/shared-view-icon-phase-a.md`
- `.claw/truth/shared-view-tabler-icon-supply-chain.md`
