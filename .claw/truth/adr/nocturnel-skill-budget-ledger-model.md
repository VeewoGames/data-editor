# Nocturnel 技能预算账本模型

## Status

accepted

## context

“建立完整技能预算模型方案”已经完成。方案确认 Nocturnel 当前技能预算模糊的根因不是单纯文档压缩，而是缺少统一的可审计预算账本。

现有资料已经提供 AP 档位、修正因子、冷却/范围/目标/控制等预算影响因素，以及完整评分记录要求。但如果继续只扩展自然语言评分理由或 AP 档位说明，技能开发文档仍难以解释具体数值消耗如何从这些因素推导出来。

因此需要把“预算拆账”沉淀为独立模型层，作为后续设计指南、评分模板和技能开发文档更新的长期边界。

后续“建立独立技能预算指南并轻量接入现有指南”已完成。该轮工作把完整 BU 技能预算模型集中到独立 `C:\Code\Nocturnel\项目文档\标准&指南\技能预算指南（AI 专用）.md`，并明确三份既有指南只保留各自职责范围内的轻量入口，避免完整 BU 分值表在多份指南中重复维护并产生漂移。

后续“迁移 skill_axe_throw 开发文档为预算账本样例”已完成。`C:\Code\Nocturnel\项目文档\开发\技能\skill_axe_throw.md` 已经从自然语言预算拆解迁移为首个正式 BU 预算账本样例，并保留完整评分记录用于审计评分过程。

后续“校准 skill_axe_throw 同池样本 BU 分值”已完成。该轮产出 `C:\Code\Nocturnel\项目文档\开发\技能\skill_axe_throw 同池 BU 校准表.md` 作为同池样本校准证据；校准结论没有推翻 `skill_axe_throw` 当前 `235 BU` 可用预算与 `235 BU` 消耗预算，也没有形成足够依据去修改 `技能预算指南（AI 专用）.md` 的分值表。

后续“同步技能开发文档模板草案与瘦身方案”已完成。该轮把 `data-editor` 侧两份技能开发文档模板相关方案同步到同一预算账本边界：模板文档只维护结构和引用，不维护完整 BU 分值表；完整预算模型统一回源 `C:\Code\Nocturnel\项目文档\标准&指南\技能预算指南（AI 专用）.md`。

后续玩家技能职责拆分已经完成。玩家技能持久化 `dev_doc` 的当前设计入口已收口到 Nocturnel
repo-local `data-design-skill-player`。正式评审与评分 ownership 由
[`nocturnel-player-skill-review-authority-and-verification-gate.md`](./nocturnel-player-skill-review-authority-and-verification-gate.md)
单独拥有；用户级 `design-skill` 建立的模板边界保留为历史来源，不再是玩家技能的唯一当前入口。

## decision

### 1. 技能预算采用独立预算账本层

Nocturnel 技能预算的长期模型采用独立“预算账本层”，而不是继续只扩展自然语言评分或 AP 档位说明。

预算账本层负责把 AP、冷却、范围、目标数、控制、条件、风险、支付项、复合收益溢价和容差等因素拆成可查看的预算项，让技能数值消耗和支付能逐项审计。

### 2. 初版使用 `1 AP = 100 BU` 作为可读审计刻度

预算单位初版采用 `BU`，并以 `1 AP = 100 BU` 作为可读审计刻度。

该刻度不是最终平衡定值，而是第一版账本的统一读数单位。`skill_axe_throw` 已作为首个正式样例完成拆账，用于校准后续代表技能样本。

### 3. 预算账本前置于完整评分记录

预算账本应前置于完整评分记录。完整评分记录继续保留完整评分过程，用于解释技能是否达标；预算账本负责解释 AP 与数值预算分数的依据。

后续模板、设计指南或技能开发文档更新时，不应把预算账本压缩成评分记录中的自然语言段落。两者可以互相引用，但职责保持分离。

### 4. 初始落地范围先覆盖玩家主动技能方案

本轮完成的是完整方案文档，不直接修改设计指南，也不批量迁移现有技能文档。

第一阶段应先围绕玩家主动技能建立账本模板、代表样本和校准规则；敌人、Boss、装备词缀、符文等其他对象需要单独判断是否复用同一预算模型。

### 5. 完整 BU 模型采用单点权威指南维护

完整 BU 技能预算模型、分值表、预算账本模板、评分衔接和 `skill_axe_throw` 示例集中维护在独立 `技能预算指南（AI 专用）.md`。

三份既有指南不再承载完整 BU 分值表：

- `战斗数值平衡手册 2.0（AI 专用）.md` 只维护伤害公式、AP 效率、层级数值锚点和战斗数值红线。
- `技能设计指南（AI 专用）.md` 只维护设计流程、字段语义、标签要求和输出模板入口。
- `技能(玩家)品质标准（AI专用）.md` 只维护评分流程、评分维度和完整评分记录；`AP 与数值预算` 的评分依据来自预算指南账本。

预算相关模板、评分记录或技能开发文档需要完整 BU 分值时，应引用独立预算指南，而不是把分值表复制到上述三份指南。

### 6. `skill_axe_throw` 固定为首个正式 BU 预算账本样例

`C:\Code\Nocturnel\项目文档\开发\技能\skill_axe_throw.md` 固定作为首个正式 BU 预算账本样例，不在同一轮批量迁移同池技能。

该样例文档顺序固定为：技能摘要 -> 正式规则 -> 预算账本 -> 风险与待确认 -> 评分结论摘要 -> 完整评分记录 -> 附录。

预算账本放在完整评分记录之前，用于解释 AP 与数值预算依据；完整评分记录仍完整保留在后方，用于审计评分过程。本样例采用 `235 BU` 可用预算与 `235 BU` 消耗预算，作为边界稳定型技能示例。

### 7. 同池校准采用证据表与锚点分级，不用未复核样本反推分值表

`skill_axe_throw` 的同池 BU 校准应以独立校准表沉淀样本证据，而不是直接改写预算指南分值表。当前校准表确认 `skill_axe_throw` 的 `235/235 BU` 暂时站得住；后续只有在更多已正式评分样本形成一致证据后，才应调整 `技能预算指南（AI 专用）.md` 的分值表。

同池样本的锚点资格需要分级处理：

- `skill_weapon_bow_shot` 可作为 `2 AP` 远程基础攻击与 `0.75 AD` 远程安全支付锚点。
- `skill_thrust` 可作为近战破甲入口的健康样本，但仍需正式评分后才能作为稳定强度锚点。
- `skill_throw_knife` 和 `skill_armor_break` 暂不能作为已平衡强度锚点，应先单独复核。

后续校准不得用未正式复核的同池样本反向推翻已审计账本；应先确认样本本身是否健康，再决定它能否参与调整 BU 系数或权重。

### 8. 技能开发文档模板只维护结构和引用

技能开发文档模板的推荐结构固定为：技能摘要 -> 正式规则 -> 预算账本 -> 风险与待确认 -> 评分结论摘要 -> 完整评分记录 -> 附录。

模板文档只维护章节结构、章节职责和权威来源引用，不复制或维护完整 BU 分值表。完整 BU 分值表、预算项定义和预算模型仍统一回源 `C:\Code\Nocturnel\项目文档\标准&指南\技能预算指南（AI 专用）.md`。

`skill_axe_throw.md` 继续作为当前首个正式 BU 预算账本样例。完整评分记录继续保留；预算账本负责解释 AP 与数值预算依据，完整评分记录负责保留评分审计过程。

### 9. 玩家技能 `dev_doc` 的设计入口固定为 repo-local `data-design-skill-player`

Nocturnel 玩家技能开发文档的当前设计入口固定为 repo-local
`.agents/skills/data-design-skill-player`，不再由计划正文、临时草案或交互式回答骨架决定。

该 Skill 负责设计稿和 persisted `dev_doc`，但不得生成非空正式 `rating`。正式评分与完成门禁由
独立评审决定负责；本 ADR 只拥有设计入口与预算账本边界，不重复定义评分状态机。预算账本继续
回源独立预算指南。

对实际生成的技能开发文档来说，职责边界保持不变：

- `预算账本` 只记录该技能自己的具体 BU 账本结果、补偿与结论。
- 完整 BU 模型继续单点回源 `技能预算指南（AI 专用）.md`。
- `完整评分记录` 必须保留在评分结论摘要之后，记录完整评分过程而不是只留摘要。
- 原始引用清单、字段读取流水账和过程噪声不应进入持久化正文主干，除非它们本身会改变可复用决策。

## alternatives considered

- 继续扩展自然语言评分理由：无法稳定解释预算消耗与支付来源，审计粒度不足。
- 只补充 AP 档位说明：可以改善档位可读性，但不能表达复合收益、支付项、条件、风险和容差对预算的逐项影响。
- 把预算拆账并入完整评分记录：会让评分记录同时承担达标判断和数值推导两种职责，长期难以维护。

## consequences

- 后续技能预算相关文档应优先引用或生成预算账本，再进入完整评分记录。
- `BU` 成为第一版可读审计单位，样本校准可以调整系数或权重，但不应回退到纯自然语言预算说明。
- 技能开发文档可以直接暴露预算消耗、支付、溢价和容差，便于设计复核具体数值是否合理。
- 评分模板需要保留完整评分过程，但 AP 与数值预算分数的依据应来自预算账本，而不是重复写一套不可审计解释。
- 完整 BU 分值表只有一个维护入口，降低设计指南、数值手册和品质标准之间的维护成本与漂移风险。
- 三份既有指南的职责边界变窄：数值手册管数值锚点，设计指南管设计产出，品质标准管评分流程，预算指南管 BU 账本。
- 后续技能开发文档迁移可优先参考 `skill_axe_throw.md` 的章节顺序；若技能调整导致伤害、控制、范围、目标数或支付项变化，应重新核对 BU 账本，而不是只修改评分文字。
- 技能开发文档模板草案和模板瘦身方案不应成为第二份 BU 分值表维护点；它们只规定文档结构、引用关系和评分记录保留规则。
- repo-local `data-design-skill-player` 成为 Nocturnel 玩家技能持久化 `dev_doc` 的当前设计入口；
  计划正文和交互式答复只能提供上下文，不能替代持久化模板控制。
- 设计入口不拥有正式评分；具体评分与实现完成门禁规则回源独立玩家技能评审 ADR。
- persisted 技能文档前半段优先承载高价值设计决策与账本结果，后半段再保留完整评分记录，从而把交互式分析噪声与正式正文分离。
- 同池校准表成为调整预算指南前的证据层；单个样本或未复核样本不足以直接修改 BU 分值表。
- `skill_weapon_bow_shot` 可以支撑远程基础攻击和远程安全支付的局部锚点判断，但不能自动替代完整技能评分。
- `skill_throw_knife`、`skill_armor_break`、`skill_thrust` 在正式评分或单独复核完成前，应保持“参照样本”身份，避免把潜在超预算或字段边界问题固化进分值表。

## related code

- `C:\Code\data-editor\.claw\tasks\建立完整技能预算模型方案\plan.json`
- `C:\Code\data-editor\.claw\tasks\建立独立技能预算指南并轻量接入现有指南\plan.json`
- `C:\Code\data-editor\.claw\tasks\迁移-skill_axe_throw-开发文档为预算账本样例\plan.json`
- `C:\Code\data-editor\.claw\tasks\校准-skill_axe_throw-同池样本-BU-分值\plan.json`
- `C:\Code\data-editor\.claw\tasks\同步技能开发文档模板草案与瘦身方案\plan.json`
- `C:\Code\data-editor\.claw\tasks\落地技能开发文档实际生成模板\plan.json`
- `C:\Code\data-editor\docs\superpowers\specs\2026-07-09-技能开发文档新模板草案.md`
- `C:\Code\data-editor\docs\superpowers\specs\2026-07-09-技能开发文档模板瘦身优化方案.md`
- `C:\Users\lans\.codex\skills\design-skill\SKILL.md`
- `C:\Users\lans\.codex\skills\design-skill\references\workflows-and-checklists.md`
- `C:\Code\Nocturnel\.agents\skills\data-design-skill-player\SKILL.md`
- `C:\Code\Nocturnel\.agents\skills\review-player-skill\SKILL.md`
- `C:\Code\Nocturnel\.agents\skills\review-player-skill\references\review-contract.md`
- `C:\Code\Nocturnel\项目文档\标准&指南\技能预算指南（AI 专用）.md`
- `C:\Code\Nocturnel\项目文档\数值\战斗数值平衡手册 2.0（AI 专用）.md`
- `C:\Code\Nocturnel\项目文档\标准&指南\技能设计指南（AI 专用）.md`
- `C:\Code\Nocturnel\项目文档\标准&指南\技能(玩家)品质标准（AI专用）.md`
- `C:\Code\Nocturnel\项目文档\开发\技能\skill_axe_throw.md`
- `C:\Code\Nocturnel\项目文档\开发\技能\skill_axe_throw 同池 BU 校准表.md`

## search terms

`Nocturnel`、`技能预算`、`预算账本`、`BU`、`1 AP = 100 BU`、`235 BU`、`技能预算指南`、`技能开发文档模板`、`模板瘦身`、`完整评分记录`、`skill_axe_throw`、`同池校准`、`skill_weapon_bow_shot`、`skill_throw_knife`、`skill_armor_break`、`skill_thrust`

<!-- state: history -->
## Evolution history

<!-- dated: 2026-07-29 -->
### 用户级 `design-skill` 的唯一入口决定被玩家技能仓库本地职责取代

早期决定由用户级 `design-skill` 的
`Write or update a skill development document` 路由统一生成 persisted `dev_doc`。该决定建立的
预算账本与评分记录章节边界继续有效，但对 Nocturnel 玩家技能而言，当前设计入口已经迁移到
repo-local `data-design-skill-player`；正式评分的独立 ownership 由玩家技能评审 ADR 记录。
