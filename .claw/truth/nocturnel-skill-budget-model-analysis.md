# Nocturnel 技能预算模型：单点权威入口与三份指南职责边界

这条 truth 只沉淀未来处理 Nocturnel 技能开发文档、预算评分或模板调整时可复用的查找入口和审计边界，不记录任务进度。

## 稳定结论

Nocturnel 玩家主动技能完整 BU 预算模型已经集中到单一权威入口：

- `C:\Code\Nocturnel\项目文档\标准&指南\技能预算指南（AI 专用）.md`

后续处理技能预算、预算评分、技能设计模板或技能文档审计时，不应再把完整 BU 分值表分别写进多份指南。预算模型、预算账本、BU 分值和预算结论应单点维护在技能预算指南；其他指南只保留本职内容，并轻量引用该指南。

## 审计边界

“完整评分记录”和“预算拆账”不是同一层级：

- 完整评分记录用于解释最终评分结果，证明技能是否达标。
- 预算拆账用于解释数值消耗如何从 AP、冷却、范围、目标数、控制、条件、风险等因素推导出来。

因此，后续如果要提升技能预算可审计性，不能只要求补充评分记录；还需要单独定义或引用预算拆账结构。

## 文档职责边界

以下文档仍是相关资料入口，但不再承担完整 BU 账本维护职责：

1. `C:\Code\Nocturnel\项目文档\数值\战斗数值平衡手册 2.0（AI 专用）.md`
   - 只维护伤害公式、AP 效率、层级数值锚点和战斗数值红线。
   - 涉及完整 BU 账本时，应引用 `技能预算指南（AI 专用）.md`。
2. `C:\Code\Nocturnel\项目文档\标准&指南\技能设计指南（AI 专用）.md`
   - 只维护设计流程、字段语义、标签要求和输出模板入口。
   - 预算账本、BU 分值和预算结论应引用 `技能预算指南（AI 专用）.md`。
3. `C:\Code\Nocturnel\项目文档\标准&指南\技能(玩家)品质标准（AI专用）.md`
   - 只维护评分流程、评分维度和完整评分记录。
   - `AP 与数值预算` 20 分依据 `技能预算指南（AI 专用）.md` 的账本评分。

## 使用方式

- 写技能开发文档前，先查 `技能预算指南（AI 专用）.md` 获取完整 BU 预算模型，再按需要查设计指南或品质标准。
- 做预算评分时，先确认 `AP 与数值预算` 维度来自品质标准，再使用技能预算指南的账本判断预算消耗是否可解释。
- 调整 AI 输出模板时，不要复制完整 BU 分值表；模板只需要指向技能预算指南，并要求产出可审计的预算账本。
- 修改战斗数值手册、技能设计指南或品质标准时，避免把预算模型再次分叉到这些文档中。

## 同池 BU 校准样本边界

读取 Nocturnel 技能样本时，主数据锚点是 `C:\Code\Nocturnel\data\skills.json` 根对象下的 `skills` 集合，不是 JSON 根数组。后续做同池 BU 校准、data-editor 文档解析或技能对象抽样时，应先进入 `skills` 集合再按 `skill_id` 定位。

`skill_axe_throw` 的同池 BU 校准样本可以优先参考以下技能对象：

- `skill_axe_throw`
- `skill_throw_knife`
- `skill_thrust`
- `skill_armor_break`
- `skill_weapon_bow_shot`

这些对象适合作为“同池校准样本”，但不应直接当作已验证强度标准。当前四个对照技能的开发文档多数还没有正式评分，且 `C:\Code\Nocturnel\data\skills.json` 中 `skill_throw_knife`、`skill_thrust`、`skill_armor_break`、`skill_weapon_bow_shot` 的 `rating` 为空；做 `skill_axe_throw` 预算校准时，应把它们作为待审计参照，而不是稳定标尺。

两个样本风险需要优先复核：

- `skill_armor_break` 当前 `nodes` 只有 `damage` / `stat_mod`，没有 `targeting` node，但 top-level 显示 `range_type_show: "adjacent"`、`range_value_show: 1`。后续审计此类技能时，要检查 top-level 展示字段与 `nodes` 执行边界是否一致。
- `skill_throw_knife` 是 `1 AP`、`cooldown: 1`、`sight 3`、`0.6 AD + base 5`，并附带 `1` 层 `bleed`、持续 `3` 回合。它可能是 `1 AP` 远程 + DoT 的超预算样本，必须先复核预算账本和强度边界，不能直接拿来反向校准 `skill_axe_throw`。

## 正式账本样例

`C:\Code\Nocturnel\项目文档\开发\技能\skill_axe_throw.md` 已经迁移为独立 `技能预算指南（AI 专用）.md` 体系下的正式 BU 预算账本样例。

该技能文档的长期可复用结构顺序是：技能摘要、正式规则、预算账本、风险与待确认、评分结论摘要、完整评分记录、附录。后续迁移技能开发文档时，可以优先参考这个顺序：预算账本前置于完整评分记录，用于解释数值预算；完整评分记录继续保留在预算账本之后，用于解释评分结论。

`skill_axe_throw` 当前账本样例的审计结论是：可用预算 `235 BU`，消耗预算 `235 BU`，差额 `0 BU`。这表示预算通过，但属于边界稳定型技能；后续调整伤害、控制、范围、目标数或支付项时，应重新核对 BU 账本，不能只改评分文字。

data-editor 读取该技能文档时，长期验证入口是：

- `/api/document-index?path=data/skills.json&refresh=1` 中 `skill_axe_throw` 应能 resolved。
- `/api/document-content?path=data/skills.json&id=skill_axe_throw&refresh=1` 应能读到对应 Markdown 内容。

## data-editor 模板文档入口

后续在 `C:\Code\data-editor` 侧调整 Nocturnel 技能开发文档模板时，优先从这两份 specs 查模板结构和瘦身边界：

- `C:\Code\data-editor\docs\superpowers\specs\2026-07-09-技能开发文档新模板草案.md`
- `C:\Code\data-editor\docs\superpowers\specs\2026-07-09-技能开发文档模板瘦身优化方案.md`

这两份 data-editor 文档只维护模板结构、章节职责和引用关系，不维护完整 BU 分值表。完整预算模型仍统一回源 `C:\Code\Nocturnel\项目文档\标准&指南\技能预算指南（AI 专用）.md`；模板侧只要求产出可审计预算账本，并保留完整评分记录作为评分审计层。

## 生成入口与持久化模板控制点

后续要落地 Nocturnel 技能开发文档的实际生成时，真正的控制点不在项目计划正文，而在用户侧 `design-skill` 的 skill 指令与 references：

- `C:\Users\lans\.codex\skills\design-skill\SKILL.md`
  - 这里定义了 `Write or update a skill development document` 这条专用路由，明确它是写入 skill `dev_doc` 字段的持久化入口。
  - 该路由要求优先使用 `references/workflows-and-checklists.md` 里的 `Skill Development Document Template`，而不是交互式 `Formal Output Skeleton`。
  - 该路由还要求把高价值决策内容前置、保留 `完整评分记录`，并把原始引用清单和字段读数等噪声移出正文主干。
- `C:\Users\lans\.codex\skills\design-skill\references\workflows-and-checklists.md`
  - 这里定义了 persisted `dev_doc` 的固定章节顺序：`技能摘要`、`正式规则`、`预算账本`、`风险与待确认`、`评分结论摘要`、`完整评分记录`、`附录：开发记录`。
  - 这份模板的长期职责是存放可复用设计决策和可审计账本结果，不承担完整 BU 模型本体。
  - 静态验证确认，`正式规则与关键预算`、`预算拆解` 这类旧持久化模板措辞没有作为默认章节残留在这个 route 里；`引用清单` 仍只属于交互式 `Formal Output Skeleton`。
- `C:\Users\lans\.codex\skills\design-skill\references\current-skill-fields.md`
  - 这里补充了当前设计场景的权威来源集合，包含 AI 专用设计指南、玩家品质标准和预算指南，说明技能文档生成时需要同时尊重设计、评分和预算三类真值源。

因此，后续若要调整 Nocturnel 技能开发文档的实际生成行为，应优先改 `design-skill` 的路由和持久化模板，而不是只改 Nocturnel 项目内的计划文档或样例正文。`dev_doc` 的稳定产物应是“预算账本 + 评分审计”的结果文档，不是把完整 BU 模型复制进每份技能稿。
