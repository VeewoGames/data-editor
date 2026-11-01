# ADR: Nocturnel 技能预算账本模型（历史迁回入口）

<!-- document-state: historical -->

## Context

原项目决策的正文已由原字节历史对象保留，本文件只保留历史导航。

## Decision

本文件保留旧入口的可达性，不再拥有项目规则。来源核实日期为 2026-10-25；旧预算、评级、开发状态、样本、配置路径、视图数量及历史验收不得据此恢复为当前规则。

项目知识的原字节来源、过期原因和承接映射见[夜曲历史接收索引](C:/Code/Nocturnel/.claw/truth/tech/data-editor/编辑器侧项目知识承接与历史索引.md)。现行规则仍由以下既有 owner 维护，本次迁回不覆盖其内容：

- [0425-single-component-bu-trial-guide-authority-boundary.md](C:/Code/Nocturnel/.claw/truth/adr/0425-single-component-bu-trial-guide-authority-boundary.md)
- [玩家技能mana预算双层模型.md](C:/Code/Nocturnel/.claw/truth/玩家技能mana预算双层模型.md)

## Alternatives

不在编辑器保留另一套现行项目规则，也不以旧文档覆盖夜曲当前 owner。

## Consequences

- 来源标识：`K04`，原文件：`adr/nocturnel-skill-budget-ledger-model.md`。
- 原字节 SHA-256：`76f5c413177901228008a21f2823a891edd59fed456cc70e53e18b9a1d30dddc`。
- [原字节历史对象](C:/Code/Nocturnel/docs/records/data-editor知识迁回来源/2026-10-25/objects/76f5c413177901228008a21f2823a891edd59fed456cc70e53e18b9a1d30dddc.source)。对象为不可执行的 `.source`，不作为 current 检索正文；其相对引用按 manifest 的原路径解释，不在这里执行。
- [来源 manifest](C:/Code/Nocturnel/docs/records/data-editor知识迁回来源/2026-10-25/manifest.v1.json)。

编辑器的 shared/profile 分层、普通保存、文档合同、自动化调度及历史非重放仍由通用产品维护；项目知识历史化不改变任何业务数据、现行配置或运行保护。
