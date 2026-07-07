# entryActions 第二版本机 Codex 执行链已接通：stdin prompt、技能解析与回写核对边界

status: accepted

## context

这条 truth 只沉淀 `entryActions` 第二版里“执行器已经从占位 started 切到真实本机 Codex 执行”这一轮稳定事实，不重复更早的双层个人化方向、运行时真值切换，或 Project Settings / Automation Settings 的入口收口。

这里固定的是：当前正式运行时仍然是 `automation profile + machine-local automation bindings`，但执行器本身已经不是空壳 started，而是会在本机实际解析 skill、启动 Codex、生成结果产物。

## 结论

### 1. 运行时真值仍然是 `automation profile + machine-local bindings`

条目级自动化的长期真值没有变化，仍然由两层构成：

- `automation profile` 负责规则
- `automation bindings` 负责当前机器上的执行绑定

前端和服务端都应继续围绕这两层判断是否可见、是否可执行、以及是否进入运行流程。

### 2. `bindingStatuses` 已成为绑定层的正式前置识别结果

`server.mjs::handleLoadAutomationBindings(...)` 会在返回 bindings 时附带 `bindingStatuses`。

`src/codex-runtime.mjs::resolveCodexBindingStatus(...)` 会把本机绑定提前分成这些稳定状态：

- `missing`
- `invalid`
- `ready`

其中 `invalid` 已能前置识别至少这几类问题：

- `binding_disabled`
- `provider_unsupported`
- `codex_cli_missing`
- `skill_missing`

这意味着前端和执行器都不需要把“点了才报错”当作默认模式，绑定缺失或不可用现在可以在运行前就被识别出来。

### 3. skill 解析已经支持项目内 `.agents/skills`

`src/codex-runtime.mjs::resolveCodexSkill(...)` 现在会优先在项目根下解析：

- `<projectRoot>/.agents/skills/<skill>/SKILL.md`

然后才回落到用户目录下的 Codex / agents skills 路径。

这条能力是长期可复用的，因为条目级自动化现在可以直接消费项目内 skill，不必强依赖全局安装。

### 4. `run-entry-action` 已改成后台启动并立即返回 `started`

`server.mjs::handleRunEntryAction(...)` 现在会先写 handoff，再 `spawn(...)` 启动 `scripts/run-entry-action.mjs`，然后立即对 API 返回 `status: "started"`。

这条行为的长期含义是：

- `/api/entry-actions/run` 只负责发起运行
- 它不等待 Codex exec 跑完
- started 只表示任务已进入后台执行链

在 Windows 上，这条 fire-and-forget 链还有一个稳定约束：当子进程采用 `stdio: "ignore"` 并立刻 `unref()` 时，`spawn(...)` 需要保持 `detached: true`。否则后台 runner 可能在真正启动前就跟随父进程丢失，导致 `started/result/reply` 产物落盘不稳定。

### 5. Codex exec 的 prompt 交互已经改为 stdin

`scripts/run-entry-action.mjs` 里执行 Codex 时，prompt 不是通过 Windows 多行命令参数传递，而是通过 `child.stdin.end(options.prompt)` 写入 stdin。

这样可以避开 Windows 多行参数在 shell / CLI 层退回到“Reading additional input from stdin”一类不稳定交互的问题。

### 6. 执行时显式开启了可写工作区模式

当前 `codex exec` 调用带有：

- `--ignore-user-config`
- `--skip-git-repo-check`
- `--dangerously-bypass-approvals-and-sandbox`

这条组合的长期事实是：条目级自动化执行会显式进入可写工作区模式，而不是依赖默认安全沙箱或交互确认。

### 7. 运行产物已经形成 `handoff / started / result / reply` 链

实际验证链里，Codex 执行会围绕这些产物展开：

- `<runId>.json` handoff
- `<runId>.started.json`
- `<runId>.result.json`
- `<runId>.reply.md`

`Nocturnel` 项目内的 `fill-data-name` skill 已经用作主链测试，接口返回 `started`，运行时也确实生成了这些产物。

当前在 Windows 上已经验证：当 `server.mjs` 维持 `detached: true` 后，`.data-editor/runtime/entry-actions/` 下的这些产物可以稳定产出；排查“started 都没写出来”时，优先看后台 spawn 选项，而不是先怀疑 `run-entry-action.mjs` 里的业务逻辑。

### 8. 结果态已经从单一 `completed` 进化为带写回观察语义的分流

原先只看 `reply/result` 的 `completed` 语义，已经被 `completed_with_writeback` 和 `completed_without_observed_writeback` 取代。也就是说，结果态现在不仅表示 Codex 流程结束，还会带上是否观察到真实写回的信号。

因此后续不能再把“过程完成”与“观察到写回”混为一谈，而要直接读取分流后的结果态和 `writebackCheck`。

## 长期规则

### 1. 排查条目级自动化时，先看 `bindingStatuses`

如果出现“按钮可见但跑不起来”或“看起来绑定存在但执行失败”，先查：

- 绑定是 `missing` 还是 `invalid`
- 是 `codex_cli_missing` 还是 `skill_missing`
- 目标 skill 是否真的在项目内 `.agents/skills` 或用户级 skill 路径里

### 2. `started` 只说明后台链路已启动，不说明执行成功

`POST /api/entry-actions/run` 返回 `started` 只是入队和写 handoff 成功，不代表 Codex exec 已完成，也不代表目标条目已改写。

在 Windows 上，如果连 `.started.json` 都长期不出现，优先检查 `handleRunEntryAction(...)` 的后台子进程是否仍保持 `detached: true`。

### 3. `completed` 只说明 Codex 进程完成，不自动证明业务回写完成

后续如果要判断一条条目动作是否真正成功，必须继续核对：

- 目标文件或数据项是否真的被改动
- 修改是否已落盘
- 最终结果是否与条目状态一致

### 4. 项目内 skills 是正式执行面的一部分

只要 `resolveCodexSkill(...)` 仍支持 `<projectRoot>/.agents/skills/...`，就说明条目级自动化已经允许项目本地 skill 作为正式执行面来源，不应再把它误判成临时 hack。

## 关联代码

- `src/codex-runtime.mjs`
- `src/entry-actions.mjs`
- `server.mjs`
- `scripts/run-entry-action.mjs`
- `src/App.tsx`

## 验证锚点

- Nocturnel 项目内 `fill-data-name` skill 主链测试
- `POST /api/entry-actions/run` 返回 `started`
- 运行目录下生成 `handoff / started / result / reply` 产物

## 关键检索词

- `bindingStatuses`
- `resolveCodexBindingStatus`
- `resolveCodexSkill`
- `.agents/skills`
- `run-entry-action`
- `stdin prompt`
- `dangerously-bypass-approvals-and-sandbox`
- `started.json`
- `result.json`
- `reply.md`
- `detached: true`
