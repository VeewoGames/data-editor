# Windows 持久服务的 Job 隔离、监督链与 fixture 生命周期合同

status: accepted

## context

Data Editor 的正式后台服务由 `recovery-bridge.mjs` 监督主服务。旧版 Windows 启动路径使用 Node `spawn(..., { detached: true })` 与 `unref()` 创建 recovery bridge，但这只能脱离父进程会话，不能保证脱离调用方已经所属的外部 Job Object。当 Codex 等宿主关闭带 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 Job 时，bridge 与其监督的主服务会被一并回收，`8787` 与 `8791` 同时失效。

修复必须保留 recovery bridge 对主服务的监督、runtime state、进程身份校验、`stop` 与 `service:finalize` 协议；不能用定时重启掩盖生命周期归属错误。持久化修复也改变了测试进程的真实寿命：fixture 若只删除临时目录而不正式 stop，会留下已经脱离测试宿主的孤儿服务。

## decision

### 1. 持久进程创建统一通过 `spawnPersistentProcess(...)`

- Windows recovery bridge 由隐藏的 WMI `Win32_Process.Create` broker 创建，broker 使用 `windowsHide: true`，不把 bridge 生命周期绑定到 Codex shell 或调用方 Job。
- macOS/Linux 继续使用 Node `detached: true`、`stdio: "ignore"` 与 `unref()` 的原生 detached session。
- recovery bridge 对主服务继续使用 `attach: true`；主服务仍由 bridge 直接监督，不改为第二个独立持久进程。
- runtime state、PID/命令行身份校验、`stop`、`service:status` 与 `service:finalize` 继续使用统一协议。

### 2. Windows Job 回归以调用方 Job 关闭后的服务存活为准

验收必须把调用方放入启用 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的合成 Job，关闭该 Job 后重新确认：

- `http://127.0.0.1:8787/api/health` 返回 `ok=true`
- `http://127.0.0.1:8791/health` 返回 `ok=true`
- 正式 `stop` / `service:finalize` 仍能识别并安全收尾服务

不要求 bridge 对所有系统 Job 都满足 `IsProcessInJob=false`。WMI 创建的进程可以属于 WMI provider 自身的系统 Job；关键合同是它不再属于调用方的 kill-on-close 生命周期。当前实现不依赖 `CREATE_BREAKAWAY_FROM_JOB`，后续也不能把该 flag 当作验收前提。

### 3. 测试 fixture 精确跟踪真实 open 的临时 root

`tests/open-stop.test.mjs` 只把真正执行过 open 的 tool root 标记为 active。成功执行 `runStop(toolRoot)` 后解除标记；teardown 仅对仍 active 的 root 先执行正式 stop，再删除临时目录。没有启动服务的 fixture 不执行昂贵的 CIM 扫描。

测试收尾不能依赖 test runner 退出、宿主 Job 关闭或临时目录删除来隐式回收持久服务。

### 4. bridge 复用与冲突清理必须校验完整运行身份

recovery bridge 的“同配置”判断必须包含 `projectRoot`，并与 bridge port、service port、mode、adapter 和 `registryHome` 一起比较。端口与 adapter 相同但项目根不同的 bridge 不能被静默复用，否则后续恢复会继续把主服务绑定到错误项目。

当 controller state 记录的 service PID 与 `8787` 实际监听 PID 冲突时，runtime state 不能单独作为清理依据。必须以实际监听 PID 为起点读取完整命令行，确认其 data-editor 服务身份和参数后精确停止孤儿进程，再由 recovery bridge 恢复受管服务；不得仅凭端口占用或陈旧 state 扩大清理范围。

## alternatives considered

- 继续使用 Windows Node `detached + unref`：不能跨越调用方外部 Job 的 kill-on-close 边界，已被否决。
- 用定时重启恢复被回收服务：只掩盖退出结果，不能修正生命周期归属，已被否决。
- 要求 `IsProcessInJob=false` 或强制 `CREATE_BREAKAWAY_FROM_JOB`：约束了错误的系统级表象，且不是已验证修复成立的必要条件，已被否决。
- fixture 无条件 stop：会让未启动服务的测试承担不必要的 Windows CIM 扫描成本，已被否决。
- bridge 复用时忽略 `projectRoot`：会把同端口、同 adapter 但项目绑定不同的实例误判为同配置，已被否决。
- controller state 与监听 PID 冲突时只信任其中一方：不能同时证明进程归属与实时占用，已被否决。

## related code

- `src/persistent-process.mjs`
- `open.mjs`
- `recovery-bridge.mjs`
- `service-lifecycle.mjs`
- `stop.mjs`
- `tests/persistent-process.test.mjs`
- `tests/open-stop.test.mjs`
- `tests/service-finalizer.test.mjs`

## consequences

- Windows recovery bridge 的生命周期从调用方 Job 转移到系统 WMI broker 创建边界，同时保留 bridge 对主服务的单一监督关系。
- 跨平台差异只存在于持久进程创建适配层；状态、身份、停止与恢复协议保持统一。
- Windows 生命周期验证必须证明“调用方 kill-on-close Job 关闭后双端口仍健康”，不能用普通父命令退出或单纯端口监听代替。
- 持久进程正确存活后，测试必须显式承担资源所有权；新增 open helper 时必须同步接入 active root 跟踪与正式 stop 收尾。
- bridge 配置身份包含 `projectRoot`；切换项目根时必须启动匹配的新监督链，不能沿用旧绑定。
- 状态与实际监听冲突的恢复流程必须先完成监听 PID 的完整命令行身份校验，再执行精确清理和受管恢复。
- 后续若更换 Windows broker、创建 flags 或监督链，必须重新验证调用方 Job 隔离、双端口健康、无可见窗口及 `stop` / `service:finalize` 合同。

## search terms

`spawnPersistentProcess`、`Win32_Process.Create`、`WmiPrvSE.exe`、`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`、`IsProcessInJob`、`CREATE_BREAKAWAY_FROM_JOB`、`activeOpenToolRoots`、`hasSameRecoveryBridgeConfig`、`projectRoot`、`controller state`、`listening PID`、`commandLine`、`attach: true`、`detached: true`、`8787`、`8791`、`service:finalize`、`windowsHide`
