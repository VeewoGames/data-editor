# Data Editor 任务 3：冻结耦合证据、旧行为与 identity disposition 回执

## 方案概述

本回执只记录已授权的只读调查结果与冻结产物。它不改变任何 runtime、tests、数据、项目配置、Nocturnel、submodule/gitlink，也不构成历史 `__entry_id` 的物理治理授权。

## 工作包与基线

- 工作包：任务 3「冻结耦合证据、旧行为与 identity disposition」。
- Data Editor：`master` @ `66403f88cf6513d15195b17ba82ffed9a4cf85c3`；开始时未暂存 diff hash 为 `c210720c4a822edffc06162e7e65b020ef568885`，暂存区为空。
- Nocturnel：`master` @ `66c4d92d4174d122f48c33787d74356ec2d1c7c2`；开始时未暂存 diff hash 为 `761eb12a24445e3b17618426facf62a42db15412`，暂存区为空。
- Nocturnel gitlink：`.godot-mcp` 为 `e37ffccbb8fbf8fef699a9a64645e84b1da00949`；`tools/data-editor` 为 `f298d3ff684ac411fdc796a711d1e2431d389a43`，子模块自身 clean、落后 upstream 3 个提交。
- 审计结束时 Nocturnel 的 tracked diff hash 已变为 `4769a367870d18675d5154ea54407d3300600da9`，并出现 `tests/manifests/test_catalog.json`、`tests/node/testing_governance_scenario_catalog_v1.test.js` 的外部脏改动。任务 3 未写入 Nocturnel；后续接收方必须重新取得该范围的 owner handoff。

机器可读的 identity disposition、共享路径 owner map、删除阻断清单与验证记录见同目录的 [identity disposition JSON](2026-08-02-Data%20Editor任务3-identity-disposition.json)。

## 已冻结事实

1. 当前 Data Editor 在 `openDocumentAt` 后调用 `ensurePersistentEntryIds`；缺失 ID 会令文档 dirty，随后可能经正常保存路径落盘。数组新增和复制同样会生成 `__entry_id`。
2. 普通 `DocumentStore` / writeback 已具备 session RowId 路径；但 `Entry Action` 仍以非空、唯一 `__entry_id` 为硬前置，缺失或重复时 fail-closed。
3. Nocturnel 当前扫描到的主要数据集合均没有空或 collection-local 重复 `__entry_id`。这仅证明格式和集合内唯一性，不证明可删除。
4. `skills.json:skills` 同时被项目 Action policy、自动化 profile、共享视图、审查/迁移工具和 Godot SkillDataModel 保存链消费；`traits`、`runes`、`stats`、`glossary` 也各有配置、validator 或生成器证据。因此全部进入 retain-and-freeze。
5. Data Editor 仍含默认 `nocturnel` adapter、固定 `skills.json` 保存门/合同路径、硬编码嵌套 schema，以及直接读取相邻 Nocturnel 的测试。Nocturnel 仍通过 gitlink、启动脚本和 `.data-editor` 项目配置消费该工具。

## Serial handoff 门

- 已脏的 Data Editor Entry Action 路径（`App.tsx`、API、Entry Action、writeback 和对应测试）归既有 owner；任务 5～7 首次写入前必须取得 final path set、baseline/final diff hash、允许修改集和 handoff receipt。
- Nocturnel 的 `.data-editor/shared-views.json`、`skills.json`、`board_objects.json` 已脏；Data Editor 不得接管或归因这些改动。
- `tools/data-editor` gitlink、`open-data-editor.ps1` 与项目侧配置仅可在 Data Editor 发布门完成后进入 Nocturnel owner handoff；本回执不允许提前改写。

## 未授权物理删除

没有本工作包可执行的删除项。所有历史 `__entry_id`、包括 `skills/traits/runes/stats/glossary`，均保持原样。已存在的 fixture policy 删除属于其他 Entry Action owner，不在本任务接受、恢复或继续删除。

## 验证与下一项建议

- 已执行：双仓 `HEAD/status/diff hash/submodule status`；定向 `rg` 与关键调用链读取；Nocturnel JSON collection 扫描；Nocturnel `git diff --check` 和 `git diff --cached --check` 均为 exit 0。
- 阻塞：尚无 Entry Action、Nocturnel 配置、Nocturnel 内容的 serial handoff receipt；历史 ID 治理也未获单独授权。
- 建议下一项：保持计划暂停。若另获明确授权，先执行任务 4，仅建立 Data Editor 仓内 hermetic fixture 与独立测试基线，并在首次写入前复核本回执所冻结的 owner map/hash。
