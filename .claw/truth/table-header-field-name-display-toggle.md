# 表头显示原始字段名开关：列模型状态贯通与签名重建规则

status: accepted

## context

这条 truth 记录 Data Editor 表格表头「显示原始字段名」开关的稳定实现链路。它总结的是可复用的长期事实：在这个仓库里新增任何「列渲染级别的布尔显示状态」时，必须沿哪条链路贯通、哪些位置必须同步，否则会出现「状态看起来传下去了、UI 却不更新」的经典问题。

同时记录一个容易被忽略的工程陷阱：在本仓库用脚本批量改写文件时，行尾风格处理不当会把 diff 污染成几千行的假增删。

## 结论

### 1. 开关形态与渲染结果

工具栏新增「字段名」切换按钮（`</>` 图标，`title="在表头显示原始字段名"`，`aria-pressed` 标记激活态）。开启后，每个表头在中文 label 后追加灰色小字原始字段名，例如：

- 开启前：`换弹时间(秒)`
- 开启后：`换弹时间(秒)（reload_time_s）`

渲染发生在 `src/table/ColumnHeader.tsx`，条件是 `props.showFieldNames && props.fieldLabel`（只有存在中文 label 时才追加；没有 label 的列本就显示 `fieldName`，不再重复）。样式锚点 `.column-header-field-name`（灰 `#a09f9a`、`12px`、`margin-left: 4px`）。

### 2. 完整数据链路

`App.tsx` 的 state 是唯一真值，逐层下传：

1. `src/App.tsx`：`useState(false)` 的 `showTableFieldNames`，连同 `tableTextEditMode` 一起放入传给 `DataTable` 的 snapshot 对象（`showFieldNames: showTableFieldNames`），并加入 useMemo 依赖数组。
2. `src/table/DataTable.tsx`：`TableSnapshot` 新增 `showFieldNames`；在 `buildTableColumnModels` 调用处传入 `showFieldNames: snapshot.showFieldNames`，并加入列模型 useMemo 的依赖数组。
3. `src/table/table-column-models.mjs`：`buildTableColumnModels` 接收 `showFieldNames = false` 默认值，写入每个 column model。
4. `src/table/table-columns.tsx`：把 `columnModel.showFieldNames` 传给 `ColumnHeader`。
5. `src/table/ColumnHeader.tsx`：按上文条件渲染 `（{fieldName}）`。

### 3. 状态贯通 = 完全复刻 `textEditable` 链路

`showFieldNames` 不是独立发明的通道，而是与现有「编辑模式」`textEditable` 完全同构的列级布尔状态。凡是 `textEditable` 出现的位置，`showFieldNames` 都要同步出现：

- `TableSnapshot` 字段 + DataTable 传参 + 列模型 useMemo 依赖
- `buildTableColumnModels` 参数 + column model 字段
- `src/table/table-column-models.mjs` 的 `sameColumnModel(previous, next)` 复用比较（漏了会导致列模型被错误复用、开关不生效）
- `src/table/table-column-signatures.mjs` 的列模型签名（见下）
- `ColumnHeader` 渲染 + `.d.ts` + 单元测试

### 4. 签名重建：`show-field-names` / `hide-field-names` token

`src/table/table-column-signatures.mjs` 的 `columnModelSignature` 是列模型 useMemo 的依赖。签名里为每个字段追加：

```js
showFieldNames ? "show-field-names" : "hide-field-names",
```

开关切换后签名变化 → 列模型 useMemo 重建 → 表头重渲染。这个 token 必须放进签名，否则开关不触发重建。

### 5. 按钮与样式

- `src/components/ViewTabs.tsx`：新增 `showFieldNames` prop 与 `onToggleShowFieldNames`，按钮类名 `.view-tab-action view-tabs-field-name-toggle`，激活态加 `active` 并 `aria-pressed`。
- `src/styles.css`：`.view-tabs-field-name-toggle.active` 与编辑按钮激活态同款（绿色 `#2f7d32`、`font-weight: 600`）。
- `src/components/icons.ts`：复用已有 `code` 图标，无需新增图标。

### 6. 同步 `.d.ts` 与测试是必做项

本仓库 `.d.ts` 是手写的（不是自动生成）。`table-column-models.d.ts`、`table-column-signatures.d.ts`、`table-runtime-deps.d.ts` 都要同步新增字段，否则 `npm run typecheck` 失败。单元测试锚点：`tests/table-column-models.test.mjs`、`tests/table-column-signatures.test.mjs`、`tests/view-config-client.test.mjs`、`tests/view-config.test.mjs`。

## 真实调用链路

1. 用户点击工具栏「字段名」按钮。
2. `ViewTabs` 的 `onToggleShowFieldNames` → `App.tsx` 的 setter 翻转 `showTableFieldNames`。
3. snapshot 对象重建，`DataTable` 拿到新的 `showFieldNames`。
4. `columnModelSignature` 因 `show-field-names` / `hide-field-names` token 变化而重建。
5. 列模型 useMemo 重建 → `buildTableColumns` 重建 → `ColumnHeader` 用新 `showFieldNames` 渲染 `（{fieldName}）`。

## 长期行为 / 规则

- 新增列渲染级布尔状态时，先找现有同构状态（如 `textEditable`）的每一处出现位置，逐一复刻，不要自创短路径。
- 凡是参与列模型 useMemo 的布尔值，必须同时进 `sameColumnModel` 比较和 `columnModelSignature` 签名，二者缺一不可。
- `.d.ts`、单测、构建三件套必须与实现同步落地。

## 已知陷阱

- **行尾编码陷阱**：本仓库 HEAD 中 `.tsx` / `.mjs` 是 LF 行尾，`styles.css` 是混合行尾（部分 CRLF 部分 LF）。用 Python 等脚本整文件重写时，如果统一转 CRLF/LF，git diff 会把整文件判成假增删（本次曾误判 8765 行全删）。正确做法：按 HEAD 的行尾风格做局部插入，最后用 `git diff --stat` 核对增删量级是否合理。
- 漏掉 `sameColumnModel` 的 `showFieldNames` 比较时，开关切换后列模型可能被复用，表头不更新，且不会报错——这是最隐蔽的失败模式。
- 漏掉签名 token 时，开关切换不触发重建，同样表现为「点了没反应」。
- 不要为开关状态引入独立的全局 store 或 context；它会绕开现有 snapshot 链路，破坏 memo 一致性。

## 验证标准

- 开启「字段名」后，有中文 label 的表头显示 `中文（field_name）`；无 label 的列不重复显示。
- 切换开关后 `columnModelSignature` 变化（`show-field-names` ↔ `hide-field-names`），列模型重建。
- `sameColumnModel` 在 `showFieldNames` 不同时返回 false。
- `npm run build` 通过；`npm run typecheck` 不被新增字段破坏（仓库既有类型错误另计）。
- `git diff --stat` 增删量级符合实际改动（本次 212 增 / 1 删），无整文件假增删。

## 关联代码

- `src/App.tsx`（`showTableFieldNames` state、snapshot 传参）
- `src/table/DataTable.tsx`（`TableSnapshot.showFieldNames`、列模型 useMemo 依赖）
- `src/table/table-column-models.mjs`（列模型字段 + `sameColumnModel`）
- `src/table/table-column-signatures.mjs`（`show-field-names` token）
- `src/table/ColumnHeader.tsx`（渲染 `（{fieldName}）`）
- `src/components/ViewTabs.tsx`（工具栏按钮）
- `src/styles.css`（`.column-header-field-name`、`.view-tabs-field-name-toggle.active`）

## 相关 truth

- `.claw/truth/data-table-text-cell-blur-bypass-draft-loss.md`：同一表格编辑时序的另一类陷阱（blur 绕过与 draft 丢失），排查表格交互问题时一并参考。

## 关键检索词

`showTableFieldNames`、`showFieldNames`、`columnHeader`、`sameColumnModel`、`columnModelSignature`、`show-field-names`、`view-tabs-field-name-toggle`、`column-header-field-name`、`textEditable`、行尾编码
