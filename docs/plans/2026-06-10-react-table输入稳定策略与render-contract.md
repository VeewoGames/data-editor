# 概述

## 总体目标和范围

本文只覆盖第五阶段已经在代码中落地的两类框架边界：

1. `useReactTable(...)` 输入稳定策略
2. worker-ready render contract 第一版

它不重复解释大数据编辑的整体方案，也不替代第五阶段执行计划；它的作用是把当前已经实现的稳定/失效规则写成可执行、可复核的框架约束，供后续继续推进 `5D / 5E` 时直接对照。

## 各阶段任务概要

1. 列层输入拆分：
   - 先把 `DataTable` 内的运行态依赖抽到 `buildTableRuntimeDeps(...)`
   - 再把列描述抽到 `buildTableColumnModels(...)`
   - 最后把 `ColumnDef[]` 编译收口到 `buildTableColumns(...)`
2. 高频运行态解耦：
   - 把 `validation / backlink / sort / pressed / drag / callbacks` 从 `columns` 依赖中移出
   - 改为 `TableColumnsRuntimeProvider` 运行时注入
3. 行层 contract 落地：
   - 把窗口内可见行组装收口到 `buildVisibleTableRenderContract(...)`
   - 形成第一版 worker-ready payload

## 整体结构框架

当前表格输入边界已经形成四层：

1. `buildTableRuntimeDeps(...)`
2. `buildTableColumnModelsSignature(...)`
3. `buildTableColumnModels(...)`
4. `buildTableColumns(...) + TableColumnsRuntimeProvider`

行层则形成：

1. row window / variable height
2. `buildVisibleTableRenderContract(...)`
3. `useReactTable({ data, columns, getRowId })`

---

# 一、当前模块边界

## 1.1 列层

- `src/table/table-runtime-deps.mjs`
  - 负责 `fieldOptions / selectOptions / relationOptionsByField / relationConfigByField`
- `src/table/table-column-signatures.mjs`
  - 负责 `columnModels` 的显式失效签名
- `src/table/table-column-models.mjs`
  - 负责每列半静态描述
- `src/table/table-columns.tsx`
  - 负责 `ColumnDef[]` 编译
  - 负责 `TableColumnsRuntimeProvider` 运行态注入

## 1.2 行层

- `src/table/variable-row-window.mjs`
  - 负责动态高度窗口范围
- `src/table/row-height-index.mjs`
  - 负责测量高度缓存
- `src/table/table-render-contract.mjs`
  - 负责窗口内可见行的纯数据 contract

---

# 二、`useReactTable(...)` 输入稳定策略

## 2.1 `columns`

当前规则：

- `columns` 只应随 `columnModels` 变化而重建
- 以下变化不应直接触发 `columns` 重建：
  - `validation`
  - `backlinkValuesByRowId`
  - `sortField / sortDirection`
  - `pressedField`
  - `columnDragState`
  - header / cell action callback

当前实现：

- `DataTable.tsx` 中：
  - `columns = useMemo(() => buildTableColumns(columnModels), [columnModels])`
- 高频运行态经 `TableColumnsRuntimeProvider` 注入到 header / cell 渲染层

## 2.2 `columnModels`

当前规则：

- `columnModels` 的失效不再直接绑定对象引用，而是绑定显式签名
- 只有以下变化才应触发 `columnModels` 重建：
  - `visibleFields`
  - `displayTypes`
  - `wrappedFields`
  - `detectedTitleField`
  - `backlinkColumns`
  - `relationConfigByField`
  - `relationOptionsByField` 的可见列内容
  - `fieldOptions / selectOptions` 的可见列内容
  - 可见列宽
  - 会影响自动推断显示类型的 sample value type

当前实现：

- `buildTableColumnModelsSignature(...)`
  - 把以上输入归一到显式签名
- `columnModels = useMemo(() => buildTableColumnModels(...), [columnModelSignature])`

这条规则的直接意义是：

- 即使 `rows / relationOptionsByField / fieldOptions / selectOptions` 的对象引用抖动，只要最终列输出语义不变，`columnModels` 仍可保持稳定

## 2.3 `data`

当前规则：

- `data` 现在不是在组件里临时拼 `tableData`，而是先收口成 `buildVisibleTableRenderContract(...)`
- `useReactTable(...)` 消费的是 contract 中的 `rows`

当前含义：

- 行层输入已经具备独立 contract
- 这为后续继续做 row-level runtime 分层、以及未来 worker 化预留了纯数据边界

## 2.4 `getRowId`

当前规则：

- 继续以 `__rowId ?? __rowIndex` 作为兜底
- 优先使用稳定 `rowId`
- `__rowIndex` 只是没有显式 `sourceIndex` 时的窗口内回退语义

---

# 三、worker-ready render contract 第一版

## 3.1 目标

这一版 contract 不负责多线程执行，只负责把行层输入变成纯数据结构，避免 React 组件直接承担 payload 组装。

## 3.2 当前结构

`buildVisibleTableRenderContract(...)` 当前输出：

- `rows`
- `rowIds`
- `windowStart`
- `rowCount`

其中每一行至少带：

- `__rowId`
- `__rowIndex`
- 原始字段值

## 3.3 当前边界

这一版 contract 明确不包含：

- React component
- callback
- DOM ref
- measured height
- selection class / visual state

这意味着它已经满足“worker-ready”的最低前提：

- 输入输出纯数据
- 与 React 渲染树解耦
- 可在未来迁移到 worker 预计算，而不反向污染 UI 层 API

---

# 四、当前失效矩阵

| 变化类型 | 是否应重建 `columnModels` | 是否应重建 `columns` | 是否应更新 runtime context | 是否应重建 render contract |
| --- | --- | --- | --- | --- |
| `validation` 变化 | 否 | 否 | 是 | 否 |
| backlink 值变化 | 否 | 否 | 是 | 否 |
| sort 状态变化 | 否 | 否 | 是 | 否 |
| 列按压 / 拖拽状态 | 否 | 否 | 是 | 否 |
| callback 引用变化 | 否 | 否 | 是 | 否 |
| wrap 切换 | 是 | 是 | 可附带 | 否 |
| 列宽变化 | 是 | 是 | 否 | 否 |
| 关联配置变化 | 是 | 是 | 否 | 否 |
| 关联选项语义变化 | 是 | 是 | 否 | 否 |
| Multi-select / Select 选项语义变化 | 是 | 是 | 否 | 否 |
| 窗口内 rowViews 变化 | 否 | 否 | 否 | 是 |
| `windowStart` 变化 | 否 | 否 | 否 | 是 |

---

# 五、后续建议

## 5.1 `5D` 剩余工作

- 给 row-level runtime 再补一层显式失效策略
- 判断单元格编辑、行选择、detail 打开是否还会造成窗口内整批重建
- 为 `tableRenderContract` 增加必要但仍纯数据的增量字段，而不是让 `DataTable` 回填临时运行态

## 5.2 `5E` 正式收口

- 用静态脚本重新取 3 次中位数
- 对比第五阶段起点基线
- 给出是否进入“可选 worker 化评估”的结论
