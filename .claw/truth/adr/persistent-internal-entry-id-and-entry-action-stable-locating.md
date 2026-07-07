# 持久内部条目 ID 与 entry-action 稳定定位

status: accepted

## context

当前数组集合条目虽然已有运行时 `rowId`，但在条目定位、自动化执行和写回核对上，仍需要一个能够长期稳定存在、且能直接写回源数据的内部身份。

如果继续把业务主键或 `sourceRowIndex` 当成唯一真值，会持续暴露几个问题：

- 业务主键可能为空、变更或不适合作为内部定位锚点
- `sourceRowIndex` 只反映当前顺序，不适合作为跨保存、重载和执行回写的正式身份
- entry-action 的发起、结果轮询和写回核对会被迫依赖不稳定的临时坐标

因此需要把“正式稳定身份”和“业务字段语义”彻底拆开。

## decision

### 1. 数组集合条目的正式稳定身份切换为持久字段 `__entry_id`

数组集合中的每个条目都以 `__entry_id` 作为正式稳定身份。

该字段直接写入源数据记录，作为条目在保存、重载、新增和删除后的持久定位锚点，不再让业务主键或 `sourceRowIndex` 承担这项职责。

### 2. 运行时定位与写回核对优先复用 `__entry_id`

运行时的 `rowId`、entry-action 目标定位、以及执行前后写回核对，应优先复用持久 `__entry_id`。

`sourceRowIndex` 仍可作为临时回退或兼容输入，但不能再被视为唯一真值。

同样，业务主键只承担业务语义，不再作为内部定位的最高优先级依据。

### 3. `__entry_id` 默认隐藏，不进入默认字段展示和候选分析

`__entry_id` 属于内部机制字段，不应进入默认字段展示、标题推断，也不应进入 primary key candidate 分析。

这样可以避免把内部身份误暴露成业务字段语义，也避免它干扰现有字段角色判断。

### 4. entry-action 完成态必须通过独立结果轮询接口判断

entry-action 前端闭环需要通过独立结果接口 `/api/entry-actions/result` 轮询完成态。

`POST /api/entry-actions/run` 的 `started` 返回只表示任务已进入执行队列或后台流程，不能被视为完成。

### 5. 业务主键同步维护只在“非空旧值 -> 非空新值”时介入

业务主键同步维护只负责“已有业务主键被另一个非空业务主键替换”的场景。

当业务主键原本为空，或本次编辑把业务主键清空时，不再阻断保存，也不要求额外补齐替代键；内部稳定身份继续由 `__entry_id` 承担。

## consequences

- 条目身份从运行时临时坐标升级为可持久写回的内部字段，跨保存与重载的定位更稳定。
- entry-action 的目标定位和写回核对可以统一复用同一身份锚点，减少对业务主键空值和顺序变化的依赖。
- `__entry_id` 不参与默认展示和候选推断后，UI 和字段分析不会被内部实现细节污染。
- 前端不能再把 `started` 当作完成信号，必须等待 `/api/entry-actions/result` 的独立结果。
- 这条协议也为后续更可靠的执行审计和写回确认留下了明确接口边界。
- 保存链不再把“业务主键为空”误判为内部身份缺失；业务字段可以为空或被清空，而不破坏条目级保存与后续定位。

## related code

- `src/model/document-store.mjs`
- `src/model/row-id.mjs`
- `src/model/maintenance-lookup.mjs`
- `src/entry-actions.mjs`
- `scripts/run-entry-action.mjs`
- `server.mjs`
- `src/App.tsx`
- `src/components/PrimaryKeyCandidateBanner.tsx`
- `tests/document-store.test.mjs`
- `tests/entry-actions.test.mjs`
- `tests/open-stop.test.mjs`
