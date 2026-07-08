# Automation Settings Skill 真值链与最小保存边界

status: accepted

## context

这条 truth 只沉淀 task 3 已经稳定下来的 Skill 真值层与保存边界，不记录还在推进中的 Skill 选择器 UI 细节，也不把未完全落地的交互状态提前写成长期结论。

当前可复用的稳定事实是：Automation Settings 里的 Skill 不属于 `automation-profile`，而是属于 `automation-bindings.bindings[ruleId].skill` 这一层；保存前的合法性判断链也已经固定到具体的 runtime 解析函数上。

## 结论

### 1. Skill 的正式存储层在 `automation-bindings`，不在 `automation-profile`

`automation-profile` 只负责规则层字段：

- `id`
- `label`
- `icon`
- `enabled`
- `targets`
- `payload`

`Skill` 不应被写回到 `automation-profile`，也不应被当成规则层的附属扩展位。正式落盘与读取都应优先按 `automation-bindings.bindings[ruleId].skill` 理解。

### 2. 真实合法性判断链已经收口到 runtime 解析函数

当前可复用的合法性判断链固定为：

- `src/codex-runtime.mjs::resolveCodexSkill(...)`
- `src/codex-runtime.mjs::resolveCodexBindingStatus(...)`

这意味着保存前的校验不能只看 catalog 是否命中，也不能把 `skill` 当成静态字符串字段直接放行；它必须复用 runtime 的真实解析语义。

### 3. 当前保存顺序是双保存链，不是合并写入

前端当前的保存顺序仍是：

- `saveAutomationProfile(profile)`
- `saveAutomationBindings(bindings)`

因此，若把 runtime 校验直接塞进 bindings 保存链而不做前置收口，就会出现 `profile` 已经落盘、但 `bindings` 因校验失败被拒绝的部分成功风险。

### 4. 当前最小一致性保护是 `bindings validateOnly` 预校验 + 现有双保存链

在还没有切到 combined save 之前，最小可接受边界是：

- 先对 `bindings` 做服务端 `validateOnly` 预校验
- 再沿用现有的 `saveAutomationProfile` -> `saveAutomationBindings` 双保存链

这条边界的目标不是一次性重构成单请求写入，而是先消掉“profile 已保存、bindings 失败”的部分成功风险。

## 长期行为 / 规则

### 1. 看到 Automation Settings 的 Skill，默认先查 `automation-bindings`

排障或回归时，优先从 `automation-bindings.bindings[ruleId].skill` 找正式值，不要先回头猜 `automation-profile` 是否扩了字段。

### 2. Skill 合法性判断必须复用 runtime 解析链

后续任何保存前校验、状态展示或回归修复，只要涉及 Skill 是否可用，都应默认以 `resolveCodexSkill(...)` 和 `resolveCodexBindingStatus(...)` 为准。

### 3. 在 combined save 落地前，不把双保存链伪装成原子写入

当前边界只保证“先预校验，尽量减少部分成功”，不保证 profile 和 bindings 的单请求原子提交。后续若要升级提交语义，应另起明确的架构决策，不要在 truth 里假设它已经完成。

## 关联代码

- `src/codex-runtime.mjs`
- `src/automation-bindings.mjs`
- `src/automation-profile.mjs`
- `src/api/client.ts`
- `src/App.tsx`
- `server.mjs`
- `docs/plans/2026-07-08-Automation-Settings-Skill选择与校验具体执行方案.md`
- `.claw/tmp/automation-settings-skill-task3-truth-input.md`

## 关键检索词

`automation-bindings`、`automation-profile`、`resolveCodexSkill`、`resolveCodexBindingStatus`、`validateOnly`、`saveAutomationProfile`、`saveAutomationBindings`、`部分成功风险`
