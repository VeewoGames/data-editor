# 条目自动化运行中状态的实时已运行时长

<!-- state: current -->
## 当前行为

### 运行中的详情状态按 `startedAt` 每秒显示已运行时长

条目自动化处于非终态时，详情面板使用结果记录中的 `startedAt` 计算已运行时长，
不引入独立的前端起始时间或后端计时状态。显示格式为：未满一小时显示
`已运行 m:ss`，达到一小时后显示 `已运行 h:mm:ss`；无效或缺失的时间戳不显示时长。

### 轮询结果持续同步运行中的 `startedAt`

`waitForEntryActionResult(...)` 每次得到非终态结果都会调用 `onPendingResult`。`App` 将该
结果转换为详情状态，因此长时间运行的轮询过程会持续提供最新的 `startedAt`，而不只依赖
首次发起动作的响应。

### 终态或离开运行状态后停止时钟

`DetailPanel` 仅当状态为 `running` 且存在 `startedAt` 时建立一秒间隔；状态转为终态、
`startedAt` 变化或面板卸载时，effect cleanup 会清理该间隔。既有的完成、失败和超时状态
仍由 `App` 的终态映射负责显示，不附带继续刷新的运行时长。

## 代码锚点

- `src/entry-action-duration.ts`
- `src/detail/DetailPanel.tsx`
- `src/App.tsx`
- `src/entry-action-result-wait.ts`
- `src/api/client.ts`

## 回归覆盖

- `tests/entry-action-duration.test.mjs` 覆盖分钟、小时和无效时间戳格式化。
- `tests/entry-action-result-wait.test.mjs` 覆盖非终态轮询结果经 `onPendingResult` 同步。

## 检索词

`startedAt`、`formatEntryActionElapsedDuration`、`onPendingResult`、`已运行`
