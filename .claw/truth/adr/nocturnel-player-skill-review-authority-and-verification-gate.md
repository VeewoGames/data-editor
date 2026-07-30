# Nocturnel 玩家技能评审权威与验证门禁

## Context

玩家技能设计曾同时承担规则设计、正式评分和实现完成判断，导致三个不同问题被压进同一输出：

- 设计稿是否具备可评审质量；
- 正式设计结论与 `rating` 由谁负责；
- 已有运行时实现是否具备当前、可追溯的玩法验证证据。

`impl_status=已实现`、既有评分和 `use=true` 都只能描述局部事实，不能证明当前设计已经通过正式
评审，也不能证明完整玩法语义已经验证。由 Skill 自报通过或用通用测试替代技能级证据，会让
`dev_status=完成` 失去可审计含义。

同时，玩家技能的 canonical JSON 与开发 Markdown 都属于 Nocturnel。Data Editor 是通用编辑器，
不应承载 Nocturnel 专用的评审模式、action、fixture 配置或状态写回特判。

## Decision

### 1. 设计、正式评审和实现验证采用独立职责

Nocturnel 使用 repo-local `data-design-skill-player` 负责设计产出，使用 repo-local
`review-player-skill` 负责独立正式评审，并使用确定性工具消费实现证据。

`data-design-skill-player` 不得生成非空正式 `rating`；实质设计变化使技能重新进入 `待评审` 时，
它只能清空旧评分。非空 `rating` 的生成建议唯一归 `review-player-skill` 所有。

### 2. 正式结果采用设计与完成双轴

正式评审必须分别输出：

- `designVerdict`：`evidence_insufficient`、`changes_required` 或 `approved`；
- `completionGate`：`implementation_pending`、`verification_missing`、
  `verification_failed` 或 `verified`。

设计未批准时不进入实现完成判断。只有 `designVerdict=approved` 且
`completionGate=verified` 才能建议 `dev_status=完成`。

### 3. 实现验证只接受测试治理的 `run_report v2`

玩家技能验证 producer 只消费正式 mapping 指定的测试治理 `run_report v2`，并校验 profile、
test identity、subject projection、晋升产物及摘要。没有充分 mapping、证据缺失、证据失效或
证据不匹配时必须失败关闭，返回 `verification_missing` 或 `verification_failed`。

Skill 自述、`impl_status`、通用测试成功或未绑定到当前设计的旧报告均不能替代该证据。

### 4. 评审阶段保持 canonical 数据只读，设计写回使用独立 proposal authority

正式评审只发布不可变 review artifact 和确定性 Markdown section patch，不直接修改
`data/content/skills.json` 或 canonical 开发文档。

`data-design-skill-player` 的 Data Editor action 是独立写回入口：项目 policy/profile 以该
`actionId` 把入口限制在 `owner=player` 的技能和按 `skill_id` 推导的唯一 canonical Markdown；
它不与同文件的 `fill-data-name` 共享 target 授权。通用 Data Editor
不再配置 Nocturnel 设计字段 allowlist。实际 JSON 字段边界由 repo-local Skill 合同拥有：
它必须保持 `impl_status`、`nodes`、`action_source`、`use`、`skill_id`、`__entry_id` 与
`dev_doc` 不变，不得生成非空 `rating`，仅可在实质设计变化后显式清空已失效评分。设计 action
的成功不能替代正式评审、评分或实现完成判断。

### 5. 项目专用能力归 Nocturnel 所有

玩家技能评审 Skill、预检工具、验证 mapping、producer 和合同测试全部归 Nocturnel 仓库所有。
Data Editor 保持项目无关；只有能够脱离 Nocturnel 独立复现的通用编辑器缺陷，才另立任务修改
Data Editor。

## Alternatives

- 继续由设计 Skill 同时评分和批准完成：拒绝。设计者自评会混合产出职责与独立门禁，旧评分也
  容易在实质变更后被错误继承。
- 用单一 `dev_status` 同时表达设计和实现：拒绝。它无法区分“设计通过但未实现”“已实现但缺少
  当前验证”和“验证失败”。
- 把 `impl_status=已实现` 或通用测试通过视为完成：拒绝。二者都不能证明目标玩家技能的完整
  玩法语义与当前设计一致。
- 允许评审 Skill 直接写 canonical JSON 和 Markdown：拒绝。只读判断与持久化提交具有不同授权、
  并发和恢复风险。
- 允许设计 action 同时修改评分或 lifecycle 字段：拒绝。它会再次混合设计、正式评审和完成门禁
  的 ownership。
- 在 Data Editor policy 中重复维护 Nocturnel 设计字段 allowlist：拒绝。通用 authority 只提供
  目标条目的现有字段，项目业务边界由 repo-local Skill 合同单点维护，避免两份字段清单漂移。
- 在 Data Editor 中加入 Nocturnel 专用分支：拒绝。该逻辑属于项目规则，不属于通用编辑器能力。

## Consequences

- 正式评分和完成状态具有单一 ownership；设计修改、设计评审和实现复核可以分别审计。
- `待评审`、`待修改`、`待开发` 和 `完成` 不再隐含彼此的证据，调用方必须读取双轴结果。
- 新玩家技能要进入 `verified`，必须先建立正式验证 mapping 和足够的 `run_report v2` 证据。
- 正式映射为空或证据不足时，已实现技能仍保持 `verification_missing`，不能因已有评分或启用状态
  自动晋升。
- 评审产物增加了摘要与 artifact 管理成本，但 canonical 数据不会被只读评审隐式修改。
- 满足规则、binding、action 级 policy、authority 与 fencing 门禁的 proposal-only action 可把目标条目的现有字段合同与 canonical Markdown 交给
  `data-design-skill-player`；具体字段选择受其 repo-local 合同约束，不授予正式评分或实现完成
  判断。
- Data Editor 不需要为了 Nocturnel 玩家技能评审增加项目专用运行时代码、配置或测试分支。

Data Editor 当前写回能力与禁用边界仍由
[`entry-actions-legacy-direct-write-hard-disable.md`](./entry-actions-legacy-direct-write-hard-disable.md)
拥有；本 ADR 只决定 Nocturnel 玩家技能评审不能绕过该边界。

技能预算账本、BU 模型与持久化 `dev_doc` 的设计入口仍由
[`nocturnel-skill-budget-ledger-model.md`](./nocturnel-skill-budget-ledger-model.md)
拥有；本 ADR 只拥有正式评审、评分与实现完成门禁。

<!-- state: history -->
## Evolution history

<!-- dated: 2026-07-29 -->
### 设计 action 获得受控条目写回，评审只读边界保持不变

Nocturnel 曾为 `data-design-skill-player` 配置 proposal-only eligibility、玩家行谓词和
canonical Markdown 模板；独立 eligibility 随后退出当前协议。JSON 字段选择由 repo-local Skill 合同负责，不再在通用 policy 中
重复配置 allowlist。此前“JSON 与 Markdown 受控写回尚未实现”的事实退出当前状态；正式评审仍
只发布 artifact 与建议 patch，评分和完成门禁仍由独立职责持有。
