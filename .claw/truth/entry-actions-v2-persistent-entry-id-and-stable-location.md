# 持久内部条目 ID 与 entry-action 稳定定位已落地

status: accepted

## context

这条 truth 只沉淀本轮已经完成的稳定事实：数组集合条目现在有了持久内部身份字段 `__entry_id`，而 `entry-action` 的定位、handoff 和写回核对都已经改为优先围绕这个内部身份工作。

它不重复 `automation profile`、Codex exec、writeback 状态分流，也不写未来愿景，只固定可复用的定位与回写事实。

## 结论

### 1. `__entry_id` 是数组集合条目的正式持久身份

数组集合条目现在引入了持久字段 `__entry_id`，用来作为正式稳定身份。

运行时的 row 定位已经不再只依赖 `sourceOrder` 或旧行号，而是会优先复用该持久身份。

### 2. 新增数组条目时会自动补 `__entry_id`

`src/document-model.mjs` 在新增数组条目时会自动补种 `__entry_id`。

`src/App.tsx::openDocumentAt(...)` 在文档打开后也会为缺失该字段的旧条目补种，并把文档标记为 dirty，以便触发后续自动保存。

这意味着旧数据不会停留在“只有临时行号、没有稳定身份”的状态里。

### 3. `__entry_id` 默认不进入用户可见字段面

`getMainColumns(...)` 和 `getNestedFields(...)` 会过滤 `__entry_id`，所以它不会出现在默认字段展示里，也不会进入标题推断或 primary key candidate 候选面。

这条边界稳定了两个事实：

- 内部定位字段不污染默认编辑面
- 用户侧仍然看到正常字段集合，而不是额外内部标识列

### 4. `resolveEntryActionRow(...)` 现在优先按 rowId 定位并修正 sourceRowIndex

`src/entry-actions.mjs::resolveEntryActionRow(...)` 现在会优先按 `rowId` 定位目标条目，并把 `sourceRowIndex` 修正为真实位置。

服务端写入 handoff 时使用的是修正后的真实 `sourceRowIndex`，而不是只信前端传入的旧行号。

### 5. 写回核对也已经切到 rowId 优先

`scripts/run-entry-action.mjs::captureWritebackState(...)` 现在同样会优先用 `rowId + sourceRowIndex` 解析目标条目。

因此写回核对不再只信旧行号，后续对“是否写回”的判断也能跟随稳定身份做重读核对。

### 6. 发起 entry-action 前会先 flush 草稿和保存队列

前端详情按钮发起 entry-action 前会先：

- flush 当前文本草稿
- 调用 `saveCoordinator.flush("flush")`

这保证 entry-action 启动前，当前编辑态不会只停留在前端内存草稿里。

### 7. `/api/entry-actions/result` 已用于轮询 started / completed

服务端新增了 `/api/entry-actions/result`，前端可据此轮询 entry-action 的 started / completed 结果。

这让 entry-action 的运行态不再只靠一次性发起请求猜测，结果读取链路也变成了可重复查询的稳定接口。

### 8. 本轮验证显示稳定 rowId 已能覆盖旧行号偏差

本轮验证里：

- `tests/document-model.test.mjs` 通过
- `tests/document-store.test.mjs` 通过
- `tests/entry-actions.test.mjs` 通过
- `tests/maintenance-lookup.test.mjs` 通过

额外的临时真实项目验证也确认：

- 传入错误 `sourceRowIndex = 0`
- 但提供正确 `rowId = 01JZTESTENTRY0000000000000B`

时，handoff 最终写入的是修正后的 `entry.sourceRowIndex = 1`。

同一条验证里，`skill_id` 为空的目标条目也仍然能够成功发起 action，运行结果先进入 `started`，随后在快速失败宿主下落到 `completed_without_observed_writeback`。

### 9. `__entry_id` 解决的是内部稳定身份，不会取代业务主键保存链

当前 `data-editor` 里，`__entry_id` 已承担内部稳定定位；但 `viewConfig.primaryKeys` 配置的业务主键仍会进入保存前维护链。

稳定调用链是：

- `flushAutosaveTargets(...)` 在数据 dirty 时先尝试解析 `primaryKeySyncPlan`
- `shouldInterceptPrimaryKeySyncPlan(...)` 决定是否拦截保存
- `buildMaintenanceLookupState(...)` 会在 `src/model/maintenance-lookup.mjs` 内结合 `viewConfig.primaryKeys` 与 relation/document rewrites 生成计划

因此，不能把“已经有 `__entry_id`”误解成“业务主键已经完全退出保存语义”。

### 10. 业务主键同步维护只在“非空旧值 -> 非空新值”时介入

`src/model/maintenance-lookup.mjs` 现在会在以下任一条件满足时直接返回空维护态：

- 旧值和新值都为空
- 新值为空

这意味着当前保存拦截边界已经收敛为：

- 如果业务主键原本为空并保持为空，不阻断保存
- 如果业务主键从非空被清空，也不再进入“待确认 / 新主键不能为空”阻断链
- 只有真正的非空重命名场景，才继续构造 `primaryKeySyncPlan`

配套验证已固定在 `tests/maintenance-lookup.test.mjs`，其中包含 `configured business primary key is cleared to empty`。

## 长期规则

### 1. `rowId` 优先于旧行号

只要目标条目已经有 `__entry_id`，后续稳定定位就应优先使用它，而不是回退到可能漂移的旧 `sourceRowIndex`。

### 2. 内部身份字段不应进入默认 UI 面

`__entry_id` 只承担稳定定位，不应作为默认展示字段、标题推断字段或 primary key candidate 候选。

### 3. entry-action 的 handoff 与 writeback 核对必须共享同一稳定身份

只要定位链条仍在使用 `rowId`，handoff 和 writebackCheck 就应继续围绕同一个条目身份重读，而不是分别相信不同的临时行号。

### 4. `__entry_id` 与业务主键是两条不同职责链

`__entry_id` 负责内部稳定定位；`viewConfig.primaryKeys` 负责业务字段级同步维护。两者可以同时存在，但保存拦截只应在非空业务主键重命名时介入。

## 关联代码

- `src/model/persistent-entry-id.mjs`
- `src/document-model.mjs`
- `src/App.tsx`
- `src/entry-actions.mjs`
- `scripts/run-entry-action.mjs`
- `server.mjs`
- `src/api/client.ts`

## 验证锚点

- `tests/document-model.test.mjs`
- `tests/document-store.test.mjs`
- `tests/entry-actions.test.mjs`
- `tests/maintenance-lookup.test.mjs`
- 临时真实项目验证：错误 `sourceRowIndex` + 正确 `rowId` 仍能稳定定位并发起 action
- 临时真实项目验证：清空 `skill_id` 后不再出现“待确认 / 新主键不能为空”阻断

## 关键检索词

- `__entry_id`
- `persistent entry id`
- `resolveEntryActionRow`
- `captureWritebackState`
- `saveCoordinator.flush("flush")`
- `/api/entry-actions/result`
- `sourceRowIndex`
- `rowId`
- `primaryKeySyncPlan`
- `configured business primary key is cleared to empty`
