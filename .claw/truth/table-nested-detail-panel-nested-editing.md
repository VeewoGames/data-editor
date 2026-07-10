# 表格 nested 单元格直达右侧 DetailPanel 嵌套编辑

status: accepted

## context

这条 truth 记录主表格中 nested 单元格的稳定入口语义，以及它和右侧 `DetailPanel` 现有 nested 编辑链路的真实分工。

它只保留可复用的长期事实，不记录这次任务的临时实施过程。

## 结论

### 1. 本轮交互决策已经收口为复用右侧 `DetailPanel`

当前确认的产品语义是：表格里的 nested 单元格点击后，不新增独立弹窗，不在表格内内联编辑，而是直接复用右侧 `DetailPanel` 打开对应字段的 nested detail。

这意味着 nested 入口只是“把用户带到现有 nested 编辑真值层”，不是新建第二套编辑器。

### 2. 主表 nested 单元格当前仍只负责选中行

`src/table/table-columns.tsx` 里，`columnModel.isNested` 分支的点击入口目前只会调用：

- `runtime.onSelectRow(originalRowIndex, rowId)`

这说明现状链路仍然是“选中当前行”，而不是“直接展开 nested 编辑器”。

### 3. 真正的 nested 编辑真值已经在 `DetailPanel` 内部

右侧 nested 编辑链路已经由 `src/detail/DetailPanel.tsx` 承担，核心锚点是：

- `openNestedField(...)`
- `nestedStack`
- `NestedObjectPanel`
- `NestedCollectionPanel`
- `NestedEditor`

所以后续实现应把表格入口接到这套链路上，而不是另起一套 nested UI。

### 4. 已确认的执行边界是根字段级 nested 直达

本轮收口后的稳定边界是：

- 只支持表格根字段级 nested 直达
- 不新增独立 `Dialog`
- 不扩散到非 nested 列
- 同一行切换不同 nested 字段时，要替换当前 root nested target
- 当该行 nested 值为空、`null` 或不是 object / array 时，只打开 primary detail，不自动展开 secondary panel

这套边界让入口语义保持单一，也避免把深层 path 导航提前揉进第一版。

### 5. 自动展开必须避开 `DetailPanel` 的清空时序

`src/detail/DetailPanel.tsx` 里，`nestedStack` 会在 `rowId` 或 `open` 变化时被清空：

- `useEffect(() => { setNestedStack([]); }, [rowId, open]);`

因此 nested 自动展开不能和这段清空逻辑并发竞争，必须在新行 / 新打开态稳定后再消费一次性目标。

另外，重复点击同一行同一字段时，`pendingNestedOpen` 必须带 `requestKey` 之类的一次性标识，避免 effect 因依赖不变而不再消费。

## 真实调用链路

1. 用户点击表格里的 nested 单元格摘要按钮。
2. `src/table/table-columns.tsx` 现状只会把控制权交给 `runtime.onSelectRow(originalRowIndex, rowId)`。
3. 右侧 `DetailPanel` 负责承接行详情，并通过 `openNestedField(...)` 进入 nested stack。
4. `openNestedField(...)` 推入 `nestedStack` 后，由 `NestedObjectPanel` / `NestedCollectionPanel` / `NestedEditor` 完成真正的 nested 编辑。

## 长期行为 / 规则

- 主表 nested 单元格的稳定职责是“入口”，不是“编辑器本体”。
- 右侧 `DetailPanel` 是 nested 编辑的唯一真值层。
- 后续如果要做自动展开，必须以一次性 pending 目标的方式接入，不能把 nested 目标做成长期 UI 状态。
- 同一行切换 nested 字段时，语义必须是替换当前 root nested target，而不是继续追加旧 stack。

## 已知陷阱

- 如果把自动展开接到 `DetailPanel` 的 `rowId/open` 同步阶段，可能会在 `nestedStack` 被清空后又立即被旧目标重建，导致目标字段不稳定。
- 如果不带 `requestKey`，同一行同一字段再次点击时，React effect 可能因为依赖未变化而不再触发消费。
- 如果把这条入口扩散到非 nested 列，后续会破坏现有普通列 / relation / backlink 的职责边界。

## 验证标准

满足以下条件时，可认为这条链路仍然成立：

- 点击 nested 单元格后，最终落到右侧 `DetailPanel` 的 nested 编辑链路
- 仍然只保留一套 nested 编辑真值，不新增独立弹窗
- 同一行切换不同 nested 字段时，secondary nested panel 会替换为新目标
- 空值行只打开 primary detail，不错误展开 secondary panel
- `src/detail/DetailPanel.tsx` 的 `nestedStack` 清空逻辑没有被自动展开时序破坏

## 补充实现与验证

这轮实现已经把入口、桥接状态和 nested 目标消费真正落到代码里，后续排查可以直接沿这些锚点看：

- `src/table/table-columns.tsx` / `src/table/DataTable.tsx`：nested 单元格入口已从 `onSelectRow` 收口到专门的 `onOpenNestedDetail` runtime。
- `src/App.tsx`：新增 `pendingNestedOpen` 一次性目标与 `requestKey`，通过 `openNestedDetailForRow(...)` 串起“选中行 + 打开 detail + 指定 nested 字段”的事务链。
- `src/detail/DetailPanel.tsx`：新增 `initialNestedTarget` 消费逻辑，按 `requestKey` 一次性替换 `nestedStack`，并区分数组、对象和空值三种分支；空值行只保留 primary detail，secondary panel 会被清空。
- `tests/fixtures/make-scratch-root.mjs` / `tests/data-editor.spec.ts`：新增直接打开、同一行切字段、空值行三类覆盖，作为 nested 入口的回归锚点。
- 目标 Playwright 用例已经通过，`npm run build` 已通过；`npm run typecheck` 目前被仓库现存类型错误阻塞，错误集中在 `src/api/client.ts`、`src/App.tsx`、`src/components/RelationConfigDialog.tsx` 和 `DataTable` 的既有类型面，不是这次 nested feature 自身回归。
- `npm run service:finalize` 已执行，正式服务与 recovery bridge 均处于健康收尾状态。

## 关联代码

- `src/table/table-columns.tsx`
- `src/detail/DetailPanel.tsx`
- `src/table/DataTable.tsx`
- `docs/plans/2026-07-09-嵌套结构单元格直达详情嵌套编辑执行方案.md`

## 相关 truth

- `.claw/truth/nested-detail-panel-first-phase-boundary-and-resolver-key.md`：记录右侧 `nested detail` 第一阶段框架边界、`nestedStack` 真值延续和 resolver key 约束；适合排查 schema 驱动改造范围，而不是表格入口语义。

## 关键检索词

- `onSelectRow`
- `openNestedField`
- `nestedStack`
- `NestedObjectPanel`
- `NestedCollectionPanel`
- `NestedEditor`
- `pendingNestedOpen`
- `requestKey`
