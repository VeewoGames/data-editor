# 数组条目拖动排序与行级操作边界

<!-- state: current -->
## 当前行为

主表的条目排序直接重排业务文档中的真实数组顺序；它不是个人 profile 或共享视图的一套独立排序配置。数组顺序因此是所有读取该文档的用户和运行时消费者共享的唯一排序真值。

`src/table/row-reorder-policy.mjs` 的 `resolveCanReorderRows(...)` 仅在以下条件同时满足时开放排序：

- 当前 collection 是根数组（`$`）或根对象的顶层数组字段；
- 没有搜索词、筛选条件或字段排序；
- 不处于 `commandSaving`、`closing`、`rebuilding` 或 `restarting` 的受控状态。

`record-map` 与嵌套数组不进入排序能力。前者仍是可编辑条目集合，但对象键的枚举先后不被定义为可调整的业务顺序。

排序由 `src/model/writeback-adapter.mjs` 的 `reorderRowsByRowId(...)` 以源、目标 `rowId` 和 `before | after` 定位源数组条目；屏幕 `sourceIndex`、`visibleRowIds` 与过滤后的行号只可用于展示，不能作为最终写回身份。重排后 adapter 以严格的原有 `rowId` 全排列重建 `DocumentStore`，使移动条目保留其稳定身份；`App.tsx` 随后保持该条目选中，并复用既有 `mutate`、autosave 与 `documentEtag` 保存链。

## 行级交互合同

`DataTable` 的固定行把手同时承担两种明确区分的意图：

- 点击打开行级操作浮框，提供复制和删除；删除仍经 `ConfirmDialog` 二次确认。
- 鼠标或笔指针按住后移动超过 `rowDragThreshold`（4px）才进入拖动；触屏不启动排序。

拖动临时态只保存源 `rowId`、目标 `rowId` 与落点预览。只有 pointer up 且落点有效时才调用 `onReorderRows`；Escape、pointer cancel、无有效落点或离开有效区域均不写业务数据。长列表在滚动容器上下各 `rowAutoScrollEdgeSize`（48px）内用 `requestAnimationFrame` 自动滚动，并在实际滚动后重算落点。

复制由 `duplicateRowByRowId(...)` 按稳定身份解析源条目。数组副本走 `src/document-model.mjs` 的独立复制路径并获得新身份；`App.tsx` 传入 collection 的主键配置后，文档模型通过 `resolveAutoSuffixedPrimaryKeyValue(...)` 生成不冲突的后缀值。`record-map` 不排序，但仍可走复制与删除操作。

## 关联代码

- `src/App.tsx`
- `src/table/DataTable.tsx`
- `src/table/row-dnd.mjs`
- `src/table/row-reorder-policy.mjs`
- `src/model/writeback-adapter.mjs`
- `src/model/document-store.mjs`
- `src/document-model.mjs`

## 验证锚点

- `tests/row-reorder-policy.test.mjs`
- `tests/row-dnd.test.mjs`
- `tests/writeback-adapter.test.mjs`
- `tests/document-store.test.mjs`
- `tests/data-editor.spec.ts`

定向模型、ETag/API、类型检查、构建及三项 Playwright 行为验证均已有完成记录。仓库 236 项单文件串行 E2E 曾在 20 分钟后超时，因此该套件没有“全量通过”的结论。

## 与稳定身份的关系

数组排序复用 `__entry_id` / `rowId` 的稳定定位规则，但不改变其既有权威归属；持久内部身份的通用合同见 [持久内部条目 ID 与 entry-action 稳定定位](./entry-actions-v2-persistent-entry-id-and-stable-location.md)。
