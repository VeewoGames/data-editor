# DataTable 文本/数字单元格切换时的 blur 绕过与 draft 丢失

status: accepted

## context

这条 truth 记录一个可复用的表格编辑时序陷阱：文本或数字单元格在仍有未提交 draft 时，从当前可编辑单元格直接点击另一个可编辑单元格，可能绕过原生 `blur`，导致旧 editor 卸载前没有执行 `flushDraft()`，表现为“点击到别的单元格后内容偶发没保存”。

## 结论

这不是 autosave 或后端写盘问题，而是前端交互时序问题。

问题成立的关键链路如下：

- `src/table/DataTable.tsx` 的 `handleSelectionCellPointerDown(...)` 在普通数据单元格点击路径上会调用 `event.preventDefault()`，用于开始单元格选择。
- 这个 `preventDefault()` 会阻止当前 `input` / `textarea` 在点击其他单元格时先触发原生 `blur`。
- 新目标单元格随后会在 `src/table/TextCellSurface.tsx` 里通过 `220ms` 的延迟激活，把 `activeTextCellId` 切换到新单元格。
- 旧 editor 因 `activeTextCellId` 切换而被卸载，但 `src/editing/TableTextCellEditor.tsx` 的卸载清理只会注销 active editor handle，不会主动 `flushDraft()`。
- `TableTextCellEditor` 真实的 draft 提交通常依赖 `onBlur` 回调里的 `inputRef.current?.flushDraft()`。
- 因此，只要点击路径先被 `preventDefault()` 接管、后续又由延迟激活触发 editor 切换，旧 draft 就会在未 `blur`、未 `flushDraft()` 的情况下被卸载丢失。

## 真实调用链路

1. 当前文本/数字单元格进入编辑态后，`TableTextCellEditor` 通过 `onBlur` 负责 `flushDraft()`、清理 active editor，并调用 `onDeactivate()`。
2. 用户点击另一个普通数据单元格时，`DataTable.handleSelectionCellPointerDown(...)` 先执行 `event.preventDefault()` 并开始表格级 selection。
3. 由于默认点击行为被拦截，当前聚焦的 `input` / `textarea` 不会先收到原生 `blur`。
4. 新目标单元格的 `TextCellSurface.handleActivate(...)` 再通过 `setTimeout(..., 220)` 延迟调用 `onActivate(cellId)`。
5. `activeTextCellId` 切到新单元格后，旧 editor 被 React 卸载；卸载 effect 仅注销 handle，没有补一次 `flushDraft()`。
6. 结果是用户看到焦点已切走，但旧 draft 没有提交到 cell value。

## 修复策略

当前稳定修复不是只补单点，而是同时在事件入口和 draft 生命周期上加双保险：

- `src/table/DataTable.tsx` 新增 `blurActiveTextEditor()`，在用户点击 editor 外部的普通数据单元格时，先主动对当前聚焦的 `input` / `textarea` 执行 `blur()`，再继续 `event.preventDefault()` 和 `beginCellSelection(...)`。
- 同一个 `blurActiveTextEditor()` 也接到 `.table-scroll` 的空白区域 `onMouseDown` 路径上，因此点击表格空白区域清选前，同样会先触发当前 editor 的原生 `blur`。
- `src/editing/useStableDraftInput.ts` 保留组件卸载时的 `flushDraft()` + `clearTimer()` 兜底，使 editor 即使因为切换或卸载没有收到正常 `blur`，draft 也不会直接丢失。

这条问题的长期修复规则是：如果表格层交互会用 `preventDefault()` 接管点击，就不能把 draft 提交完全押注在原生 `blur` 上；必须同时提供“入口侧显式触发 blur”和“editor 卸载时 flush”两层保障。

## 已知陷阱

- 这个问题只在“一个可编辑文本/数字单元格切到另一个可编辑单元格”的点击路径上最典型；如果是正常原生失焦、回车触发 `blur()`、或滚动导致显式 `blur()`，draft 通常会提交。
- 调查这类“偶发没保存”问题时，不能先怀疑 autosave、写盘 API 或后端；先检查当前交互是否绕过了 `blur`。
- `TableTextCellEditor` 的卸载清理与 `onBlur` 提交不是同一件事；只看到 active editor handle 被注销，不代表 draft 已落盘到单元格值。

## 验证标准

- focused Playwright 回归至少应覆盖三条链路：
  - `table text edit mode toggles ordinary text cell editing and autosaves`
  - `table text cell saves the latest draft when clicking another cell`
  - `table text cell saves the latest draft when clicking table whitespace`
- 前两条新增保存回归要显式证明“点击前文件内容还没更新，点击后才写入最新 draft”，这样才能区分“真正由 blur/flush 触发保存”与“等待时间足够长后自己写入”。
- 类型层最小护栏应保留 `npm run typecheck`，避免 `blurActiveTextEditor()`、editor handle 或 draft hook 的签名回归。

## 相关代码

- 主要锚点：`src/table/DataTable.tsx`
- 主要锚点：`src/table/TextCellSurface.tsx`
- 主要锚点：`src/editing/TableTextCellEditor.tsx`
- 相关锚点：`src/editing/useStableDraftInput.ts`
- 相关锚点：`tests/data-editor.spec.ts`

## 关键检索词

`handleSelectionCellPointerDown`、`preventDefault`、`blurActiveTextEditor`、`blur`、`flushDraft`、`activeTextCellId`、`TextCellSurface`、`TableTextCellEditor`、`220ms`、`draft 丢失`
