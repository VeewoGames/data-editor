# entryActions 第二版第二阶段：正式运行时真值切换与个人自动化入口收口

<!-- state: current -->

## context

这条 truth 只沉淀第二阶段完成后的最终运行时决策，不重复第一阶段的存储/API 基础设施，也不重复第二版为什么要转成双层个人化配置的方向性判断。

第二阶段完成后，`entryActions` 的正式运行时真值已经从旧的 `project.entryActions` 切到 `automation profile + machine-local automation bindings`。`Automation Settings` 负责个人自动化编辑与迁移导入，`Project Settings` 只保留项目元数据职责。

## decision

### 1. 正式运行时真值切换到 `automation profile + machine-local automation bindings`

第二版运行时不再以 `project.entryActions` 作为正式真值来源，而是明确采用双层真值：

- 用户级 `automation profile`
- 机器本地 `automation bindings`

详情按钮可见性仍围绕这两层真值判断，而不是再回读项目级旧配置。`run-entry-action`
只保留为 legacy handler 的历史实现：当前 `POST /api/entry-actions/run` 在进入它之前固定返回
HTTP 503 `ENTRY_ACTION_PROTOCOL_DISABLED`。新任务门禁由
[`entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md`](./entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md)
单独拥有。

### 2. `project.entryActions` 只保留迁移来源语义

旧 `project.entryActions` 现在只作为一次性迁移来源，不再承担以下职责：

- 详情按钮是否显示
- 已禁用入口是否允许进入执行
- 新入口里规则层的长期编辑职责

后续代码和排障语义里，只能把它理解为历史来源，不应再把它当成正式运行时真值或长期 fallback。

### 3. 详情按钮和服务端前置校验都按双层真值收敛

详情按钮是否显示，必须同时满足：

- 当前条目命中 `automation profile` 的规则
- 当前设备存在可用的 `automation bindings`

服务端在执行前也必须做同一套双层前置校验，再返回稳定的 `started / rejected / error` 结果和原因码。换句话说，前端可见性和后端执行准入使用的是同一套最终语义，不允许出现“按钮显示逻辑”和“实际执行校验”分叉的长期状态。

### 4. 旧规则层自动迁移到个人 automation profile，但 bindings 不自动迁移

第二阶段允许把旧项目级规则一次性导入到个人 `automation profile`，但不迁移 `automation bindings`。

不自动迁移 bindings 的原因是它们是 machine-local 语义，绑定内容天然依赖当前设备上的 provider、skill 和本地执行环境。把这些内容自动迁到另一层只会制造错误可用性假象，或者把设备专属绑定污染成跨设备假设。

因此，迁移只负责把旧规则层搬进新规则层；设备绑定仍然要由当前机器在新入口里重新确认和补全。

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

## consequences

- 后续运行时排查 `entryActions` 时，默认先看 `automation profile` 和 `automation bindings`，不要再从 `project.entryActions` 反推正式真值。
- 新设备可以沿用已迁移的规则层，但必须单独补齐本机 bindings。
- 详情按钮“没显示”不再是黑盒现象，它要么是规则没命中，要么是本机 bindings 不可用。
- 服务端执行失败时，原因码应优先区分规则缺失、规则禁用、目标不匹配、绑定缺失、绑定禁用和绑定无效，而不是笼统吞成通用错误。
- 设置页保存前会先暴露最小本地 issues，防止非法 `automation profile` / `automation bindings` 被写入。
- 旧 `project.entryActions` 只保留为一次性迁移来源，不再保留长期双读或隐式 fallback。
- 自动化设置弹窗的宽度优化必须同时覆盖 shared dialog base 的宽度上限，否则视觉上不会真正放宽。
- 侧边栏里的项目管理入口和自动化入口必须保持分离，避免把用户级自动化误归到项目设置里。
- 自动化设置页面的本地化规则是字段英文、周边中文，回归测试应按中文文案和 summary chip 断言。

## related code

- `src/components/Sidebar.tsx`
- `src/App.tsx`
- `src/api/client.ts`
- `src/automation-profile.mjs`
- `src/automation-bindings.mjs`
- `src/entry-actions.mjs`
- `server.mjs`
- `tests/automation-profile.test.mjs`
- `tests/automation-bindings.test.mjs`
- `tests/data-editor.spec.ts`
- `tests/open-stop.test.mjs`
- `src/styles.css`

## search terms

`Automation Settings`、`automation profile`、`automation bindings`、`project.entryActions`、`run-entry-action`、`detail button visibility`、`validation issues`、`missing_binding`、`binding_invalid`、`importLegacyEntryActions`、`validateAutomationProfile`、`validateAutomationBindings`
