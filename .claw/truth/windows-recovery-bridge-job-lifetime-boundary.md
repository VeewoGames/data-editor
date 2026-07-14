# Windows recovery bridge 的 Job 生命周期边界、WMI broker 与双端口存活合同

## 结论

Data Editor 在 Codex 回合结束后出现 `8787` 主服务与 `8791` recovery bridge 同时失效、runtime state 仍残留旧 PID、`lastExit = null`，且日志只有正常启动记录时，已确认的根因不是服务主动退出，也不是 recovery 协议本身未启动，而是旧版 Windows recovery bridge 的创建边界仍依赖宿主进程所属的外部 Job Object。

旧版 `open.mjs` 通过 Node `spawn(..., { detached: true })` 加 `unref()` 创建 recovery bridge。Node/libuv 在 Windows 上的 detached 语义会使用 detached process / new process group 相关创建标志，但这不等于自动脱离调用方已经所在的外部 Job Object。Codex 宿主关闭该 Job 时，bridge 会被系统直接终止，JavaScript 层的正常 cleanup 没有执行机会。

recovery bridge 又以 `attach: true` 启动并监督主服务。因此旧版 bridge 随外部 Job 被硬终止时，主服务也会随同监督链退出，形成 `8787` 与 `8791` 同时失效的表象。

当前修复已把持久进程创建统一收口到 `src/persistent-process.mjs::spawnPersistentProcess(...)`：Windows 通过 WMI `Win32_Process.Create` broker 创建 bridge，macOS/Linux 保留 Node `detached: true` + `unref()`。`open.mjs` 只替换 recovery bridge 的创建方式，bridge 对主服务的 attach 监督链没有改变。

## 真实调用链路

1. `open.mjs::ensureRecoveryBridgeRunning(...)` 检查 recovery bridge state、PID 身份和 `8791/health`。
2. bridge 不存在时，`open.mjs` 调用 `spawnPersistentProcess(...)` 创建 `recovery-bridge.mjs`。
3. Windows 分支启动隐藏的 `powershell.exe -EncodedCommand` broker，再由 WMI `Win32_Process.Create` 创建 bridge；macOS/Linux 分支继续使用 Node detached child 并 `unref()`。
4. `recovery-bridge.mjs::startServiceThroughController(...)` 调用 `startMainService(...)`，明确传入 `attach: true` 和 `onExit`。
5. `service-lifecycle.mjs::spawnMainService(...)` 因 `attach: true` 将主服务按 `detached: false` 创建，并在 child `exit` 时回调 bridge。
6. 正常 child exit 会由 `recordMainServiceExit(...)` 清理 service state、递增 generation 并写入 `lastExit`；正常 bridge shutdown 也会清理 bridge/controller state。

旧版外部 Job Object 直接结束 bridge 时，上述 JavaScript cleanup 与退出记录链不会可靠执行，因此旧 PID、`lastExit = null` 和“日志只有正常启动”是同一根因的配套证据。当前 Windows WMI broker 创建边界已经通过关闭调用方 kill-on-close Job 的合成测试，bridge 与主服务不会再随调用方 Job 一起退出。

## 跨平台持久进程合同

- Windows recovery bridge 固定通过 WMI `Win32_Process.Create` broker 创建，使 bridge 生命周期不依赖 Codex shell / 调用方 Job。
- macOS/Linux 固定保留 Node `detached: true`、`stdio: "ignore"`、`unref()` 的既有创建方式。
- recovery bridge 对主服务的 `attach: true` 监督必须保留；这是主服务可恢复、可停止和可记录退出状态的核心控制边界。
- runtime state、PID 与命令行身份校验、`stop`、`service:status` 和 `service:finalize` 协议必须保留。
- 不使用定时重启掩盖 bridge 被宿主 Job 终止的问题；修复点是进程创建与生命周期归属，而不是故障后的轮询拉起。

## Windows broker 实现合同

- `src/persistent-process.mjs::spawnWindowsPersistentProcess(...)` 使用 `windowsHide: true` 启动系统 `powershell.exe`，并通过 `-EncodedCommand` 传入 UTF-16LE Base64 PowerShell 脚本。
- 命令 payload 先编码为 Base64 JSON；实际 Windows command line 由 `buildWindowsCommandLine(...)` 与 `quoteWindowsCommandLineArgument(...)` 按 Windows quoting 规则生成，避免把原始命令或参数直接拼进 PowerShell 源码。
- Windows payload 的工作目录使用 `path.win32.resolve(...)` 规范化，不能使用宿主平台语义不明确的普通路径拼接代替。
- `Win32_ProcessStartup` 固定设置 `ShowWindow = 0`。
- `CreateFlags` 固定组合 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT`，当前数值为 `1544`。
- `EnvironmentVariables` 显式传递 broker 当前环境；`open.mjs` 调用时传入 `process.env`。
- WMI 返回值必须为 `0` 且 `ProcessId` 必须为正整数，否则持久进程创建失败并向调用方暴露错误。

## 测试 fixture 生命周期合同

`tests/open-stop.test.mjs` 使用 `activeOpenToolRoots` 只跟踪真正调用过 `runOpen(...)` 或 `runOpenInsideKillOnCloseJob(...)` 的 tool root。两条 open helper 会在启动前把 root 加入集合；`runStop(toolRoot)` 成功后会将其移除。

`makeToolRoot(...)` 的 teardown 不是无条件执行 stop：只有 root 在结束时仍属于 `activeOpenToolRoots`，才执行 `runStop(toolRoot)` 并断言成功；无论是否 active，最后都会递归删除临时目录。这样既能收尾真正启动过的持久 bridge，也避免只测试 state / identity 等无服务 fixture 时触发昂贵的 CIM 进程扫描。

旧 fixture 只删除临时目录，过去之所以没有持续泄漏，是因为 bridge 仍会被测试宿主所属的 Job 隐式终止。WMI 持久化修复生效后，bridge 正确脱离调用方 Job；若 active root 继续只删目录，就会留下服务进程、监听端口和已经失去 runtime 文件的孤儿生命周期。因此长期合同是“精确跟踪已 open 的 root；成功 stop 后解除跟踪；teardown 只补停仍 active 的 root，再删目录”。不能依赖 test runner 退出、临时目录删除或宿主 Job 关闭来代替服务收尾。

## Job 验收语义

不能把“bridge 必须满足 `IsProcessInJob = false`”作为验收条件。WMI 创建的进程可能属于 WMI provider 自身的系统 Job；真正需要证明的是 bridge 已脱离调用方的 kill-on-close Job，不会在调用方 Job 关闭时被连带终止。

当前合成测试会把 `open.mjs` 调用方放入设置了 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 Job，随后关闭该 Job，并验证主服务与 bridge 仍然健康，最后验证正式 `stop` 能清理两个端口。这条测试比普通“父命令退出后 child 仍存活”更接近 Codex 宿主关闭 Job 的真实失败边界。

当前实现没有使用 `CREATE_BREAKAWAY_FROM_JOB`，且已经通过上述合成 Job 验证。后续不能把该 flag 写成必需条件；若要改变创建标志，必须先重新证明调用方 Job 隔离、监督链和 stop/finalize 合同仍成立。

## 关联代码

主要锚点：

- `open.mjs::ensureRecoveryBridgeRunning(...)`：bridge state / PID 身份检查，以及跨平台持久创建入口调用。
- `src/persistent-process.mjs::spawnPersistentProcess(...)`：跨平台持久进程创建的统一入口。
- `src/persistent-process.mjs::spawnWindowsPersistentProcess(...)`、`buildWindowsBrokerScript(...)`、`buildWindowsCommandLine(...)`：WMI broker、环境传递与安全 quoting。
- `service-lifecycle.mjs::spawnMainService(...)`：`attach` 到 `detached: !attach` 的映射、主服务 state 写入和 child exit 监听。
- `recovery-bridge.mjs::startServiceThroughController(...)`：bridge 以 `attach: true` 启动主服务。
- `recovery-bridge.mjs::recordMainServiceExit(...)` 与 `shutdown(...)`：正常退出时的 state / `lastExit` 清理链。

相关锚点：

- `stop.mjs::matchesRecoveryBridgeIdentity(...)`、`inspectWindowsProcess(...)`、`terminateWindowsProcess(...)`：PID / 命令行身份校验与 Windows 停止协议。
- `tests/persistent-process.test.mjs`：平台分流、WMI broker、flags、环境传递、Windows quoting 与错误返回测试。
- `tests/open-stop.test.mjs::activeOpenToolRoots`、`makeToolRoot(...)`、`runOpen(...)`、`runOpenInsideKillOnCloseJob(...)`、`runStop(...)`：只对真正 open 且尚未成功 stop 的 fixture 执行 teardown 收尾。
- `tests/open-stop.test.mjs`：detached 启动、bridge 健康、stop/finalize 清理，以及调用方 kill-on-close Job 关闭后的存活测试。

## 验证标准

- `tests/persistent-process.test.mjs` 的 4 个 launcher 单测覆盖 macOS/Unix detached + `unref()` 参数、Windows 隐藏 WMI broker / `EncodedCommand` / 环境边界、Windows command-line quoting，以及 WMI 返回值错误。
- 4 个关键 open/stop/finalize 集成用例通过，覆盖 bridge 启动、调用方 kill-on-close Job 关闭后的 `8787/8791` 存活和正式收尾。
- Windows 合成 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 测试关闭调用方 Job 后，`8787` 主服务与 `8791` bridge 仍健康。
- 在真实 Codex 宿主结束当前回合后，`http://127.0.0.1:8787/api/health` 与 `http://127.0.0.1:8791/health` 仍健康。
- runtime state 中的 PID 对应真实进程，命令行身份仍通过既有校验。
- 主服务主动退出时，bridge 仍能执行 `recordMainServiceExit(...)` 并更新 `lastExit`。
- `npm run stop` 与 `npm run service:finalize` 仍能按既有协议停止、恢复或清理服务。
- 非 Windows 的启动与停止行为没有变化。
- TypeScript `tsc --noEmit` 与 production build 通过。

## 正式服务验收快照（2026-07-10）

正式入口通过以下命令启动成功：

```powershell
npm run open -- --project C:\Code\Nocturnel --adapter nocturnel
```

在独立后续命令中重新检查，而不是沿用启动命令内的即时结果：

- `http://127.0.0.1:8787/api/health` 返回 `{ "ok": true, "bridgePort": 8791 }`
- `http://127.0.0.1:8791/health` 返回 `{ "ok": true }`

当次 runtime process tree 为：

- recovery bridge PID `33392`，父 PID `7256`；现场进程检查确认父进程为 `WmiPrvSE.exe`
- main service PID `38908`，父 PID `33392`，即 recovery bridge

这组进程关系证明两层边界同时成立：bridge 已由系统 WMI broker 创建，不再归属启动命令的调用方进程树；主服务仍由 bridge 以 attach 方式直接监督。

随后执行 `npm run service:finalize -- --json`，结果为 main / bridge 均 `healthy` 且 `protected`，recovery 因 `main-healthy` 跳过，`stoppedProcesses` 为空。finalize 同时清理 4 个 `data-editor-stop-*` 测试临时目录，未出现 skipped 项或 warnings。

最终复核 `service:status` 时，main / bridge 仍均为 `healthy`；本轮 code review 没有阻断性发现。

正式验收不能只看端口监听或 runtime state 文件：必须在独立后续命令中同时核对两个 health、真实父子进程关系，并运行 `service:finalize` 验证保护、恢复判定和临时目录清理合同。

### `service:finalize` 的 Windows 停止竞态

`service:finalize` 在 Windows 上可能遇到 `Stop-Process` 的检查后使用竞态：目标进程在身份检查与实际停止之间已经退出，导致第一次 finalize 报错。此类单次失败不能单独作为最终服务异常结论；应立即重跑一次 `npm run service:finalize`，再以第二次 finalize 结果、`cleanupPerformed`，以及 `8787/api/health` 与 `8791/health` 的独立复核共同收口。

2026-07-14 的一次正式收尾中，第一次 finalize 命中该竞态，第二次成功；最终清理结果为 0 个进程、2 个临时目录，随后 `8787/api/health` 返回 `{ "ok": true, "bridgePort": 8791 }`，`8791/health` 返回 `{ "ok": true }`。这证明重试后的服务保护与临时目录清理合同成立；具体 PID 只属于当次运行快照，不作为长期真值。

## 本轮验证边界

当前不能声明完整 `npm test` 全绿：全量运行仍会命中未修改的 `automation-bindings` / `view-state` 源码断言失败；完整 `tests/open-stop.test.mjs` 运行还会被未修改的 entry-action 临时 server 用例拖到 10 分钟工具上限。这两项不属于 persistent launcher / recovery lifecycle 修复的回归证据，不能据此把本次修复判为失败。

判断本合同是否成立，应优先看 launcher 4 个定向单测、关键 open/stop/finalize 集成用例、kill-on-close Job 存活测试、typecheck 与 production build。全量测试中的既有失败仍应单独治理；未来这些外部失败修复后，应重新运行全量套件并更新此验证边界。

## 关键检索词

`8787`、`8791`、`recovery-bridge.mjs`、`spawnPersistentProcess`、`path.win32.resolve`、`ensureRecoveryBridgeRunning`、`activeOpenToolRoots`、`makeToolRoot`、`runOpenInsideKillOnCloseJob`、`runStop`、`attach: true`、`detached: true`、`unref()`、`Job Object`、`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`、`lastExit`、`Win32_Process.Create`、`WmiPrvSE.exe`、`EncodedCommand`、`CREATE_BREAKAWAY_FROM_JOB`、`main-healthy`、`protected`、`service:status`、`service:finalize`

## recovery bridge 配置复用必须包含 `projectRoot`

本次根因调查确认，`recovery-bridge.mjs` 启动时会把 `projectRoot` 写入 recovery bridge state，并在后续 `startServiceThroughController(...)` 中持续使用该 root 启动主服务。`open.mjs::openService(...)` 在确认 bridge 可复用后只向 `/start` 发送空对象，不会把本次请求的项目 root 重新传给既有 bridge。

因此，`ensureRecoveryBridgeRunning(...)` 的旧 `sameConfig` 只比较 `port`、`servicePort`、`mode`、`adapter` 与 `registryHome`，却遗漏 `projectRoot` 时，两个不同项目只要共享其余配置，就可能被误判为同一实例。此时 `open` 会静默复用仍绑定旧项目的 bridge，`/start` 最终启动的仍是旧 `projectRoot`，而不是本次请求的项目。

修复后的长期合同是：bridge 复用判定必须把规范化后的 `state.projectRoot` 与 `requested.projectRoot` 纳入严格相等比较。当前该判断收口在 `open.mjs::hasSameRecoveryBridgeConfig(...)`；旧 state 缺少 `projectRoot` 时也必须判为不匹配，不能为了兼容旧状态而放宽。`tests/open-stop.test.mjs` 应持续覆盖“其余配置相同但 `projectRoot` 不同 => 不可复用”。

关联锚点：

- `open.mjs::ensureRecoveryBridgeRunning(...)`
- `open.mjs::hasSameRecoveryBridgeConfig(...)`
- `recovery-bridge.mjs` 的 recovery bridge state 写入
- `recovery-bridge.mjs::startServiceThroughController(...)`
- `tests/open-stop.test.mjs`

关键检索词：`hasSameRecoveryBridgeConfig`、`sameConfig`、`projectRoot`、`registryHome`、`/start`、`Recovery bridge port`

### 实现与回归状态（2026-07-14）

上述 bridge 配置合同已经落地：`open.mjs::hasSameRecoveryBridgeConfig(...)` 现同时比较规范化后的 `state.projectRoot` 与 `requested.projectRoot`，`ensureRecoveryBridgeRunning(...)` 统一复用该判断。`tests/open-stop.test.mjs` 已加入 project root 相同可复用、其余配置相同但 project root 不同不可复用的定向用例，本轮该 1 个定向测试通过。

## controller state 未跟踪的孤儿主服务排障边界

本次端到端收口发现，旧 `8787` server PID `56160` 未被当前 controller state 跟踪，属于孤儿主服务。向该进程调用 `POST /api/shutdown` 虽返回 `{ "ok": true, "stopping": true }`，但 `8787` 端口没有随之退出。这说明 202 响应只表示正式停止流程已被调度，不能单独证明目标端口已关闭；当实际进程不在 controller 的监督状态中时，必须继续核对 controller/service state、PID command line 身份与端口存活。

本次处理在确认 command line 确属 data-editor server 后精确停止 PID `56160`，随后由现有 `8791` recovery bridge 通过正式监督链启动新的受管主服务 PID `19128`。新服务完成 registry/API/UI 验收。两个 PID 仅是本次现场快照，不是长期常量；可复用规则是“先证明孤儿身份，再按 command line 精确停止，最后让 bridge 重新建立受管主服务并复核双端口与业务 API”。

关键检索词：`controller state`、`orphan`、`孤儿进程`、`/api/shutdown`、`stopping`、`commandLine`、`8791 recovery bridge`、`受管主服务`

### 本轮最终完成快照（2026-07-14）

修复、定向测试、无效 registry 清理、API/UI 验收与 `service:finalize` 已全部完成。最终独立复核中，`8787/api/health` 与 `8791/health` 均健康；主服务 PID `19128` 已由 recovery controller PID `33392` 跟踪，证明清理孤儿进程后重新建立了正式监督链。临时 Playwright 目录与测试进程均已清理，没有遗留本轮验证资源。

上述 PID 只用于证明本次最终现场的监督关系，不是长期常量。与项目 registry 相关的最终状态已记录在 `project-registry-and-view-profile-cleanup-boundary.md`：仅保留 `Nocturnel -> C:\Code\Nocturnel`，项目数为 1，文件数为 38，真实页面项目菜单仅显示一个 `Nocturnel`。
