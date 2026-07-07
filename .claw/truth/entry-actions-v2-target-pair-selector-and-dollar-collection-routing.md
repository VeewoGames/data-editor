# entryActions 第二版目标范围收口：正式语义改为精确 file-collection 对，`$` 只在文件上下文里解释

status: accepted

## context

这条 truth 只沉淀 `Automation Settings` 第二版里目标范围的正式语义和稳定排查路径。

此前规则配置使用两组独立数组：`targets.files[]` 与 `targets.collections[]`。这种写法虽然能表达“可能的文件”和“可能的 collection”，但它不能表达真正的命中对，因此会产生一种早期假象：

- 配置看起来已经覆盖了某个文件
- 配置看起来也已经覆盖了某个 collection
- 但这两者不一定属于同一个真实目标

`traits.json` 场景暴露了这个问题：规则里把 `data/traits.json` 和 `skills` 同时填进去时，配置本身能保存，但详情按钮在 `traits` 条目里不会出现。

## 结论

### 1. 目标范围的正式真值已经从“独立 file / collection 集合”收口为“精确 target pair”

当前正式规则结构不再把目标解释成：

- 一组 `files`
- 一组 `collections`

而是解释成：

- 一组精确的 `{ file, collection }` 对

关键锚点：

- `src/api/client.ts` 的 `EntryActionRule.targets`
- `src/automation-profile.mjs::normalizeTargets(...)`
- `src/entry-actions.mjs::validateEntryActionTarget(...)`
- `src/App.tsx::resolveVisibleEntryActions(...)`

这意味着运行时命中规则已经变成：

- 当前 `selectedPath`
- 当前 `collectionPath`
- 必须同时命中同一个 target pair

而不是“文件命中一次、collection 命中一次即可”。

### 2. `traits.json` 不显示按钮的真实根因是 pair 不匹配，不是按钮系统失效

这类问题现在的排查顺序应该固定为：

1. 确认当前文件真实路径，例如 `data/traits.json`
2. 确认当前详情条目所在 collection，例如 `traits`
3. 检查 rule.targets 中是否存在完全一致的 `{ file: "data/traits.json", collection: "traits" }`

只要 pair 不存在，按钮就不会出现；即使：

- 同一条规则里已经包含 `data/traits.json`
- 同一条规则里也已经包含 `skills` 或别的 collection

也不能算命中。

### 3. `Automation Settings` 的候选 collection 正式来源是 `listFiles + loadDocument + model.collections`

目标选择器不再要求用户手写 `Target Files` / `Target Collections` 文本。

当前正式候选生成链路在 `src/App.tsx::AutomationSettingsDialog(...)`：

- 先使用当前项目的 `files`
- 对每个文件调用 `loadDocument(file.path, projectId)`
- 再从 `DocumentModel.collections` 读取这个文件真实存在的 collection 列表

长期含义：

- 候选 collection 必须以“某个具体文件实际解析出的 collections”为准
- 不应再把 collection 视为脱离文件上下文的全局字符串池
- 任何“目标选择器”体验增强，都应围绕 file-scoped collections 做，而不是回到自由文本

### 4. `$` 不是全局唯一 collection 名，它只在具体文件上下文中成立

`$` 的语义来自 `src/document-model.mjs`：

- 根数组文件会暴露 `$`
- 根对象映射也会暴露 `$`
- `getRows(model, "$")` 读取的就是这个文件根层的行集合

因此 `$` 不能单独作为目标标识使用。

正式识别方式必须是：

- `sourcePath + collectionPath`

也就是：

- `data/e2e_select.json + $`
- `data/other-root-array.json + $`

是两个不同目标。

当前设置页也应把它显示成文件上下文里的根集合，例如：

- `skills.json · 根集合 ($)`
- `traits.json · 根集合 ($)`

而不是只显示一个裸 `$`。

### 5. 旧 profile 仍可能带着 legacy 结构进入前端，因此前端读取层必须做归一化

虽然服务端 `src/automation-profile.mjs` 已经能把旧结构迁成 target pairs，但前端不能假设浏览器里永远只会拿到新形状。

当前 `src/api/client.ts` 已增加读取归一化：

- `loadAutomationProfile(...)` 先走 `normalizeFetchedAutomationProfile(...)`
- 旧的 `targets.files[] + targets.collections[]` 会被转成 pair 列表
- `saveAutomationProfile(...)` 保存前也会统一成新结构

这条边界很重要，因为否则旧配置会在前端 `targets.some(...)` 处直接崩掉，页面甚至可能变成空白。

### 6. 本轮之后，`Target Files` / `Target Collections` 文本框不应再被视为正式配置面

第二版的正式配置语义已经从“自由文本编辑”切到“联动目标选择器”。

因此后续若再做体验增强，默认方向应是：

- 更好的 target pair 编辑器
- 更清晰的当前文件 / 当前 collection 快速填充
- 更直观的根集合文案

而不是回退到两块自由文本框继续扩展。

## 长期排查规则

### 1. 按钮不显示时，先看精确 pair，再看 binding

排查顺序应固定为：

1. 当前 `selectedPath`
2. 当前 `collectionPath`
3. rule.targets 是否有完全一致 pair
4. binding 是否存在、启用且 `skill` 非空

不要再先看“这个文件有没有出现在 files 列表里”“这个 collection 有没有单独出现过”。

### 2. 看到多个 `$` 时，不要把它当成冲突

多个 `$` 只说明多个文件都是根集合形态，不代表目标重复。

真正的唯一性键仍然是：

- `file + collection`

### 3. 任何后续 schema、校验或按钮过滤改动，都不能再退回笛卡尔式双数组匹配

旧结构最大的长期风险是：

- 保存合法
- 运行时不透明
- 用户难以理解为什么按钮不出现

因此后续若改动 `EntryActionRule.targets`、服务端校验或详情按钮过滤，必须保住 pair 语义，不能再回到 `files[] x collections[]` 的隐式匹配模型。

## 关联代码

- `src/App.tsx`
- `src/api/client.ts`
- `src/automation-profile.mjs`
- `src/entry-actions.mjs`
- `src/document-model.mjs`
- `tests/automation-profile.test.mjs`
- `tests/entry-actions.test.mjs`
- `tests/data-editor.spec.ts`

## 关键检索词

- `EntryActionTarget`
- `resolveVisibleEntryActions`
- `validateEntryActionTarget`
- `normalizeFetchedAutomationProfile`
- `normalizeTargets`
- `model.collections`
- `collectionPath === "$"`
- `target pair`