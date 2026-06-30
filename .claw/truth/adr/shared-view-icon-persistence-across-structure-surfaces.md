# shared view icon 必须作为结构真值跨 config / draft / profile 持久化

status: accepted

## 背景

本轮继续排查 shared view 图标在“多轮操作后、刷新后、或继续做筛选/重排后”丢失的问题时，确认根因不只来自单个保存请求，而是多个结构重建与持久化入口把 `icon` 当成可忽略字段处理。

已确认的实际入口包括：

- top-level view rename / delete 时重建 collection items
- top-level group duplicate 时复制 group 快照
- 命名 profile 对 `structureDrafts` 的 normalize / serialize
- 本地 draft storage 与 path migration 对 structure draft 的转写

这些入口的共同点是：它们都不直接决定 shared view 的“内容查询逻辑”，却会重建 shared view 的结构对象；一旦重建时不显式保留 `icon`，后续任何成功保存都会把“已经丢失 icon 的对象”正确落盘，用户体感上就会变成“刚才没丢，后续多轮操作后突然丢了”。

## 决策

### 1. shared view 的 top-level view icon 与 group icon 视为结构真值，不再视为可推导 UI 元信息

从本轮开始，以下字段都属于 shared view 结构真值的一部分：

- top-level `kind: "view"` leaf 的 `icon`
- top-level `kind: "group"` item 的 `icon`
- group 内 leaf 的 `icon`

它们和 `viewId`、`groupId`、`name`、`viewIds` 一样，必须在结构对象跨层流转时被完整保留。

### 2. 任何会重建 shared view 结构对象的入口都必须显式复制 icon

后续如果某个 helper 会做以下任一动作：

- 重建 collection items
- 复制 group / leaf 快照
- 规范化 `structureDrafts`
- 写入或读回 profile / local draft / migration 结果

那么它必须显式复制 `icon`，不能默认依赖后续 normalizer 或渲染层“猜回来”。

### 3. profile / draft / migration 与 shared config 在 icon 契约上必须保持等价

只要一个结构字段会进入下列任一 surface，它在 icon 契约上就必须和正式 shared config 保持等价：

- `shared-views.json`
- 命名 profile 的 `structureDrafts`
- 本地 shared view drafts
- path migration 的 rewrite 结果

不能接受“shared config 有 icon，但 profile/draft/migration 可以丢”的半一致状态，因为刷新和后续操作会把这些旁路状态重新带回主路径。

## 后果与边界

### 正向后果

- 后续排查 shared view 图标问题时，可以先按“对象重建是否保留 icon”这一条主线审计，不必先怀疑每个网络请求。
- team mode 与 personal mode 虽然保存语义不同，但在 icon 结构契约上保持一致，减少分叉规则。
- 自动化验证可以明确落在 view-state、profile、storage、migration 和 e2e 主路径上，而不是只覆盖最终 UI。

### 负向成本

- 任何新增 structure helper、duplicate helper、normalize helper 时，都需要把 `icon` 一并纳入 schema 与测试。
- 不能再把 icon 变更视作“低风险 UI 字段”；涉及 structure copy / rewrite 的改动都要额外做 icon 回归。

### 非目标

- 本 ADR 不决定 shared view 的 team/personal 高层协作模式。
- 本 ADR 不保证已经复现并覆盖所有可能的多轮混合操作链；它只固定“icon 是结构真值，所有中间 surface 都必须保留”这一长期规则。

## 关联代码

- `src/App.tsx`
- `src/view/view-state.mjs`
- `src/api/client.ts`
- `tests/view-state.test.mjs`
- `tests/view-state-storage.test.mjs`
- `tests/view-profile.test.mjs`
- `tests/path-migration.test.mjs`
- `tests/data-editor.spec.ts`
