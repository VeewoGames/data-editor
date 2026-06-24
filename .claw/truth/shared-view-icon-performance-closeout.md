# 共享视图图标性能复测收口：脚本入口、稳定产物与环境波动边界

status: accepted

## context

这条 truth 记录共享视图图标性能复测已经完成后的稳定结论。它的作用不是复盘一次具体跑数，而是给后续执行提供可重复的性能入口、可信的产物位置，以及明确的验证环境边界。

## performance truth

### 1. 性能复测脚本已正式化为 `npm run profile:shared-view-icons`

共享视图图标性能复测的正式入口是：

- 脚本文件：`tests/perf/shared-view-icons-profile.mjs`
- `package.json` 暴露命令：`npm run profile:shared-view-icons`

后续如果要重新做同类复测，应优先沿用这个入口，而不是另起临时脚本或把终端手工采样当成正式流程。

### 2. 当前性能真相源已经落盘到 `artifacts/icon-pack-performance/shared-view-icons-closeout.json`

本轮复测的可复用性能产物固定为：

- `artifacts/icon-pack-performance/shared-view-icons-closeout.json`

后续讨论共享视图图标性能时，应把这个 JSON 作为首选真相源。终端输出、一次性控制台日志或临时服务打印只能作为辅助证据，不能替代 artifact。

### 3. `tests/.scratch` 上采集到的关键路径是本轮稳定基线

在 `tests/.scratch` 环境上，已经成功采集到以下关键路径时长：

- `goto`：95.38ms
- `openDocument`：5161.32ms
- `openViewMenu`：224.07ms
- `openPicker`：63.24ms
- `switchToCoreSolid`：1161.9ms
- `loadCoreSolidPack`：8142.06ms
- `switchToLegacy`：137.07ms

这组数据可作为共享视图图标收口轮的性能基线参考，尤其适合回看 view 打开、picker 打开、pack 切换和单包加载的相对开销。

### 4. 分组规模已经确认，性能判断应与真实规模一起看

同一产物还确认了当前分组规模：

- `Micro S`：1904
- `Core S`：5603
- `Legacy`：153

后续如果再做性能诊断，应该把这些规模数据和时长一起看，而不是只看某个单点毫秒数。规模不同，切换和加载时长的解释也应跟着变化。

### 5. 临时 dev 服务复测曾成功，但后续波动应视为验证环境问题

本轮还验证过一次默认 `projectRoot` 的临时 dev 服务复测成功，但后续重跑时出现启动健康检查波动。

可复用的边界判断是：

- 该波动优先视为验证环境问题
- 不应据此推断共享视图图标逻辑回归
- 当前最稳定、最适合作为真相源的仍是 `tests/.scratch` 产物

也就是说，临时服务成功只说明验证链路曾经可用，不代表它比 scratch 产物更稳定、更适合做收口证据。

## related code / docs

- `tests/perf/shared-view-icons-profile.mjs`
- `package.json`
- `artifacts/icon-pack-performance/shared-view-icons-closeout.json`
- `tests/.scratch`
- `.claw/truth/shared-view-icon-planning-execution-entry.md`
- `.claw/truth/adr/shared-view-icon-phase-a.md`

## 关键检索词

`profile:shared-view-icons`、`tests/perf/shared-view-icons-profile.mjs`、`shared-view-icons-closeout.json`、`icon-pack-performance`、`tests/.scratch`、`goto 95.38ms`、`openDocument 5161.32ms`、`openViewMenu 224.07ms`、`openPicker 63.24ms`、`switchToCoreSolid 1161.9ms`、`loadCoreSolidPack 8142.06ms`、`switchToLegacy 137.07ms`、`Micro S 1904`、`Core S 5603`、`Legacy 153`
