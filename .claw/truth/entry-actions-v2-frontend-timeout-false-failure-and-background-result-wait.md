# entry-action 前端超时误判修复：60 秒前台等待后转后台继续轮询，不再直接判失败

status: accepted

## context

这条 truth 只沉淀详情面板里 entry-action 点击后的前端等待语义，不重复第二版配置归属、target pair 结构或 `completed_with_writeback` / `completed_without_observed_writeback` 的结果含义本身。

真实问题不是 Codex 写回失败，而是：

- 前端固定只等待 60 次、每次 1 秒的结果轮询
- 后端 `scripts/run-entry-action.mjs` 只有在 `codex exec` 结束并完成写回核对后才会写出 `result.json`
- 只要结果文件比前端 60 秒窗口更晚落盘，页面就会先显示“执行失败 / 尚未收到完成结果”，但刷新后又能看到数据已经成功写回

因此，这是一条典型的“前端超时误判”，不是执行链真正失败。

## 结论

### 1. 旧前端误判根因是固定 60 秒等待窗口

旧链路在 `src/App.tsx` 里会：

- 调用 `runEntryAction(...)`
- 再调用本地 `waitForEntryActionResult(...)`
- 每秒读取一次 `/api/entry-actions/result`
- 最多等 60 次
- 如果 60 次都还是 `started`，就直接抛出：`自动化执行超时，尚未收到完成结果。`

这条抛错会直接把详情状态映射成 `tone: "error"` 的失败提示。

### 2. 后端结果落盘时机天然晚于 `started`

`scripts/run-entry-action.mjs` 的正式顺序是：

- 先写 `started.json`
- 后台执行 `codex exec`
- 再重读目标文件和目标条目，生成 `writebackCheck`
- 最后才写 `result.json`

因此 `started` 与最终结果之间存在天然的长尾窗口。只要窗口超过 60 秒，旧前端就会把“结果尚未落盘”错误解释成“执行失败”。

### 3. 前端等待语义现在改成“两段式”

当前等待逻辑已经抽到 `src/entry-action-result-wait.ts`，正式语义变成：

- 第一段：前台等待 60 次，每次 1 秒
- 第二段：如果仍然是 `started`，切到后台继续轮询
- 后台阶段默认每 2 秒轮询一次，持续更长窗口
- 在后台窗口内，如果结果迟到返回，页面会自动更新成真实完成态

对应 UI 行为：

- 不再在 60 秒处直接显示红色失败
- 而是切成“仍在执行 / 仍在后台等待完成结果”的运行态提示

### 4. “超时”不再默认等于失败

这轮之后，只有这些情况才应进入失败语义：

- `result.status === "failed"`
- `result.status === "rejected"`
- 发起前的保存/校验链路本身失败
- 后台继续等待也被明确放弃或真正取消

单纯“60 秒内没拿到 result.json”不再是失败证据。

### 5. 前端停止观察时也只给中性/警告语义，不给红色失败

如果后台继续轮询窗口也耗尽，当前页面会落到：

- `仍未完成`
- `当前页面暂时停止等待，你可以稍后刷新页面再次查看最终写回结果`

这仍然不是执行失败，只是“当前页面停止继续观察”。

### 6. 等待取消需要和当前详情上下文绑定

当前等待 helper 支持 `shouldContinue()` 取消条件。`src/App.tsx` 里通过 `entryActionWatchIdRef` 把这条等待和当前详情上下文绑定起来：

- 切换条目
- 清空 entry-action 反馈
- 重新发起新的动作

都会使旧等待链路失效，避免迟到结果把错误状态写回到新的详情上下文里。

## 长期规则

### 1. `started` 的长尾窗口不能再被前端直接映射成失败

只要执行协议继续保持：

- `/run` 立即返回 `started`
- `result.json` 在 Codex 完成后才落盘

前端就必须保留“started 长尾等待”这层中间语义。

### 2. 排查“先失败后成功”时，优先检查前端等待窗口，而不是先怀疑写回真假

如果用户反馈：

- 详情面板先显示失败
- 刷新后发现条目其实已经变了

默认先查：

- 前端是否在结果落盘前停止等待
- 当前页面是否被旧等待链路取消
- `result.json` 的生成时间是否晚于前端原始等待窗口

而不是先把它当作 Codex 执行失败或条目定位错误。

### 3. 结果可信度仍由 `result.status + writebackCheck` 决定

这轮修复只解决“等待语义误判”，不改变最终结果判断标准。

真实完成态仍然看：

- `completed_with_writeback`
- `completed_without_observed_writeback`
- `writebackCheck`

前端等待更久，不等于放宽结果可信度。

## 关联代码

- `src/App.tsx`
- `src/entry-action-result-wait.ts`
- `scripts/run-entry-action.mjs`
- `src/api/client.ts`
- `src/detail/DetailPanel.tsx`
- `tests/entry-action-result-wait.test.mjs`

## 关键检索词

- `waitForEntryActionResult`
- `EntryActionResultWaitCancelledError`
- `后台继续轮询`
- `自动化耗时较长`
- `started`
- `completed_with_writeback`
- `completed_without_observed_writeback`