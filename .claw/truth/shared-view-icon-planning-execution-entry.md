# 共享视图图标收口轮 planning 执行入口：优先级、边界与 Legacy 收口规则

status: accepted

## context

这条 truth 记录的是共享视图图标体系在 Phase A 和 Tabler 接入完成后的下一轮正式执行入口。它不是新的图标体系设计，也不是重新开题；它用于后续 planning / 执行前先确认本轮该做什么、哪些决定不能回开、哪些区域只能先盘点不迁移。

## execution truth

### 1. 下一轮固定优先级是性能复测、pack 管理诊断增强、Legacy 治理准备

在当前 shared view icon 体系的收口阶段，后续优先级已经固定为：

1. 先做性能复测
2. 再做 pack 管理诊断增强
3. 最后做 Legacy 治理准备

这条顺序是后续正式执行入口的默认队列，不应再被重新排序成“先扩来源、先补新图标、先做 Legacy 迁移”之类的路径。

### 2. 本轮不新增正式图标来源，也不重开已 accepted 决策

本轮 planning 的边界是收口，不是扩容。以下既有结论保持有效，不重新进入讨论：

- 不新增新的正式图标来源
- 不重开 `favorites`
- 不重开 `search contract`
- 不重开 `metadata/runtime` 双层
- 不重开 `Base` 常驻
- 不重开 `pack` 会话态
- 不重开“已使用 pack 保护”决策

这意味着本轮执行的目标只能建立在既有合同之上，不能借收口名义把已经 accepted 的边界再翻开。

### 3. 性能结论必须继续落盘到 artifacts，终端输出不能作为唯一证据

后续所有性能复测结论都必须有落盘证据，不能只依赖终端输出、临时日志或人工口述。

可复用的判断标准是：

- artifacts 里有可回溯的性能结果
- 终端输出只能作为辅助佐证
- 任何结论如果只存在于 console，而没有进入 artifacts，就不算完成收口证据

这条规则用于避免后续把一次性执行输出误当成长期真相。

### 4. Legacy 本轮先做 inventory 与分类，不直接大规模迁移或删除

Legacy 治理准备阶段的第一步只做 inventory 和分类，目的是把存量区域标清楚，而不是立刻批量迁移、批量删除或做大范围结构翻新。

本轮对 Legacy 的正确处理方式是：

- 先枚举现状
- 再按类型分类
- 之后再决定是否进入迁移、保留或清理

换句话说，Legacy 在本轮的角色是“待治理对象的清点与分层”，不是“立即执行重构”的开关。

## related code / docs

- `docs/plans/2026-06-24-共享视图图标收藏与来源分组方案.md`
- `docs/plans/2026-06-24-共享视图图标Phase-A实施计划.md`
- `.claw/truth/shared-view-icon-phase-a-planning-truth.md`
- `.claw/truth/shared-view-tabler-icon-supply-chain.md`

## 关键检索词

`共享视图图标收口轮`、`planning 执行入口`、`性能复测`、`pack 管理诊断增强`、`Legacy 治理准备`、`artifacts`、`favorites`、`search contract`、`metadata/runtime`、`Base 常驻`、`pack 会话态`、`已使用 pack 保护`
