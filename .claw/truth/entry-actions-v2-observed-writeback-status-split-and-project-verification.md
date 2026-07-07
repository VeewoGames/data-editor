# entry-action 观察到写回状态已分流：`completed_with_writeback` / `completed_without_observed_writeback`

status: accepted

## context

这条 truth 只沉淀这轮已经完成的最小验证结果：`scripts/run-entry-action.mjs` 现在会在执行前后重读目标文件与目标条目，计算 `fileChanged`、`targetRowChanged` 和 `changedFields`，并把 `writebackCheck` 写入 `result.json`。

它不重复更上层的 Codex 执行链、stdin prompt、skill 解析或绑定状态识别，只固定“结果状态如何对应真实观察到的写回”。

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

这说明 `completed_with_writeback` 现在对应的是“过程完成且目标条目真实变化已被观察到”。

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

### 1. `completed_with_writeback` 才表示观察到真实写回

只有当 `writebackCheck.targetRowChanged` 或等价的观察证据成立时，才应该把结果解释为真实写回成功。

### 2. `completed_without_observed_writeback` 不是失败，但必须保留

它表示：

- Codex 流程结束
- 结果文件已产出
- 但没有观察到新的目标写回

这类结果对排障很重要，不能和失败、异常终止混为一谈。

### 3. 回写验证必须以目标文件和目标条目的重读结果为准

`reply.md` 仍然只能作为过程说明，最终判断应以执行前后快照和 `writebackCheck` 为准。

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
