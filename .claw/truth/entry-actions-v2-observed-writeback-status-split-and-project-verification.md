# entry-action 观察到写回状态已分流：`completed_with_writeback` / `completed_without_observed_writeback`

<!-- document-state: historical -->
<!-- state: history -->
## 历史观察语义

这条 truth 只沉淀已经完成的最小观察能力：`scripts/run-entry-action.mjs` 现在会在执行前后重读目标文件与目标条目，计算 `fileChanged`、`targetRowChanged` 和 `changedFields`，并把 `writebackCheck` 写入 `result.json`。

它不重复更上层的 Codex 执行链、stdin prompt、skill 解析或绑定状态识别，只固定“结果状态如何对应执行前后快照观察到的变化”。这些快照不提供同源并发隔离，也不能把变化唯一归因于当前 `runId`。

## 结论

### 1. `result.status` 已从单一 `completed` 分化为两类

当前 `result.status` 的完成态已经分流为：

- `completed_with_writeback`
- `completed_without_observed_writeback`

这意味着结果不再只描述“Codex 过程结束”，而是开始区分：

- 是否观察到目标文件变化
- 是否观察到目标条目变化

### 2. `writebackCheck` 已进入 `result.json`

`scripts/run-entry-action.mjs` 会把 `writebackCheck` 一并写入 `result.json`，至少包含：

- `fileChanged`
- `targetRowChanged`
- `changedFields`

这让运行结果不再只是单纯的 reply/result 过程记录，而是带上了最小观察证据。

### 3. Nocturnel 项目内 `fill-data-name` 已做两次真实验证

#### 第一次：缺失字段条目命中真实写回

第一次在缺失字段条目上运行 `fill-data-name`，结果为：

- `completed_with_writeback`

最终目标条目确实变成：

- `id = 1095`
- `skill_name = 震地砸击`
- `skill_id = skill_ground_slam`

这说明该次验证中，`completed_with_writeback` 对应“过程完成且前后快照观察到目标条目变化”。它不把这项观察提升为通用的单次运行归因证明。

#### 第二次：同一已补完条目重跑未观察到写回

第二次在同一已补完条目上重跑，结果为：

- `completed_without_observed_writeback`

同时 `writebackCheck` 显示：

- `fileChanged = false`
- `targetRowChanged = false`
- `changedFields = []`

reply 也明确说明没有修改任何文件。

这说明当目标本来就处于补完态时，系统现在会把“没有观察到新的写回”显式区分出来，而不会误报成真实写回成功。

### 4. 结果语义已经固定为“过程完成 + 观察写回状态”双维度

后续看到结果态时，必须同时读两个维度：

- Codex 过程是否完成
- writebackCheck 是否观察到真实写回

不能再把一个字符串结果态当成单维成功判定。

## 长期规则

### 1. `completed_with_writeback` 只表示观察到目标条目变化

只有当 `writebackCheck.targetRowChanged` 或等价的观察证据成立时，才可以报告“执行前后观察到目标条目变化”。

该状态不能单独证明变化由当前 `runId` 产生，也不能证明目标外没有其他写入。同源文件并发、严格定位和受控提交的当前缺口由 [`entry-actions-same-source-concurrency-and-timeout-evidence-gap.md`](./entry-actions-same-source-concurrency-and-timeout-evidence-gap.md) 维护。

### 2. `completed_without_observed_writeback` 不是失败，但必须保留

它表示：

- Codex 流程结束
- 结果文件已产出
- 但没有观察到新的目标写回

这类结果对排障很重要，不能和失败、异常终止混为一谈。

### 3. 回写观察必须以目标文件和目标条目的重读结果为准

`reply.md` 仍然只能作为过程说明。判断“是否观察到目标变化”时，应以执行前后快照和 `writebackCheck` 为准；判断“是否由当前运行安全提交”时，还需要互斥、版本门禁和提交归因证据。

### 4. 新增写回链路后，历史“completed 只表示过程完成”的语义应视为过时

旧的粗粒度 `completed` 解释已经被更精细的结果分流替代。后续文档与排障语义应优先使用：

- `completed_with_writeback`
- `completed_without_observed_writeback`

## 关联代码

- `scripts/run-entry-action.mjs`
- `server.mjs`
- `src/entry-actions.mjs`
- `src/App.tsx`

## 验证锚点

- Nocturnel 项目内 `fill-data-name` 第一次补全验证
- Nocturnel 项目内 `fill-data-name` 第二次重跑验证

## 关键检索词

- `completed_with_writeback`
- `completed_without_observed_writeback`
- `writebackCheck`
- `fileChanged`
- `targetRowChanged`
- `changedFields`
- `observed writeback`

<!-- state: history -->
## 演进记录

<!-- dated: 2026-07-26 -->
### 从写回成功解释收窄为快照观察语义

早期在单次验证中，`completed_with_writeback` 曾被解释为当前运行真实写回成功。后续同源文件重叠运行证明，其他进程的写入也可能进入当前运行的前后快照，因此该状态的 canonical 含义收窄为“观察到目标条目变化”，不再承担运行归因或并发安全证明。

<!-- dated: 2026-07-27 -->
### legacy 观察链退出当前执行面

新的 legacy action 已在 API 边界被拒绝，因此本文保留为旧 runner 的结果解释历史；它不代表
当前可启动的自动化协议。当前运行时门禁由
[`entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md`](./entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md)
维护。
