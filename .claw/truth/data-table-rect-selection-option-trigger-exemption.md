# DataTable 矩形选区对离散选项触发区的豁免边界

status: accepted

## context

这条 truth 记录一个可复用的交互边界：`DataTable` 的矩形选区入口，必须和 `OptionFieldEditor.forwardOptionFieldSurfaceClick(...)` 采用一致的豁免集合。否则离散选项单元格里的 trigger 点击会先被表格级选区接管，留下错误的 `data-cell-selected="true"` 状态。

## 结论

`src/table/DataTable.tsx` 的 `handleSelectionCellPointerDown(...)` 不能只豁免文本编辑器相关命中，还必须同时豁免离散选项触发区：

- `[data-cell-role="token-trigger"]`
- `[data-cell-role="detail-trigger"]`

`src/table/OptionFieldEditor.tsx` 的 `forwardOptionFieldSurfaceClick(...)` 已经把这两个 trigger 作为 surface 点击的阻断边界，因此 `DataTable` 的矩形选区入口也要保持同一组边界。两处边界不一致时，至少会影响 `Select` 与 `Multi-select` 单元格，表现为点击 trigger 后先进入表格级矩形选区，并残留 `data-cell-selected="true"`。

## 验证标准

- 新增 E2E 回归，覆盖离散选项单元格的 trigger 点击、选择、关闭流程。
- 断言上述流程结束后不会残留矩形选区。
- 同时联跑既有的拖拽选区回归与文本编辑回归，确认新的豁免边界没有破坏原有交互。

## 相关代码

- `src/table/DataTable.tsx`
- `src/table/OptionFieldEditor.tsx`
- `src/table/CellRenderer.tsx`
- `tests/data-editor.spec.ts`

## 关键检索词

`handleSelectionCellPointerDown`、`forwardOptionFieldSurfaceClick`、`data-cell-role="token-trigger"`、`data-cell-role="detail-trigger"`、`data-cell-selected="true"`、`Select`、`Multi-select`
