# entry-action completed 与真实写回脱节：最小证据链

<!-- document-state: historical -->

<!-- state: history -->
## context

这条 truth 只固定一个最小且可复用的排障结论：`entry-action` 的旧 `completed` 语义只说明 Codex 过程结束并产出了 `reply/result`，**不等于** 目标文件或目标条目的真实写回已经被观察到。

它不重复更上层的执行链接通、stdin prompt、skill 解析或绑定前置校验，只保留“completed 的真实含义”这一条最小证据链。

这条旧语义现在已被 [`./entry-actions-v2-observed-writeback-status-split-and-project-verification.md`](./entry-actions-v2-observed-writeback-status-split-and-project-verification.md) 中的 `completed_with_writeback` / `completed_without_observed_writeback` 分流替代。

## 证据链

### 1. `scripts/run-entry-action.mjs` 在 `codex exec` 返回 `0` 后直接写 `result.status = "completed"`

当前实现里，`scripts/run-entry-action.mjs` 的成功分支是：

- 先启动 Codex exec
- 只要子进程正常结束，就写出 `<runId>.result.json`
- 其中 `status` 直接标为 `completed`

这说明 `completed` 的触发条件来自进程退出成功，而不是来自目标数据是否已被再次核对。

### 2. `completed` 目前不依赖目标文件或目标条目的核对

当前 `completed` 判定链没有把以下信息纳入完成条件：

- 目标文件是否已重新读取确认
- 目标条目是否已回写到最终状态
- 目标字段是否已和 `reply.md` 声称的修改一致

因此，`completed` 不是“写回已观察到”，而只是“Codex 流程已跑完”。

### 3. `reply.md` 可以声称已修改，但读取目标条目时仍可能为空

实际排查中，`reply.md` 可能会写出类似“已修改 `data/skills.json` 第 140 行，并补入 `skill_name` / `skill_id`”的结论。

但当后续再读取目标条目时，目标仍可能为空，说明：

- `reply.md` 只是 Codex 自述结果
- `result.json` 只是过程完成记录
- 这两者都不能单独证明业务写回已经落地

### 4. 因此 `completed` 的真实含义只到“过程完成并产出 reply/result”

当前可以安全解释的含义只有：

- Codex 进程完成
- `reply.md` 已生成
- `result.json` 已生成

不能直接推出：

- 目标文件已更新
- 目标条目已持久化
- 目标状态已和输出内容一致

## 长期规则

### 1. 看到 `completed` 时，默认还要做一次写回观察核对

后续只要任务涉及条目级自动化，就不要把 `completed` 当作最终验收结论。至少还要核对一次目标文件或目标条目。

### 2. `reply.md` 属于过程证据，不是写回证据

`reply.md` 可以作为 Codex 完成了什么的说明，但不能替代对目标数据的观察验证。

### 3. 下一轮应补执行前后快照与最小 observed writeback 状态

data-editor 侧后续需要新增的，是：

- 执行前快照
- 执行后快照
- 最小 `observed writeback` 状态

这样才能把“进程完成”与“业务写回已观察到”分开记录。

## 关联代码

- `scripts/run-entry-action.mjs`
- `server.mjs`
- `src/entry-actions.mjs`
- `src/App.tsx`

## 关键检索词

- `completed`
- `result.json`
- `reply.md`
- `observed writeback`
- `before/after snapshot`
- `run-entry-action`
