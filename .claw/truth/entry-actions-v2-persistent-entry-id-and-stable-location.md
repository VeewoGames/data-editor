# 持久内部条目 ID 与 entry-action 稳定定位已落地

<!-- state: current -->
## 当前行为

### 背景

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

### 4. `resolveEntryActionRow(...)` 只按 rowId 定位并修正 sourceRowIndex

`src/entry-actions.mjs::resolveEntryActionRow(...)` 现在要求非空 `rowId`，并只按持久
`__entry_id` 在目标 collection 中定位目标条目；`sourceRowIndex` 不参与回退定位。

找不到 `rowId` 时返回 `ENTRY_ACTION_TARGET_MISSING`；同一 collection 中出现重复
`__entry_id` 时返回 `ENTRY_ACTION_TARGET_ID_DUPLICATE`。服务端写入 handoff 时使用解析出的
真实 `sourceRowIndex`，而不是只信前端传入的旧行号。

### 5. proposal authority 与提交定位只接受稳定 rowId

`src/entry-actions.mjs::resolveEntryActionRow(...)`、authority snapshot 与 proposal commit 共同绑定
稳定 `rowId`。proposal 中的 `sourceRowIndex` 不能替代 `__entry_id`，提交时也会在当前文档模型中
重新定位并核对该行。

模型返回 proposal 后，`src/entry-action-service.mjs::bindProposalToHandoff(...)` 会以服务端创建的
handoff 覆盖 proposal 的 `version`、`runId`、`actionId`、`sourcePath`、`canonicalFileKey`、
`collectionPath`、`rowId`、两个 etag、`authorityDigest` 与 `fencingToken`。模型只决定 `changes` 与
summary 等建议内容；它回传的身份字段不构成提交目标。这避免复制 `rowId` 时的单字符误写把写回
导向不存在或错误的条目。

因此 Codex 只提交变更建议，正式写回仍由服务端围绕稳定身份完成，不再依赖已删除的 legacy
direct-write runner 做前后快照归因。

### 6. 发起 entry-action 前会先 flush 草稿和保存队列

前端详情按钮发起 entry-action 前会先：

- flush 当前文本草稿
- 调用 `saveCoordinator.flush("flush")`

这保证 entry-action 启动前，当前编辑态不会只停留在前端内存草稿里。

### 7. `/api/entry-actions/result` 用于轮询 proposal-only 运行状态

服务端保留 `/api/entry-actions/result` 读取历史记录，并对当前运行返回规范化的 `phase/outcome`、
proposal、reply 与 diagnostics 可用性。已启用且命中目标的规则、可用本机 binding 与 action 级
policy 共同允许进入 proposal-only 执行链；它们不满足时服务失败关闭。

这让 entry-action 的运行态不再只靠一次性发起请求猜测，结果读取链路也变成了可重复查询的稳定接口。

### 8. 稳定 rowId 是 execution 与 writeback 的共同身份边界

当前实现与合同测试共同覆盖：前端行号陈旧时以唯一 `__entry_id` 重新定位；缺失或重复 rowId
失败关闭；proposal authority 与最终提交不能切换到另一条记录。历史 legacy handoff 的行号修正
证据只保留在下方演进记录，不再作为当前执行协议。

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

### 1. `rowId` 是唯一的提交定位身份

后续稳定定位必须使用非空且唯一的 `__entry_id`；不得以可能漂移的 `sourceRowIndex` 作为
缺失、找不到或重复 `rowId` 的回退。

### 2. 内部身份字段不应进入默认 UI 面

`__entry_id` 只承担稳定定位，不应作为默认展示字段、标题推断字段或 primary key candidate 候选。

### 3. entry-action 的 handoff 与 writeback 核对必须共享同一稳定身份

只要定位链条仍在使用 `rowId`，handoff 和 writebackCheck 就应继续围绕同一个条目身份重读，而不是分别相信不同的临时行号。模型返回的 proposal 也必须由服务端 handoff 覆盖所有执行身份与并发合同字段；不得把模型回传的 `rowId`、文件、动作、版本、etag、authority 或 fencing 值作为写回真值。

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
- `tests/entry-action-service.test.mjs`
- `tests/maintenance-lookup.test.mjs`
- 历史真实项目验证：错误 `sourceRowIndex` + 正确 `rowId` 曾能稳定定位并发起 legacy action
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
- `ENTRY_ACTION_TARGET_MISSING`
- `ENTRY_ACTION_TARGET_ID_DUPLICATE`
- `bindProposalToHandoff`
- `primaryKeySyncPlan`
- `configured business primary key is cleared to empty`

<!-- state: history -->
## 演进记录

<!-- dated: 2026-07-27 -->
### 稳定定位保留，legacy 启动入口关闭

`__entry_id` 的持久身份与结果读取能力仍是当前事实；曾经由此进入的 legacy 新任务启动路径已被
`ENTRY_ACTION_PROTOCOL_DISABLED` 取代。当前运行时门禁见
[`entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md`](./entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md)。

<!-- dated: 2026-07-27 -->
### Strict RowId 取消行号回退

定位链已从“优先 `rowId`”收紧为“只接受唯一持久 `__entry_id`”。此演进保留在这里，便于
排查旧 handoff 或历史记录中仍携带 `sourceRowIndex` 时不误把它当作当前提交定位依据。
