# Nocturnel 玩家技能正式评审与实现完成门禁

<!-- state: current -->
## 当前行为

Nocturnel 的玩家技能设计、正式评审和实现验证已经分为三个职责层：

1. `.agents/skills/data-design-skill-player/` 负责设计或修订正式规则、资源值、玩家文案、设计标签、targeting 意图和 canonical 开发文档。
2. `.agents/skills/review-player-skill/` 独立负责正式设计结论、非空 `rating` 的生成建议和实现完成门禁。
3. 确定性工具负责结构预检、不可变评审产物和 `run_report v2` 实现证据消费；Skill 不能自行声明实现已验证。

以下路径均以 Nocturnel 仓库根目录为基准。玩家技能 canonical 数据入口是
`data/content/skills.json`，canonical 开发文档必须解析为
`项目文档/开发/技能/<skill_id>.md`。评审工具只读取这两个 canonical 目标，
并把评审 artifact 与建议替换的 `## 审查证据` 章节发布到 runtime 产物目录；它不直接修改 JSON
或 Markdown。

## 职责与状态边界

`data-design-skill-player` 不得生成非空正式 `rating`，也不得声称 `待开发` 或 `完成`。Data Editor
的通用 proposal authority 只把目标玩家条目的现有字段与 canonical 开发文档合同交给该 Skill，
不再配置 Nocturnel 设计字段白名单；实际修改边界由 repo-local Skill 合同拥有。当前合同明确要求
保持 `impl_status`、`nodes`、`action_source`、`use`、`skill_id`、`__entry_id` 与 `dev_doc`
不变，且不得生成非空评分。实质设计变化使旧评分失效时，Skill 只能显式清空旧 `rating`，不能把
正式评分或完成判断夹带进设计写回。

`review-player-skill` 支持两个入口：

- `design_review` 只接受 `dev_status=待评审`，输出
  `evidence_insufficient`、`changes_required` 或 `approved`。
- `completion_only` 只接受 `dev_status=待开发`，并要求存在与当前设计一致的既有评审 artifact；
  它保留原设计结论与评分，只重查实现完成门禁。

正式结果采用双轴而不是把“设计通过”和“实现完成”压成一个状态：

- `designVerdict` 表达设计证据是否充分、是否需要修改或是否批准。
- `completionGate` 表达 `implementation_pending`、`verification_missing`、
  `verification_failed` 或 `verified`。

只有 `designVerdict=approved` 才进入实现完成门禁。只有 `completionGate=verified` 才能建议
`dev_status=完成`；`impl_status=已实现` 本身不等于已经完成验证。

## 实现证据门禁

实现验证 producer 位于 `tools/testing/run_player_skill_verification.mjs`，正式映射位于
`tests/manifests/player_skill_verification_map.json`。producer 只接受测试治理产生的
`run_report v2`，并核对 profile、test identity、subject projection、晋升产物与摘要。

当前正式映射没有为具体玩家技能登记充分 profile，因此默认结果是 `verification_missing`。该默认值
是失败关闭边界：通用测试、实现字段或 Skill 自述都不能被推断成某个玩家技能的完整玩法验证。

## 评审产物完整性

确定性评审工具位于 `tools/review/player-skill-review.mjs`。评审产物至少区分：

- `designSubjectDigest`：设计主题摘要；排除 `dev_status`、`rating`、`use`、`impl_status`、
  `nodes`、`action_source` 等实现或生命周期载荷。
- `semanticDigest`：评审语义摘要，用于判断相同输入与结论是否发生语义漂移。
- `artifactDigest`：完整产物摘要，用于校验发布内容未被修改。

摘要复核、artifact 发布和建议章节生成必须保持 canonical JSON 与 Markdown 不变。任何正式写回都
不属于只读评审的隐含结果。Data Editor 的 proposal-only action 现可在独立 action eligibility、
project policy 与 profile authority 下，把目标条目的现有字段合同和唯一 canonical Markdown
交给 repo-local Skill，并只提交该 Skill 实际选择的字段；这不扩大评审 Skill 的只读边界，也不
授权其生成正式评分或声明实现完成。

## 复核锚点

后续修改此能力时，至少检查：

- `.agents/skills/data-design-skill-player/SKILL.md`
- `.agents/skills/review-player-skill/SKILL.md`
- `.agents/skills/review-player-skill/references/review-contract.md`
- `tools/review/player-skill-review.mjs`
- `tools/testing/run_player_skill_verification.mjs`
- `tests/manifests/player_skill_verification_map.json`
- `tests/node/player_skill_review_skill_contract_v1.test.js`
- `tests/node/player_skill_review_tool_v1.test.js`
- `tests/node/player_skill_verification_producer_v1.test.js`
- `.data-editor/entry-action-eligibility.json`
- `.data-editor/entry-action-policy.json`
- `.data-editor/automation-profile.json`

预算账本、BU 分值和品质评分维度仍由
[`nocturnel-skill-budget-model-analysis.md`](./nocturnel-skill-budget-model-analysis.md) 负责；
本 Truth 只拥有正式评审职责分离、双轴状态和实现证据门禁。

<!-- state: history -->
## 演进记录

<!-- dated: 2026-07-29 -->
### 缺少当前验证证据的历史完成状态已回退

`skill_cleave`、`skill_shield_bash`、`skill_leap_slash`、`skill_whirlwind`、
`skill_bleeding_strike`、`skill_seismic_cry`、`skill_axe_throw` 和 `skill_jump` 曾处于
`dev_status=完成`，但没有当前正式映射能够证明完整玩法语义。它们已回退为 `dev_status=待开发`，
同时保留既有 `impl_status=已实现`、评分、启用状态和玩法数据。

这次迁移确立了可重复使用的状态解释：实现存在、评分存在或技能启用都不能替代当前验证证据；
缺少证据时必须保持 `verification_missing`，不能继续展示为完成。

<!-- dated: 2026-07-29 -->
### 设计 action 接入受控条目与 canonical 文档写回

Nocturnel 将 `data-design-skill-player` 列入 proposal-only eligibility，并用项目 policy/profile
将其限制为 `owner=player` 与按 `skill_id` 推导的单一开发 Markdown；具体 JSON 字段边界由
repo-local Skill 合同持有。设计 action 不得生成非空 `rating`，并明确保持实现、运行时和稳定
身份字段不变；正式评审、评分与完成门禁继续由独立评审和验证职责持有。
