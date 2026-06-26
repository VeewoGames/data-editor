# 表格文本编辑器：外部目标切换前主动 blur 并在卸载时兜底 flush

status: accepted

## context

data-editor 的表格文本/数字单元格原先依赖浏览器默认 `blur` 时序提交 draft，但本轮已完成的修复计划确认，这条链路在表格自身的交互里并不稳定。

根因不是普通输入控件本身丢值，而是 `DataTable` 的单元格 `pointerdown` / 选区切换逻辑会对默认焦点迁移产生干预；当用户在编辑后点击其他单元格或表格空白区域时，旧 editor 可能来不及收到原生 `blur`，导致 `useStableDraftInput` 中尚未提交的 draft 被切换流程绕过。

这说明“表格点击切换目标”与“文本编辑提交”不能继续作为彼此独立、只靠浏览器事件顺序偶然串起来的两条链路。它们必须在表格交互层形成明确合同，否则后续再出现 overlay 切换、卸载或停留场景时，仍会重复出现偶发不保存。

## decision

### 1. 表格内点击 editor 外部目标时，必须先由表格交互层主动触发当前 editor 的 `blur`

对于表格文本/数字单元格，点击其他单元格或表格空白区域时，`DataTable` 自己的选区切换逻辑必须先推动当前 `input` / `textarea` 提交，再继续处理新的选中目标。

正式合同是：

- 外部目标点击不再依赖浏览器是否刚好先派发原生 `blur`
- 表格自己的 `pointerdown` / 选区切换逻辑先确保当前 editor 进入提交路径
- 修复范围只限定在表格文本编辑提交流程，不扩散到无关编辑模式

### 2. 稳定草稿输入层在 editor 卸载时保留 `flushDraft` 兜底

`useStableDraftInput` 仍需在组件卸载时执行一次 `flushDraft` 兜底，以覆盖 editor 被切换、替换或移除，但没有收到预期 `blur` 的时序场景。

这不是对主动 `blur` 合同的替代，而是第二道边界：

- 第一层边界由表格交互层在点击外部目标前主动推进提交
- 第二层边界由稳定草稿输入层在 editor 卸载时兜底收口

## alternatives considered

- 继续只依赖浏览器默认 `blur` 时序：已被本轮根因确认否定，表格自己的 `pointerdown` 干预会让提交链路带有偶发性。
- 只在单一点击路径上补局部提交：不能覆盖 editor 被切换或卸载但未收到 `blur` 的场景，长期上仍会留下同类缺口。

## related code

- `src/editing/TableTextCellEditor.tsx`
- `src/editing/useStableDraftInput.ts`
- `src/table/TextCellSurface.tsx`
- `src/table/DataTable.tsx`
- `tests/data-editor.spec.ts`

## consequences

- 表格文本/数字单元格的保存时机从“依赖浏览器偶然 blur 顺序”收敛为“由表格交互层显式推进提交”。
- 以后再出现“点击别处后偶发不保存”时，排查优先级应先看 `DataTable` 是否在切换目标前触发当前 editor 提交，再看 `useStableDraftInput` 的卸载兜底是否被破坏。
- 新增或重构表格编辑器时，若仍挂接到同一 active editor / overlay 体系，就必须遵守这两层提交边界，不能回退到只依赖原生 `blur` 的实现。
- 与该合同直接相关的回归验证应继续保留“点击其他单元格”和“点击表格空白区域”两类交互路径。

## search terms

`TableTextCellEditor`、`useStableDraftInput`、`DataTable`、`TextCellSurface`、`blur`、`flushDraft`、`pointerdown`、`active editor`、`表格空白区域`、`失焦保存`
