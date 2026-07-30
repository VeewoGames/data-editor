# entryActions 第二版第二阶段：正式运行时真值切换与个人自动化入口收口

<!-- state: current -->

## context

这条 truth 只沉淀第二阶段完成后的最终运行时决策，不重复第一阶段的存储/API 基础设施，也不重复第二版为什么要转成双层个人化配置的方向性判断。

第二阶段完成后，`entryActions` 的正式运行时真值已经从旧的 `project.entryActions` 切到
`automation profile + machine-local automation bindings`。`Automation Settings` 负责个人
自动化编辑，`Project Settings` 只保留项目元数据职责；当前 registry 归一化会直接剥离 legacy
`entryActions`，不再提供自动迁移入口。

## decision

### 1. 正式运行时真值切换到 `automation profile + machine-local automation bindings`

第二版运行时不再以 `project.entryActions` 作为正式真值来源，而是明确采用双层真值：

- 用户级 `automation profile`
- 机器本地 `automation bindings`

详情按钮可见性仍围绕这两层真值判断，而不是再回读项目级旧配置。当前
`POST /api/entry-actions/run` 只进入 proposal-only service，并额外要求已启用且命中目标的规则、
可用本机 binding、action 级 policy、authority 与 fencing admission。执行边界由
[`entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md`](./entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md)
单独拥有。

### 2. `project.entryActions` 只保留历史来源语义

旧 `project.entryActions` 不再进入规范化后的 project definition。加载 legacy registry 时，
`src/project-registry.mjs::normalizeProjectDefinition(...)` 只保留正式项目字段并剥离该属性。
它不再承担以下职责：

- 详情按钮是否显示
- 已禁用入口是否允许进入执行
- 新入口里规则层的长期编辑职责
- 自动导入到 `automation profile`

后续代码和排障语义里，只能把它理解为历史输入，不应再把它当成正式运行时真值、迁移来源或
长期 fallback。

### 3. 详情按钮和服务端前置校验都按双层真值收敛

详情按钮是否显示，必须同时满足：

- 当前条目命中 `automation profile` 的规则
- 当前设备存在可用的 `automation bindings`

服务端在执行前也必须做同一套双层前置校验，再返回稳定的 `started / rejected / error` 结果和原因码。换句话说，前端可见性和后端执行准入使用的是同一套最终语义，不允许出现“按钮显示逻辑”和“实际执行校验”分叉的长期状态。

### 4. legacy registry 不再触发自动迁移

当前实现不再从旧项目级规则自动生成 `automation profile`，也不迁移 `automation bindings`。
遇到 legacy registry 字段时，registry 归一化负责剥离，而不是生成新的个人配置。

这不会改变 bindings 的 machine-local 边界：新设备仍必须在 `Automation Settings` 中单独配置
当前设备上的 provider、skill 与执行参数，不能从 legacy 项目字段推断设备绑定。

### 5. `Automation Settings` 是正式个人自动化入口，不再是 `Project Settings` 的附属页面

第二阶段最终收口后的 UI 边界是：

- `Automation Settings` 承担个人自动化规则和设备绑定维护
- `Project Settings` 只承担项目元数据

这条入口分离不是临时排版调整，而是长期信息架构边界。

### 6. `Automation Settings` 新增最小 validation issues 面板，保存前先做本地收口

第二阶段收口后，设置页必须在保存前提供最小可发现性提示，避免非法规则和绑定进入保存链。

本地会检查的 issues 包括：

- rule `id` 格式
- 重复 `id`
- 空 `label`
- 空 `icon`
- 空 `target files`
- 空 `target collections`
- 启用中的 rule 对应的 binding `provider`
- 启用中的 rule 对应的 binding `skill`

只要存在这些本地问题，`Save Automation` 就会直接禁用。

这层 issues 面板只负责前端可见性和最小收口，不替代服务端的 `validateAutomationProfile(...)` / `validateAutomationBindings(...)`。

### 7. `Automation Settings` 弹窗的放宽必须覆盖共享基样式的宽度上限

`Automation Settings` 的视觉减压不是单纯增加一个 class 名就会生效，真正的长期约束是：

- `src/App.tsx` 里的弹窗内容已经挂上 `automation-settings-dialog`
- `src/styles.css` 的通用 `.dialog-content` 仍保留默认窄宽度上限
- 因此 `.automation-settings-dialog` 必须同时覆盖 `width`、`max-width` 和 `min-width`

如果只加特化 class，却没有覆盖这三项宽度约束，弹窗仍会被共享基样式卡回窄布局。后续再做类似设置页优化时，应优先先查共享弹窗基类是否还在收紧宽度。

### 8. 侧边栏里的项目管理入口和自动化入口是三个独立按钮

`src/components/Sidebar.tsx` 里的用户入口已经按职责拆分，不应再把自动化设置当成项目设置的附属动作。

当前稳定结构是三枚独立图标按钮：

- `Add project`
- `Project settings`
- `自动化设置`

后续如果侧边栏按钮顺序、可见性或 aria 文案出现问题，应按这三个独立入口分别排查，而不是把它们当成同一个设置入口的不同态。

### 9. 自动化设置的本地化规则是“字段英文、周边中文”

`Automation Settings` 面向用户的文案有明确边界：字段级、schema-facing 的标识继续保留英文，避免破坏稳定映射；状态、帮助、分组、按钮等周边文案可以并且应该翻成中文。

必须保留英文的字段/标签包括：

- `Rule Id`
- `Label`
- `Icon`
- `Skill`
- `Target Files`
- `Target Collections`

对应的回归测试也应优先断言中文对话框名、按钮名和 summary chips，而不是旧的英文字符串。这类测试才能覆盖实际可见的产品文案边界。

### 10. 规则草稿的编辑态选择身份与业务 `Rule Id` 解耦

`Rule Id` 是保存前严格校验的业务字段，但在设置页编辑期间允许暂时为空、重复或被修改。因此，
规则列表的当前选择不能以 `rule.id` 作为身份，否则未完成规则会无法重新选中，修改 `Rule Id`
也会让详情面板失焦或跳到其他规则。

当前编辑态统一使用原始 `automation profile.rules` 数组索引：

- 搜索结果保留原始数组索引，不把过滤结果下标当作规则身份
- 规则卡片点击与详情定位都读写 `selectedRuleIndex`
- 修改 `Rule Id` 不改变当前选择
- 新增后选择新规则的原始数组索引
- 删除后按被删位置和剩余长度归一化选择
- 搜索导致当前规则不可见时，只在可见原始索引集合中归一化选择

这条规则只约束 `Automation Settings` 的未保存编辑态，不改变 `automation profile` 的持久化
schema、bindings 的 `ruleId` 关联方式或服务端保存校验。排查空白/重复 `Rule Id` 无法编辑、
搜索后选错规则、删除后详情错位时，应先检查
`src/automation-rule-selection.mjs` 与 `selectedRuleIndex` 的消费链。

### 11. `Rule Id` 改名与 binding 生命周期必须作为同一草稿事务维护

持久化 binding 仍以合法 `ruleId` 为键，因此编辑 `Rule Id` 时，profile 草稿与
`automation-bindings.bindings` / `bindingStatuses` 必须同步改键。当前链路固定为：

- `updateRuleId(...)` 从 `profileRef.current` 读取旧 id，更新规则后立即调用
  `remapAutomationRuleBindingKey(...)`
- `Rule Id` 暂时清空再重新输入时，binding 会跟随空键迁移，不会丢失或残留旧键
- 删除规则时通过 `removeAutomationRuleBinding(...)` 同步删除 binding 与状态
- 打开、加载和保存设置时通过 `pruneOrphanAutomationRuleBindings(...)` 移除 profile 中已无
  对应规则的孤立 binding
- 保存使用 `profileRef.current` 与 `bindingsRef.current` 的同步快照，先清理孤立项并校验，再按
  `saveAutomationProfile(...)`、`saveAutomationBindings(...)` 顺序提交

这条事务只维护草稿一致性，不把空或重复 `Rule Id` 合法化，也不把双保存链描述为原子提交。
排查“摘要显示无效项为 0，但保存按钮仍被隐藏 binding 禁用”时，应先检查
`src/automation-rule-draft.mjs`、两个同步 ref 与保存前 prune 链。

## consequences

- 后续运行时排查 `entryActions` 时，默认先看 `automation profile` 和 `automation bindings`，不要再从 `project.entryActions` 反推正式真值。
- 新设备使用已有 `automation profile` 时，仍必须单独补齐本机 bindings。
- 详情按钮“没显示”不再是黑盒现象，它要么是规则没命中，要么是本机 bindings 不可用。
- 服务端执行失败时，原因码应优先区分规则缺失、规则禁用、目标不匹配、绑定缺失、绑定禁用和绑定无效，而不是笼统吞成通用错误。
- 设置页保存前会先暴露最小本地 issues，防止非法 `automation profile` / `automation bindings` 被写入。
- 旧 `project.entryActions` 会在 registry 归一化时被剥离，不再提供自动迁移、长期双读或隐式 fallback。
- 自动化设置弹窗的宽度优化必须同时覆盖 shared dialog base 的宽度上限，否则视觉上不会真正放宽。
- 侧边栏里的项目管理入口和自动化入口必须保持分离，避免把用户级自动化误归到项目设置里。
- 自动化设置页面的本地化规则是字段英文、周边中文，回归测试应按中文文案和 summary chip 断言。
- `Rule Id` 的校验失败不会剥夺规则草稿的编辑身份；列表过滤、字段修改、新增和删除都必须保持
  原始数组索引语义。
- `Rule Id` 改名、清空、重新输入或删除时，binding 与状态键必须同步迁移或清理；保存前不得让
  profile 不再引用的孤立 binding 继续参与全局校验。

## related code

- `src/components/Sidebar.tsx`
- `src/App.tsx`
- `src/api/client.ts`
- `src/automation-profile.mjs`
- `src/automation-rule-selection.mjs`
- `src/automation-rule-draft.mjs`
- `src/automation-bindings.mjs`
- `src/entry-actions.mjs`
- `server.mjs`
- `tests/automation-profile.test.mjs`
- `tests/automation-rule-selection.test.mjs`
- `tests/automation-rule-draft.test.mjs`
- `tests/automation-bindings.test.mjs`
- `tests/data-editor.spec.ts`
- `tests/open-stop.test.mjs`
- `src/styles.css`

## search terms

`Automation Settings`、`automation profile`、`automation bindings`、`project.entryActions`、`normalizeProjectDefinition`、`run-entry-action`、`detail button visibility`、`validation issues`、`selectedRuleIndex`、`automation-rule-selection`、`automation-rule-draft`、`Rule Id`、`remapAutomationRuleBindingKey`、`pruneOrphanAutomationRuleBindings`、`missing_binding`、`binding_invalid`、`validateAutomationProfile`、`validateAutomationBindings`

<!-- state: history -->
## 演进记录

<!-- dated: 2026-07-29 -->
### 一次性导入方案退出当前链路

第二阶段曾允许在 `automation profile` 为空时把旧 `project.entryActions` 导入个人规则层，同时要求
用户另行补齐 machine-local bindings。旧项目字段随后退出 registry 正式结构；当前加载链直接
剥离该属性，不再把历史项目配置自动提升为个人自动化真值。
